// ============================================================
// KELLY ENGINE
// Fractional Kelly position sizing
// ============================================================

export interface KellyResult {
  fullKelly: number;
  fractionalKelly: number;
  recommendedFraction: number;
  positionSizePercent: number;
  rationale: string;
}

export function runKellyEngine(
  confidence: number,
  riskRewardRatio: number,
  winRate: number = 0.55
): KellyResult {
  // Kelly Formula: f = (bp - q) / b
  // b = odds (risk/reward), p = win probability, q = 1 - p
  const p = winRate * (confidence / 100);
  const q = 1 - p;
  const b = riskRewardRatio;

  const fullKelly = (b * p - q) / b;
  const clampedKelly = Math.max(0, Math.min(1, fullKelly));

  // Use 25% Kelly by default, 50% for very high confidence
  const fractionMultiplier = confidence >= 80 ? 0.5 : 0.25;
  const fractionalKelly = clampedKelly * fractionMultiplier;
  const positionSizePercent = Math.round(fractionalKelly * 100);

  let rationale = '';
  if (positionSizePercent === 0) {
    rationale = 'Negative Kelly — do not trade';
  } else if (confidence >= 80) {
    rationale = `50% Kelly applied — high confidence signal (${confidence}%)`;
  } else {
    rationale = `25% Kelly applied — standard confidence (${confidence}%)`;
  }

  return {
    fullKelly: Math.round(clampedKelly * 100),
    fractionalKelly: positionSizePercent,
    recommendedFraction: fractionMultiplier,
    positionSizePercent,
    rationale,
  };
}
