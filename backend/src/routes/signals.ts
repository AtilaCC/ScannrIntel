// ============================================================
// SIGNALS ROUTES
// ============================================================

import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/authenticate';

const router = Router();
const prisma = new PrismaClient();

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  symbol: z.string().optional(),
  type: z.string().optional(),
  severity: z.string().optional(),
});

// ── GET /signals ──────────────────────────────────────────
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, symbol, type, severity } = querySchema.parse(req.query);
    const skip = (page - 1) * limit;

    const where = {
      ...(symbol && { symbol: symbol.toUpperCase() }),
      ...(type && { type: type as any }),
      ...(severity && { severity: severity as any }),
    };

    const [signals, total] = await prisma.$transaction([
      prisma.signal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { insights: { take: 1, orderBy: { createdAt: 'desc' } } },
      }),
      prisma.signal.count({ where }),
    ]);

    res.json({
      success: true,
      data: signals,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /signals/:id ──────────────────────────────────────
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const signal = await prisma.signal.findUnique({
      where: { id: req.params.id },
      include: { insights: true },
    });
    if (!signal) {
      res.status(404).json({ success: false, error: 'Signal not found' });
      return;
    }
    res.json({ success: true, data: signal });
  } catch (err) {
    next(err);
  }
});

export { router as signalsRouter };
