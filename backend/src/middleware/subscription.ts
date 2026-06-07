// ============================================================
// SUBSCRIPTION MIDDLEWARE
//
// requirePlan(tier)    — blocks request if user is below tier
// requireFeature(feat) — blocks if plan doesn't include feature
// checkQuota(feature)  — increments + enforces daily/total limits
// requireApiAccess()   — enforces API rate limit for API key users
// ============================================================

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { AuthRequest } from './authenticate';
import { AppError } from './errorHandler';
import { createSubscriptionService } from '../services/subscriptionService';
import { createUsageService } from '../services/usageService';
import {
  PlanTier, getFeature, canAccessSignalType, canUseAlertChannel,
  compareTiers, PLANS,
} from '../config/plans';

// Singleton services (created once, reused per request)
let _prisma: PrismaClient;
let _redis:  Redis;
let _subService:   ReturnType<typeof createSubscriptionService>;
let _usageService: ReturnType<typeof createUsageService>;

export function initSubscriptionMiddleware(prisma: PrismaClient, redis: Redis) {
  _prisma       = prisma;
  _redis        = redis;
  _subService   = createSubscriptionService(prisma);
  _usageService = createUsageService(prisma, redis);
}

// ── Helper: get plan from JWT or DB ──────────────────────────

async function resolveUserPlan(req: AuthRequest): Promise<{
  plan: PlanTier;
  subscriptionId: string;
  periodStart: Date;
}> {
  // Fast path: plan embedded in JWT
  const jwtPlan = (req.user as any)?.plan as PlanTier | undefined;
  if (jwtPlan && jwtPlan !== 'FREE') {
    // Verify it's a real plan name
    if (PLANS[jwtPlan]) {
      const sub = await _prisma.subscription.findUnique({
        where:  { userId: req.user!.sub },
        select: { id: true, currentPeriodStart: true },
      });
      return {
        plan:           jwtPlan,
        subscriptionId: sub?.id ?? '',
        periodStart:    sub?.currentPeriodStart ?? new Date(),
      };
    }
  }

  // Slow path: hit DB
  const sub = await _prisma.subscription.findUnique({
    where:  { userId: req.user!.sub },
    select: { id: true, plan: true, status: true, currentPeriodStart: true, currentPeriodEnd: true },
  });

  const plan: PlanTier =
    !sub ||
    sub.status === 'CANCELED' ||
    sub.status === 'UNPAID' ||
    sub.currentPeriodEnd < new Date()
      ? 'FREE'
      : sub.plan as PlanTier;

  return {
    plan,
    subscriptionId: sub?.id ?? '',
    periodStart:    sub?.currentPeriodStart ?? new Date(),
  };
}

// ── requirePlan ───────────────────────────────────────────────

/**
 * Blocks request if user's plan is below the required tier.
 * Usage: router.get('/scores', requirePlan('PRO'), handler)
 */
export function requirePlan(minTier: PlanTier) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError(401, 'Authentication required'));

      const { plan } = await resolveUserPlan(req);

      if (compareTiers(plan, minTier) < 0) {
        return next(new AppError(403,
          `This feature requires the ${minTier} plan or higher. You are on the ${plan} plan.`,
          'PLAN_REQUIRED',
        ));
      }

      (req as any).userPlan = plan;
      next();
    } catch (err) { next(err); }
  };
}

// ── requireFeature ────────────────────────────────────────────

/**
 * Blocks request if user's plan doesn't have a boolean feature.
 * Usage: router.get('/export', requireFeature('dataExport'), handler)
 */
export function requireFeature(feature: 'tokenScores' | 'scoreLeaderboard' | 'dataExport' | 'apiAccess') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError(401, 'Authentication required'));

      const { plan } = await resolveUserPlan(req);
      const allowed  = getFeature(plan, feature) as boolean;

      if (!allowed) {
        return next(new AppError(403,
          `The "${feature}" feature is not available on the ${plan} plan.`,
          'FEATURE_NOT_AVAILABLE',
        ));
      }

      (req as any).userPlan = plan;
      next();
    } catch (err) { next(err); }
  };
}

