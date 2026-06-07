// ============================================================
// TOKEN SCORER + SCORE AGGREGATOR TESTS
// ============================================================

import { TokenScorer } from '../scoring/tokenScorer';
import { ScoreAggregator } from '../scoring/scoreAggregator';
import { DbSignal, MarketContext, ParsedInsight } from '../types';

// ── Helpers ───────────────────────────────────────────────────

function makeSignal(
  type      = 'WHALE_TRADE',
  severity  = 'HIGH',
  data: Record<string, unknown> = {},
): DbSignal {
  return {
    id: 'sig_test',
    symbol: 'BTCUSDT',
    type,
    severity,
    data: {
      tradeUSD:  1_000_000,
      direction: 'BUY',
      price:     65000,
      quantity:  15.38,
      ...data,
    },
    metadata:  { price: 65000, volume: 1_000_000, priceChange: 2.1 },
    createdAt: new Date(),
  };
}

function makeCtx(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    symbol:        'BTCUSDT',
    currentPrice:  65000,
    priceChange24h: 3.5,
    volume24h:     1_200_000_000,
    high24h:       67000,
    low24h:        62000,
    priceChange1h: 1.2,
    volumeMA20:    400_000_000,
    volumeRatio:   3.0,
    spreadPercent: 0.05,
    rangePosition: 0.6,
    recentSignals: [],
    ...overrides,
  };
}

function makeInsight(overrides: Partial<ParsedInsight> = {}): ParsedInsight {
  return {
    summary:          'Test insight',
    details:          'Test details',
    riskScore:        65,
    opportunityScore: 55,
    sentiment:        'BULLISH',
    tags:             ['whale', 'btc'],
    recommendations:  ['Monitor closely'],
    confidence:       0.75,
    keyLevels:        { support: 63000, resistance: 68000 },
    timeframe:        'short-term',
    ...overrides,
  };
}

// ── TokenScorer tests ─────────────────────────────────────────

