// ============================================================
// AUTH SERVICE — Standalone microservice entry point
//
// This service can run independently of the main backend,
// exposing only auth-related endpoints. The main backend
// can either embed the auth routes OR call this service.
// Both patterns are supported by sharing the same schema.
// ============================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import { config } from './config';

const app    = express();
const prisma = new PrismaClient();
const redis  = new Redis(config.REDIS_URL, {
  retryStrategy: (t) => Math.min(t * 200, 5000),
});

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json());

// ── Health ────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis.ping().then(() => true).catch(() => false),
  ]);

  const status = dbOk && redisOk ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    service: 'auth-service',
    checks: { database: dbOk, redis: redisOk },
    timestamp: new Date().toISOString(),
  });
});

// ── Routes ─────────────────────────────────────────────────────
// The auth service reuses the same controller/validator logic
// from the shared backend modules.
// Import them via relative path to shared build output.
//
// In a true microservices setup these would be npm packages.
// For this monorepo setup we import directly.

import rateLimit from 'express-rate-limit';
import { createAuthController } from '../../backend/src/controllers/authController';
import { authenticate } from '../../backend/src/middleware/authenticate';
import { errorHandler } from '../../backend/src/middleware/errorHandler';

const authCtrl = createAuthController(prisma);

const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const strictLimit   = rateLimit({ windowMs: 60 * 60 * 1000, max: 5  });

const router = express.Router();

router.post('/register',        authRateLimit, authCtrl.register.bind(authCtrl));
router.post('/login',           authRateLimit, authCtrl.login.bind(authCtrl));
router.post('/refresh',         authRateLimit, authCtrl.refresh.bind(authCtrl));
router.post('/logout',          authenticate,  authCtrl.logout.bind(authCtrl));
router.post('/logout-all',      authenticate,  authCtrl.logoutAll.bind(authCtrl));
router.get ('/me',              authenticate,  authCtrl.me.bind(authCtrl));
router.get ('/sessions',        authenticate,  authCtrl.getSessions.bind(authCtrl));
router.delete('/sessions/:id',  authenticate,  authCtrl.revokeSession.bind(authCtrl));
router.patch('/change-password',authenticate,  authCtrl.changePassword.bind(authCtrl));
router.post('/forgot-password', strictLimit,   authCtrl.forgotPassword.bind(authCtrl));
router.post('/reset-password',  strictLimit,   authCtrl.resetPassword.bind(authCtrl));
router.patch('/profile',        authenticate,  authCtrl.updateProfile.bind(authCtrl));
router.patch('/preferences',    authenticate,  authCtrl.updatePreferences.bind(authCtrl));

app.use('/api/v1/auth', router);
app.use(errorHandler);

// ── Publish auth events to Redis (for other services) ────────
// Other services (e.g. AI service) can subscribe to know when
// users register, log in, or their sessions are revoked.
async function publishAuthEvent(event: string, data: unknown) {
  await redis.publish('channel:auth_events', JSON.stringify({ event, data, ts: Date.now() }));
}

// ── Start ─────────────────────────────────────────────────────
const server = createServer(app);

server.listen(config.PORT, () => {
  console.log(JSON.stringify({
    level: 'info',
    service: 'auth-service',
    msg: `Auth Service running on port ${config.PORT}`,
    ts: new Date().toISOString(),
  }));
});

// ── Shutdown ──────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  server.close(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
});
