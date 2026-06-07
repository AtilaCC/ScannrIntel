// ============================================================
// RESPONSE PARSER TESTS
// ============================================================

import { parseClaudeResponse } from '../analyzers/responseParser';
import { DbSignal } from '../types';

// ── Helpers ───────────────────────────────────────────────────

function makeSignal(overrides: Partial<DbSignal> = {}): DbSignal {
  return {
    id:        'sig_001',
    symbol:    'BTCUSDT',
    type:      'WHALE_TRADE',
    severity:  'HIGH',
    data:      { tradeUSD: 500_000, direction: 'BUY', price: 65000, quantity: 7.69 },
    metadata:  { price: 65000, volume: 500_000, priceChange: 1.2 },
    createdAt: new Date(),
    ...overrides,
  };
}

const VALID_JSON = {
  summary:          'Large institutional buy detected on BTC.',
  details:          'A $500K buy order was executed. Volume is 3.2x the 20-period average.',
  riskScore:        68,
  opportunityScore: 55,
  sentiment:        'BULLISH',
  tags:             ['whale', 'accumulation', 'btc'],
  recommendations:  ['Monitor for follow-through volume', 'Watch $64,800 support'],
  confidence:       0.82,
  keyLevels:        { support: 64800, resistance: 66500 },
  timeframe:        'short-term',
};

// ── Tests ─────────────────────────────────────────────────────