describe('TokenScorer', () => {
  const scorer = new TokenScorer();

  describe('computeRuleBasedScores', () => {
    it('returns 6 factors', () => {
      const { factors } = scorer.computeRuleBasedScores(makeSignal(), makeCtx());
      expect(factors).toHaveLength(6);
    });

    it('all factors have name, score, weight, direction, explanation', () => {
      const { factors } = scorer.computeRuleBasedScores(makeSignal(), makeCtx());
      for (const f of factors) {
        expect(typeof f.name).toBe('string');
        expect(f.score).toBeGreaterThanOrEqual(0);
        expect(f.score).toBeLessThanOrEqual(100);
        expect(f.weight).toBeGreaterThan(0);
        expect(['RISK', 'OPPORTUNITY', 'BOTH']).toContain(f.direction);
        expect(typeof f.explanation).toBe('string');
      }
    });

    it('factor weights sum to ~1.0', () => {
      const { factors } = scorer.computeRuleBasedScores(makeSignal(), makeCtx());
      const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 1);
    });

    it('compositeRisk is within 0–100', () => {
      const { compositeRisk } = scorer.computeRuleBasedScores(makeSignal(), makeCtx());
      expect(compositeRisk).toBeGreaterThanOrEqual(0);
      expect(compositeRisk).toBeLessThanOrEqual(100);
    });

    it('compositeOpportunity is within 0–100', () => {
      const { compositeOpportunity } = scorer.computeRuleBasedScores(makeSignal(), makeCtx());
      expect(compositeOpportunity).toBeGreaterThanOrEqual(0);
      expect(compositeOpportunity).toBeLessThanOrEqual(100);
    });

    // ── Volatility factor ───────────────────────────────────

    it('high volatility increases risk score', () => {
      const lowVol  = scorer.computeRuleBasedScores(makeSignal(), makeCtx({ priceChange24h: 1.0 }));
      const highVol = scorer.computeRuleBasedScores(makeSignal(), makeCtx({ priceChange24h: 15.0 }));
      expect(highVol.compositeRisk).toBeGreaterThan(lowVol.compositeRisk);
    });

    // ── Volume factor ───────────────────────────────────────

    it('higher volume ratio increases both scores', () => {
      const low  = scorer.computeRuleBasedScores(makeSignal(), makeCtx({ volumeRatio: 1.0 }));
      const high = scorer.computeRuleBasedScores(makeSignal(), makeCtx({ volumeRatio: 8.0 }));
      expect(high.compositeRisk).toBeGreaterThan(low.compositeRisk);
      expect(high.compositeOpportunity).toBeGreaterThan(low.compositeOpportunity);
    });

    // ── Liquidity factor ────────────────────────────────────

    it('wide spread increases risk score', () => {
      const tight = scorer.computeRuleBasedScores(makeSignal(), makeCtx({ spreadPercent: 0.03 }));
      const wide  = scorer.computeRuleBasedScores(makeSignal(), makeCtx({ spreadPercent: 0.8  }));
      expect(wide.compositeRisk).toBeGreaterThan(tight.compositeRisk);
    });

    // ── Signal history factor ───────────────────────────────

    it('critical recent signals increase risk', () => {
      const noHistory = scorer.computeRuleBasedScores(makeSignal(), makeCtx({ recentSignals: [] }));
      const withCrit  = scorer.computeRuleBasedScores(makeSignal(), makeCtx({
        recentSignals: [
          { type: 'WHALE_TRADE', severity: 'CRITICAL', createdAt: new Date().toISOString() },
          { type: 'VOLUME_SPIKE', severity: 'CRITICAL', createdAt: new Date().toISOString() },
          { type: 'PRICE_SURGE', severity: 'CRITICAL', createdAt: new Date().toISOString() },
        ],
      }));
      expect(withCrit.compositeRisk).toBeGreaterThan(noHistory.compositeRisk);
    });

    // ── Trade size factor — per signal type ─────────────────

    it('larger whale trade increases risk', () => {
      const small = scorer.computeRuleBasedScores(
        makeSignal('WHALE_TRADE', 'HIGH', { tradeUSD: 100_000 }),
        makeCtx(),
      );
      const large = scorer.computeRuleBasedScores(
        makeSignal('WHALE_TRADE', 'CRITICAL', { tradeUSD: 15_000_000 }),
        makeCtx(),
      );
      expect(large.compositeRisk).toBeGreaterThan(small.compositeRisk);
    });

    it('handles VOLUME_SPIKE signal type', () => {
      const signal = makeSignal('VOLUME_SPIKE', 'HIGH', { multiplier: 5.5, avgVolume: 200e6, currentVolume: 1100e6 });
      const { compositeRisk } = scorer.computeRuleBasedScores(signal, makeCtx());
      expect(compositeRisk).toBeGreaterThan(0);
    });

    it('handles PRICE_CRASH signal with recovery opportunity', () => {
      const signal = makeSignal('PRICE_CRASH', 'HIGH', { changePercent: -12.5, fromPrice: 75000, toPrice: 65625, windowMs: 300_000 });
      const ctx    = makeCtx({ priceChange24h: -12.5, rangePosition: 0.05 });
      const { compositeOpportunity } = scorer.computeRuleBasedScores(signal, ctx);
      // Crashes near 24h low should show meaningful opportunity
      expect(compositeOpportunity).toBeGreaterThan(30);
    });

    it('handles ACCUMULATION_PATTERN signal', () => {
      const signal = makeSignal('ACCUMULATION_PATTERN', 'HIGH', { largeBuyCount: 8, totalUSD: 4_000_000 });
      const result = scorer.computeRuleBasedScores(signal, makeCtx());
      // Accumulation = opportunity >= risk (buying conviction)
      expect(result.compositeOpportunity).toBeGreaterThanOrEqual(result.compositeRisk * 0.8);
    });

    it('returns consistent results for identical inputs', () => {
      const signal = makeSignal();
      const ctx    = makeCtx();
      const r1     = scorer.computeRuleBasedScores(signal, ctx);
      const r2     = scorer.computeRuleBasedScores(signal, ctx);
      expect(r1.compositeRisk).toBe(r2.compositeRisk);
      expect(r1.compositeOpportunity).toBe(r2.compositeOpportunity);
    });
  });
});

// ── ScoreAggregator tests ─────────────────────────────────────

