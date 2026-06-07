// ============================================================
// API KEY ROUTES
//
// POST   /api-keys              — create new key (returns raw key once)
// GET    /api-keys              — list user's keys
// DELETE /api-keys/:id          — revoke a key
// DELETE /api-keys              — revoke all keys
//
// Admin only:
// GET    /api-keys/admin/stats  — usage stats
// ============================================================

import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate';
import { AppError } from '../middleware/errorHandler';
import { createApiKeyService } from '../services/apiKeyService';
import { createLogger } from '../utils/shared';

const logger = createLogger('api-key-routes');

export function createApiKeyRouter(prisma: PrismaClient) {
  const router     = Router();
  const apiKeySvc  = createApiKeyService(prisma);

  // ── POST / — Create a new API key ─────────────────────────
  const createSchema = z.object({
    name:      z.string().min(1).max(80),
    scopes:    z.array(z.enum(['read', 'write'])).optional().default(['read']),
    expiresAt: z.string().datetime().optional(),
  });

  router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);

      const { rawKey, info } = await apiKeySvc.create({
        userId:    req.user!.sub,
        name:      body.name,
        scopes:    body.scopes as any,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });

      logger.info('API key created via route', { userId: req.user!.sub });

      // Raw key shown exactly once — client must store it
      res.status(201).json({
        success: true,
        data: {
          ...info,
          key: rawKey,  // ⚠️ SHOW ONCE — not stored, cannot be retrieved
        },
        warning: 'Copy this key now. It will not be shown again.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(new AppError(400, err.errors[0].message, 'VALIDATION_ERROR'));
      }
      next(err);
    }
  });

  // ── GET / — List keys ─────────────────────────────────────
  router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const keys = await apiKeySvc.listForUser(req.user!.sub);
      res.json({ success: true, data: keys });
    } catch (err) { next(err); }
  });

  // ── DELETE /:id — Revoke a key ────────────────────────────
  router.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await apiKeySvc.revoke(req.params.id, req.user!.sub);
      res.json({ success: true, message: 'API key revoked.' });
    } catch (err) { next(err); }
  });

  // ── DELETE / — Revoke all keys ────────────────────────────
  router.delete('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const count = await apiKeySvc.revokeAll(req.user!.sub);
      res.json({ success: true, data: { revoked: count } });
    } catch (err) { next(err); }
  });

  // ── GET /admin/stats — Admin stats ────────────────────────
  router.get('/admin/stats', authenticate, requireAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const stats = await apiKeySvc.adminStats();
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  });

  return router;
}
