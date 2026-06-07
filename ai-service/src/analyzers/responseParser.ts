// ============================================================
// RESPONSE PARSER
// Extracts and validates the structured JSON from Claude's
// response. Handles edge cases: markdown fences, extra text,
// partial JSON, schema mismatches.
// ============================================================

import { ParsedInsight, ClassifiedError } from '../types';
import { createLogger } from '../../../../shared/src/utils';
import { DbSignal } from '../types';

const logger = createLogger('response-parser');

// ── Validators ────────────────────────────────────────────────

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? fallback : Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}

function validSentiment(v: unknown): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (v === 'BULLISH' || v === 'BEARISH' || v === 'NEUTRAL') return v;
  return 'NEUTRAL';
}

function validTimeframe(v: unknown): string {
  const valid = ['immediate', 'short-term', 'medium-term'];
  return typeof v === 'string' && valid.includes(v) ? v : 'short-term';
}

function validStringArray(v: unknown, maxLen = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === 'string' && x.trim().length > 0)
    .slice(0, maxLen)
    .map((x) => x.trim());
}

// ── Extraction ────────────────────────────────────────────────

function extractJSON(text: string): string | null {
  // 1. Try to strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) return fenceMatch[1];

  // 2. Find first { and last } — handles trailing text
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return null;
}

// ── Main parser ───────────────────────────────────────────────

export function parseClaudeResponse(
  rawText:  string,
  signal:   DbSignal,
): { insight: ParsedInsight; parseError: string | null } {
  let parseError: string | null = null;

  const jsonStr = extractJSON(rawText);

  if (jsonStr) {
    try {
      const obj = JSON.parse(jsonStr);

      // Validate required fields exist
      if (typeof obj.summary !== 'string' || typeof obj.details !== 'string') {
        throw new Error('Missing required fields: summary or details');
      }

      // Parse per-factor scores if Claude provided them
      let factorScores: ParsedInsight['factorScores'] | undefined;
      if (obj.factorScores && typeof obj.factorScores === 'object') {
        const fs = obj.factorScores;
        factorScores = {
          volatility:   typeof fs.volatility   === 'number' ? clampInt(fs.volatility,   0, 100, 50) : undefined,
          volume:       typeof fs.volume       === 'number' ? clampInt(fs.volume,       0, 100, 50) : undefined,
          momentum:     typeof fs.momentum     === 'number' ? clampInt(fs.momentum,     0, 100, 50) : undefined,
          liquidity:    typeof fs.liquidity    === 'number' ? clampInt(fs.liquidity,    0, 100, 50) : undefined,
          sentiment:    typeof fs.sentiment    === 'number' ? clampInt(fs.sentiment,    0, 100, 50) : undefined,
          manipulation: typeof fs.manipulation === 'number' ? clampInt(fs.manipulation, 0, 100, 50) : undefined,
        };
      }

      const insight: ParsedInsight = {
        summary:          obj.summary.trim().slice(0, 200),
        details:          obj.details.trim(),
        riskScore:        clampInt(obj.riskScore,        0, 100, 50),
        opportunityScore: clampInt(obj.opportunityScore, 0, 100, 50),
        sentiment:        validSentiment(obj.sentiment),
        tags:             validStringArray(obj.tags,            6),
        recommendations:  validStringArray(obj.recommendations, 4),
        confidence:       clampFloat(obj.confidence, 0, 1, 0.6),
        keyLevels: {
          support:    typeof obj.keyLevels?.support    === 'number' ? obj.keyLevels.support    : null,
          resistance: typeof obj.keyLevels?.resistance === 'number' ? obj.keyLevels.resistance : null,
        },
        timeframe:    validTimeframe(obj.timeframe),
        factorScores,
      };

      return { insight, parseError: null };

    } catch (err) {
      parseError = `JSON parse/validate failed: ${(err as Error).message}`;
      logger.warn('Claude response parse failed', {
        signal: signal.id,
        error: parseError,
        rawSnippet: rawText.slice(0, 200),
      });
    }
  } else {
    parseError = 'No JSON object found in response';
    logger.warn('Claude returned no JSON', {
      signal: signal.id,
      rawSnippet: rawText.slice(0, 200),
    });
  }

  // ── Fallback: derive insight from raw text ────────────────
  const lower        = rawText.toLowerCase();
  const isBullish    = /bullish|accumul|breakout|buying pressure|upward/i.test(lower);
  const isBearish    = /bearish|distribut|dump|selling pressure|downward|crash/i.test(lower);
  const severity     = signal.severity;

  const fallback: ParsedInsight = {
    summary:          `${formatType(signal.type)} detected on ${signal.symbol.replace('USDT', '')}`,
    details:          rawText.trim().slice(0, 1000) || 'Analysis data unavailable.',
    riskScore:        severity === 'CRITICAL' ? 85 : severity === 'HIGH' ? 70 : severity === 'MEDIUM' ? 50 : 30,
    opportunityScore: isBullish ? 65 : isBearish ? 25 : 45,
    sentiment:        isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : 'NEUTRAL',
    tags:             [signal.type.toLowerCase().replace(/_/g, '-'), signal.symbol, severity.toLowerCase()],
    recommendations:  ['Monitor price action closely', 'Apply appropriate position sizing'],
    confidence:       0.45,  // low confidence for fallback
    keyLevels:        { support: null, resistance: null },
    timeframe:        'short-term',
  };

  return { insight: fallback, parseError };
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
