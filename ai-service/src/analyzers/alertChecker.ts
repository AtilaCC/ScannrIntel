// ============================================================
// ALERT CHECKER
// Evaluates live ticker data against user alert configurations.
//
// Optimisations vs original:
//   - In-memory alert cache (DB refreshed every 30s, not per tick)
//   - Per-alert cooldown enforcement (Map-based, O(1))
//   - Symbol → alert index for O(1) lookup
//   - Batch trigger persistence
//   - Notification dispatch (in-app + Telegram + email stubs)
// ============================================================

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { REDIS_CHANNELS } from '../../utils/shared';
import { config } from '../config';
import { NotificationPayload } from '../types';
import { createLogger, generateId } from '../../utils/shared';

const logger = createLogger('alert-checker');

interface CachedAlert {
  id:        string;
  userId:    string;
  symbol:    string;
  condition: string;
  threshold: number;
  isActive:  boolean;
  channels:  string[];
}

interface TickerData {
  symbol:                string;
  price:                 number;
  priceChangePercent24h: number;
  quoteVolume24h:        number;
}

export class AlertChecker {
  // symbol → alerts for that symbol (rebuilt every refreshMs)
  private alertIndex:   Map<string, CachedAlert[]> = new Map();
  private lastRefresh:  number = 0;
  // alertId → last trigger timestamp
  private cooldowns:    Map<string, number> = new Map();
  // Stats
  private checksRun:    number = 0;
  private triggered:    number = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis:  Redis,
  ) {}

  // ── Main entry ────────────────────────────────────────────

  async check(ticker: TickerData): Promise<void> {
    this.checksRun++;

    // Refresh alert cache if stale
    await this.maybeRefreshCache();

    const alerts = this.alertIndex.get(ticker.symbol);
    if (!alerts || alerts.length === 0) return;

    const toTrigger: Array<{ alert: CachedAlert; value: number }> = [];

    for (const alert of alerts) {
      if (!alert.isActive) continue;

      // Cooldown check
      const last = this.cooldowns.get(alert.id) ?? 0;
      if (Date.now() - last < config.alertMinRetriggerMs) continue;

      const result = this.evaluate(alert, ticker);
      if (result !== null) toTrigger.push({ alert, value: result });
    }

    if (toTrigger.length === 0) return;

    // Trigger all matched alerts
    await Promise.all(toTrigger.map(({ alert, value }) => this.trigger(alert, ticker, value)));
  }

  get stats() {
    return { checksRun: this.checksRun, triggered: this.triggered };
  }

  // ── Private ───────────────────────────────────────────────

  private evaluate(alert: CachedAlert, t: TickerData): number | null {
    const { condition, threshold } = alert;
    switch (condition) {
      case 'PRICE_ABOVE':
        return t.price >= threshold ? t.price : null;
      case 'PRICE_BELOW':
        return t.price <= threshold ? t.price : null;
      case 'PRICE_CHANGE_PERCENT':
        return Math.abs(t.priceChangePercent24h) >= threshold ? t.priceChangePercent24h : null;
      case 'VOLUME_SPIKE_PERCENT':
        return t.quoteVolume24h >= threshold ? t.quoteVolume24h : null;
      case 'WHALE_TRADE_SIZE':
        // Whale alerts are triggered directly by the signal pipeline, not here
        return null;
      default:
        return null;
    }
  }

  private async trigger(
    alert:  CachedAlert,
    ticker: TickerData,
    value:  number,
  ): Promise<void> {
    this.cooldowns.set(alert.id, Date.now());
    this.triggered++;

    const message = this.buildMessage(alert, value);

    try {
      const triggered = await this.prisma.triggeredAlert.create({
        data: {
          id:             generateId(),
          alertConfigId:  alert.id,
          userId:         alert.userId,
          symbol:         ticker.symbol,
          condition:      alert.condition as any,
          triggerValue:   value,
          threshold:      alert.threshold,
          message,
        },
      });

      // Publish for real-time UI notification
      await this.redis.publish(
        REDIS_CHANNELS.ALERTS,
        JSON.stringify({
          type:      'alert_triggered',
          payload:   { ...triggered, userId: alert.userId },
          timestamp: Date.now(),
        }),
      );

      // Dispatch external notifications
      const notification: NotificationPayload = {
        userId:    alert.userId,
        alertId:   alert.id,
        symbol:    ticker.symbol,
        message,
        condition: alert.condition,
        value,
        threshold: alert.threshold,
        channels:  alert.channels,
      };

      await this.dispatchNotifications(notification);

      logger.info('Alert triggered', {
        alertId:   alert.id,
        userId:    alert.userId,
        symbol:    ticker.symbol,
        condition: alert.condition,
        value:     value.toFixed(4),
        threshold: alert.threshold,
      });

    } catch (err) {
      logger.error('Alert trigger failed', { alertId: alert.id, error: (err as Error).message });
    }
  }

  private buildMessage(alert: CachedAlert, value: number): string {
    const sym = alert.symbol;
    const t   = alert.threshold;
    switch (alert.condition) {
      case 'PRICE_ABOVE':
        return `🚀 ${sym} hit $${value.toLocaleString()} — above your $${t.toLocaleString()} alert`;
      case 'PRICE_BELOW':
        return `📉 ${sym} dropped to $${value.toLocaleString()} — below your $${t.toLocaleString()} alert`;
      case 'PRICE_CHANGE_PERCENT':
        return `⚡ ${sym} moved ${value >= 0 ? '+' : ''}${value.toFixed(2)}% in 24h (threshold ±${t}%)`;
      case 'VOLUME_SPIKE_PERCENT':
        return `📊 ${sym} volume reached $${(value / 1e6).toFixed(1)}M (threshold $${(t / 1e6).toFixed(1)}M)`;
      default:
        return `Alert triggered for ${sym}`;
    }
  }

  private async dispatchNotifications(n: NotificationPayload): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (n.channels.includes('TELEGRAM') && config.telegramBotToken) {
      tasks.push(this.sendTelegram(n));
    }
    if (n.channels.includes('EMAIL') && config.smtpHost) {
      tasks.push(this.sendEmail(n));
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }

  private async sendTelegram(n: NotificationPayload): Promise<void> {
    try {
      // Fetch the user's telegram chat ID from preferences
      const prefs = await this.prisma.userPreferences.findUnique({
        where:  { userId: n.userId },
        select: { telegramChatId: true },
      });
      if (!prefs?.telegramChatId) return;

      const url  = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
      const body = {
        chat_id:    prefs.telegramChatId,
        text:       `🔔 CryptoIntel Alert\n\n${n.message}`,
        parse_mode: 'HTML',
      };

      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        logger.warn('Telegram send failed', { userId: n.userId, status: res.status });
      }
    } catch (err) {
      logger.error('Telegram dispatch error', { error: (err as Error).message });
    }
  }

  private async sendEmail(n: NotificationPayload): Promise<void> {
    // Email sending is intentionally stubbed — wire up nodemailer or
    // a transactional email service (Resend, SendGrid, Postmark) here.
    logger.debug('Email notification stub', { userId: n.userId, symbol: n.symbol });
  }

  // ── Cache management ──────────────────────────────────────

  private async maybeRefreshCache(): Promise<void> {
    const age = Date.now() - this.lastRefresh;
    if (age < config.alertDbCacheRefreshMs) return;

    try {
      const alerts = await this.prisma.alertConfig.findMany({
        where: { isActive: true },
        select: {
          id: true, userId: true, symbol: true,
          condition: true, threshold: true, isActive: true, channels: true,
        },
      });

      // Rebuild symbol index
      this.alertIndex.clear();
      for (const a of alerts) {
        const existing = this.alertIndex.get(a.symbol) ?? [];
        existing.push(a as CachedAlert);
        this.alertIndex.set(a.symbol, existing);
      }

      this.lastRefresh = Date.now();
      logger.debug('Alert cache refreshed', { total: alerts.length, symbols: this.alertIndex.size });
    } catch (err) {
      logger.error('Alert cache refresh failed', { error: (err as Error).message });
    }
  }
}
