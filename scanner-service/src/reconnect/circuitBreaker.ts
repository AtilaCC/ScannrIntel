// ============================================================
// CIRCUIT BREAKER
// Protects against sustained connection failures that would
// otherwise create an infinite reconnect storm.
//
// States:
//   CLOSED   → normal operation, requests pass through
//   OPEN     → failures exceeded threshold, fast-fail
//   HALF_OPEN → probe period: allow one attempt to test recovery
// ============================================================

import { createLogger } from '../utils/constants';

const logger = createLogger('circuit-breaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold:  number;   // failures before opening  (default 5)
  successThreshold:  number;   // successes to close again (default 2)
  openDurationMs:    number;   // how long to stay OPEN    (default 30s)
  halfOpenTimeoutMs: number;   // probe attempt timeout    (default 10s)
}

const DEFAULTS: CircuitBreakerOptions = {
  failureThreshold:  5,
  successThreshold:  2,
  openDurationMs:    30_000,
  halfOpenTimeoutMs: 10_000,
};

export class CircuitBreaker {
  private state:          CircuitState = 'CLOSED';
  private failureCount:   number = 0;
  private successCount:   number = 0;
  private lastFailureAt:  number = 0;
  private lastOpenedAt:   number = 0;
  private opts:           CircuitBreakerOptions;

  constructor(
    private readonly name: string,
    opts: Partial<CircuitBreakerOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  // ── Public API ────────────────────────────────────────────

  /** Returns true if the caller is allowed to attempt the operation. */
  canAttempt(): boolean {
    this.evaluateState();
    return this.state !== 'OPEN';
  }

  /** Call this when an operation succeeds. */
  recordSuccess(): void {
    this.lastFailureAt = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.opts.successThreshold) {
        this.close();
      }
    } else {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }
  }

  /** Call this when an operation fails. */
  recordFailure(reason?: string): void {
    this.lastFailureAt = Date.now();
    this.failureCount++;
    this.successCount = 0;

    if (
      this.state === 'CLOSED' &&
      this.failureCount >= this.opts.failureThreshold
    ) {
      this.open(reason);
    } else if (this.state === 'HALF_OPEN') {
      // Failed probe — go back to OPEN
      this.open(reason);
    }
  }

  get currentState(): CircuitState {
    this.evaluateState();
    return this.state;
  }

  get stats() {
    return {
      name:          this.name,
      state:         this.currentState,
      failureCount:  this.failureCount,
      successCount:  this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastOpenedAt:  this.lastOpenedAt,
    };
  }

  // ── Private ───────────────────────────────────────────────

  private evaluateState(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastOpenedAt;
      if (elapsed >= this.opts.openDurationMs) {
        this.halfOpen();
      }
    }
  }

  private open(reason?: string): void {
    this.state       = 'OPEN';
    this.lastOpenedAt = Date.now();
    this.successCount = 0;
    logger.warn(`Circuit [${this.name}] OPENED`, {
      failures: this.failureCount,
      reason,
      reopenIn: `${this.opts.openDurationMs / 1000}s`,
    });
  }

  private halfOpen(): void {
    this.state        = 'HALF_OPEN';
    this.successCount = 0;
    logger.info(`Circuit [${this.name}] HALF_OPEN — probing`);
  }

  private close(): void {
    this.state        = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    logger.info(`Circuit [${this.name}] CLOSED — recovered`);
  }
}
