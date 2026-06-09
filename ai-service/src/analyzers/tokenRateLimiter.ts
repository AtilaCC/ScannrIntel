// ============================================================
// TOKEN RATE LIMITER
// Enforces both requests-per-minute (RPM) and
// tokens-per-minute (TPM) limits against the Claude API.
//
// Uses a sliding-window algorithm: tracks each request's
// timestamp and token count in a rolling 60-second window.
// ============================================================

import { createLogger, sleep } from '../utils/shared';

const logger = createLogger('rate-limiter');

interface WindowEntry {
  ts:     number;
  tokens: number;   // estimated tokens for this request
}

const WINDOW_MS = 60_000; // 1 minute

export class TokenRateLimiter {
  private window: WindowEntry[] = [];

  constructor(
    private readonly maxRpm: number,   // max requests per minute
    private readonly maxTpm: number,   // max tokens per minute
  ) {}

  /**
   * Acquire a slot for a request with an estimated token count.
   * Blocks (with sleep) until the rate limit allows.
   */
  async acquire(estimatedTokens: number = 500): Promise<void> {
    const maxWaitMs = 90_000; // 90 second max wait
    const startedAt = Date.now();

    while (true) {
      this.pruneWindow();

      const currentRpm    = this.window.length;
      const currentTpm    = this.window.reduce((sum, e) => sum + e.tokens, 0);
      const rpmAvailable  = currentRpm < this.maxRpm;
      const tpmAvailable  = (currentTpm + estimatedTokens) <= this.maxTpm;

      if (rpmAvailable && tpmAvailable) {
        this.window.push({ ts: Date.now(), tokens: estimatedTokens });
        return;
      }

      if (Date.now() - startedAt > maxWaitMs) {
        logger.warn('Rate limit wait exceeded max — proceeding anyway', {
          currentRpm, maxRpm: this.maxRpm,
          currentTpm, maxTpm: this.maxTpm,
        });
        this.window.push({ ts: Date.now(), tokens: estimatedTokens });
        return;
      }

      // Calculate how long until the oldest entry expires
      const oldest  = this.window[0];
      const waitFor = oldest ? (oldest.ts + WINDOW_MS - Date.now()) + 50 : 1_000;

      logger.debug('Rate limit reached — waiting', {
        waitMs:  Math.round(waitFor),
        rpm:     `${currentRpm}/${this.maxRpm}`,
        tpm:     `${currentTpm}/${this.maxTpm}`,
      });

      await sleep(Math.max(100, Math.min(waitFor, 5_000)));
    }
  }

  /**
   * Record actual token usage after a completed request
   * (replaces the estimate with the real number).
   */
  recordActual(estimatedTokens: number, actualTokens: number): void {
    // Find the most recent entry with the estimated value and correct it
    for (let i = this.window.length - 1; i >= 0; i--) {
      if (this.window[i].tokens === estimatedTokens) {
        this.window[i].tokens = actualTokens;
        break;
      }
    }
  }

  get currentRpm(): number {
    this.pruneWindow();
    return this.window.length;
  }

  get currentTpm(): number {
    this.pruneWindow();
    return this.window.reduce((sum, e) => sum + e.tokens, 0);
  }

  private pruneWindow(): void {
    const cutoff = Date.now() - WINDOW_MS;
    while (this.window.length > 0 && this.window[0].ts < cutoff) {
      this.window.shift();
    }
  }
}
