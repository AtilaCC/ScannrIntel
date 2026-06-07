// ============================================================
// TOKEN SERVICE — JWT generation & verification
// Handles: access tokens, refresh tokens, password reset tokens
// ============================================================

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { JWT_CONFIG } from '../utils/shared';

export interface AccessTokenPayload {
  sub: string;     // userId
  email: string;
  role: 'admin' | 'user';
  sessionId: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';  // embedded for fast middleware checks
}

export interface RefreshTokenPayload {
  sub: string;     // userId
  sessionId: string;
  jti: string;     // unique token id — for one-time-use enforcement
}

// ── Access Token ─────────────────────────────────────────────
export const tokenService = {
  /**
   * Generate a short-lived access token (15 min).
   */
  generateAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
      expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY,
      algorithm: JWT_CONFIG.ALGORITHM as jwt.Algorithm,
      issuer: 'cryptointel',
      audience: 'cryptointel-api',
    });
  },

  /**
   * Verify & decode an access token. Throws on invalid / expired.
   */
  verifyAccessToken(token: string): AccessTokenPayload & jwt.JwtPayload {
    return jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: 'cryptointel',
      audience: 'cryptointel-api',
    }) as AccessTokenPayload & jwt.JwtPayload;
  },

  /**
   * Generate a long-lived refresh token (7 days).
   */
  generateRefreshToken(userId: string, sessionId: string): string {
    const jti = crypto.randomUUID();
    return jwt.sign(
      { sub: userId, sessionId, jti } satisfies RefreshTokenPayload,
      config.JWT_REFRESH_SECRET,
      {
        expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRY,
        algorithm: JWT_CONFIG.ALGORITHM as jwt.Algorithm,
        issuer: 'cryptointel',
      }
    );
  },

  /**
   * Verify & decode a refresh token. Throws on invalid / expired.
   */
  verifyRefreshToken(token: string): RefreshTokenPayload & jwt.JwtPayload {
    return jwt.verify(token, config.JWT_REFRESH_SECRET, {
      issuer: 'cryptointel',
    }) as RefreshTokenPayload & jwt.JwtPayload;
  },

  /**
   * Decode a token without verifying the signature.
   * Useful for reading expired tokens during refresh flows.
   */
  decodeToken(token: string): jwt.JwtPayload | null {
    const decoded = jwt.decode(token);
    return decoded && typeof decoded === 'object' ? decoded : null;
  },

  /**
   * Generate a secure random password reset token (hex, 64 chars).
   */
  generatePasswordResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
  },

  /**
   * SHA-256 hash of a token for safe DB storage.
   * We store hashes, not raw reset tokens.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  },

  /**
   * Expiry date helpers
   */
  accessTokenExpiresAt(): Date {
    return new Date(Date.now() + 15 * 60 * 1000); // 15 min
  },

  refreshTokenExpiresAt(): Date {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  },

  passwordResetExpiresAt(): Date {
    return new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  },
};
