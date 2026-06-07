// ============================================================
// AUTH SERVICE CONFIG
// ============================================================

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  PORT:               z.coerce.number().default(4004),
  DATABASE_URL:       z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL:          z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET:  z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  BCRYPT_ROUNDS:      z.coerce.number().default(12),
  CORS_ORIGIN:        z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Auth service config error:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
