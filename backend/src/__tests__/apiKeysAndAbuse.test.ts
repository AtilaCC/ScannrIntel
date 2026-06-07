// ============================================================
// TESTS: Rate Limiting, API Keys, Abuse Protection
// ============================================================

import { createApiKeyService } from '../services/apiKeyService';
import { createAbuseProtectionService } from '../services/abuseProtectionService';

// ── Mocks ─────────────────────────────────────────────────────

const mockPrisma = {
  subscription: {
    findUnique: jest.fn(),
  },
  apiKey: {
    count:    jest.fn(),
    create:   jest.fn(),
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    update:     jest.fn(),
    updateMany: jest.fn(),
    groupBy:    jest.fn(),
  },
  abuseLog: {
    create:   jest.fn(),
    findMany: jest.fn(),
    groupBy:  jest.fn(),
  },
  ipBlock: {
    findUnique: jest.fn(),
    upsert:     jest.fn(),
    delete:     jest.fn(),
    findMany:   jest.fn(),
    count:      jest.fn(),
  },
  user: { findUnique: jest.fn() },
} as any;

const mockRedis = {
  get:              jest.fn(),
  set:              jest.fn(),
  setex:            jest.fn(),
  del:              jest.fn(),
  incr:             jest.fn(),
  expire:           jest.fn(),
  zremrangebyscore: jest.fn(),
  zcard:            jest.fn(),
  zadd:             jest.fn(),
  zrange:           jest.fn(),
} as any;

// ── API Key Service Tests ─────────────────────────────────────

describe('ApiKeyService', () => {
  let svc: ReturnType<typeof createApiKeyService>;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = createApiKeyService(mockPrisma);
  });

  describe('create()', () => {
    it('creates a key for a PRO user', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'ACTIVE' });
      mockPrisma.apiKey.count.mockResolvedValue(0);
      mockPrisma.apiKey.create.mockResolvedValue({
        id:         'key-id-1',
        name:       'My Key',
        keyPrefix:  'cip_abc12...',
        scopes:     ['read'],
        isActive:   true,
        lastUsedAt: null,
        expiresAt:  null,
        createdAt:  new Date(),
      });

      const result = await svc.create({ userId: 'user-1', name: 'My Key' });

      expect(result.rawKey).toMatch(/^cip_/);
      expect(result.rawKey).toHaveLength(68); // 'cip_' + 64 hex chars
      expect(result.info.name).toBe('My Key');
      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name:   'My Key',
            userId: 'user-1',
            scopes: ['read'],
          }),
        })
      );
    });

    it('rejects FREE users (no API access)', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE', status: 'ACTIVE' });

      await expect(svc.create({ userId: 'user-1', name: 'Key' }))
        .rejects.toMatchObject({ statusCode: 403, code: 'PLAN_REQUIRED' });
    });

    it('rejects when key limit reached (PRO = 5)', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'ACTIVE' });
      mockPrisma.apiKey.count.mockResolvedValue(5);

      await expect(svc.create({ userId: 'user-1', name: 'Key' }))
        .rejects.toMatchObject({ statusCode: 400, code: 'KEY_LIMIT_REACHED' });
    });

    it('generates unique hashes for different keys', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({ plan: 'ENTERPRISE', status: 'ACTIVE' });
      mockPrisma.apiKey.count.mockResolvedValue(0);
      mockPrisma.apiKey.create.mockResolvedValue({
        id: 'k', name: 'K', keyPrefix: 'cip_', scopes: ['read'],
        isActive: true, lastUsedAt: null, expiresAt: null, createdAt: new Date(),
      });

      const r1 = await svc.create({ userId: 'u1', name: 'K1' });
      const r2 = await svc.create({ userId: 'u1', name: 'K2' });

      expect(r1.rawKey).not.toBe(r2.rawKey);
    });
  });

  describe('validate()', () => {
    it('returns null for non-cip_ prefixed keys', async () => {
      const result = await svc.validate('sk-not-a-cip-key');
      expect(result).toBeNull();
      expect(mockPrisma.apiKey.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when key not found in DB', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue(null);
      const result = await svc.validate('cip_' + 'a'.repeat(64));
      expect(result).toBeNull();
    });

    it('returns null for inactive key', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'k1', userId: 'u1', plan: 'PRO', scopes: ['read'],
        isActive: false, expiresAt: null,
      });
      const result = await svc.validate('cip_' + 'b'.repeat(64));
      expect(result).toBeNull();
    });

    it('returns null for expired key', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'k1', userId: 'u1', plan: 'PRO', scopes: ['read'],
        isActive: true, expiresAt: new Date(Date.now() - 1000),
      });
      const result = await svc.validate('cip_' + 'c'.repeat(64));
      expect(result).toBeNull();
    });

    it('returns validated payload for valid key', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'k1', userId: 'u1', plan: 'PRO', scopes: ['read', 'write'],
        isActive: true, expiresAt: null,
      });
      mockPrisma.apiKey.update.mockResolvedValue({});

      const result = await svc.validate('cip_' + 'd'.repeat(64));

      expect(result).toMatchObject({
        userId:   'u1',
        apiKeyId: 'k1',
        plan:     'PRO',
        scopes:   ['read', 'write'],
      });
    });
  });

  describe('revoke()', () => {
    it('revokes a key belonging to the user', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValue({ id: 'k1', userId: 'u1' });
      mockPrisma.apiKey.update.mockResolvedValue({});

      await svc.revoke('k1', 'u1');

      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data:  { isActive: false },
      });
    });

    it('throws 404 for key not belonging to user', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(svc.revoke('k1', 'wrong-user'))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });
});

