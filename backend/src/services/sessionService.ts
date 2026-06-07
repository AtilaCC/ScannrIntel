// ============================================================
// SESSION SERVICE — Refresh token session management
// Handles create, validate, rotate, revoke, cleanup
// ============================================================

import { PrismaClient } from '@prisma/client';
import { tokenService } from './tokenService';
import { createLogger } from '../../../shared/src/utils';

const logger = createLogger('session-service');

// Max concurrent sessions per user
const MAX_SESSIONS_PER_USER = 5;

export const createSessionService = (prisma: PrismaClient) => ({
  /**
   * Create a new session and return the refresh token.
   */
  async create(opts: {
    userId: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ sessionId: string; refreshToken: string }> {
    // Enforce session limit — remove oldest if over cap
    await this.enforceSessionLimit(opts.userId);

    const sessionId = crypto.randomUUID();
    const refreshToken = tokenService.generateRefreshToken(opts.userId, sessionId);

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: opts.userId,
        refreshToken,
        userAgent: opts.userAgent,
        ipAddress: opts.ipAddress,
        expiresAt: tokenService.refreshTokenExpiresAt(),
      },
    });

    logger.info('Session created', { userId: opts.userId, sessionId });
    return { sessionId, refreshToken };
  },

  /**
   * Validate a refresh token and return the session + user.
   * Throws on invalid, expired, or revoked token.
   */
  async validate(refreshToken: string): Promise<{
    sessionId: string;
    userId: string;
  }> {
    // Verify JWT signature first
    const payload = tokenService.verifyRefreshToken(refreshToken);

    // Look up the session in DB
    const session = await prisma.session.findUnique({
      where: { refreshToken },
    });

    if (!session) {
      throw new Error('Session not found — token may have been revoked');
    }

    if (session.expiresAt < new Date()) {
      // Clean up expired session
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      throw new Error('Session expired');
    }

    if (session.userId !== payload.sub) {
      throw new Error('Token / session user mismatch');
    }

    // Update last used timestamp
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    return { sessionId: session.id, userId: session.userId };
  },

  /**
   * Rotate a refresh token (old in → new token out).
   * Old session is deleted; new session is created.
   * This is a security measure: each refresh token is single-use.
   */
  async rotate(opts: {
    oldRefreshToken: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ sessionId: string; refreshToken: string }> {
    const { sessionId, userId } = await this.validate(opts.oldRefreshToken);

    // Delete old session
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});

    // Create new session
    return this.create({
      userId,
      userAgent: opts.userAgent,
      ipAddress: opts.ipAddress,
    });
  },

  /**
   * Revoke a single session by refresh token.
   */
  async revoke(refreshToken: string): Promise<void> {
    const deleted = await prisma.session.deleteMany({ where: { refreshToken } });
    if (deleted.count > 0) {
      logger.info('Session revoked', { refreshToken: refreshToken.slice(0, 20) + '...' });
    }
  },

  /**
   * Revoke ALL sessions for a user (e.g. password change, account compromise).
   */
  async revokeAll(userId: string): Promise<number> {
    const result = await prisma.session.deleteMany({ where: { userId } });
    logger.info('All sessions revoked', { userId, count: result.count });
    return result.count;
  },

  /**
   * Revoke all sessions except the one currently in use.
   */
  async revokeOthers(userId: string, currentSessionId: string): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: { userId, id: { not: currentSessionId } },
    });
    logger.info('Other sessions revoked', { userId, count: result.count });
    return result.count;
  },

  /**
   * List all active sessions for a user.
   */
  async list(userId: string) {
    return prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  },

  /**
   * Purge all expired sessions globally (for cron / background task).
   */
  async purgeExpired(): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      logger.info('Expired sessions purged', { count: result.count });
    }
    return result.count;
  },

  /**
   * Enforce max sessions per user by removing the oldest ones.
   */
  async enforceSessionLimit(userId: string): Promise<void> {
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (sessions.length >= MAX_SESSIONS_PER_USER) {
      const toDelete = sessions.slice(0, sessions.length - MAX_SESSIONS_PER_USER + 1);
      await prisma.session.deleteMany({
        where: { id: { in: toDelete.map((s) => s.id) } },
      });
    }
  },
});

export type SessionService = ReturnType<typeof createSessionService>;
