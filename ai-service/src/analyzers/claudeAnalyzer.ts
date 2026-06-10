// ============================================================
// CLAUDE ANALYZER
// Orchestrates the full analysis pipeline per signal:
//   1. Deduplication check
//   2. Severity filter
//   3. Context enrichment
//   4. Rate-limited Claude API call (with retry)
//   5. Response parsing + validation
//   6. DB persistence
//   7. Redis publish
//   8. Usage tracking
// ============================================================

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { ClaudeClient } from './claudeClient';
import { TokenRateLimiter } from './tokenRateLimiter';
import { ContextEnricher } from '../context/contextEnricher';
import { parseClaudeResponse } from './responseParser';
import { buildUserPrompt, estimatePromptTokens } from '../prompts/signalPrompts';
import { SYSTEM_PROMPT } from '../prompts/systemPrompt';
import { TokenScorer } from '../scoring/tokenScorer';
import { ScoreAggregator } from '../scoring/scoreAggregator';
import { TokenScoreStore } from '../scoring/tokenScoreStore';
import { config, SEVERITY_PRIORITY } from '../config';
import { REDIS_CHANNELS } from '../utils/shared';
import { QueueItem, ClassifiedError, TokenScore } from '../types';
import { createLogger, generateId, sleep } from '../utils/shared';

const logger = createLogger('groq-analyzer');

// How long to wait between retries per error type
const RETRY_DELAYS: Record<string, number> = {
  RATE_LIMIT:     60_000,
  OVERLOADED:     10_000,
  SERVER_ERROR:    5_000,
  NETWORK_ERROR:   2_000,
  TIMEOUT:         3_000,
};

export class ClaudeAnalyzer {
  private client:     ClaudeClient;
  private limiter:    TokenRateLimiter;
  private enricher:   ContextEnricher;
  private scorer:     TokenScorer;
  private aggregator: ScoreAggregator;
  private scoreStore: TokenScoreStore;

