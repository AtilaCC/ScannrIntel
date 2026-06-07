// ============================================================
// SIGNAL EMITTER — Persist + publish detected signals
// ============================================================

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { DetectedSignal } from '../../../shared/src/types';
import { REDIS_CHANNELS } from '../../../shared/src/constants';
import { createLogger } from '../../../shared/src/utils';

const logger = createLogger('signal-emitter');

// Dedup: don't re-emit same signal within 30 seconds
const recentEmissions = new Map<string, number>();
const DEDUP_WINDOW_MS = 30_000;

export class SignalEmitter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis
  ) {}

  async emit(signal: DetectedSignal): Promise<void> {
    // Deduplication check
    const dedupKey = `${signal.symbol}:${signal.type}:${signal.severity}`;
    const lastEmitted = recentEmissions.get(dedupKey) || 0;
    if (Date.now() - lastEmitted < DEDUP_WINDOW_MS) return;
    recentEmissions.set(dedupKey, Date.now());

    // Cleanup old entries periodically
    if (recentEmissions.size > 1000) {
      const cutoff = Date.now() - DEDUP_WINDOW_MS;
      recentEmissions.forEach((ts, key) => {
        if (ts < cutoff) recentEmissions.delete(key);
      });
    }

    try {
      // Ensure token exists in DB
      await this.prisma.token.upsert({
        where: { symbol: signal.symbol },
        update: {},
        create: {
          symbol: signal.symbol,
          baseAsset: signal.symbol.replace('USDT', ''),
          quoteAsset: 'USDT',
        },
      });

      // Persist signal
      const saved = await this.prisma.signal.create({
        data: {
          id: signal.id,
          symbol: signal.symbol,
          type: signal.type as any,
          severity: signal.severity as any,
          data: signal.data as any,
          metadata: signal.metadata as any,
        },
      });

      // Publish to Redis for AI service and frontend
      await this.redis.publish(
        REDIS_CHANNELS.SIGNALS,
        JSON.stringify({ type: 'signal', payload: saved, timestamp: Date.now() })
      );

      // Also push to AI analysis queue
      await this.redis.lpush(
        REDIS_CHANNELS.AI_QUEUE,
        JSON.stringify({ signalId: saved.id, signal: saved, enqueuedAt: Date.now() })
      );

      logger.info('Signal emitted', {
        symbol: signal.symbol,
        type: signal.type,
        severity: signal.severity,
      });
    } catch (err) {
      logger.error('Failed to emit signal', { error: (err as Error).message, signal });
    }
  }
}
