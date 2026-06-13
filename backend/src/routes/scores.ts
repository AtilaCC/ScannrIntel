// ============================================================
// SCORES ROUTES
// GET /scores                    — all current scores
// GET /scores/leaderboard/risk   — top N by risk
// GET /scores/leaderboard/opportunity — top N by opportunity
// GET /scores/:symbol            — current score for a symbol
// GET /scores/:symbol/history    — score history for a symbol
// ============================================================

import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/authenticate';
import { requirePlan, requireFeature } from '../middleware/subscription';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const prisma = new PrismaClient();

// ── GET /scores ───────────────────────────────────────────────
router.get('/', authenticate, requirePlan('PRO'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cacheKey = 'scores:all:v2';
    const cached   = await cache.get(cacheKey);
    if (cached) { res.json({ success: true, data: cached, cached: true }); return; }

    // Get all symbols from tokens table
    const tokens = await prisma.token.findMany({
      where:   { isActive: true },
      select:  { symbol: true },
    });
    const symbols = tokens.map((t) => t.symbol);

    // For each symbol get latest score
    const latestScores = await prisma.tokenScore.findMany({
      where:   { symbol: { in: symbols } },
      orderBy: { createdAt: 'desc' },
      distinct: ['symbol'],
      select: {
        symbol:        true,
        riskScore:     true,
        overallScore:  true,
        momentumScore: true,
        volumeScore:   true,
        sentimentScore:true,
        metadata:      true,
        createdAt:     true,
      },
    });

    // Build a map for O(1) lookup
    const scoreMap = Object.fromEntries(
      latestScores.map((s) => [s.symbol, s]),
    );

    // Merge: every symbol gets a score (null if never scored)
    const data = symbols.map((symbol) => {
      const s = scoreMap[symbol];
      const meta = s?.metadata as any ?? {};
      return {
        symbol,
        score: s ? {
          symbol:          s.symbol,
          riskScore:       s.riskScore,
          opportunityScore:meta.opportunityScore ?? s.overallScore,
          sentiment:       meta.sentiment ?? 'NEUTRAL',
          computedAt:      s.createdAt,
        } : null,
      };
    });

    await cache.set(cacheKey, data, 15); // 15s cache
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ── GET /scores/leaderboard/risk ──────────────────────────────
router.get('/leaderboard/risk', authenticate, requireFeature('scoreLeaderboard'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit as string || '10', 10), 50);
    const cacheKey = `scores:leaderboard:risk:${limit}`;
    const cached   = await cache.get(cacheKey);
    if (cached) { res.json({ success: true, data: cached }); return; }

    const rows = await prisma.tokenScore.findMany({
      orderBy: { computedAt: 'desc' },
      take:    limit * 5,
      distinct: ['symbol'],
      select: {
        symbol: true, riskScore: true, opportunityScore: true,
        sentiment: true, computedAt: true,
      },
    });

    const sorted = rows
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, limit)
      .map((r, i) => ({ rank: i + 1, ...r }));

    await cache.set(cacheKey, sorted, 30);
    res.json({ success: true, data: sorted });
  } catch (err) { next(err); }
});

// ── GET /scores/leaderboard/opportunity ───────────────────────
router.get('/leaderboard/opportunity', authenticate, requireFeature('scoreLeaderboard'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit as string || '10', 10), 50);
    const cacheKey = `scores:leaderboard:opp:${limit}`;
    const cached   = await cache.get(cacheKey);
    if (cached) { res.json({ success: true, data: cached }); return; }

    const rows = await prisma.tokenScore.findMany({
      orderBy: { computedAt: 'desc' },
      take:    limit * 5,
      distinct: ['symbol'],
      select: {
        symbol: true, riskScore: true, opportunityScore: true,
        sentiment: true, computedAt: true,
      },
    });

    const sorted = rows
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, limit)
      .map((r, i) => ({ rank: i + 1, ...r }));

    await cache.set(cacheKey, sorted, 30);
    res.json({ success: true, data: sorted });
  } catch (err) { next(err); }
});

// ── GET /scores/:symbol ───────────────────────────────────────
router.get('/:symbol', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const symbol   = req.params.symbol.toUpperCase();
    const cacheKey = `scores:current:${symbol}`;
    const cached   = await cache.get(cacheKey);
    if (cached) { res.json({ success: true, data: cached }); return; }

    const score = await prisma.tokenScore.findFirst({
      where:   { symbol },
      orderBy: { computedAt: 'desc' },
    });

    if (!score) throw new AppError(404, `No score data for ${symbol}`);

    await cache.set(cacheKey, score, 30);
    res.json({ success: true, data: score });
  } catch (err) { next(err); }
});

// ── GET /scores/:symbol/history ───────────────────────────────
router.get('/:symbol/history', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit  = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
    const since  = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // default 7 days

    const history = await prisma.tokenScore.findMany({
      where:   { symbol, computedAt: { gte: since } },
      orderBy: { computedAt: 'desc' },
      take:    limit,
      select: {
        id: true, symbol: true,
        riskScore: true, opportunityScore: true,
        compositeRisk: true, compositeOpportunity: true,
        claudeRisk: true, claudeOpportunity: true,
        ruleWeight: true, claudeWeight: true,
        sentiment: true, factors: true, computedAt: true,
      },
    });

    res.json({
      success: true,
      data:    history,
      meta:    { symbol, count: history.length, since: since.toISOString() },
    });
  } catch (err) { next(err); }
});

export { router as scoresRouter };