describe('parseClaudeResponse', () => {
  const signal = makeSignal();

  // ── Valid JSON ────────────────────────────────────────────

  describe('valid JSON response', () => {
    it('parses a clean JSON object', () => {
      const raw = JSON.stringify(VALID_JSON);
      const { insight, parseError } = parseClaudeResponse(raw, signal);

      expect(parseError).toBeNull();
      expect(insight.summary).toBe(VALID_JSON.summary);
      expect(insight.riskScore).toBe(68);
      expect(insight.opportunityScore).toBe(55);
      expect(insight.sentiment).toBe('BULLISH');
      expect(insight.tags).toEqual(['whale', 'accumulation', 'btc']);
      expect(insight.confidence).toBe(0.82);
      expect(insight.keyLevels?.support).toBe(64800);
    });

    it('strips markdown code fences', () => {
      const raw = '```json\n' + JSON.stringify(VALID_JSON) + '\n```';
      const { insight, parseError } = parseClaudeResponse(raw, signal);

      expect(parseError).toBeNull();
      expect(insight.riskScore).toBe(68);
    });

    it('extracts JSON surrounded by extra text', () => {
      const raw = 'Here is my analysis:\n' + JSON.stringify(VALID_JSON) + '\nEnd.';
      const { insight, parseError } = parseClaudeResponse(raw, signal);

      expect(parseError).toBeNull();
      expect(insight.summary).toBe(VALID_JSON.summary);
    });

    it('clamps riskScore to 0–100', () => {
      const raw = JSON.stringify({ ...VALID_JSON, riskScore: 150 });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.riskScore).toBe(100);
    });

    it('clamps opportunityScore to 0–100', () => {
      const raw = JSON.stringify({ ...VALID_JSON, opportunityScore: -10 });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.opportunityScore).toBe(0);
    });

    it('clamps confidence to 0–1', () => {
      const raw = JSON.stringify({ ...VALID_JSON, confidence: 1.5 });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.confidence).toBe(1);
    });

    it('normalises invalid sentiment to NEUTRAL', () => {
      const raw = JSON.stringify({ ...VALID_JSON, sentiment: 'VERY_BULLISH' });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.sentiment).toBe('NEUTRAL');
    });

    it('normalises invalid timeframe to short-term', () => {
      const raw = JSON.stringify({ ...VALID_JSON, timeframe: 'next_week' });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.timeframe).toBe('short-term');
    });

    it('caps tags array at 6 items', () => {
      const raw = JSON.stringify({ ...VALID_JSON, tags: ['a','b','c','d','e','f','g','h'] });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.tags.length).toBe(6);
    });

    it('truncates summary to 200 chars', () => {
      const longSummary = 'X'.repeat(300);
      const raw = JSON.stringify({ ...VALID_JSON, summary: longSummary });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.summary.length).toBe(200);
    });

    it('handles null keyLevels gracefully', () => {
      const raw = JSON.stringify({ ...VALID_JSON, keyLevels: null });
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.keyLevels?.support).toBeNull();
      expect(insight.keyLevels?.resistance).toBeNull();
    });

    it('handles missing keyLevels field', () => {
      const { keyLevels, ...rest } = VALID_JSON;
      const raw = JSON.stringify(rest);
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.keyLevels).toBeDefined();
    });
  });

  // ── Fallback behaviour ────────────────────────────────────

  describe('fallback on invalid response', () => {
    it('returns fallback with parseError on pure plain text', () => {
      const raw = 'I cannot analyze this signal because it lacks context.';
      const { insight, parseError } = parseClaudeResponse(raw, signal);

      expect(parseError).not.toBeNull();
      expect(insight.summary).toContain('BTCUSDT');
      expect(insight.confidence).toBeLessThan(0.6);
    });

    it('returns fallback on malformed JSON', () => {
      const raw = '{ summary: "missing quotes", riskScore: 50 }'; // invalid JSON
      const { insight, parseError } = parseClaudeResponse(raw, signal);

      expect(parseError).not.toBeNull();
      expect(insight.symbol).toBeUndefined(); // fallback doesn't set symbol
    });

    it('returns fallback when required fields are missing', () => {
      const raw = JSON.stringify({ riskScore: 50 }); // no summary or details
      const { insight, parseError } = parseClaudeResponse(raw, signal);

      expect(parseError).not.toBeNull();
      expect(insight.riskScore).toBeGreaterThan(0);
    });

    it('infers BULLISH sentiment from text keywords in fallback', () => {
      const raw = 'This looks like a clear bullish accumulation pattern.';
      const { insight } = parseClaudeResponse(raw, signal);
      expect(insight.sentiment).toBe('BULLISH');
    });

    it('infers BEARISH sentiment from text keywords in fallback', () => {
      const bearishSignal = makeSignal({ type: 'PRICE_CRASH', severity: 'HIGH' });
      const raw = 'This is a bearish dump pattern. Selling pressure is extreme.';
      const { insight } = parseClaudeResponse(raw, bearishSignal);
      expect(insight.sentiment).toBe('BEARISH');
    });

    it('applies CRITICAL severity to fallback riskScore', () => {
      const critSignal = makeSignal({ severity: 'CRITICAL' });
      const raw = 'No JSON here.';
      const { insight } = parseClaudeResponse(raw, critSignal);
      expect(insight.riskScore).toBe(85);
    });

    it('applies LOW severity to lower fallback riskScore', () => {
      const lowSignal = makeSignal({ severity: 'LOW' });
      const raw = 'No JSON here.';
      const { insight } = parseClaudeResponse(raw, lowSignal);
      expect(insight.riskScore).toBe(30);
    });
  });

  // ── Edge cases ────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles completely empty string', () => {
      const { insight, parseError } = parseClaudeResponse('', signal);
      expect(parseError).not.toBeNull();
      expect(insight).toBeDefined();
    });

    it('handles whitespace-only string', () => {
      const { insight, parseError } = parseClaudeResponse('   \n\t  ', signal);
      expect(parseError).not.toBeNull();
      expect(insight).toBeDefined();
    });

    it('handles double-encoded JSON', () => {
      const encoded = JSON.stringify(JSON.stringify(VALID_JSON));
      // parseClaudeResponse should extract the outer JSON string
      const { insight } = parseClaudeResponse(encoded, signal);
      expect(insight).toBeDefined();
    });
  });
});
