// ============================================================
// REDIS PUBLISHER
// Wraps ioredis for the scanner service.
// Handles connection lifecycle, errors, and provides typed
// publish helpers.
// ============================================================

import Redis from 'ioredis';
import { REDIS_CHANNELS } from '../../../../shared/src/constants';
import { createLogger } from '../../../../shared/src/utils';
import { MetricsCollector } from '../metrics/metricsCollector';

const logger = createLogger('redis-publisher');

export class RedisPublisher {
  public client: Redis;
  private isConnected: boolean = false;

  constructor(
    private readonly redisUrl: string,
    private readonly metrics:  MetricsCollector,
  ) {
    this.client = new Redis(redisUrl, {
      retryStrategy:          (times) => Math.min(times * 200, 10_000),
      enableReadyCheck:       true,
      maxRetriesPerRequest:   3,
      lazyConnect:            false,
      reconnectOnError:       (err) => {
        // Reconnect on READONLY errors (Redis Sentinel failover)
        return err.message.includes('READONLY');
      },
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis connected');
    });

    this.client.on('ready', () => {
      logger.info('Redis ready');
    });

    this.client.on('error', (err) => {
      logger.error('Redis error', { error: err.message });
      this.metrics.recordRedisError();
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }

  // ── Readiness ─────────────────────────────────────────────

  async waitReady(timeoutMs = 10_000): Promise<void> {
    if (this.isConnected) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Redis connection timeout')),
        timeoutMs,
      );

      this.client.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });

      this.client.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ── Typed publish helpers ─────────────────────────────────

  async publishMarketData(type: string, payload: unknown): Promise<void> {
    await this.publish(REDIS_CHANNELS.MARKET_DATA, { type, payload, timestamp: Date.now() });
  }

  async publishSignal(payload: unknown): Promise<void> {
    await this.publish(REDIS_CHANNELS.SIGNALS, { type: 'signal', payload, timestamp: Date.now() });
  }

  // ── Cache write helpers ───────────────────────────────────

  async setex(key: string, ttl: number, value: unknown): Promise<void> {
    try {
      await this.client.setex(key, ttl, JSON.stringify(value));
    } catch (err) {
      this.metrics.recordRedisError();
      logger.error('Redis SETEX failed', { key, error: (err as Error).message });
    }
  }

  async pipeline(ops: Array<['setex', string, number, string]>): Promise<void> {
    try {
      const pipe = this.client.pipeline();
      for (const [cmd, ...args] of ops) {
        if (cmd === 'setex') pipe.setex(args[0] as string, args[1] as number, args[2] as string);
      }
      await pipe.exec();
    } catch (err) {
      this.metrics.recordRedisError();
      logger.error('Redis pipeline failed', { error: (err as Error).message });
    }
  }

  // ── Disconnect ────────────────────────────────────────────

  async disconnect(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
    logger.info('Redis disconnected');
  }

  // ── Private ───────────────────────────────────────────────

  private async publish(channel: string, payload: unknown): Promise<void> {
    if (!this.isConnected) {
      this.metrics.recordRedisError();
      return;
    }
    try {
      await this.client.publish(channel, JSON.stringify(payload));
    } catch (err) {
      this.metrics.recordRedisError();
      logger.error('Redis publish failed', {
        channel,
        error: (err as Error).message,
      });
    }
  }
}
