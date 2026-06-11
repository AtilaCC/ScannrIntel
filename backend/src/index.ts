// ============================================================
// BACKEND API — Entry Point
// ============================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { config } from './config';
import { logger } from './utils/logger';
import { connectRedis, redisSubscriber, redis } from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';

import { authRouter }    from './routes/auth';
import { adminRouter }   from './routes/admin';
import { tokensRouter }  from './routes/tokens';
import { signalsRouter } from './routes/signals';
import { insightsRouter, alertsRouter, usersRouter } from './routes/insights';
import { scoresRouter }  from './routes/scores';
import { createSubscriptionRouter } from './routes/subscriptions';
import { initSubscriptionMiddleware } from './middleware/subscription';
import { tradingEngineRouter } from './routes/tradingEngine';
import { newsRouter } from './routes/news';

import { WSManager } from './services/wsManager';
import { REDIS_CHANNELS } from './utils/shared';
import { createSessionService } from './services/sessionService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function bootstrap() {
  const app        = express();
  const httpServer = createServer(app);

  // ── Security & Middleware ──────────────────────────────────
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
  app.use(rateLimiter);

  // ── Health check ──────────────────────────────────────────
  app.get('/health', async (_req, res) => {
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    res.status(200).json({
      status: 'ok',
      service: 'backend-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  // ── API Routes ────────────────────────────────────────────
  app.use('/api/v1/auth',          authRouter);
  app.use('/api/v1/admin',         adminRouter);
  app.use('/api/v1/tokens',        tokensRouter);
  app.use('/api/v1/signals',       signalsRouter);
  app.use('/api/v1/insights',      insightsRouter);
  app.use('/api/v1/alerts',        alertsRouter);
  app.use('/api/v1/users',         usersRouter);
  app.use('/api/v1/scores',        scoresRouter);
  app.use('/api/v1/subscriptions',    createSubscriptionRouter(prisma, redis));
  app.use('/api/v1/trading-engine',   tradingEngineRouter);
  app.use('/api/v1/news',             newsRouter);

  // Init subscription middleware (makes plan resolver available globally)
  initSubscriptionMiddleware(prisma, redis);

  // ── Error Handler ─────────────────────────────────────────
  app.use(errorHandler);

  // ── WebSocket Server ──────────────────────────────────────
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const wsManager = new WSManager(wss);

  // ── Redis Subscriptions ───────────────────────────────────
  await connectRedis();

  redisSubscriber.subscribe(
    REDIS_CHANNELS.MARKET_DATA,
    REDIS_CHANNELS.SIGNALS,
    REDIS_CHANNELS.AI_INSIGHTS,
    REDIS_CHANNELS.ALERTS,
    (err) => { if (err) logger.error('Redis subscribe error', { error: err.message }); }
  );

  redisSubscriber.on('message', (channel, message) => {
    try {
      const payload = JSON.parse(message);
      wsManager.broadcast(channel, payload);
    } catch (err) {
      logger.error('Failed to parse Redis message', { channel });
    }
  });

  // ── Background: purge expired sessions every hour ─────────
  const sessionService = createSessionService(prisma);
  setInterval(() => sessionService.purgeExpired(), 60 * 60 * 1000);

  // ── Start Server ──────────────────────────────────────────
  httpServer.listen(config.PORT, () => {
    logger.info(`✅ Backend API running on port ${config.PORT}`, {
      env: config.NODE_ENV,
      version: '1.0.0',
    });
  });

  // ── Graceful Shutdown ─────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down...`);
    httpServer.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error', { error: err.message, stack: err.stack });
  process.exit(1);
});
