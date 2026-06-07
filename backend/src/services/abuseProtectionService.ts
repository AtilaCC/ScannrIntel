// ============================================================
// ABUSE PROTECTION SERVICE
//
// Tracks suspicious activity and auto-blocks IPs that exceed
// violation thresholds. Uses Redis for fast in-memory counters
// and Postgres for persistent audit trails.
// ============================================================

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { createLogger } from '../../../shared/src/utils';

const logger = createLogger('abuse-protection');

export type AbuseEventType =
  | 'RATE_LIMITED'
  | 'INVALID_KEY'
  | 'INVALID_TOKEN'
  | 'SUSPICIOUS_UA'
  | 'BLOCKED'
  | 'AUTO_BLOCKED';

export interface AbuseEvent {
  ip:        string;
  userId?:   string;
  apiKeyId?: string;
  eventType: AbuseEventType;
  path:      string;
  userAgent?: string;
  details?:  Record<string, unknown>;
}

// ── Thresholds ────────────────────────────────────────────────

const AUTO_BLOCK_THRESHOLDS = {
  RATE_LIMITED:   50,  // 50 rate-limit hits in 1 hour → auto-block 1h
  INVALID_KEY:    20,  // 20 bad API keys in 15 min → auto-block 24h
  INVALID_TOKEN:  30,  // 30 invalid tokens in 15 min → auto-block 1h
  SUSPICIOUS_UA:  10,  // 10 suspicious UA hits in 5 min → auto-block 30min
} as const;

const WINDOW_SECONDS = {
  RATE_LIMITED:  3600,  // 1 hour
  INVALID_KEY:    900,  // 15 min
  INVALID_TOKEN:  900,  // 15 min
  SUSPICIOUS_UA:  300,  // 5 min
} as const;

const BLOCK_DURATION_SECONDS = {
  RATE_LIMITED:   3600,      // 1 hour
  INVALID_KEY:   86400,      // 24 hours
  INVALID_TOKEN:  3600,      // 1 hour
  SUSPICIOUS_UA:  1800,      // 30 min
} as const;

// Suspicious user-agent patterns (scrapers, scanners, exploit tools)
const SUSPICIOUS_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i,
  /python-requests\/[01]\./i,  // very old versions often used in bulk scripts
  /go-http-client\/1\.1$/i,
  /^curl\/[0-6]\./i,
  /nuclei/i, /metasploit/i, /dirbuster/i, /gobuster/i,
];

// ── Service ───────────────────────────────────────────────────

