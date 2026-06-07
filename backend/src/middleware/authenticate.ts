// ============================================================
// AUTHENTICATE MIDDLEWARE
//
// Handles two auth strategies:
//   Bearer <jwt>    → JWT flow (unchanged)
//   X-API-Key <key> → API key flow (validates via DB/Redis cache)
//
// authenticateAny() accepts both. Downstream middleware
// (requirePlan, requireFeature) works identically for both.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { tokenService, AccessTokenPayload } from '../services/tokenService';
import { createApiKeyService } from '../services/apiKeyService';
import { AppError } from './errorHandler';
import { createLogger } from '../../../shared/src/utils';
import jwt from 'jsonwebtoken';

const logger = createLogger('authenticate');

export interface AuthRequest extends Request {
  user?:     AccessTokenPayload & { iat: number; exp: number };
  apiKeyId?: string;
}

// ── Singletons ────────────────────────────────────────────────

let _prisma:        PrismaClient | null = null;
let _apiKeyService: ReturnType<typeof createApiKeyService> | null = null;

export function initAuthenticate(prisma: PrismaClient, redis: Redis) {
  _prisma        = prisma;
  _apiKeyService = createApiKeyService(prisma);
}

// ── JWT auth ─────────────────────────────────────────────────

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Authentication required', 'NO_TOKEN'));
  }
  const token = authHeader.slice(7);
  try {
    const payload = tokenService.verifyAccessToken(token);
    req.user = payload as any;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError)
      return next(new AppError(401, 'Token expired', 'TOKEN_EXPIRED'));
    if (err instanceof jwt.JsonWebTokenError)
      return next(new AppError(401, 'Invalid token', 'INVALID_TOKEN'));
    next(new AppError(401, 'Authentication failed', 'AUTH_FAILED'));
  }
}

// ── API key auth ──────────────────────────────────────────────

export function authenticateApiKey(req: AuthRequest, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    return next(new AppError(401, 'API key required. Provide X-API-Key header.', 'NO_API_KEY'));
  }
  if (!_apiKeyService || !_prisma) {
    return next(new AppError(500, 'Auth service not initialized', 'INTERNAL'));
  }

  _apiKeyService.validate(apiKey)
    .then(async (validated) => {
      if (!validated) {
        logger.warn('Invalid API key attempt', { path: req.path });
        return next(new AppError(401, 'Invalid or expired API key', 'INVALID_API_KEY'));
      }
      const user = await _prisma!.user.findUnique({
        where:  { id: validated.userId },
        select: { email: true, role: true, isActive: true },
      });
      if (!user || !user.isActive) {
        return next(new AppError(401, 'Account is inactive', 'ACCOUNT_INACTIVE'));
      }
      const now = Math.floor(Date.now() / 1000);
      req.user = {
        sub:       validated.userId,
        email:     user.email,
        role:      user.role === 'ADMIN' ? 'admin' : 'user',
        sessionId: `apikey:${validated.apiKeyId}`,
        plan:      validated.plan as any,
        iat:       now,
        exp:       now + 86400,
      };
      req.apiKeyId = validated.apiKeyId;
      next();
    })
    .catch((err) => {
      logger.error('API key validation error', { err });
      next(new AppError(500, 'Authentication error', 'AUTH_ERROR'));
    });
}

// ── Dual auth: JWT OR API key ─────────────────────────────────

export function authenticateAny(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }
  if (req.headers['x-api-key']) {
    return authenticateApiKey(req, res, next);
  }
  next(new AppError(401, 'Authentication required (Bearer token or X-API-Key)', 'NO_AUTH'));
}

// ── Optional auth ─────────────────────────────────────────────

export function optionalAuthenticate(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  try {
    const payload = tokenService.verifyAccessToken(authHeader.slice(7));
    req.user = payload as any;
  } catch { /* ignore */ }
  next();
}

// ── Role guards ───────────────────────────────────────────────

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError(403, 'Admin access required', 'FORBIDDEN'));
  }
  next();
}

export function requireSelfOrAdmin(req: AuthRequest, _res: Response, next: NextFunction): void {
  const targetId = req.params.userId || req.params.id;
  if (!req.user) return next(new AppError(401, 'Authentication required'));
  if (req.user.role === 'admin' || req.user.sub === targetId) return next();
  next(new AppError(403, 'Access denied', 'FORBIDDEN'));
}
