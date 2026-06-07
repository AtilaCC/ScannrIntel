// ============================================================
// AUDIT SERVICE — Security event logging
// ============================================================

import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

export type AuditAction =
  | 'USER_REGISTER'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_LOGIN_FAILED'
  | 'TOKEN_REFRESHED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'SESSION_REVOKED'
  | 'ALL_SESSIONS_REVOKED'
  | 'PROFILE_UPDATED'
  | 'PREFERENCES_UPDATED'
  | 'ALERT_CREATED'
  | 'ALERT_DELETED'
  | 'ALERT_TOGGLED'
  | 'WATCHLIST_UPDATED'
  | 'ADMIN_USER_UPDATED'
  | 'ADMIN_USER_LISTED';

export const createAuditService = (prisma: PrismaClient) => ({
  async log(opts: {
    userId?: string;
    action: AuditAction;
    resource: string;
    resourceId?: string;
    req?: Request;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: opts.userId,
          action: opts.action,
          resource: opts.resource,
          resourceId: opts.resourceId,
          ipAddress: opts.req ? getClientIp(opts.req) : undefined,
          userAgent: opts.req?.headers['user-agent'],
          metadata: opts.metadata as any,
        },
      });
    } catch {
      // Audit log failure must never break the main flow
    }
  },

  async getByUser(userId: string, limit = 50) {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, action: true, resource: true,
        ipAddress: true, createdAt: true, metadata: true,
      },
    });
  },

  async getAll(opts: { page: number; limit: number; action?: string }) {
    const skip = (opts.page - 1) * opts.limit;
    const where = opts.action ? { action: opts.action } : {};
    const [logs, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where, skip, take: opts.limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { logs, total };
  },
});

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export type AuditService = ReturnType<typeof createAuditService>;
