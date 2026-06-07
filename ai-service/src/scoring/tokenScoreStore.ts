// ============================================================
// TOKEN SCORE STORE
// Manages persistence and retrieval of token scores.
//
// Redis:
//   market:score:<symbol>        → current score (TTL 24h)
//   market:score:history:<symbol> → last 100 score snapshots (list)
//   market:scores:leaderboard     → sorted set (finalRisk desc)
//   market:scores:opportunity     → sorted set (finalOpportunity desc)
//
// Postgres:
//   token_scores table            → full history with breakdown
// ============================================================

import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { TokenScore, ScoreBreakdown } from '../types';
import { createLogger } from '../../../../shared/src/utils';

const logger = createLogger('score-store');

const SCORE_TTL_S      = 24 * 60 * 60;  // 24 hours
const HISTORY_MAX_LEN  = 100;            // per symbol

export class TokenScoreStore {
  constructor(
    private readonly redis:  Redis,
    private readonly prisma: PrismaClient,
  ) {}

  // ── Write ─────────────────────────────────────────────────

  async save(score: TokenScore): Promise<void> {
    await Promise.all([
      this.saveToRedis(score),
      this.saveToDb(score),
    ]);
  }

  // ── Read — current score ──────────────────────────────────

  async getCurrent(symbol: string): Promise<TokenScore | null> {
    try {
      const raw = await this.redis.get(`market:score:${symbol}`);
      if (raw) return JSON.parse(raw) as TokenScore;
    } catch { /* fallthrough to DB */ }

    // Redis miss — try DB
    try {
      const row = await this.prisma.tokenScore.findFirst({
        where:   { symbol },
        orderBy: { computedAt: 'desc' },
      });
      if (!row) return null;
      return this.rowToScore(row);
    } catch {
      return null;
    }
  }

  // ── Read — history ────────────────────────────────────────

  async getHistory(symbol: string, limit = 50): Promise<TokenScore[]> {
    try {
      const raws = await this.redis.lrange(`market:score:history:${symbol}`, 0, limit - 1);
      if (raws.length > 0) {
        return raws.map((r) => JSON.parse(r) as TokenScore);
      }
    } catch { /* fallthrough */ }

    try {
      const rows = await this.prisma.tokenScore.findMany({
        where:   { symbol },
        orderBy: { computedAt: 'desc' },
        take:    limit,
      });
      return rows.map((r) => this.rowToScore(r));
    } catch {
      return [];
    }
  }

  // ── Read — leaderboards ───────────────────────────────────

  /** Top N tokens by risk score (highest risk first). */
  async getTopRisk(limit = 10): Promise<Array<{ symbol: string; score: number }>> {
    try {
      const raw = await this.redis.zrevrangebyscore(
        'market:scores:leaderboard', '+inf', '-inf',
        'WITHSCORES', 'LIMIT', 0, limit,
      );
      return parseZRangeWithScores(raw);
    } catch {
      return this.getLeaderboardFromDb('riskScore', limit);
    }
  }

  /** Top N tokens by opportunity score (highest opportunity first). */
  async getTopOpportunity(limit = 10): Promise<Array<{ symbol: string; score: number }>> {
    try {
      const raw = await this.redis.zrevrangebyscore(
        'market:scores:opportunity', '+inf', '-inf',
        'WITHSCORES', 'LIMIT', 0, limit,
      );
      return parseZRangeWithScores(raw);
    } catch {
      return this.getLeaderboardFromDb('opportunityScore', limit);
    }
  }

  /** All current scores (for the full scanner grid). */
  async getAllCurrent(symbols: string[]): Promise<Record<string, TokenScore | null>> {
    const result: Record<string, TokenScore | null> = {};

    if (symbols.length === 0) return result;

    try {
      const pipeline = this.redis.pipeline();
      for (const sym of symbols) pipeline.get(`market:score:${sym}`);
      const results  = await pipeline.exec();

      symbols.forEach((sym, i) => {
        const raw = results?.[i]?.[1] as string | null;
        result[sym] = raw ? JSON.parse(raw) : null;
      });
    } catch {
      symbols.forEach((sym) => { result[sym] = null; });
    }

    return result;
  }

