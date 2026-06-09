// ============================================================
// MACRO ENGINE
// Analyzes macro conditions impact on crypto
// ============================================================

export interface MacroData {
  fedFundsRate?: number;
  cpi?: number;
  dxy?: number;
  sp500Change?: number;
  goldChange?: number;
  fearGreedIndex?: number;
  btcDominance?: number;
  totalMarketCap?: number;
  stablecoinDominance?: number;
}

export interface MacroResult {
  regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  liquidityCondition: 'EXPANDING' | 'CONTRACTING' | 'NEUTRAL';
  cryptoFavorable: boolean;
  score: number;
  signals: string[];
  warnings: string[];
}

export function runMacroEngine(data: MacroData): MacroResult {
  const signals: string[] = [];
  const warnings: string[] = [];
  let score = 50;

  // DXY analysis (inverse correlation with crypto)
  if (data.dxy !== undefined) {
    if (data.dxy < -0.5) { score += 10; signals.push('DXY weakening — bullish for crypto'); }
    else if (data.dxy > 0.5) { score -= 10; warnings.push('DXY strengthening — bearish for crypto'); }
  }

  // S&P500 correlation
  if (data.sp500Change !== undefined) {
    if (data.sp500Change > 1) { score += 8; signals.push('Risk-on: equities rallying'); }
    else if (data.sp500Change < -1) { score -= 8; warnings.push('Risk-off: equities selling'); }
  }

  // Fear & Greed
  if (data.fearGreedIndex !== undefined) {
    if (data.fearGreedIndex < 25) { score += 15; signals.push('Extreme fear — contrarian bullish'); }
    else if (data.fearGreedIndex > 80) { score -= 10; warnings.push('Extreme greed — potential reversal'); }
    else if (data.fearGreedIndex > 60) { score += 5; signals.push('Greed — momentum positive'); }
  }

  // BTC dominance
  if (data.btcDominance !== undefined) {
    if (data.btcDominance > 55) { signals.push('High BTC dominance — altcoins may lag'); }
    else if (data.btcDominance < 45) { signals.push('Low BTC dominance — altseason possible'); }
  }

  // Stablecoin dominance (inverse — high = fear)
  if (data.stablecoinDominance !== undefined) {
    if (data.stablecoinDominance > 10) { score -= 10; warnings.push('High stablecoin dominance — investors in cash'); }
    else if (data.stablecoinDominance < 5) { score += 10; signals.push('Low stablecoin dominance — capital deployed'); }
  }

  // CPI (inflation)
  if (data.cpi !== undefined) {
    if (data.cpi > 4) { score -= 8; warnings.push(`High CPI ${data.cpi}% — Fed likely hawkish`); }
    else if (data.cpi < 2.5) { score += 8; signals.push(`Low CPI ${data.cpi}% — Fed likely dovish`); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const regime: MacroResult['regime'] = score >= 60 ? 'RISK_ON' : score <= 40 ? 'RISK_OFF' : 'NEUTRAL';
  const liquidityCondition: MacroResult['liquidityCondition'] =
    (data.fedFundsRate && data.fedFundsRate < 3) ? 'EXPANDING' :
    (data.fedFundsRate && data.fedFundsRate > 5) ? 'CONTRACTING' : 'NEUTRAL';

  return {
    regime,
    liquidityCondition,
    cryptoFavorable: score >= 55,
    score,
    signals,
    warnings,
  };
}
