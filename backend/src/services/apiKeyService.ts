// ============================================================
// API KEY SERVICE
//
// Manages creation, validation, and revocation of API keys.
// Keys are stored as SHA-256 hashes — raw key shown only once.
// Format: cip_<32 random bytes hex>
// ============================================================

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PlanTier, getFeature } from '../config/plans';
import { AppError } from '../middleware/errorHandler';
import { createLogger } from '../utils/shared';

const logger = createLogger('api-key-service');

export type ApiKeyScope = 'read' | 'write' | 'admin';

export interface CreateApiKeyInput {
  userId:   string;
  name:     string;
  scopes?:  ApiKeyScope[];
  expiresAt?: Date;
}

export interface ApiKeyInfo {
  id:         string;
  name:       string;
  keyPrefix:  string;
  scopes:     string[];
  isActive:   boolean;
  lastUsedAt: Date | null;
  expiresAt:  Date | null;
  createdAt:  Date;
}

export interface ValidatedApiKey {
  userId:   string;
  apiKeyId: string;
  plan:     PlanTier;
  scopes:   string[];
}

// ── Constants ─────────────────────────────────────────────────

const MAX_KEYS_PER_USER: Record<PlanTier, number> = {
  FREE:       0,   // no API access on free
  PRO:        5,
  ENTERPRISE: 20,
};

const KEY_PREFIX = 'cip_';

// ── Helpers ───────────────────────────────────────────────────

function generateRawKey(): string {
  return KEY_PREFIX + crypto.randomBytes(32).toString('hex');
}

function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function getPrefixFromKey(rawKey: string): string {
  // "cip_" + first 8 hex chars = 12 chars total for display
  return rawKey.slice(0, 12) + '...';
}

// ── Service ───────────────────────────────────────────────────

export function createApiKeyService(prisma: PrismaClient) {
  return {
    // ── Create ────────────────────────────────────────────────
    async create(input: CreateApiKeyInput): Promise<{ info: ApiKeyInfo; rawKey: string }> {
      // Check plan allows API access
      const sub = await prisma.subscription.findUnique({
        where: { userId: input.userId },
        select: { plan: true, status: true },
      });

      const plan = (sub?.status === 'ACTIVE' ? sub.plan : 'FREE') as PlanTier;
      const hasApiAccess = getFeature(plan, 'apiAccess');

      if (!hasApiAccess) {
        throw new AppError(403, 'API access requires a Pro or Enterprise subscription', 'PLAN_REQUIRED');
      }

      // Enforce per-user key limit
      const existingCount = await prisma.apiKey.count({
        where: { userId: input.userId, isActive: true },
      });

      const maxKeys = MAX_KEYS_PER_USER[plan];
      if (existingCount >= maxKeys) {
        throw new AppError(400, `Maximum of ${maxKeys} API keys allowed on your plan`, 'KEY_LIMIT_REACHED');
      }

      // Generate
      const rawKey   = generateRawKey();
      const keyHash  = hashKey(rawKey);
      const keyPrefix = getPrefixFromKey(rawKey);

      const apiKey = await prisma.apiKey.create({
        data: {
          userId:    input.userId,
          name:      input.name,
          keyHash,
          keyPrefix,
          plan,
          scopes:    input.scopes ?? ['read'],
          expiresAt: input.expiresAt ?? null,
        },
      });

      logger.info('API key created', { userId: input.userId, keyId: apiKey.id, plan });

      return {
        rawKey,
        info: {
          id:         apiKey.id,
          name:       apiKey.name,
          keyPrefix:  apiKey.keyPrefix,
          scopes:     apiKey.scopes,
          isActive:   apiKey.isActive,
          lastUsedAt: apiKey.lastUsedAt,
          expiresAt:  apiKey.expiresAt,
          createdAt:  apiKey.createdAt,
        },
      };
    },

    // ── Validate (called on every API request) ────────────────
    async validate(rawKey: string): Promise<ValidatedApiKey | null> {
      if (!rawKey.startsWith(KEY_PREFIX)) return null;

      const keyHash = hashKey(rawKey);

      const apiKey = await prisma.apiKey.findUnique({
        where:  { keyHash },
        select: {
          id:        true,
          userId:    true,
          plan:      true,
          scopes:    true,
          isActive:  true,
          expiresAt: true,
        },
      });

      if (!apiKey) return null;
      if (!apiKey.isActive) return null;
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

      // Fire-and-forget: update lastUsedAt (no await to avoid latency)
      prisma.apiKey.update({
        where: { id: apiKey.id },
        data:  { lastUsedAt: new Date() },
      }).catch(() => { /* non-critical */ });

      return {
        userId:   apiKey.userId,
        apiKeyId: apiKey.id,
        plan:     apiKey.plan as PlanTier,
        scopes:   apiKey.scopes,
      };
    },

    // ── List keys for a user ──────────────────────────────────
    async listForUser(userId: string): Promise<ApiKeyInfo[]> {
      const keys = await prisma.apiKey.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, keyPrefix: true, scopes: true,
          isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true,
        },
      });
      return keys;
    },

    // ── Revoke a key ──────────────────────────────────────────
    async revoke(keyId: string, userId: string): Promise<void> {
      const key = await prisma.apiKey.findFirst({
        where: { id: keyId, userId },
      });
      if (!key) throw new AppError(404, 'API key not found', 'NOT_FOUND');

      await prisma.apiKey.update({
        where: { id: keyId },
        data:  { isActive: false },
      });

      logger.info('API key revoked', { userId, keyId });
    },

    // ── Revoke all keys for a user (e.g. on account compromise) ──
    async revokeAll(userId: string): Promise<number> {
      const result = await prisma.apiKey.updateMany({
        where: { userId, isActive: true },
        data:  { isActive: false },
      });
      logger.warn('All API keys revoked', { userId, count: result.count });
      return result.count;
    },

    // ── Admin: get usage summary ──────────────────────────────
    async adminStats() {
      const [total, active, byPlan] = await Promise.all([
        prisma.apiKey.count(),
        prisma.apiKey.count({ where: { isActive: true } }),
        prisma.apiKey.groupBy({
          by:     ['plan'],
          _count: { id: true },
          where:  { isActive: true },
        }),
      ]);
      return { total, active, byPlan };
    },
  };
}
