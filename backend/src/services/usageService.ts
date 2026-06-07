// ============================================================
// USAGE SERVICE
// Meters daily feature consumption per user and enforces
// the hard caps defined in PLANS.
//
// Features metered:
//   ai_insights   — Claude analysis calls per day
//   api_calls     — REST API requests per minute (Redis-based)
//   alerts        — total active alert count (DB count, not daily)
//   watchlist     — total watchlist entries (DB count)
// ============================================================

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { PlanTier, getFeature, withinLimit, PLANS } from '../config/plans';
import { createLogger } from '../utils/shared';

const logger = createLogger('usage-service');

export type MeterableFeature = 'ai_insights' | 'api_calls';

export const createUsageService = (prisma: PrismaClient, redis: Redis) => ({

  // ── Increment a daily metered counter ─────────────────────

  async increment(
    userId:         string,
    subscriptionId: string,
    feature:        MeterableFeature,
    amount:         number = 1,
  ): Promise<number> {
    const today = todayDate();

    const record = await prisma.usageRecord.upsert({
      where:  { subscriptionId_feature_date: { subscriptionId, feature, date: today } },
      update: { count: { increment: amount } },
      create: { subscriptionId, userId, feature, count: amount, date: today },
    });

    return record.count;
  },

  // ── Check if within daily limit ───────────────────────────

  async checkDailyLimit(
    userId:         string,
    subscriptionId: string,
    feature:        MeterableFeature,
    plan:           PlanTier,
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const limit = feature === 'ai_insights'
      ? getFeature(plan, 'aiInsightsPerDay')
      : -1; // other features handled differently

    if (limit === -1) return { allowed: true, current: 0, limit: -1 };

    const today  = todayDate();
    const record = await prisma.usageRecord.findUnique({
      where: { subscriptionId_feature_date: { subscriptionId, feature, date: today } },
    });

    const current = record?.count ?? 0;
    return { allowed: withinLimit(current, limit), current, limit };
  },

  // ── Get today's usage for a user ─────────────────────────

  async getTodayUsage(subscriptionId: string): Promise<Record<string, number>> {
    const today   = todayDate();
    const records = await prisma.usageRecord.findMany({
      where: { subscriptionId, date: today },
    });
    return Object.fromEntries(records.map((r) => [r.feature, r.count]));
  },

  // ── Get usage for the current billing period ─────────────

  async getPeriodUsage(subscriptionId: string, periodStart: Date): Promise<Record<string, number>> {
    const records = await prisma.usageRecord.findMany({
      where: { subscriptionId, date: { gte: periodStart } },
    });
    const totals: Record<string, number> = {};
    for (const r of records) {
      totals[r.feature] = (totals[r.feature] ?? 0) + r.count;
    }
    return totals;
  },

  // ── Check structural limits (non-daily counters) ──────────
  // These count current DB rows, not daily usage.

  async checkAlertLimit(userId: string, plan: PlanTier): Promise<{
    allowed: boolean; current: number; limit: number;
  }> {
    const limit = getFeature(plan, 'maxAlerts');
    if (limit === -1) return { allowed: true, current: 0, limit: -1 };

    const current = await prisma.alertConfig.count({ where: { userId, isActive: true } });
    return { allowed: withinLimit(current, limit), current, limit };
  },

  async checkWatchlistLimit(userId: string, plan: PlanTier): Promise<{
    allowed: boolean; current: number; limit: number;
  }> {
    const limit = getFeature(plan, 'maxWatchlistSymbols');
    if (limit === -1) return { allowed: true, current: 0, limit: -1 };

    const current = await prisma.watchlist.count({ where: { userId } });
    return { allowed: withinLimit(current, limit), current, limit };
  },

  // ── API rate limiting (Redis-based sliding window) ────────

  async checkApiRateLimit(userId: string, plan: PlanTier): Promise<{
    allowed: boolean; remaining: number; limit: number;
  }> {
    const limit = getFeature(plan, 'apiRateLimit');
    if (limit === 0) return { allowed: false, remaining: 0, limit: 0 };
    if (limit === -1) return { allowed: true, remaining: 999, limit: -1 };

    const key      = `rate:api:${userId}`;
    const windowMs = 60_000; // 1 minute
    const now      = Date.now();
    const cutoff   = now - windowMs;

    // Sliding window using Redis sorted set
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(key, '-inf', cutoff);
    pipe.zadd(key, now, `${now}`);
    pipe.zcard(key);
    pipe.expire(key, 65);
    const results = await pipe.exec();

    const count     = (results?.[2]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    return { allowed: count <= limit, remaining, limit };
  },

  // ── Build usage summary for billing page ─────────────────

  async getSummary(userId: string, plan: PlanTier, subscriptionId: string, periodStart: Date) {
    const [todayUsage, periodUsage, alertCount, watchlistCount] = await Promise.all([
      this.getTodayUsage(subscriptionId),
      this.getPeriodUsage(subscriptionId, periodStart),
      prisma.alertConfig.count({ where: { userId, isActive: true } }),
      prisma.watchlist.count({ where: { userId } }),
    ]);

    const features = PLANS[plan].features;

    return {
      aiInsights: {
        today: todayUsage['ai_insights'] ?? 0,
        limit: features.aiInsightsPerDay,
        period: periodUsage['ai_insights'] ?? 0,
      },
      alerts: {
        current: alertCount,
        limit:   features.maxAlerts,
      },
      watchlist: {
        current: watchlistCount,
        limit:   features.maxWatchlistSymbols,
      },
      apiCalls: {
        period: periodUsage['api_calls'] ?? 0,
        rpmLimit: features.apiRateLimit,
      },
    };
  },
});

function todayDate(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export type UsageService = ReturnType<typeof createUsageService>;