  // ── Private ───────────────────────────────────────────────

  private async saveToRedis(score: TokenScore): Promise<void> {
    try {
      const pipe = this.redis.pipeline();
      const key  = `market:score:${score.symbol}`;
      const json = JSON.stringify(score);

      // Current score (with TTL)
      pipe.setex(key, SCORE_TTL_S, json);

      // Prepend to history list
      pipe.lpush(`market:score:history:${score.symbol}`, json);
      pipe.ltrim(`market:score:history:${score.symbol}`, 0, HISTORY_MAX_LEN - 1);

      // Update risk leaderboard (sorted set, score = finalRisk)
      pipe.zadd('market:scores:leaderboard', score.breakdown.finalRisk, score.symbol);

      // Update opportunity leaderboard
      pipe.zadd('market:scores:opportunity', score.breakdown.finalOpportunity, score.symbol);

      await pipe.exec();
    } catch (err) {
      logger.error('Redis score save failed', {
        symbol: score.symbol,
        error:  (err as Error).message,
      });
    }
  }

  private async saveToDb(score: TokenScore): Promise<void> {
    try {
      await this.prisma.tokenScore.create({
        data: {
          symbol:          score.symbol,
          signalId:        score.signalId,
          insightId:       score.insightId,
          riskScore:       score.breakdown.finalRisk,
          opportunityScore:score.breakdown.finalOpportunity,
          compositeRisk:   score.breakdown.compositeRisk,
          compositeOpportunity: score.breakdown.compositeOpportunity,
          claudeRisk:      score.breakdown.claudeRisk,
          claudeOpportunity: score.breakdown.claudeOpportunity,
          ruleWeight:      score.breakdown.ruleWeight,
          claudeWeight:    score.breakdown.claudeWeight,
          sentiment:       score.sentiment as any,
          factors:         score.breakdown.factors as any,
          computedAt:      new Date(score.computedAt),
        },
      });
    } catch (err) {
      logger.error('DB score save failed', {
        symbol: score.symbol,
        error:  (err as Error).message,
      });
    }
  }

  private rowToScore(row: any): TokenScore {
    return {
      symbol:          row.symbol,
      finalRisk:       row.riskScore,
      finalOpportunity:row.opportunityScore,
      sentiment:       row.sentiment,
      signalId:        row.signalId,
      insightId:       row.insightId,
      computedAt:      new Date(row.computedAt).getTime(),
      breakdown: {
        factors:              row.factors ?? [],
        compositeRisk:        row.compositeRisk,
        compositeOpportunity: row.compositeOpportunity,
        claudeRisk:           row.claudeRisk,
        claudeOpportunity:    row.claudeOpportunity,
        finalRisk:            row.riskScore,
        finalOpportunity:     row.opportunityScore,
        ruleWeight:           row.ruleWeight,
        claudeWeight:         row.claudeWeight,
        computedAt:           new Date(row.computedAt).getTime(),
      },
    };
  }

  private async getLeaderboardFromDb(
    field: 'riskScore' | 'opportunityScore',
    limit: number,
  ): Promise<Array<{ symbol: string; score: number }>> {
    try {
      // Get latest score per symbol using a subquery approach
      const symbols = await this.prisma.tokenScore.findMany({
        orderBy: { computedAt: 'desc' },
        take:    limit * 5, // overfetch then deduplicate
        select:  { symbol: true, riskScore: true, opportunityScore: true },
      });

      // Deduplicate by symbol, keeping first (latest)
      const seen  = new Set<string>();
      const dedup = symbols.filter((s) => {
        if (seen.has(s.symbol)) return false;
        seen.add(s.symbol);
        return true;
      });

      return dedup
        .slice(0, limit)
        .sort((a, b) => (b[field] as number) - (a[field] as number))
        .map((s) => ({ symbol: s.symbol, score: s[field] as number }));
    } catch {
      return [];
    }
  }
}

function parseZRangeWithScores(raw: string[]): Array<{ symbol: string; score: number }> {
  const result = [];
  for (let i = 0; i < raw.length; i += 2) {
    result.push({ symbol: raw[i], score: parseFloat(raw[i + 1]) });
  }
  return result;
}