export function createAbuseProtectionService(prisma: PrismaClient, redis: Redis) {
  // ── Internal: increment Redis counter ─────────────────────
  async function incrementCounter(ip: string, eventType: keyof typeof WINDOW_SECONDS): Promise<number> {
    const key     = `abuse:${eventType.toLowerCase()}:${ip}`;
    const windowS = WINDOW_SECONDS[eventType];
    const count   = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowS);
    return count;
  }

  // ── Internal: auto-block an IP ────────────────────────────
  async function autoBlock(ip: string, reason: string, eventType: keyof typeof BLOCK_DURATION_SECONDS): Promise<void> {
    const durationS = BLOCK_DURATION_SECONDS[eventType];
    const expiresAt = new Date(Date.now() + durationS * 1000);

    // Write to DB (upsert in case already blocked)
    await prisma.ipBlock.upsert({
      where:  { ip },
      create: { ip, reason, blockedBy: 'auto', expiresAt },
      update: { reason, expiresAt },
    }).catch(() => { /* best-effort */ });

    // Also cache in Redis for fast lookup
    await redis.setex(`ipblock:${ip}`, durationS, '1');

    logger.warn('IP auto-blocked', { ip, reason, expiresAt, durationS });
  }

  return {
    // ── Check if an IP is currently blocked ───────────────────
    async isBlocked(ip: string): Promise<boolean> {
      // Fast path: Redis cache
      const cached = await redis.get(`ipblock:${ip}`);
      if (cached) return true;

      // Slow path: DB (also warms Redis cache)
      const block = await prisma.ipBlock.findUnique({
        where:  { ip },
        select: { expiresAt: true },
      });

      if (!block) return false;
      if (block.expiresAt && block.expiresAt < new Date()) {
        // Expired — clean up
        await prisma.ipBlock.delete({ where: { ip } }).catch(() => {});
        return false;
      }

      // Warm cache (remaining TTL or 1 hour if permanent)
      const ttl = block.expiresAt
        ? Math.floor((block.expiresAt.getTime() - Date.now()) / 1000)
        : 3600;
      if (ttl > 0) await redis.setex(`ipblock:${ip}`, ttl, '1');

      return true;
    },

    // ── Record an abuse event and potentially auto-block ──────
    async record(event: AbuseEvent): Promise<void> {
      // Async DB write — don't await on hot paths
      prisma.abuseLog.create({
        data: {
          ip:        event.ip,
          userId:    event.userId    ?? null,
          apiKeyId:  event.apiKeyId  ?? null,
          eventType: event.eventType,
          path:      event.path,
          userAgent: event.userAgent ?? null,
          details:   event.details   ?? undefined,
        },
      }).catch((err) => logger.error('Failed to write abuse log', { err }));

      // Check thresholds for auto-blockable event types
      const thresholdKey = event.eventType as keyof typeof AUTO_BLOCK_THRESHOLDS;
      if (!(thresholdKey in AUTO_BLOCK_THRESHOLDS)) return;

      const count = await incrementCounter(event.ip, thresholdKey);
      const threshold = AUTO_BLOCK_THRESHOLDS[thresholdKey];

      if (count >= threshold) {
        const reason = `Auto-blocked: ${count} ${event.eventType} events in window`;
        await autoBlock(event.ip, reason, thresholdKey);
      }
    },

    // ── Detect suspicious user agents ─────────────────────────
    isSuspiciousUserAgent(ua: string | undefined): boolean {
      if (!ua || ua.length === 0) return false;
      return SUSPICIOUS_UA_PATTERNS.some((p) => p.test(ua));
    },

    // ── Admin: unblock an IP ──────────────────────────────────
    async unblock(ip: string, adminId: string): Promise<void> {
      await prisma.ipBlock.delete({ where: { ip } }).catch(() => {});
      await redis.del(`ipblock:${ip}`);
      logger.info('IP unblocked by admin', { ip, adminId });
    },

    // ── Admin: manual block ───────────────────────────────────
    async blockIp(ip: string, reason: string, adminId: string, expiresAt?: Date): Promise<void> {
      await prisma.ipBlock.upsert({
        where:  { ip },
        create: { ip, reason, blockedBy: adminId, expiresAt: expiresAt ?? null },
        update: { reason, blockedBy: adminId, expiresAt: expiresAt ?? null },
      });

      const ttl = expiresAt
        ? Math.floor((expiresAt.getTime() - Date.now()) / 1000)
        : 24 * 3600;
      if (ttl > 0) await redis.setex(`ipblock:${ip}`, ttl, '1');

      logger.warn('IP manually blocked', { ip, reason, adminId });
    },

    // ── Admin: list recent abuse events ──────────────────────
    async getRecentEvents(limit = 100) {
      return prisma.abuseLog.findMany({
        orderBy: { createdAt: 'desc' },
        take:    limit,
        select: {
          id: true, ip: true, userId: true, eventType: true,
          path: true, userAgent: true, details: true, createdAt: true,
        },
      });
    },

    // ── Admin: list blocked IPs ───────────────────────────────
    async getBlockedIps() {
      return prisma.ipBlock.findMany({
        where:   { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { createdAt: 'desc' },
      });
    },

    // ── Admin: abuse stats ────────────────────────────────────
    async getStats(windowHours = 24) {
      const since = new Date(Date.now() - windowHours * 3600 * 1000);
      const [byType, topIps, blockedCount] = await Promise.all([
        prisma.abuseLog.groupBy({
          by:      ['eventType'],
          _count:  { id: true },
          where:   { createdAt: { gte: since } },
        }),
        prisma.abuseLog.groupBy({
          by:      ['ip'],
          _count:  { id: true },
          where:   { createdAt: { gte: since } },
          orderBy: { _count: { id: 'desc' } },
          take:    10,
        }),
        prisma.ipBlock.count({
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        }),
      ]);

      return { byType, topIps, blockedCount, windowHours };
    },
  };
}
