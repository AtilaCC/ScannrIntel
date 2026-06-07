// ============================================================
// CONTEXT ENRICHER
// Fetches market context from Redis before each Claude call.
// Gives Claude the data it needs to produce high-quality,
// data-grounded analysis instead of generic commentary.
// ============================================================

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { DbSignal, MarketContext } from '../types';
import { config } from '../config';
import { createLogger } from '../../../../shared/src/utils';

const logger = createLogger('context-enricher');

export class ContextEnricher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis:  Redis,
  ) {}

  async enrich(signal: DbSignal): Promise<MarketContext> {
    const symbol = signal.symbol;

    // Fetch all context sources in parallel
    const [ticker, book, recentSignals, lastInsight, prevScore] = await Promise.all([
      this.fetchTicker(symbol),
      this.fetchBook(symbol),
      this.fetchRecentSignals(symbol),
      this.fetchLastInsight(symbol),
      this.fetchPreviousScore(symbol),
    ]);

    // Base context from ticker cache (written by scanner)
    const ctx: MarketContext = {
      symbol,
      currentPrice:   ticker?.price                ?? 0,
      priceChange24h: ticker?.priceChangePercent24h ?? 0,
      volume24h:      ticker?.quoteVolume24h        ?? 0,
      high24h:        ticker?.high24h               ?? 0,
      low24h:         ticker?.low24h                ?? 0,
    };

    // 24h range position (0 = at low, 1 = at high)
    if (ctx.high24h > ctx.low24h && ctx.currentPrice > 0) {
      ctx.rangePosition = (ctx.currentPrice - ctx.low24h) / (ctx.high24h - ctx.low24h);
    }

    // Spread from book ticker
    if (book?.spreadPercent !== undefined) {
      ctx.spreadPercent = book.spreadPercent;
    }

    // Enrich with candle-derived data if available
    if (ticker) {
      ctx.priceChange1h = await this.fetchPriceChange1h(symbol, ticker.price);
      ctx.volumeMA20    = await this.fetchVolumeMA(symbol);
      if (ctx.volumeMA20 && ctx.volumeMA20 > 0) {
        ctx.volumeRatio = ticker.quoteVolume24h / ctx.volumeMA20;
      }
    }

    // Recent signals (for context about this symbol's recent behaviour)
    if (recentSignals.length > 0) {
      ctx.recentSignals = recentSignals.map((s) => ({
        type:      s.type,
        severity:  s.severity,
        createdAt: s.createdAt.toISOString(),
      }));
    }

    // When was the last AI insight generated for this symbol?
    if (lastInsight) {
      ctx.lastInsightAt = lastInsight.createdAt.toISOString();
    }

    // Previous score for smoothing
    if (prevScore) {
      ctx.previousScore = prevScore;
    }

    return ctx;
  }

  // ── Private helpers ───────────────────────────────────────

  private async fetchTicker(symbol: string): Promise<any | null> {
    try {
      const raw = await this.redis.get(`market:ticker:${symbol}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async fetchBook(symbol: string): Promise<any | null> {
    try {
      const raw = await this.redis.get(`market:book:${symbol}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async fetchPreviousScore(symbol: string): Promise<{
    risk: number; opportunity: number; computedAt: number;
  } | undefined> {
    try {
      const raw = await this.redis.get(`market:score:${symbol}`);
      if (!raw) return undefined;
      const score = JSON.parse(raw);
      return {
        risk:        score.finalRisk        ?? score.breakdown?.finalRisk,
        opportunity: score.finalOpportunity ?? score.breakdown?.finalOpportunity,
        computedAt:  score.computedAt       ?? Date.now(),
      };
    } catch {
      return undefined;
    }
  }

  private async fetchPriceChange1h(symbol: string, currentPrice: number): Promise<number | undefined> {
    try {
      // Try to get the 1h candle close from 1 hour ago
      const raw = await this.redis.get(`market:candle:${symbol}:1h:prev`);
      if (!raw) return undefined;
      const candle = JSON.parse(raw);
      if (!candle?.open || candle.open === 0) return undefined;
      return ((currentPrice - candle.open) / candle.open) * 100;
    } catch {
      return undefined;
    }
  }

  private async fetchVolumeMA(symbol: string): Promise<number | undefined> {
    try {
      const raw = await this.redis.get(`market:vma20:${symbol}`);
      if (!raw) return undefined;
      const n = parseFloat(raw);
      return isFinite(n) ? n : undefined;
    } catch {
      return undefined;
    }
  }

  private async fetchRecentSignals(symbol: string): Promise<Array<{
    type: string; severity: string; createdAt: Date;
  }>> {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return await this.prisma.signal.findMany({
        where:   { symbol, createdAt: { gte: cutoff } },
        orderBy: { createdAt: 'desc' },
        take:    config.contextLookbackSignals,
        select:  { type: true, severity: true, createdAt: true },
      });
    } catch {
      return [];
    }
  }

  private async fetchLastInsight(symbol: string): Promise<{ createdAt: Date } | null> {
    try {
      return await this.prisma.aIInsight.findFirst({
        where:   { symbol },
        orderBy: { createdAt: 'desc' },
        select:  { createdAt: true },
      });
    } catch {
      return null;
    }
  }
}
