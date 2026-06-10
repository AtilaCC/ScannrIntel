// ============================================================
// GROQ API CLIENT (migrated from Anthropic Claude)
// Thin wrapper around the Groq Chat Completions API.
// Responsibilities:
//   - Request/response serialization
//   - HTTP error → typed ClaudeError classification
//   - Token usage tracking
//   - Request timeout enforcement
//   - Retry-After header parsing
// ============================================================

import {
  ClaudeRequest,
  ClaudeResponse,
  ClaudeErrorType,
  ClassifiedError,
  TokenUsage,
} from '../types';
import { config, TOKEN_COST } from '../config';
import { createLogger } from '../utils/shared';

const logger = createLogger('groq-client');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;

// ── Error classifier ─────────────────────────────────────────

function classifyError(status: number, body: string): ClassifiedError {
  let parsed: any = {};
  try { parsed = JSON.parse(body); } catch { /* raw body */ }

  const message = parsed?.error?.message ?? body ?? `HTTP ${status}`;

  if (status === 429) {
    // Parse Retry-After if present (Anthropic includes it)
    const retryMatch = body.match(/"retry_after":\s*(\d+)/);
    const retryAfterMs = retryMatch ? parseInt(retryMatch[1], 10) * 1000 : 60_000;
    return { type: 'RATE_LIMIT', retryable: true, retryAfterMs, message, statusCode: status };
  }
  if (status === 529) {
    return { type: 'OVERLOADED', retryable: true, retryAfterMs: 10_000, message, statusCode: status };
  }
  if (status === 400) {
    return { type: 'INVALID_REQUEST', retryable: false, message, statusCode: status };
  }
  if (status === 401) {
    return { type: 'AUTH_ERROR', retryable: false, message, statusCode: status };
  }
  if (status === 404) {
    return { type: 'NOT_FOUND', retryable: false, message, statusCode: status };
  }
  if (status >= 500) {
    return { type: 'SERVER_ERROR', retryable: true, retryAfterMs: 5_000, message, statusCode: status };
  }
  return { type: 'SERVER_ERROR', retryable: false, message, statusCode: status };
}

function computeCost(usage: { input_tokens: number; output_tokens: number }): number {
  return (
    usage.input_tokens  * TOKEN_COST.input +
    usage.output_tokens * TOKEN_COST.output
  );
}

// ── Client ────────────────────────────────────────────────────

export class ClaudeClient {
  private requestCount: number = 0;
  private errorCount:   number = 0;
  private totalLatency: number = 0;
  private totalCostUsd: number = 0;
  private rateLimitHits:number = 0;

  constructor(private readonly apiKey: string) {}

  // ── Core request ─────────────────────────────────────────

  async request(req: ClaudeRequest): Promise<{
    response: ClaudeResponse;
    usage:    TokenUsage;
    latencyMs:number;
  }> {
    const startedAt  = Date.now();
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let rawBody = '';
    let status  = 0;

    // Convert Anthropic-style messages to OpenAI-style for Groq
    const messages: any[] = [];
    if (req.system) {
      messages.push({ role: 'system', content: req.system });
    }
    for (const msg of req.messages) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      } else {
        // Extract text from content blocks
        const text = msg.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
        messages.push({ role: msg.role, content: text });
      }
    }

    const groqBody = {
      model: config.claudeModel,
      max_tokens: req.max_tokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      messages,
    };

    try {
      const res = await fetch(GROQ_URL, {
        method:  'POST',
        signal:  controller.signal,
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(groqBody),
      });

      status  = res.status;
      rawBody = await res.text();

      if (!res.ok) {
        this.errorCount++;
        const err = classifyError(status, rawBody);
        if (err.type === 'RATE_LIMIT') this.rateLimitHits++;
        throw err;
      }

      const groqData = JSON.parse(rawBody);
      const latencyMs = Date.now() - startedAt;

      // Normalize Groq response to ClaudeResponse shape
      const data: ClaudeResponse = {
        id: groqData.id,
        type: 'message',
        role: 'assistant',
        model: groqData.model,
        content: [{ type: 'text', text: groqData.choices?.[0]?.message?.content ?? '' }],
        stop_reason: groqData.choices?.[0]?.finish_reason ?? 'end_turn',
        usage: {
          input_tokens:  groqData.usage?.prompt_tokens ?? 0,
          output_tokens: groqData.usage?.completion_tokens ?? 0,
        },
      };

      const cost = computeCost(data.usage);

      this.requestCount++;
      this.totalLatency += latencyMs;
      this.totalCostUsd += cost;

      const usage: TokenUsage = {
        inputTokens:      data.usage.input_tokens,
        outputTokens:     data.usage.output_tokens,
        totalTokens:      data.usage.input_tokens + data.usage.output_tokens,
        estimatedCostUsd: cost,
      };

      logger.info('Groq request completed', {
        model:      data.model,
        stopReason: data.stop_reason,
        inputTokens:  usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
      });

      return { response: data, usage, latencyMs };

    } catch (err: any) {
      // AbortError = timeout
      if (err?.name === 'AbortError') {
        this.errorCount++;
        throw {
          type: 'TIMEOUT' as ClaudeErrorType,
          retryable: true,
          retryAfterMs: 2_000,
          message: `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        } satisfies ClassifiedError;
      }

      // Network error (fetch itself failed)
      if (err?.type === undefined) {
        this.errorCount++;
        throw {
          type: 'NETWORK_ERROR' as ClaudeErrorType,
          retryable: true,
          retryAfterMs: 2_000,
          message: err?.message ?? 'Network error',
        } satisfies ClassifiedError;
      }

      // Re-throw classified errors as-is
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Stats ─────────────────────────────────────────────────

  get stats() {
    return {
      requestsTotal:    this.requestCount,
      requestsFailed:   this.errorCount,
      rateLimitHits:    this.rateLimitHits,
      avgLatencyMs:     this.requestCount > 0
        ? Math.round(this.totalLatency / this.requestCount) : 0,
      estimatedCostUsd: parseFloat(this.totalCostUsd.toFixed(4)),
      errorRate:        this.requestCount + this.errorCount > 0
        ? parseFloat((this.errorCount / (this.requestCount + this.errorCount)).toFixed(3)) : 0,
    };
  }
}
