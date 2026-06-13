import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/shared';

const logger = createLogger('scoring-service');

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export async function runScoringCycle(prisma: PrismaClient): Promise<void> {
  try {
    const tokens = await prisma.token.findMany({
      where: { isActive: true, lastPrice: { not: null } },
    });

    if (tokens.length === 0) { logger.warn('No tokens to score yet'); return; }

    let scored = 0;
    for (const token of tokens) {
      const priceChange = token.priceChange ?? 0;
      const volume      = token.volumeUsd24h ?? 0;

      const momentumScore  = clamp(50 + priceChange * 2, 0, 100);
      const volumeScore    = volume > 50_000_000 ? 80 : volume > 10_000_000 ? 60 : volume > 1_000_000 ? 40 : 20;
      const riskScore      = clamp(Math.abs(priceChange) * 3 + (volume < 1_000_000 ? 30 : 0), 0, 100);
      const sentimentScore = priceChange > 2 ? 75 : priceChange < -2 ? 25 : 50;
      const overallScore   = clamp(Math.round((momentumScore + volumeScore + sentimentScore) / 3), 0, 100);

      await prisma.tokenScore.create({
        data: {
          symbol:        token.symbol,
          overallScore,
          momentumScore,
          volumeScore,
          sentimentScore,
          riskScore,
          metadata: {
            priceChange,
            volume,
            sentiment: priceChange > 2 ? 'BULLISH' : priceChange < -2 ? 'BEARISH' : 'NEUTRAL',
            opportunityScore: clamp(Math.round(momentumScore * 0.4 + volumeScore * 0.4 + sentimentScore * 0.2), 0, 100),
          },
        },
      });
      scored++;
    }

    logger.info('Scoring cycle complete', { scored });
  } catch (err: any) {
    logger.error('Scoring cycle failed', { error: err.message });
  }
}

export function startScoringService(prisma: PrismaClient): void {
  setTimeout(() => runScoringCycle(prisma), 15_000);
  setInterval(() => runScoringCycle(prisma), 5 * 60 * 1000);
  logger.info('Scoring service started');
}
