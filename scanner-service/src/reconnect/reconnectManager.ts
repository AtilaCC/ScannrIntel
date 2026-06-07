// ============================================================
// RECONNECT MANAGER
// Drives WebSocket reconnection with exponential backoff +
// full jitter and circuit-breaker gating.
// ============================================================

import { CircuitBreaker } from './circuitBreaker';
import { createLogger } from '../../../../shared/src/utils';

const logger = createLogger('reconnect-manager');

export interface ReconnectOptions {
  baseDelayMs:   number;
  maxDelayMs:    number;
  maxAttempts:   number;
  jitterFactor:  number;   // 0–1, how much randomness to add
}

const DEFAULTS: ReconnectOptions = {
  baseDelayMs:  1_000,
  maxDelayMs:   30_000,
  maxAttempts:  50,
  jitterFactor: 0.3,
};

export class ReconnectManager {
  private attempts:       number = 0;
  private timer:          NodeJS.Timeout | null = null;
  private _isRunning:     boolean = false;
  private opts:           ReconnectOptions;
  private circuit:        CircuitBreaker;

  constructor(
    private readonly name:      string,
    private readonly onAttempt: () => void,
    opts: Partial<ReconnectOptions> = {},
  ) {
    this.opts    = { ...DEFAULTS, ...opts };
    this.circuit = new CircuitBreaker(name, {
      failureThreshold: 5,
      openDurationMs:   this.opts.maxDelayMs,
    });
  }

  // ── Public API ────────────────────────────────────────────

  start(): void {
    this._isRunning = true;
    this.attempts   = 0;
  }

  stop(): void {
    this._isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Called when a connection attempt succeeded. */
  onSuccess(): void {
    this.attempts = 0;
    this.circuit.recordSuccess();
    logger.info(`[${this.name}] Connected — resetting reconnect state`);
  }

  /** Called when a connection attempt failed. */
  onFailure(reason?: string): void {
    this.circuit.recordFailure(reason);

    if (!this._isRunning) return;

    if (this.attempts >= this.opts.maxAttempts) {
      logger.error(`[${this.name}] Max reconnect attempts (${this.opts.maxAttempts}) reached — giving up`);
      return;
    }

    if (!this.circuit.canAttempt()) {
      logger.warn(`[${this.name}] Circuit OPEN — waiting for recovery window`);
      // Still schedule a retry for when the circuit half-opens
      this.scheduleRetry();
      return;
    }

    this.scheduleRetry();
  }

  get isRunning(): boolean { return this._isRunning; }
  get attemptCount(): number { return this.attempts; }
  get circuitState(): string { return this.circuit.currentState; }

  // ── Private ───────────────────────────────────────────────

  private scheduleRetry(): void {
    if (this.timer) return; // already scheduled

    const delay = this.computeDelay();
    this.attempts++;

    logger.info(`[${this.name}] Reconnecting in ${Math.round(delay)}ms`, {
      attempt: this.attempts,
      maxAttempts: this.opts.maxAttempts,
      circuit: this.circuit.currentState,
    });

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this._isRunning && this.circuit.canAttempt()) {
        this.onAttempt();
      }
    }, delay);
  }

  /** Exponential backoff with full jitter. */
  private computeDelay(): number {
    const base    = this.opts.baseDelayMs;
    const cap     = this.opts.maxDelayMs;
    const expo    = Math.min(cap, base * Math.pow(2, this.attempts));
    const jitter  = expo * this.opts.jitterFactor * Math.random();
    return Math.min(cap, expo - jitter);
  }
}
