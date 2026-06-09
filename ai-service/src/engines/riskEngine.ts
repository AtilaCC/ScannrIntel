// ============================================================
// RISK ENGINE
// Monitors and calculates risk metrics
// ============================================================

export interface RiskResult {
  riskScore: number;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  stopLoss: number;
  takeProfit: number;
  maxDrawdownEstimate: number;
  riskRewardRatio: number;
  warnings: string[];
  approved: boolean;
}

export function runRiskEngine(
  currentPrice: number,
  atrPercent: number,
  confidence: number,
  regime: string,
  action: 'BUY' | 'SELL' | 'HOLD'
): RiskResult {
  const warnings: string[] = [];
  let riskScore = 30;

  // ATR-based stop loss (1.5x ATR)
  const atrValue = currentPrice * (atrPercent / 100);
  const stopLossDistance = atrValue * 1.5;
  const takeProfitDistance = stopLossDistance * 2.5;

  const stopLoss = action === 'BUY'
    ? currentPrice - stopLossDistance
    : currentPrice + stopLossDistance;

  const takeProfit = action === 'BUY'
    ? currentPrice + takeProfitDistance
    : currentPrice - takeProfitDistance;

  const riskRewardRatio = takeProfitDistance / stopLossDistance;

  // Risk score factors
  if (atrPercent > 8) { riskScore += 30; warnings.push('Extreme volatility detected'); }
  else if (atrPercent > 5) { riskScore += 15; warnings.push('High volatility'); }

  if (confidence < 40) { riskScore += 25; warnings.push('Low confidence signal'); }
  else if (confidence < 60) { riskScore += 10; }

  if (regime === 'BEAR' && action === 'BUY') { riskScore += 20; warnings.push('Buying against bear trend'); }
  if (regime === 'BULL' && action === 'SELL') { riskScore += 20; warnings.push('Selling against bull trend'); }

  if (riskRewardRatio < 1.5) { riskScore += 15; warnings.push('Poor risk/reward ratio'); }

  riskScore = Math.min(100, riskScore);

  let riskLevel: RiskResult['riskLevel'];
  if (riskScore >= 75) riskLevel = 'CRITICAL';
  else if (riskScore >= 55) riskLevel = 'HIGH';
  else if (riskScore >= 35) riskLevel = 'MEDIUM';
  else riskLevel = 'LOW';

  const approved = riskScore < 75 && confidence > 40 && riskRewardRatio >= 1.5;

  return {
    riskScore,
    riskLevel,
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    maxDrawdownEstimate: atrPercent * 2,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    warnings,
    approved,
  };
}
