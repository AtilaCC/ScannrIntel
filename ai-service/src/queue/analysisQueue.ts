// ============================================================
// ANALYSIS QUEUE — Priority-aware with dead-letter handling
// ============================================================

import Redis from 'ioredis';
import { ClaudeAnalyzer } from '../analyzers/claudeAnalyzer';
import { config } from '../config';
import { QueueItem, DeadLetterItem, QueuePriority } from '../types';
import { REDIS_CHANNELS } from '../../../../shared/src/constants';
import { createLogger, sleep, generateId } from '../../../../shared/src/utils';

const logger = createLogger('analysis-queue');

const QUEUE_KEYS: Record<QueuePriority, string> = {
  CRITICAL: `${REDIS_CHANNELS.AI_QUEUE}:critical`,
  HIGH:     `${REDIS_CHANNELS.AI_QUEUE}:high`,
  NORMAL:   `${REDIS_CHANNELS.AI_QUEUE}:normal`,
  LOW:      `${REDIS_CHANNELS.AI_QUEUE}:low`,
};

const DEAD_LETTER_KEY = `${REDIS_CHANNELS.AI_QUEUE}:dead`;
const LEGACY_KEY      =  REDIS_CHANNELS.AI_QUEUE;

function signalToPriority(severity: string): QueuePriority {
  if (severity === 'CRITICAL') return 'CRITICAL';
  if (severity === 'HIGH')     return 'HIGH';
  if (severity === 'MEDIUM')   return 'NORMAL';
  return 'LOW';
}

export class AnalysisQueue {
  private isRunning = false;
  private active    = 0;
  private processed = 0;
  private failed    = 0;
  private redis!:   Redis;

  constructor(private readonly analyzer: ClaudeAnalyzer) {}

  async enqueue(raw: { signalId: string; signal: any; enqueuedAt?: number }): Promise<void> {
    const priority = signalToPriority(raw.signal?.severity ?? 'LOW');
    const item: QueueItem = {
      id: generateId(),
      signalId:    raw.signalId,
      signal:      raw.signal,
      priority,
      enqueuedAt:  raw.enqueuedAt ?? Date.now(),
      attempts:    0,
      maxAttempts: config.queueMaxAttempts,
      nextRetryAt: 0,
    };
    await this.redis.lpush(QUEUE_KEYS[priority], JSON.stringify(item));
    logger.debug('Signal enqueued', { signalId: raw.signalId, priority });
  }

  start(redis: Redis): void {
    this.redis     = redis;
    this.isRunning = true;
    this.drainLegacyQueue();
    for (let i = 0; i < config.queueConcurrency; i++) this.runWorker(i);
    setInterval(() => this.logDepths(), 60_000);
    logger.info('Queue started', { concurrency: config.queueConcurrency });
  }

  stop(): void { this.isRunning = false; }

  get stats() { return { active: this.active, processed: this.processed, failed: this.failed }; }

  async depths(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [p, k] of Object.entries(QUEUE_KEYS))
      out[p] = await this.redis.llen(k).catch(() => 0);
    out['dead'] = await this.redis.llen(DEAD_LETTER_KEY).catch(() => 0);
    return out;
  }

  private async runWorker(id: number): Promise<void> {
    while (this.isRunning) {
      try {
        const item = await this.popNext();
        if (!item) { await sleep(200); continue; }
        if (item.nextRetryAt > Date.now()) {
          await this.redis.rpush(QUEUE_KEYS[item.priority], JSON.stringify(item));
          await sleep(500);
          continue;
        }
        this.active++;
        item.attempts++;
        try {
          await this.analyzer.analyze(item);
          this.processed++;
        } catch (err: any) {
          this.failed++;
          await this.handleFailure(item, err);
        } finally {
          this.active--;
        }
      } catch (err) {
        logger.error(`Worker ${id} error`, { error: (err as Error).message });
        await sleep(1_000);
      }
    }
  }

  private async popNext(): Promise<QueueItem | null> {
    const lanes = [QUEUE_KEYS.CRITICAL, QUEUE_KEYS.HIGH, QUEUE_KEYS.NORMAL, QUEUE_KEYS.LOW];
    for (const key of lanes) {
      const raw = await this.redis.rpop(key).catch(() => null);
      if (raw) { try { return JSON.parse(raw); } catch { continue; } }
    }
    const legacy = await this.redis.brpop(LEGACY_KEY, 1).catch(() => null);
    if (legacy) {
      try {
        const raw = JSON.parse(legacy[1]);
        return {
          id: generateId(), signalId: raw.signalId, signal: raw.signal,
          priority: signalToPriority(raw.signal?.severity ?? 'LOW'),
          enqueuedAt: raw.enqueuedAt ?? Date.now(),
          attempts: 0, maxAttempts: config.queueMaxAttempts, nextRetryAt: 0,
        };
      } catch { return null; }
    }
    return null;
  }

  private async handleFailure(item: QueueItem, err: any): Promise<void> {
    if (err?.retryable !== false && item.attempts < item.maxAttempts) {
      const delay = (err?.retryAfterMs ?? config.queueRetryBaseMs) * Math.pow(2, item.attempts - 1);
      item.nextRetryAt = Date.now() + delay;
      await this.redis.lpush(QUEUE_KEYS[item.priority], JSON.stringify(item));
      logger.warn('Re-queued for retry', { signalId: item.signalId, attempt: item.attempts, delay });
    } else {
      const dead: DeadLetterItem = { ...item, failedAt: Date.now(), lastError: err?.message ?? String(err) };
      await this.redis.lpush(DEAD_LETTER_KEY, JSON.stringify(dead));
      await this.redis.ltrim(DEAD_LETTER_KEY, 0, 999);
      logger.error('Moved to dead-letter', { signalId: item.signalId, error: dead.lastError });
    }
  }

  private async drainLegacyQueue(): Promise<void> {
    let n = 0;
    while (true) {
      const raw = await this.redis.rpop(LEGACY_KEY).catch(() => null);
      if (!raw) break;
      try { await this.enqueue(JSON.parse(raw)); n++; } catch { /* skip */ }
    }
    if (n > 0) logger.info(`Drained ${n} legacy queue items`);
  }

  private async logDepths(): Promise<void> {
    logger.info('Queue depths', await this.depths());
  }
}