  // In-memory dedup: signalId → analyzed timestamp
  private analyzedCache: Map<string, number> = new Map();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis:  Redis,
  ) {
    this.client     = new ClaudeClient(config.anthropicApiKey); // reads GROQ_API_KEY via config
    this.limiter    = new TokenRateLimiter(config.rateLimitRpm, config.rateLimitTpm);
    this.enricher   = new ContextEnricher(prisma, redis);
    this.scorer     = new TokenScorer();
    this.aggregator = new ScoreAggregator();
    this.scoreStore = new TokenScoreStore(redis, prisma);
  }

  // ── Public entry point ────────────────────────────────────

  async analyze(item: QueueItem): Promise<void> {
    const { signalId, signal } = item;

    // ── 1. Dedup check ─────────────────────────────────────
    if (this.analyzedCache.has(signalId)) {
      logger.debug('Signal already analyzed (memory cache)', { signalId });
      return;
    }

    if (config.skipAlreadyAnalyzed) {
      const existing = await this.prisma.aIInsight.findFirst({ where: { signalId } });
      if (existing) {
        this.analyzedCache.set(signalId, Date.now());
        return;
      }
    }

    // ── 2. Severity filter ─────────────────────────────────
    const minPriority = SEVERITY_PRIORITY[config.minSeverityToAnalyze] ?? 3;
    const sigPriority = SEVERITY_PRIORITY[signal.severity] ?? 3;
    if (sigPriority > minPriority) {
      logger.debug('Signal below min severity threshold — skipping', {
        signalId,
        severity: signal.severity,
        minSeverity: config.minSeverityToAnalyze,
      });
      return;
    }

    logger.info('Starting analysis', {
      signalId,
      symbol:   signal.symbol,
      type:     signal.type,
      severity: signal.severity,
      attempt:  item.attempts,
    });

    // ── 3. Context enrichment ──────────────────────────────
    const ctx = await this.enricher.enrich(signal);

    // ── 4. Rule-based pre-scoring (deterministic baseline) ─
    const { factors, compositeRisk, compositeOpportunity } =
      this.scorer.computeRuleBasedScores(signal, ctx);

    logger.debug('Rule-based pre-scores computed', {
      signalId,
      compositeRisk,
      compositeOpportunity,
      factorCount: factors.length,
    });

    // ── 5. Build prompts ───────────────────────────────────
    const userPrompt      = buildUserPrompt(signal, ctx);
    const estimatedTokens = estimatePromptTokens(signal);

    // ── 6. Rate-limited API call with retry ────────────────
    let lastError: ClassifiedError | null = null;

    for (let attempt = 1; attempt <= config.queueMaxAttempts; attempt++) {
      try {
        await this.limiter.acquire(estimatedTokens);

        const { response, usage, latencyMs } = await this.client.request({
          model:       config.claudeModel,
          max_tokens:  config.claudeMaxTokens,
          temperature: config.claudeTemp,
          system:      SYSTEM_PROMPT,
          messages:    [{ role: 'user', content: userPrompt }],
        });

        // Correct rate limiter with actual token count
        this.limiter.recordActual(estimatedTokens, usage.totalTokens);

        const rawText = response.content[0]?.text ?? '';

        // ── 6. Parse response ──────────────────────────────
        const { insight, parseError } = parseClaudeResponse(rawText, signal);

        // ── 7. Aggregate scores ────────────────────────────
        const breakdown = this.aggregator.aggregate({
          signal: { id: signal.id, symbol: signal.symbol, type: signal.type, severity: signal.severity },
          insight,
          ruleFactors:          factors,
          compositeRisk,
          compositeOpportunity,
          ctx,
        });

        // ── 8. Persist insight to DB ───────────────────────
        const insightId = generateId();

        // Ensure Signal row exists (FK constraint on ai_insights_signal_id_fkey)
        await this.prisma.signal.upsert({
          where:  { id: signalId },
          update: {},
          create: {
            id:       signalId,
            symbol:   signal.symbol,
            type:     signal.type,
            severity: signal.severity as any,
            data:     (signal.data ?? {}) as any,
            metadata: (signal.metadata ?? {}) as any,
          },
        });


        const saved = await this.prisma.aIInsight.create({
          data: {
            id:               insightId,
            signalId,
            symbol:           signal.symbol,
            summary:          insight.summary,
            details:          insight.details,
            riskScore:        breakdown.finalRisk,        // ← use final calibrated score
            opportunityScore: breakdown.finalOpportunity, // ← use final calibrated score
            sentiment:        insight.sentiment as any,
            tags:             insight.tags,
            recommendations:  insight.recommendations,
            confidence:       insight.confidence,
            modelVersion:     response.model,
            promptTokens:     usage.inputTokens,
            completionTokens: usage.outputTokens,
          },
        });

        // ── 9. Persist token score ─────────────────────────
        const tokenScore: TokenScore = {
          symbol:           signal.symbol,
          finalRisk:        breakdown.finalRisk,
          finalOpportunity: breakdown.finalOpportunity,
          sentiment:        insight.sentiment,
          breakdown,
          signalId:         signal.id,
          insightId,
          computedAt:       breakdown.computedAt,
        };

        await this.scoreStore.save(tokenScore);

        // Mark signal as processed
        await this.prisma.signal.update({
          where: { id: signalId },
          data:  { processedByAI: true },
        });

        // Cache as analyzed
        this.analyzedCache.set(signalId, Date.now());
        this.pruneAnalyzedCache();

        // ── 10. Publish to Redis ───────────────────────────
        await this.redis.publish(
          REDIS_CHANNELS.AI_INSIGHTS,
          JSON.stringify({
            type:      'ai_insight',
            payload:   {
              ...saved,
              // Attach full scoring data for frontend display
              breakdown,
              keyLevels:  insight.keyLevels,
              timeframe:  insight.timeframe,
              parseError,
            },
            timestamp: Date.now(),
          }),
        );

        logger.info('Analysis complete', {
          signalId,
          symbol:           signal.symbol,
          sentiment:        insight.sentiment,
          claudeRisk:       insight.riskScore,
          claudeOpp:        insight.opportunityScore,
          finalRisk:        breakdown.finalRisk,
          finalOpp:         breakdown.finalOpportunity,
          ruleWeight:       breakdown.ruleWeight,
          claudeWeight:     breakdown.claudeWeight,
          confidence:       insight.confidence,
          costUsd:          usage.estimatedCostUsd.toFixed(6),
          latencyMs,
          hadParseError:    !!parseError,
        });

        return; // success — exit retry loop

      } catch (err: any) {
        lastError = err as ClassifiedError;

        // Non-retryable errors — fail immediately
        if (!lastError.retryable) {
          logger.error('Non-retryable Groq error', {
            signalId,
            errorType: lastError.type,
            message:   lastError.message,
          });
          throw lastError;
        }

        const delay = lastError.retryAfterMs
          ?? RETRY_DELAYS[lastError.type]
          ?? config.queueRetryBaseMs * Math.pow(2, attempt - 1);

        logger.warn('Groq API error — will retry', {
          signalId,
          attempt,
          maxAttempts: config.queueMaxAttempts,
          errorType:   lastError.type,
          retryAfterMs: delay,
        });

        if (attempt < config.queueMaxAttempts) {
          await sleep(delay);
        }
      }
    }

    // All attempts exhausted
    logger.error('Analysis failed after all attempts', {
      signalId,
      lastError: lastError?.message,
    });
    throw lastError ?? new Error('Analysis failed after all attempts');
  }

  // ── Accessors ─────────────────────────────────────────────

  get claudeStats() {
    return this.client.stats;
  }

  get rateLimiterStats() {
    return {
      currentRpm: this.limiter.currentRpm,
      currentTpm: this.limiter.currentTpm,
      maxRpm:     config.rateLimitRpm,
      maxTpm:     config.rateLimitTpm,
    };
  }

  // ── Private helpers ───────────────────────────────────────

  private pruneAnalyzedCache(): void {
    if (this.analyzedCache.size > 2_000) {
      const cutoff = Date.now() - config.signalDedupeWindowMs;
      this.analyzedCache.forEach((ts, id) => {
        if (ts < cutoff) this.analyzedCache.delete(id);
      });
    }
  }
}