// ── checkQuota ────────────────────────────────────────────────

/**
 * Checks and increments a daily usage counter.
 * Blocks request if limit is exceeded.
 * Usage: router.get('/insights', checkQuota('ai_insights'), handler)
 */
export function checkQuota(feature: 'ai_insights') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError(401, 'Authentication required'));

      const { plan, subscriptionId } = await resolveUserPlan(req);

      // Check limit BEFORE incrementing
      const { allowed, current, limit } = await _usageService.checkDailyLimit(
        req.user.sub,
        subscriptionId,
        feature,
        plan,
      );

      if (!allowed) {
        res.setHeader('X-RateLimit-Limit',     limit.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset',     tomorrowMidnightUtc().toISOString());
        return next(new AppError(429,
          `Daily ${feature} limit of ${limit} reached. Resets at UTC midnight. Upgrade to get more.`,
          'QUOTA_EXCEEDED',
        ));
      }

      // Increment usage
      const newCount = await _usageService.increment(req.user.sub, subscriptionId, feature);

      res.setHeader('X-RateLimit-Limit',     limit === -1 ? 'unlimited' : limit.toString());
      res.setHeader('X-RateLimit-Remaining', limit === -1 ? 'unlimited' : Math.max(0, limit - newCount).toString());

      (req as any).userPlan = plan;
      next();
    } catch (err) { next(err); }
  };
}

// ── checkAlertLimit ───────────────────────────────────────────

/**
 * Checks alert count before creating a new one.
 */
export function checkAlertLimit() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError(401, 'Authentication required'));

      const { plan } = await resolveUserPlan(req);
      const { allowed, current, limit } = await _usageService.checkAlertLimit(req.user.sub, plan);

      if (!allowed) {
        return next(new AppError(403,
          `Alert limit of ${limit} reached on the ${plan} plan. Upgrade to create more alerts.`,
          'ALERT_LIMIT_REACHED',
        ));
      }

      // Also validate requested channels against plan
      const channels: string[] = req.body.channels ?? ['IN_APP'];
      const invalidChannels = channels.filter((ch) => !canUseAlertChannel(plan, ch));
      if (invalidChannels.length > 0) {
        return next(new AppError(403,
          `Alert channels [${invalidChannels.join(', ')}] are not available on the ${plan} plan.`,
          'CHANNEL_NOT_AVAILABLE',
        ));
      }

      (req as any).userPlan = plan;
      next();
    } catch (err) { next(err); }
  };
}

// ── checkWatchlistLimit ───────────────────────────────────────

export function checkWatchlistLimit() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError(401, 'Authentication required'));

      const { plan } = await resolveUserPlan(req);
      const { allowed, current, limit } = await _usageService.checkWatchlistLimit(req.user.sub, plan);

      if (!allowed) {
        return next(new AppError(403,
          `Watchlist limit of ${limit} reached on the ${plan} plan.`,
          'WATCHLIST_LIMIT_REACHED',
        ));
      }

      next();
    } catch (err) { next(err); }
  };
}

// ── requireSignalAccess ───────────────────────────────────────

/**
 * Filters signal types based on plan in query params.
 * Does NOT block — just restricts the type filter.
 */
export function filterSignalsByPlan() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next();

      const { plan } = await resolveUserPlan(req);
      const allowedTypes = PLANS[plan].features.signalTypes;

      // If a specific type was requested, verify access
      const requestedType = req.query.type as string | undefined;
      if (requestedType && !canAccessSignalType(plan, requestedType)) {
        return next(new AppError(403,
          `Signal type "${requestedType}" is not available on the ${plan} plan.`,
          'SIGNAL_TYPE_RESTRICTED',
        ));
      }

      // Attach allowed types for controller to use
      (req as any).allowedSignalTypes = allowedTypes;
      (req as any).userPlan           = plan;
      next();
    } catch (err) { next(err); }
  };
}

// ── Helpers ───────────────────────────────────────────────────

function tomorrowMidnightUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
