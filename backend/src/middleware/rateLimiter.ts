import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '0.0.0.0';
}

function errorResponse(msg: string, code: string) {
  return { success: false, error: msg, code };
}

export function initRateLimiter(_redis: any, _abuseService: any) {}
export function ipBlockMiddleware() {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

export function globalRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientIp,
    skip: (req) => req.path === '/health',
  });
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: errorResponse('Too many auth attempts.', 'RATE_LIMITED'),
});

export const strictRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: errorResponse('Too many reset attempts.', 'RATE_LIMITED'),
});

export function apiKeyRateLimiter() {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

export function loginBruteForce() {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

export const rateLimiter = globalRateLimiter();