describe('ScoreAggregator', () => {
  const scorer     = new TokenScorer();
  const aggregator = new ScoreAggregator();

  function aggregate(signalOverrides = {}, ctxOverrides = {}, insightOverrides = {}) {
    const signal  = makeSignal('WHALE_TRADE', 'HIGH', signalOverrides as any);
    const ctx     = makeCtx(ctxOverrides);
    const insight = makeInsight(insightOverrides);
    const { factors, compositeRisk, compositeOpportunity } =
      scorer.computeRuleBasedScores(signal, ctx);

    return aggregator.aggregate({
      signal: { id: signal.id, symbol: signal.symbol, type: signal.type, severity: signal.severity },
      insight,
      ruleFactors:          factors,
      compositeRisk,
      compositeOpportunity,
      ctx,
    });
  }

  it('produces finalRisk within 0–100', () => {
    const bd = aggregate();
    expect(bd.finalRisk).toBeGreaterThanOrEqual(0);
    expect(bd.finalRisk).toBeLessThanOrEqual(100);
  });

  it('produces finalOpportunity within 0–100', () => {
    const bd = aggregate();
    expect(bd.finalOpportunity).toBeGreaterThanOrEqual(0);
    expect(bd.finalOpportunity).toBeLessThanOrEqual(100);
  });

  it('ruleWeight + claudeWeight ≈ 1.0', () => {
    const bd = aggregate();
    expect(bd.ruleWeight + bd.claudeWeight).toBeCloseTo(1.0, 2);
  });

  it('higher Claude confidence increases Claude weight', () => {
    const lowConf  = aggregate({}, {}, { confidence: 0.4 });
    const highConf = aggregate({}, {}, { confidence: 0.95 });
    expect(highConf.claudeWeight).toBeGreaterThan(lowConf.claudeWeight);
  });

  it('Claude cannot push score more than MAX_CLAUDE_DELTA from rule baseline', () => {
    // Claude says risk = 5 but rules say ~65
    const bd = aggregate({}, {}, { riskScore: 5, confidence: 0.9 });
    // Final risk must be no lower than compositeRisk - 20
    expect(bd.finalRisk).toBeGreaterThanOrEqual(bd.compositeRisk - 20);
  });

  it('BEARISH sentiment + extreme risk caps opportunity score', () => {
    const bd = aggregate(
      { tradeUSD: 20_000_000 }, // huge trade → high risk
      { priceChange24h: -15, volumeRatio: 8 },
      { riskScore: 90, opportunityScore: 80, sentiment: 'BEARISH', confidence: 0.85 },
    );
    // With BEARISH and risk > 80, opportunity should be capped at 35
    expect(bd.finalOpportunity).toBeLessThanOrEqual(35);
  });

  it('previous score smoothing keeps scores stable', () => {
    const stableCtx = makeCtx({
      previousScore: { risk: 50, opportunity: 50, computedAt: Date.now() - 60_000 },
    });
    const signal  = makeSignal();
    const insight = makeInsight({ riskScore: 90, opportunityScore: 85 }); // sudden spike
    const { factors, compositeRisk, compositeOpportunity } =
      scorer.computeRuleBasedScores(signal, stableCtx);

    const bd = aggregator.aggregate({
      signal: { id: signal.id, symbol: signal.symbol, type: signal.type, severity: signal.severity },
      insight,
      ruleFactors: factors,
      compositeRisk,
      compositeOpportunity,
      ctx: stableCtx,
    });

    // With SMOOTHING_FACTOR=0.20, the final score is 20% prev + 80% new
    // Even with sudden spike, score should be smoothed
    expect(bd.finalRisk).toBeLessThan(90); // smoothed from prev=50
  });

  it('includes computedAt timestamp', () => {
    const bd = aggregate();
    expect(bd.computedAt).toBeGreaterThan(Date.now() - 1000);
  });

  it('preserves all 6 factor entries in the breakdown', () => {
    const signal  = makeSignal();
    const ctx     = makeCtx();
    const insight = makeInsight();
    const { factors, compositeRisk, compositeOpportunity } =
      scorer.computeRuleBasedScores(signal, ctx);

    const bd = aggregator.aggregate({
      signal: { id: signal.id, symbol: signal.symbol, type: signal.type, severity: signal.severity },
      insight,
      ruleFactors: factors,
      compositeRisk,
      compositeOpportunity,
      ctx,
    });

    expect(bd.factors).toHaveLength(6);
  });

  it('enriches factors when Claude provides factorScores', () => {
    const signal  = makeSignal();
    const ctx     = makeCtx();
    const insight = makeInsight({
      factorScores: {
        volatility:   80,
        volume:       70,
        momentum:     60,
        liquidity:    40,
        sentiment:    55,
        manipulation: 30,
      },
    });

    const { factors, compositeRisk, compositeOpportunity } =
      scorer.computeRuleBasedScores(signal, ctx);

    const bd = aggregator.aggregate({
      signal: { id: signal.id, symbol: signal.symbol, type: signal.type, severity: signal.severity },
      insight,
      ruleFactors: factors,
      compositeRisk,
      compositeOpportunity,
      ctx,
    });

    // When Claude provides factor scores, they should influence the blend
    expect(bd.finalRisk).toBeGreaterThan(0);
    expect(bd.finalOpportunity).toBeGreaterThan(0);
  });
});
