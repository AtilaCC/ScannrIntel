// ============================================================
// SIGNAL PROMPTS TESTS
// Verifies each signal type produces a prompt containing the
// expected data fields and contextual information.
// ============================================================

import { buildUserPrompt, estimatePromptTokens } from '../prompts/signalPrompts';
import { DbSignal, MarketContext } from '../types';

// ── Helpers ───────────────────────────────────────────────────

function makeSignal(type: string, severity = 'HIGH', data: Record<string, unknown> = {}): DbSignal {
  return {
    id:        `sig_${type}`,
    symbol:    'SOLUSDT',
    type,
    severity,
    data:      { ...data },
    metadata:  { price: 155.5, volume: 420_000_000, priceChange: 6.8, tradeSize: 500_000 },
    createdAt: new Date('2024-03-15T14:30:00Z'),
  };
}

function makeCtx(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    symbol:            'SOLUSDT',
    currentPrice:      155.5,
    priceChange24h:    6.8,
    volume24h:         420_000_000,
    high24h:           162.0,
    low24h:            144.2,
    priceChange1h:     2.1,
    volumeMA20:        140_000_000,
    volumeRatio:       3.0,
    recentSignals:     [
      { type: 'VOLUME_SPIKE', severity: 'MEDIUM', createdAt: '2024-03-15T14:00:00Z' },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('buildUserPrompt', () => {
  describe('WHALE_TRADE', () => {
    const signal = makeSignal('WHALE_TRADE', 'HIGH', {
      tradeUSD:     2_500_000,
      direction:    'BUY',
      price:        155.5,
      quantity:     16_077,
      isBuyerMaker: false,
    });
    const ctx = makeCtx();

    it('contains signal type header', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('WHALE_TRADE');
      expect(prompt).toContain('HIGH');
    });

    it('includes trade USD amount', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('2,500,000');
    });

    it('includes direction', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('BUY');
    });

    it('classifies as INSTITUTIONAL for >$1M trades', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('INSTITUTIONAL');
    });

    it('includes current price and volume', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('155.5');
      expect(prompt).toContain('420.00M');
    });

    it('includes recent signals context', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('VOLUME_SPIKE');
    });

    it('includes analysis questions', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toMatch(/accumulation|distribution/i);
    });
  });

  describe('VOLUME_SPIKE', () => {
    const signal = makeSignal('VOLUME_SPIKE', 'MEDIUM', {
      multiplier:     4.2,
      avgVolume:      140_000_000,
      currentVolume:  588_000_000,
    });
    const ctx = makeCtx();

    it('includes multiplier', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('4.20x');
    });

    it('includes average and current volume', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('588.00M');
      expect(prompt).toContain('140.00M');
    });

    it('classifies as VERY HIGH for 4.2x', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('VERY HIGH');
    });
  });

  describe('PRICE_SURGE', () => {
    const signal = makeSignal('PRICE_SURGE', 'HIGH', {
      changePercent: 8.7,
      fromPrice:     143.0,
      toPrice:       155.5,
      windowMs:      300_000,
    });
    const ctx = makeCtx();

    it('includes surge percentage', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('8.70%');
    });

    it('includes from and to prices', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('143');
      expect(prompt).toContain('155.5');
    });

    it('includes time window in minutes', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('5 minutes');
    });

    it('includes price velocity', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('/min');
    });
  });

  describe('PRICE_CRASH', () => {
    const signal = makeSignal('PRICE_CRASH', 'CRITICAL', {
      changePercent: -12.3,
      fromPrice:     177.5,
      toPrice:       155.5,
      windowMs:      300_000,
    });
    const ctx = makeCtx({ priceChange24h: -12.3 });

    it('includes crash percentage', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('-12.30%');
    });

    it('includes support level question', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toMatch(/support/i);
    });
  });

  describe('ACCUMULATION_PATTERN', () => {
    const signal = makeSignal('ACCUMULATION_PATTERN', 'HIGH', {
      largeBuyCount: 8,
      totalUSD:      3_200_000,
    });
    const ctx = makeCtx();

    it('includes buy count', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('8');
    });

    it('includes total accumulated USD', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('3.20M');
    });

    it('includes average order size', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('400K');
    });
  });

  describe('DUMP_PATTERN', () => {
    const signal = makeSignal('DUMP_PATTERN', 'HIGH', {
      largeSellCount: 6,
      totalUSD:       2_100_000,
    });
    const ctx = makeCtx({ priceChange24h: -5.2 });

    it('includes sell count', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('6');
    });

    it('includes sell pressure question', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toMatch(/profit.taking|panic/i);
    });
  });

  describe('LIQUIDITY_ANOMALY', () => {
    const signal = makeSignal('LIQUIDITY_ANOMALY', 'MEDIUM', {
      spreadPercent: 0.75,
      bidPrice:      155.2,
      askPrice:      156.4,
      bidQty:        1_200,
      askQty:        800,
    });
    const ctx = makeCtx();

    it('includes spread percentage', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('0.750%');
    });

    it('includes bid and ask prices', () => {
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('155.2');
      expect(prompt).toContain('156.4');
    });
  });

  describe('unknown signal type', () => {
    it('falls back to generic prompt with raw data', () => {
      const signal = makeSignal('CUSTOM_SIGNAL', 'LOW', { custom: 'data' });
      const ctx    = makeCtx();
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('CUSTOM_SIGNAL');
      expect(prompt).toContain('custom');
    });
  });

  describe('context enrichment', () => {
    it('includes volume ratio when available', () => {
      const signal = makeSignal('WHALE_TRADE', 'HIGH', { tradeUSD: 200_000 });
      const ctx    = makeCtx({ volumeRatio: 4.2, volumeMA20: 140_000_000 });
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('4.20x');
    });

    it('includes 1h price change when available', () => {
      const signal = makeSignal('WHALE_TRADE', 'HIGH', { tradeUSD: 200_000 });
      const ctx    = makeCtx({ priceChange1h: 2.1 });
      const prompt = buildUserPrompt(signal, ctx);
      expect(prompt).toContain('+2.10%');
    });

    it('omits missing optional fields gracefully', () => {
      const signal = makeSignal('WHALE_TRADE', 'HIGH', { tradeUSD: 200_000 });
      const ctx    = makeCtx({ priceChange1h: undefined, volumeRatio: undefined, recentSignals: [] });
      // Should not throw
      expect(() => buildUserPrompt(signal, ctx)).not.toThrow();
    });
  });
});

describe('estimatePromptTokens', () => {
  it('returns a positive number for any signal', () => {
    const signal = makeSignal('WHALE_TRADE');
    expect(estimatePromptTokens(signal)).toBeGreaterThan(0);
  });

  it('returns consistent estimates', () => {
    const signal = makeSignal('VOLUME_SPIKE');
    const est1   = estimatePromptTokens(signal);
    const est2   = estimatePromptTokens(signal);
    expect(est1).toBe(est2);
  });
});
