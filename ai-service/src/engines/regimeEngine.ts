// ============================================================
// REGIME DETECTION ENGINE
// Detects current market regime
// ============================================================

export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'RISK_ON' | 'RISK_OFF' | 'ACCUMULATION' | 'DISTRIBUTION';

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;
  description: string;
  tradingImplication: string;
}

export function detectRegime(prices: number[], volumes: number[]): RegimeResult {
  const len = prices.length;
  const current = prices[len - 1];
  const price30dAgo = prices[Math.max(0, len - 30 * 24)];
  const price7dAgo = prices[Math.max(0, len - 7 * 24)];

  const change30d = ((current - price30dAgo) / price30dAgo) * 100;
  const change7d = ((current - price7dAgo) / price7dAgo) * 100;

  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeTrend = recentVolume / avgVolume;

  let regime: MarketRegime;
  let confidence = 70;
  let description = '';
  let tradingImplication = '';

  if (change30d > 20) {
    regime = 'BULL';
    confidence = 85;
    description = 'Strong uptrend over 30 days';
    tradingImplication = 'Favor long positions, buy dips';
  } else if (change30d < -20) {
    regime = 'BEAR';
    confidence = 85;
    description = 'Strong downtrend over 30 days';
    tradingImplication = 'Favor short positions or cash, sell rallies';
  } else if (Math.abs(change30d) < 5) {
    if (volumeTrend > 1.3 && change7d > 0) {
      regime = 'ACCUMULATION';
      confidence = 75;
      description = 'Sideways with increasing volume — possible accumulation';
      tradingImplication = 'Watch for breakout, small long bias';
    } else if (volumeTrend > 1.3 && change7d < 0) {
      regime = 'DISTRIBUTION';
      confidence = 75;
      description = 'Sideways with increasing volume — possible distribution';
      tradingImplication = 'Watch for breakdown, reduce exposure';
    } else {
      regime = 'SIDEWAYS';
      confidence = 70;
      description = 'No clear trend, range-bound market';
      tradingImplication = 'Trade range boundaries, avoid breakout chasing';
    }
  } else if (change7d > 5) {
    regime = 'RISK_ON';
    confidence = 72;
    description = 'Short-term risk-on sentiment';
    tradingImplication = 'Momentum favors longs, manage stops';
  } else {
    regime = 'RISK_OFF';
    confidence = 72;
    description = 'Short-term risk-off sentiment';
    tradingImplication = 'Reduce exposure, protect capital';
  }

  return { regime, confidence, description, tradingImplication };
}
