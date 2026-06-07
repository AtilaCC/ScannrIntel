// ============================================================
// AI SERVICE — Production entry point
//
// Boot sequence:
//   1. Validate config
//   2. Connect Redis (pub + sub clients)
//   3. Connect Prisma
//   4. Instantiate analyzer, alert checker, queue
//   5. Subscribe to Redis channels
//   6. Start queue workers
//   7. Start health/metrics HTTP server
//   8. Register graceful shutdown
// ============================================================

import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

import { config } from './config';
import { ClaudeAnalyzer } from './analyzers/claudeAnalyzer';
import { AlertChecker } from './analyzers/alertChecker';
import { AnalysisQueue } from './queue/analysisQueue';
import { createHealthServer } from './health/healthServer';
import { REDIS_CHANNELS } from '../../shared/src/constants';
import { createLogger } from '../../shared/src/utils';

const logger    = createLogger('ai-service');
const startedAt = Date.now();

function makeRedis(name: string): Redis {
  const client = new Redis(config.redisUrl, {
    retryStrategy:        (t) => Math.min(t * 200, 10_000),
    enableReadyCheck:     true,
    maxRetriesPerRequest: 3,
  });
  client.on('connect',      () => logger.info(`Redis [${name}] connected`));
  client.on('error',  (err) => logger.error(`Redis [${name}] error`, { error: err.message }));
  client.on('reconnecting', () => logger.warn(`Redis [${name}] reconnecting`));
  return client;
}

async function waitReady(redis: Redis, name: string): Promise<void> {
  await redis.ping();
  logger.info(`Redis [${name}] ready`);
}

async function bootstrap() {
  logger.info('🤖 Starting CryptoIntel AI Service', {
    model:       config.claudeModel,
    maxTokens:   config.claudeMaxTokens,
    concurrency: config.queueConcurrency,
    rpmLimit:    config.rateLimitRpm,
    tpmLimit:    config.rateLimitTpm,
  });

  // ── Infrastructure ─────────────────────────────────────────
  const redisSub = makeRedis('sub');
  const redisPub = makeRedis('pub');
  const prisma   = new PrismaClient({ log: ['error', 'warn'] });

  await Promise.all([
    waitReady(redisSub, 'sub'),
    waitReady(redisPub, 'pub'),
    prisma.$connect().then(() => logger.info('Postgres connected')),
  ]);

  // ── Service instances ──────────────────────────────────────
  const analyzer = new ClaudeAnalyzer(prisma, redisPub);
  const checker  = new AlertChecker(prisma, redisPub);
  const queue    = new AnalysisQueue(analyzer);

  // ── Redis subscriptions ────────────────────────────────────
  await redisSub.subscribe(
    REDIS_CHANNELS.MARKET_DATA,
    REDIS_CHANNELS.SIGNALS,
    (err, count) => {
      if (err) { logger.error('Subscribe error', { error: err.message }); return; }
      logger.info('Subscribed to Redis channels', { count });
    },
  );

  redisSub.on('message', async (channel, raw) => {
    try {
      const event = JSON.parse(raw);

      // ── Live market ticker → alert evaluation ──────────────
      if (channel === REDIS_CHANNELS.MARKET_DATA && event.type === 'ticker') {
        await checker.check(event.payload);
        return;
      }

      // ── New signal → AI analysis queue ────────────────────
      if (channel === REDIS_CHANNELS.SIGNALS && event.type === 'signal') {
        await queue.enqueue({
          signalId:   event.payload.id,
          signal:     event.payload,
          enqueuedAt: Date.now(),
        });
        return;
      }

    } catch (err) {
      logger.error('Message handler error', {
        channel,
        error: (err as Error).message,
      });
    }
  });

  // ── Start queue workers ────────────────────────────────────
  queue.start(redisPub);

  // ── Health server ──────────────────────────────────────────
  createHealthServer(config.port, analyzer, checker, queue, startedAt);

  logger.info('✅ AI Service fully started');

  // ── Graceful shutdown ──────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down AI service`);
    queue.stop();

    // Give in-flight requests 15s to complete
    await new Promise((r) => setTimeout(r, 15_000));

    await prisma.$disconnect();
    redisSub.disconnect();
    redisPub.disconnect();
    logger.info('AI service stopped cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

bootstrap().catch((err) => {
  logger.error('AI Service bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
