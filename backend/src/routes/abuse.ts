// ============================================================
// ABUSE PROTECTION ROUTES (admin only)
//
// GET    /abuse/events            — recent abuse events
// GET    /abuse/blocked-ips       — currently blocked IPs
// GET    /abuse/stats             — aggregate stats
// POST   /abuse/block             — manually block an IP
// DELETE /abuse/block/:ip         — unblock an IP
// ============================================================

import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate';
import { AppError } from '../middleware/errorHandler';
import { createAbuseProtectionService } from '../services/abuseProtectionService';

export function createAbuseRouter(prisma: PrismaClient, redis: Redis) {
  const router  = Router();
  const abuseSvc = createAbuseProtectionService(prisma, redis);

  // All routes are admin-only
  router.use(authenticate, requireAdmin);

  // ── GET /events ───────────────────────────────────────────
  router.get('/events', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limit  = Math.min(parseInt(req.query.limit as string || '100'), 500);
      const events = await abuseSvc.getRecentEvents(limit);
      res.json({ success: true, data: events });
    } catch (err) { next(err); }
  });

  // ── GET /blocked-ips ──────────────────────────────────────
  router.get('/blocked-ips', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ips = await abuseSvc.getBlockedIps();
      res.json({ success: true, data: ips });
    } catch (err) { next(err); }
  });

  // ── GET /stats ────────────────────────────────────────────
  router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const hours = Math.min(parseInt(req.query.hours as string || '24'), 168);
      const stats = await abuseSvc.getStats(hours);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  });

  // ── POST /block ───────────────────────────────────────────
  const blockSchema = z.object({
    ip:        z.string().ip(),
    reason:    z.string().min(1).max(500),
    expiresAt: z.string().datetime().optional(),
  });

  router.post('/block', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = blockSchema.parse(req.body);
      await abuseSvc.blockIp(
        body.ip,
        body.reason,
        req.user!.sub,
        body.expiresAt ? new Date(body.expiresAt) : undefined,
      );
      res.json({ success: true, message: `IP ${body.ip} blocked.` });
    } catch (err) {
      if (err instanceof z.ZodError)
        return next(new AppError(400, err.errors[0].message, 'VALIDATION_ERROR'));
      next(err);
    }
  });

  // ── DELETE /block/:ip ─────────────────────────────────────
  router.delete('/block/:ip', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ip = decodeURIComponent(req.params.ip);
      await abuseSvc.unblock(ip, req.user!.sub);
      res.json({ success: true, message: `IP ${ip} unblocked.` });
    } catch (err) { next(err); }
  });

  return router;
}
