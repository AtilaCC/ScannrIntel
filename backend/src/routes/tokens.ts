// ============================================================
// TOKENS ROUTES
// ============================================================

import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/authenticate';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const prisma = new PrismaClient();

// ── GET /tokens — list all active tokens ─────────────────
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cacheKey = 'tokens:all';
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, cached: true });
      return;
    }

    const tokens = await prisma.token.findMany({
      where: { isActive: true },
      orderBy: { volumeUsd24h: 'desc' },
    });

    await cache.set(cacheKey, tokens, 30); // 30 second cache
    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
});

// ── GET /tokens/:symbol ───────────────────────────────────
router.get('/:symbol', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;
    const token = await prisma.token.findUnique({
      where: { symbol: symbol.toUpperCase() },
    });
    if (!token) throw new AppError(404, 'Token not found');
    res.json({ success: true, data: token });
  } catch (err) {
    next(err);
  }
});

// ── POST /tokens/:symbol/watchlist — toggle watchlist ────
router.post('/:symbol/watchlist', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;
    const userId = req.user!.sub;

    const existing = await prisma.watchlist.findUnique({
      where: { userId_symbol: { userId, symbol: symbol.toUpperCase() } },
    });

    if (existing) {
      await prisma.watchlist.delete({ where: { id: existing.id } });
      res.json({ success: true, data: { watched: false } });
    } else {
      await prisma.watchlist.create({ data: { userId, symbol: symbol.toUpperCase() } });
      res.json({ success: true, data: { watched: true } });
    }
  } catch (err) {
    next(err);
  }
});

// ── GET /tokens/watchlist/me ──────────────────────────────
router.get('/watchlist/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.watchlist.findMany({
      where: { userId: req.user!.sub },
      include: { token: true },
    });
    res.json({ success: true, data: items.map((w) => w.token) });
  } catch (err) {
    next(err);
  }
});

export { router as tokensRouter };