// ── Abuse Protection Service Tests ───────────────────────────

describe('AbuseProtectionService', () => {
  let svc: ReturnType<typeof createAbuseProtectionService>;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = createAbuseProtectionService(mockPrisma, mockRedis);
  });

  describe('isBlocked()', () => {
    it('returns true when Redis cache has block', async () => {
      mockRedis.get.mockResolvedValue('1');
      const result = await svc.isBlocked('1.2.3.4');
      expect(result).toBe(true);
      expect(mockPrisma.ipBlock.findUnique).not.toHaveBeenCalled();
    });

    it('returns false when no Redis cache and no DB record', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.ipBlock.findUnique.mockResolvedValue(null);
      const result = await svc.isBlocked('5.6.7.8');
      expect(result).toBe(false);
    });

    it('returns false and cleans up expired block', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.ipBlock.findUnique.mockResolvedValue({
        expiresAt: new Date(Date.now() - 1000), // expired
      });
      mockPrisma.ipBlock.delete.mockResolvedValue({});

      const result = await svc.isBlocked('9.10.11.12');
      expect(result).toBe(false);
      expect(mockPrisma.ipBlock.delete).toHaveBeenCalled();
    });
  });

  describe('record()', () => {
    it('writes to DB and increments Redis counter', async () => {
      mockPrisma.abuseLog.create.mockResolvedValue({});
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      await svc.record({
        ip:        '1.2.3.4',
        eventType: 'RATE_LIMITED',
        path:      '/api/test',
      });

      expect(mockPrisma.abuseLog.create).toHaveBeenCalled();
      expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('rate_limited'));
    });

    it('auto-blocks IP when INVALID_KEY threshold (20) exceeded', async () => {
      mockPrisma.abuseLog.create.mockResolvedValue({});
      mockRedis.incr.mockResolvedValue(20); // exactly at threshold
      mockRedis.expire.mockResolvedValue(1);
      mockPrisma.ipBlock.upsert.mockResolvedValue({});
      mockRedis.setex.mockResolvedValue('OK');

      await svc.record({
        ip:        '1.2.3.4',
        eventType: 'INVALID_KEY',
        path:      '/api/test',
      });

      expect(mockPrisma.ipBlock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ip: '1.2.3.4' },
          create: expect.objectContaining({ blockedBy: 'auto' }),
        })
      );
    });

    it('does NOT auto-block below threshold', async () => {
      mockPrisma.abuseLog.create.mockResolvedValue({});
      mockRedis.incr.mockResolvedValue(5);
      mockRedis.expire.mockResolvedValue(1);

      await svc.record({
        ip:        '1.2.3.4',
        eventType: 'RATE_LIMITED',
        path:      '/api/test',
      });

      expect(mockPrisma.ipBlock.upsert).not.toHaveBeenCalled();
    });
  });

  describe('isSuspiciousUserAgent()', () => {
    it('flags sqlmap', () => {
      expect(svc.isSuspiciousUserAgent('sqlmap/1.7')).toBe(true);
    });
    it('flags nikto', () => {
      expect(svc.isSuspiciousUserAgent('Nikto/2.1.6')).toBe(true);
    });
    it('flags nuclei', () => {
      expect(svc.isSuspiciousUserAgent('nuclei/2.9.0')).toBe(true);
    });
    it('passes normal browser UA', () => {
      expect(svc.isSuspiciousUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      )).toBe(false);
    });
    it('passes undefined UA', () => {
      expect(svc.isSuspiciousUserAgent(undefined)).toBe(false);
    });
  });

  describe('unblock()', () => {
    it('removes from DB and Redis', async () => {
      mockPrisma.ipBlock.delete.mockResolvedValue({});
      mockRedis.del.mockResolvedValue(1);

      await svc.unblock('1.2.3.4', 'admin-1');

      expect(mockPrisma.ipBlock.delete).toHaveBeenCalledWith({ where: { ip: '1.2.3.4' } });
      expect(mockRedis.del).toHaveBeenCalledWith('ipblock:1.2.3.4');
    });
  });
});
