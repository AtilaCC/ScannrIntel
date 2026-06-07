// ============================================================
// REDIS CONFIG — pub/sub + cache client
// ============================================================

import Redis from 'ioredis';
import { config } from './index';
import { logger } from '../utils/logger';

const createRedisClient = (name: string): Redis => {
  const client = new Redis(config.REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 100, 3000),
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  });

  client.on('connect', () => logger.info(`Redis [${name}] connected`));
  client.on('error', (err) => logger.error(`Redis [${name}] error`, { error: err.message }));
  client.on('reconnecting', () => logger.warn(`Redis [${name}] reconnecting...`));

  return client;
};

// Main client (pub + cache operations)
export const redis = createRedisClient('main');

// Dedicated subscriber client (cannot be used for other commands)
export const redisSubscriber = createRedisClient('subscriber');

export async function connectRedis(): Promise<void> {
  await Promise.all([
    redis.ping(),
    redisSubscriber.ping(),
  ]);
  logger.info('Redis connections established');
}

// Cache helpers
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const val = await redis.get(key);
    return val ? (JSON.parse(val) as T) : null;
  },

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
  },

  async del(key: string): Promise<void> {
    await redis.del(key);
  },

  async publish(channel: string, payload: unknown): Promise<void> {
    await redis.publish(channel, JSON.stringify(payload));
  },
};
