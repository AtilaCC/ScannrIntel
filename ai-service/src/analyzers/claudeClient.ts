// ============================================================
// AI CLIENT — Groq API (Llama 3.3 70B)
// ============================================================

import { ClaudeRequest, ClaudeResponse, ClassifiedError, TokenUsage } from '../types';
import { createLogger } from '../utils/shared';

const logger = createLogger('groq-client');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;

function classifyError(status: number, body: string): ClassifiedError {
  let parsed: any = {};
  try { parsed = JSON.parse(body); } catch {}
  const message = parsed?.error?.message ?? `HTTP ${status}`;
  if (status === 429) return { type: 'RATE_LIMIT', retryable: true, retryAfterMs: 10_000, message, statusCode: status };
  if (status === 400) return { type: 'INVALID_REQUEST', retryable: false, message, statusCode: status };
  if (status === 401) return { type: 'AUTH_ERROR', retryable: false, message, statusCode: status };
  return { type: 'SERVER_ERROR', retryable: true, retryAfterMs: 5_000, message, statusCode: status };
}

export class ClaudeClient {
  private requestCount = 0;
  private errorCount = 0;
  private totalLatency = 0;

  constructor(private readonly apiKey: string) {}

  async complete(req: { system?: string; userMessage: string; maxTokens?: number; temperature?: number }): Promise<{ content: string; usage: TokenUsage; model: string; stopReason: string }> {
    const t0 = Date.now();
    this.requestCount++;

    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: req.maxTokens || 1024,
      temperature: req.temperature || 0.2,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.userMessage },
      ],
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body,
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        const err = classifyError(res.status, text);
        this.errorCount++;
        throw Object.assign(new Error(err.message), { classified: err });
      }

      const data = JSON.parse(text);
      this.totalLatency += Date.now() - t0;

      const usage: TokenUsage = {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        estimatedCostUsd: 0,
      };

      logger.info('Groq request completed', { latency: Date.now() - t0, tokens: usage.totalTokens });

      return {
        content: data.choices[0]?.message?.content || '',
        usage,
        model: 'llama-3.3-70b-versatile',
        stopReason: data.choices[0]?.finish_reason || 'stop',
      } as any;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Compatibility method for claudeAnalyzer (maps old Anthropic interface to Groq)
  async request(req: any): Promise<{ response: any; usage: any; latencyMs: number }> {
    const t0 = Date.now();
    // Extract user message from messages array
    const userMsg = req.messages?.find((m: any) => m.role === 'user')?.content ?? '';
    const systemMsg = req.system ?? '';

    const result = await this.complete({
      system:     systemMsg,
      userMessage: typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg),
      maxTokens:  req.max_tokens ?? 1024,
      temperature: req.temperature ?? 0.2,
    });

    return {
      response: {
        content: [{ type: 'text', text: result.content }],
        usage:   { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
        model:   result.model,
        stop_reason: result.stopReason,
      },
      usage: result.usage,
      latencyMs: Date.now() - t0,
    };
  }

  get stats() {
    return this.getStats();
  }

  getStats() {
    return { requestCount: this.requestCount, errorCount: this.errorCount, avgLatencyMs: this.requestCount > 0 ? Math.round(this.totalLatency / this.requestCount) : 0, totalCostUsd: 0, rateLimitHits: 0 };
  }
}
