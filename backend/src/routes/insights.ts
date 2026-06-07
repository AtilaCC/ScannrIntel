// ============================================================
// INSIGHTS ROUTES
// ============================================================

import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/authenticate';

const prisma = new PrismaClient();

// ── INSIGHTS ─────────────────────────────────────────────
export const insightsRouter = Router();

insightsRouter.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const symbol = req.query.symbol as string | undefined;

    const where = symbol ? { symbol: symbol.toUpperCase() } : {};
    const skip = (page - 1) * limit;

    const [insights, total] = await prisma.$transaction([
      prisma.aIInsight.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.aIInsight.count({ where }),
    ]);

    res.json({ success: true, data: insights, meta: { page, limit, total } });
  } catch (err) {
    next(err);
  }
});

insightsRouter.get('/latest', authenticate, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const insights = await prisma.aIInsight.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    res.json({ success: true, data: insights });
  } catch (err) {
    next(err);
  }
});

// ── ALERTS ───────────────────────────────────────────────
export const alertsRouter = Router();

const alertSchema = z.object({
  symbol: z.string().min(1),
  condition: z.enum(['PRICE_ABOVE', 'PRICE_BELOW', 'VOLUME_SPIKE_PERCENT', 'PRICE_CHANGE_PERCENT', 'WHALE_TRADE_SIZE']),
  threshold: z.number().positive(),
  channels: z.array(z.enum(['IN_APP', 'EMAIL', 'TELEGRAM'])).min(1),
});

alertsRouter.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const alerts = await prisma.alertConfig.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: alerts });
  } catch (err) {
    next(err);
  }
});

alertsRouter.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = alertSchema.parse(req.body);
    const alert = await prisma.alertConfig.create({
      data: { ...data, userId: req.user!.sub },
    });
    res.status(201).json({ success: true, data: alert });
  } catch (err) {
    next(err);
  }
});

alertsRouter.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.alertConfig.deleteMany({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

alertsRouter.patch('/:id/toggle', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const alert = await prisma.alertConfig.findFirst({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    if (!alert) { res.status(404).json({ success: false, error: 'Alert not found' }); return; }

    const updated = await prisma.alertConfig.update({
      where: { id: alert.id },
      data: { isActive: !alert.isActive },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Triggered alerts (notifications)
alertsRouter.get('/triggered', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const alerts = await prisma.triggeredAlert.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: alerts });
  } catch (err) {
    next(err);
  }
});

alertsRouter.patch('/triggered/:id/read', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.triggeredAlert.updateMany({
      where: { id: req.params.id, userId: req.user!.sub },
      data: { isRead: true },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── USERS ────────────────────────────────────────────────
export const usersRouter = Router();

usersRouter.get('/profile', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: {
        id: true, email: true, role: true, createdAt: true,
        _count: { select: { alerts: true, triggeredAlerts: true, watchlist: true } },
      },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch('/profile', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ email: z.string().email().optional() });
    const data = schema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data,
      select: { id: true, email: true, role: true, updatedAt: true },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});
