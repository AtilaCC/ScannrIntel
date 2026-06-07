// ============================================================
// RATE LIMITER MIDDLEWARE
//
// Three layers:
//   1. IP block check         — instant 403 for blocked IPs
//   2. Global IP rate limit   — protects all routes
//   3. Plan-aware API limit   — enforces per-plan req/min for API keys
//
// Uses Redis for distributed rate limiting (works across replicas).
// Falls back to in-memory if Redis is unavailable.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import { AuthRequest } from './authenticate';
import { AppError } from './errorHandler';
import { createLogger } from '../../../shared/src/utils';
import { PlanTier, getFeature } from '../config/plans';

const logger = createLogger('rate-limiter');

// ── Singleton references (set via initRateLimiter) ────────────

let _redis: Redis | null = null;
let _abuseService: {
  isBlocked: (ip: string) => Promise<boolean>;
  record: (event: any) => Promise<void>;
  isSuspiciousUserAgent: (ua: string | undefined) => boolean;
} | null = null;

export function initRateLimiter(
  redis: Redis,
  abuseService: typeof _abuseService,
) {
  _redis        = redis;
  _abuseService = abuseService;
}

// ── Helpers ───────────────────────────────────────────────────

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '0.0.0.0';
}

function errorResponse(msg: string, code: string) {
  return { success: false, error: msg, code };
}

function makeRedisStore(prefix: string) {
  if (!_redis) return undefined;
  return new RedisStore({
    sendCommand: (...args: string[]) => (_redis as any).call(...args),
    prefix,
  });
}

// ── 1. IP Block Middleware ────────────────────────────────────

export function ipBlockMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!_abuseService) return next();
    if (req.path === '/health') return next();

    const ip = getClientIp(req);

    try {
      const blocked = await _abuseService.isBlocked(ip);
      if (blocked) {
        await _abuseService.record({
          ip,
          eventType: 'BLOCKED',
          path:      req.path,
          userAgent: req.headers['user-agent'],
        });
        res.status(403).json(errorResponse('Access denied.', 'IP_BLOCKED'));
        return;
      }

      // Suspicious UA check (logs but doesn't block immediately)
      const ua = req.headers['user-agent'];
      if (_abuseService.isSuspiciousUserAgent(ua)) {
        await _abuseService.record({
          ip,
          eventType: 'SUSPICIOUS_UA',
          path:      req.path,
          userAgent: ua,
          details:   { ua },
        });
        logger.warn('Suspicious user agent', { ip, path: req.path });
      }
    } catch (err) {
      logger.error('IP block check failed', { err });
    }

    next();
  };
}

// ── 2. Global IP Rate Limiter ─────────────────────────────────

export function globalRateLimiter() {
  return rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             300,
    standardHeaders: true,
    legacyHeaders:   false,
    store:           makeRedisStore('rl:global:'),
    keyGenerator:    getClientIp,
    skip:            (req) => req.path === '/health',
    handler: async (req: Request, res: Response) => {
      const ip = getClientIp(req);
      logger.warn('Global rate limit hit', { ip, path: req.path });

      if (_abuseService) {
        _abuseService.record({
          ip,
          eventType: 'RATE_LIMITED',
          path:      req.path,
          userAgent: req.headers['user-agent'],
          details:   { limiter: 'global' },
        }).catch(() => {});
      }

      res.status(429).json({
        ...errorResponse('Too many requests. Please slow down.', 'RATE_LIMITED'),
        retryAfter: res.getHeader('Retry-After'),
      });
    },
  });
}

// ── 3. Auth Route Rate Limiter ────────────────────────────────

export const authRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    getClientIp,
  message:         errorResponse('Too many auth attempts. Please try again later.', 'RATE_LIMITED'),
});

export const strictRateLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    getClientIp,
  message:         errorResponse('Too many reset attempts. Please try again in an hour.', 'RATE_LIMITED'),
});

// ── 4. API Key Rate Limiter ───────────────────────────────────
//    Applied after authenticateApiKey. Per-account req/min by plan.

export function apiKeyRateLimiter() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!(req as any).apiKeyId) return next();

    const plan      = req.user?.plan as PlanTier ?? 'FREE';
    const rateLimit = getFeature(plan, 'apiRateLimit');
    const userId    = req.user?.sub;

    if (!userId || rateLimit === 0) {
      res.status(403).json(errorResponse('API access not available on your plan.', 'PLAN_REQUIRED'));
      return;
    }

    if (!_redis) return next();

    const key     = `rl:api:${userId}`;
    const window  = 60;
    const current = await _redis.incr(key);
    if (current === 1) await _redis.expire(key, window);

    res.setHeader('X-RateLimit-Limit',     rateLimit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, rateLimit - current));
    res.setHeader('X-RateLimit-Reset',     Math.floor(Date.now() / 1000) + window);

    if (current > rateLimit) {
      res.setHeader('Retry-After', window);
      if (_abuseService) {
        _abuseService.record({
          ip:        getClientIp(req),
          userId,
          apiKeyId:  (req as any).apiKeyId,
          eventType: 'RATE_LIMITED',
          path:      req.path,
          userAgent: req.headers['user-agent'],
          details:   { limiter: 'api', plan, limit: rateLimit, current },
        }).catch(() => {});
      }

      res.status(429).json({
        ...errorResponse(
          `API rate limit exceeded. Your ${plan} plan allows ${rateLimit} requests/minute.`,
          'API_RATE_LIMITED',
        ),
        retryAfter: window,
      });
      return;
    }

    next();
  };
}

// ── 5. Login brute-force protection (sliding window) ─────────

export function loginBruteForce() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!_redis) return next();

    const ip       = getClientIp(req);
    const key      = `bf:login:${ip}`;
    const now      = Date.now();
    const windowMs = 15 * 60 * 1000;
    const limit    = 10;

    await _redis.zremrangebyscore(key, '-inf', now - windowMs);
    const count = await _redis.zcard(key);

    if (count >= limit) {
      const oldest  = await _redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetAt = oldest.length >= 2
        ? parseInt(oldest[1]) + windowMs
        : now + windowMs;

      if (_abuseService) {
        _abuseService.record({
          ip,
          eventType: 'RATE_LIMITED',
          path:      req.path,
          userAgent: req.headers['user-agent'],
          details:   { limiter: 'bruteforce', count },
        }).catch(() => {});
      }

      res.setHeader('Retry-After', Math.ceil((resetAt - now) / 1000));
      res.status(429).json(errorResponse(
        'Too many login attempts. Please wait before trying again.',
        'BRUTE_FORCE_BLOCKED',
      ));
      return;
    }

    await _redis.zadd(key, now, `${now}`);
    await _redis.expire(key, Math.ceil(windowMs / 1000));
    next();
  };
}
