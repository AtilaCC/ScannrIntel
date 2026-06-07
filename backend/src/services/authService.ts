// ============================================================
// AUTH SERVICE — JWT + bcrypt
// ============================================================

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { JWTPayload } from '../../../shared/src/types';
import { JWT_CONFIG } from '../../../shared/src/constants';

export const authService = {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.BCRYPT_ROUNDS);
  },

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
      expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY,
      algorithm: JWT_CONFIG.ALGORITHM as jwt.Algorithm,
    });
  },

  generateRefreshToken(userId: string): string {
    return jwt.sign({ sub: userId }, config.JWT_REFRESH_SECRET, {
      expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRY,
      algorithm: JWT_CONFIG.ALGORITHM as jwt.Algorithm,
    });
  },

  verifyRefreshToken(token: string): { sub: string } {
    return jwt.verify(token, config.JWT_REFRESH_SECRET) as { sub: string };
  },

  getRefreshTokenExpiry(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  },
};
