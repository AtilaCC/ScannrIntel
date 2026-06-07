// ============================================================
// PASSWORD SERVICE — bcrypt hashing + strength validation
// ============================================================

import bcrypt from 'bcryptjs';
import { config } from '../config';

export const passwordService = {
  /**
   * Hash a plaintext password with bcrypt.
   */
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, config.BCRYPT_ROUNDS);
  },

  /**
   * Compare a plaintext password against a stored hash.
   * Uses constant-time comparison to prevent timing attacks.
   */
  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  },

  /**
   * Check password strength. Returns { valid, score, feedback }.
   * score: 0 (very weak) → 4 (very strong)
   */
  checkStrength(password: string): {
    valid: boolean;
    score: number;
    feedback: string[];
  } {
    const feedback: string[] = [];
    let score = 0;

    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (password.length < 8)   feedback.push('At least 8 characters required');
    if (!/[A-Z]/.test(password)) feedback.push('Add an uppercase letter');
    if (!/[0-9]/.test(password)) feedback.push('Add a number');
    if (!/[^A-Za-z0-9]/.test(password)) feedback.push('Add a special character for a stronger password');

    // Common pattern check
    const commonPatterns = [
      /^password/i, /^123456/, /^qwerty/i, /^admin/i, /^letmein/i,
    ];
    if (commonPatterns.some((p) => p.test(password))) {
      score = Math.max(0, score - 2);
      feedback.push('Avoid common password patterns');
    }

    return {
      valid: score >= 2 && password.length >= 8,
      score: Math.min(4, score),
      feedback,
    };
  },
};
