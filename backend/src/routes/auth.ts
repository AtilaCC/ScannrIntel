// ============================================================
// AUTH ROUTES — Full authentication router
// POST   /auth/register
// POST   /auth/login
// POST   /auth/refresh
// POST   /auth/logout
// POST   /auth/logout-all
// GET    /auth/me
// GET    /auth/sessions
// DELETE /auth/sessions/:sessionId
// PATCH  /auth/change-password
// POST   /auth/forgot-password
// POST   /auth/reset-password
// PATCH  /auth/profile
// PATCH  /auth/preferences
// ============================================================

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { createAuthController } from '../controllers/authController';
import { authenticate } from '../middleware/authenticate';
import { authRateLimiter, strictRateLimiter, loginBruteForce } from '../middleware/rateLimiter';

const prisma = new PrismaClient();
const ctrl   = createAuthController(prisma);
const router = Router();

// ── Public (unauthenticated) ──────────────────────────────
router.post('/register',       authRateLimiter,                             ctrl.register.bind(ctrl));
router.post('/login',          authRateLimiter, loginBruteForce(),          ctrl.login.bind(ctrl));
router.post('/refresh',        authRateLimiter,   ctrl.refresh.bind(ctrl));
router.post('/forgot-password', strictRateLimiter, ctrl.forgotPassword.bind(ctrl));
router.post('/reset-password',  strictRateLimiter, ctrl.resetPassword.bind(ctrl));

// ── Authenticated ────────────────────────────────────────
router.post  ('/logout',               authenticate, ctrl.logout.bind(ctrl));
router.post  ('/logout-all',           authenticate, ctrl.logoutAll.bind(ctrl));
router.get   ('/me',                   authenticate, ctrl.me.bind(ctrl));
router.get   ('/sessions',             authenticate, ctrl.getSessions.bind(ctrl));
router.delete('/sessions/:sessionId',  authenticate, ctrl.revokeSession.bind(ctrl));
router.patch ('/change-password',      authenticate, ctrl.changePassword.bind(ctrl));
router.patch ('/profile',              authenticate, ctrl.updateProfile.bind(ctrl));
router.patch ('/preferences',          authenticate, ctrl.updatePreferences.bind(ctrl));

export { router as authRouter };
