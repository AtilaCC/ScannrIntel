// ============================================================
// SHARED UTILITIES
// ============================================================

import { v4 as uuidv4 } from 'uuid';

/** Generate a unique ID */
export const generateId = (): string => uuidv4();

/** Sleep for N milliseconds */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retry a function with exponential backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError!;
}

/** Format a number as USD */
export const formatUSD = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

/** Format a percentage */
export const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

/** Calculate percentage change */
export const percentChange = (oldVal: number, newVal: number): number =>
  oldVal === 0 ? 0 : ((newVal - oldVal) / Math.abs(oldVal)) * 100;

/** Clamp a number between min and max */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Parse a safe float, returning 0 on failure */
export const safeParseFloat = (val: string | number): number => {
  const parsed = typeof val === 'number' ? val : parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

/** Truncate a string to N chars */
export const truncate = (str: string, maxLen: number): string =>
  str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;

/** Simple logger factory */
export const createLogger = (service: string) => ({
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'info', service, msg, ...meta, ts: new Date().toISOString() })),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: 'warn', service, msg, ...meta, ts: new Date().toISOString() })),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: 'error', service, msg, ...meta, ts: new Date().toISOString() })),
  debug: (msg: string, meta?: Record<string, unknown>) =>
    process.env.NODE_ENV !== 'production' &&
    console.debug(JSON.stringify({ level: 'debug', service, msg, ...meta, ts: new Date().toISOString() })),
});

/** Rate limiter — simple token bucket */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRateMs: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens <= 0) {
      await sleep(this.refillRateMs / this.maxTokens);
      this.refill();
    }
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor((elapsed / this.refillRateMs) * this.maxTokens);
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
}
