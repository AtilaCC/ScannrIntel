// ============================================================
// AUTH CONTROLLER — Handles all auth HTTP operations
// Separated from routing for testability
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { tokenService } from '../services/tokenService';
import { passwordService } from '../services/passwordService';
import { createSessionService } from '../services/sessionService';
import { createAuditService } from '../services/auditService';
import { createSubscriptionService } from '../services/subscriptionService';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/authenticate';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  changePasswordSchema,
  updateProfileSchema,
  updatePreferencesSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
} from '../validators/authValidators';
import { logger } from '../utils/logger';

export const createAuthController = (prisma: PrismaClient) => {
  const sessionService      = createSessionService(prisma);
  const auditService        = createAuditService(prisma);
  const subscriptionService = createSubscriptionService(prisma);

  // ── Helper: resolve plan for token ─────────────────────────
  async function resolveUserPlan(userId: string): Promise<'FREE' | 'PRO' | 'ENTERPRISE'> {
    const sub = await prisma.subscription.findUnique({
      where:  { userId },
      select: { plan: true, status: true, currentPeriodEnd: true },
    });
    if (!sub || sub.status === 'CANCELED' || sub.status === 'UNPAID') return 'FREE';
    if (sub.currentPeriodEnd < new Date()) return 'FREE';
    return sub.plan as 'FREE' | 'PRO' | 'ENTERPRISE';
  }

  return {
    // ── POST /auth/register ───────────────────────────────────
    async register(req: Request, res: Response, next: NextFunction) {
      try {
        const { email, password } = registerSchema.parse(req.body);

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new AppError(409, 'Email already registered', 'EMAIL_TAKEN');

        const passwordHash = await passwordService.hash(password);

        const user = await prisma.user.create({
          data: { email, passwordHash },
          select: { id: true, email: true, role: true, isVerified: true, createdAt: true },
        });

        // Create default preferences + FREE subscription in parallel
        await Promise.all([
          prisma.userPreferences.create({
            data: { userId: user.id, defaultPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] },
          }),
          subscriptionService.createFree(user.id),
        ]);

        const { sessionId, refreshToken } = await sessionService.create({
          userId:    user.id,
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
        });

        const accessToken = tokenService.generateAccessToken({
          sub:       user.id,
          email:     user.email,
          role:      user.role.toLowerCase() as 'user' | 'admin',
          sessionId,
          plan:      'FREE',
        });

        await auditService.log({
          userId:     user.id,
          action:     'USER_REGISTER',
          resource:   'user',
          resourceId: user.id,
          req,
        });

        logger.info('User registered', { userId: user.id, email: user.email });

        res.status(201).json({
          success: true,
          data: {
            user: { ...user, role: user.role.toLowerCase(), plan: 'FREE' },
            accessToken,
            refreshToken,
          },
        });
      } catch (err) { next(err); }
    },

    // ── POST /auth/login ──────────────────────────────────────
    async login(req: Request, res: Response, next: NextFunction) {
      try {
        const { email, password } = loginSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { email } });

        // Constant-time-safe check: always run bcrypt even if user not found
        const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxxxxxxxxxxx';
        const hash = user?.passwordHash ?? dummyHash;
        const valid = await passwordService.verify(password, hash);

        if (!user || !valid || !user.isActive) {
          await auditService.log({
            userId: user?.id,
            action: 'USER_LOGIN_FAILED',
            resource: 'user',
            req,
            metadata: { email },
          });
          throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
        }

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const { sessionId, refreshToken } = await sessionService.create({
          userId:    user.id,
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
        });

        const plan = await resolveUserPlan(user.id);

        const accessToken = tokenService.generateAccessToken({
          sub:       user.id,
          email:     user.email,
          role:      user.role.toLowerCase() as 'user' | 'admin',
          sessionId,
          plan,
        });

        await auditService.log({
          userId:     user.id,
          action:     'USER_LOGIN',
          resource:   'user',
          resourceId: user.id,
          req,
        });

        logger.info('User logged in', { userId: user.id });

        res.json({
          success: true,
          data: {
            user: {
              id:         user.id,
              email:      user.email,
              role:       user.role.toLowerCase(),
              isVerified: user.isVerified,
              plan,
            },
            accessToken,
            refreshToken,
          },
        });
      } catch (err) { next(err); }
    },

    // ── POST /auth/refresh ────────────────────────────────────
    async refresh(req: Request, res: Response, next: NextFunction) {
      try {
        const { refreshToken } = refreshSchema.parse(req.body);

        const { sessionId, userId } = await sessionService.rotate({
          oldRefreshToken: refreshToken,
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
        }).catch(() => {
          throw new AppError(401, 'Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
        });

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, role: true, isActive: true },
        });

        if (!user || !user.isActive) {
          throw new AppError(401, 'Account is inactive', 'ACCOUNT_INACTIVE');
        }

        const accessToken = tokenService.generateAccessToken({
          sub: user.id,
          email: user.email,
          role: user.role.toLowerCase() as 'user' | 'admin',
          sessionId,
        });

        // The rotated session returns a new refresh token
        const newSession = await prisma.session.findUnique({ where: { id: sessionId } });

        await auditService.log({ userId, action: 'TOKEN_REFRESHED', resource: 'session', req });

        res.json({
          success: true,
          data: {
            accessToken,
            refreshToken: newSession?.refreshToken,
          },
        });
      } catch (err) { next(err); }
    },

    // ── POST /auth/logout ─────────────────────────────────────
    async logout(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const { refreshToken } = logoutSchema.parse(req.body);

        if (refreshToken) {
          await sessionService.revoke(refreshToken);
        } else if (req.user?.sessionId) {
          // Revoke the session from the access token
          await prisma.session.deleteMany({ where: { id: req.user.sessionId } });
        }

        await auditService.log({
          userId: req.user?.sub,
          action: 'USER_LOGOUT',
          resource: 'session',
          req,
        });

        res.json({ success: true, message: 'Logged out successfully' });
      } catch (err) { next(err); }
    },

    // ── POST /auth/logout-all ─────────────────────────────────
    async logoutAll(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const count = await sessionService.revokeAll(req.user!.sub);

        await auditService.log({
          userId: req.user!.sub,
          action: 'ALL_SESSIONS_REVOKED',
          resource: 'session',
          req,
          metadata: { count },
        });

        res.json({ success: true, message: `${count} sessions revoked` });
      } catch (err) { next(err); }
    },

    // ── GET /auth/me ──────────────────────────────────────────
    async me(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: req.user!.sub },
          select: {
            id: true, email: true, role: true,
            isActive: true, isVerified: true,
            createdAt: true, lastLoginAt: true,
            preferences: true,
            _count: {
              select: {
                alerts: true,
                triggeredAlerts: true,
                watchlist: true,
              },
            },
          },
        });

        if (!user) throw new AppError(404, 'User not found');

        res.json({
          success: true,
          data: { ...user, role: user.role.toLowerCase() },
        });
      } catch (err) { next(err); }
    },

    // ── GET /auth/sessions ────────────────────────────────────
    async getSessions(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const sessions = await sessionService.list(req.user!.sub);
        // Mark which session is current
        const withCurrent = sessions.map((s) => ({
          ...s,
          isCurrent: s.id === req.user!.sessionId,
        }));
        res.json({ success: true, data: withCurrent });
      } catch (err) { next(err); }
    },

    // ── DELETE /auth/sessions/:sessionId ──────────────────────
    async revokeSession(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const { sessionId } = req.params;

        // Ensure the session belongs to this user
        const session = await prisma.session.findFirst({
          where: { id: sessionId, userId: req.user!.sub },
        });
        if (!session) throw new AppError(404, 'Session not found');

        await prisma.session.delete({ where: { id: sessionId } });

        await auditService.log({
          userId: req.user!.sub,
          action: 'SESSION_REVOKED',
          resource: 'session',
          resourceId: sessionId,
          req,
        });

        res.json({ success: true, message: 'Session revoked' });
      } catch (err) { next(err); }
    },

    // ── PATCH /auth/change-password ───────────────────────────
    async changePassword(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

        const user = await prisma.user.findUniqueOrThrow({
          where: { id: req.user!.sub },
        });

        const valid = await passwordService.verify(currentPassword, user.passwordHash);
        if (!valid) throw new AppError(400, 'Current password is incorrect', 'WRONG_PASSWORD');

        const newHash = await passwordService.hash(newPassword);

        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: newHash },
        });

        // Revoke all other sessions (security best practice)
        const revokedCount = await sessionService.revokeOthers(user.id, req.user!.sessionId);

        await auditService.log({
          userId: user.id,
          action: 'PASSWORD_CHANGED',
          resource: 'user',
          resourceId: user.id,
          req,
          metadata: { otherSessionsRevoked: revokedCount },
        });

        logger.info('Password changed', { userId: user.id });

        res.json({
          success: true,
          message: 'Password changed successfully',
          data: { otherSessionsRevoked: revokedCount },
        });
      } catch (err) { next(err); }
    },

    // ── POST /auth/forgot-password ────────────────────────────
    async forgotPassword(req: Request, res: Response, next: NextFunction) {
      try {
        const { email } = requestPasswordResetSchema.parse(req.body);

        // Always return 200 to prevent email enumeration
        const user = await prisma.user.findUnique({ where: { email } });

        if (user && user.isActive) {
          // Invalidate any existing reset tokens
          await prisma.passwordReset.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: new Date() },
          });

          const rawToken  = tokenService.generatePasswordResetToken();
          const tokenHash = tokenService.hashToken(rawToken);

          await prisma.passwordReset.create({
            data: {
              userId: user.id,
              token: tokenHash,
              expiresAt: tokenService.passwordResetExpiresAt(),
            },
          });

          await auditService.log({
            userId: user.id,
            action: 'PASSWORD_RESET_REQUESTED',
            resource: 'user',
            resourceId: user.id,
            req,
          });

          // In production: send email with rawToken
          // For now: log it (dev only)
          if (process.env.NODE_ENV !== 'production') {
            logger.info('Password reset token (DEV ONLY)', {
              email,
              token: rawToken,
              expiresAt: tokenService.passwordResetExpiresAt(),
            });
          }
        }

        res.json({
          success: true,
          message: 'If an account with that email exists, a reset link has been sent.',
        });
      } catch (err) { next(err); }
    },

    // ── POST /auth/reset-password ─────────────────────────────
    async resetPassword(req: Request, res: Response, next: NextFunction) {
      try {
        const { token, password } = confirmPasswordResetSchema.parse(req.body);

        const tokenHash = tokenService.hashToken(token);

        const resetRecord = await prisma.passwordReset.findUnique({
          where: { token: tokenHash },
          include: { user: true },
        });

        if (
          !resetRecord ||
          resetRecord.usedAt !== null ||
          resetRecord.expiresAt < new Date()
        ) {
          throw new AppError(400, 'Reset token is invalid or has expired', 'INVALID_RESET_TOKEN');
        }

        const newHash = await passwordService.hash(password);

        await prisma.$transaction([
          prisma.user.update({
            where: { id: resetRecord.userId },
            data: { passwordHash: newHash },
          }),
          prisma.passwordReset.update({
            where: { id: resetRecord.id },
            data: { usedAt: new Date() },
          }),
        ]);

        // Revoke all active sessions
        await sessionService.revokeAll(resetRecord.userId);

        await auditService.log({
          userId: resetRecord.userId,
          action: 'PASSWORD_RESET_COMPLETED',
          resource: 'user',
          resourceId: resetRecord.userId,
          req,
        });

        logger.info('Password reset completed', { userId: resetRecord.userId });

        res.json({ success: true, message: 'Password reset successfully. Please log in.' });
      } catch (err) { next(err); }
    },

    // ── PATCH /auth/profile ───────────────────────────────────
    async updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const data = updateProfileSchema.parse(req.body);

        if (data.email) {
          const existing = await prisma.user.findUnique({ where: { email: data.email } });
          if (existing && existing.id !== req.user!.sub) {
            throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
          }
        }

        const user = await prisma.user.update({
          where: { id: req.user!.sub },
          data,
          select: { id: true, email: true, role: true, updatedAt: true },
        });

        await auditService.log({
          userId: req.user!.sub,
          action: 'PROFILE_UPDATED',
          resource: 'user',
          resourceId: req.user!.sub,
          req,
          metadata: { fields: Object.keys(data) },
        });

        res.json({ success: true, data: { ...user, role: user.role.toLowerCase() } });
      } catch (err) { next(err); }
    },

    // ── PATCH /auth/preferences ───────────────────────────────
    async updatePreferences(req: AuthRequest, res: Response, next: NextFunction) {
      try {
        const data = updatePreferencesSchema.parse(req.body);

        const prefs = await prisma.userPreferences.upsert({
          where: { userId: req.user!.sub },
          update: data,
          create: { userId: req.user!.sub, ...data },
        });

        await auditService.log({
          userId: req.user!.sub,
          action: 'PREFERENCES_UPDATED',
          resource: 'user_preferences',
          req,
        });

        res.json({ success: true, data: prefs });
      } catch (err) { next(err); }
    },
  };
};

export type AuthController = ReturnType<typeof createAuthController>;
