// ============================================================
// STATISTICAL ARBITRAGE ENGINE
// Detects mispricings and relative value opportunities
// ============================================================

export interface StatArbResult {
  opportunity: boolean;
  type: 'RELATIVE_VALUE' | 'CORRELATION_BREAKDOWN' | 'MEAN_REVERSION' | 'NONE';
  zScore: number;
  description: string;
  confidence: number;
}

function zScore(series: number[]): number {
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const std = Math.sqrt(series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / series.length);
  if (std === 0) return 0;
  return (series[series.length - 1] - mean) / std;
}

export function runStatArbEngine(
  symbolPrices: number[],
  btcPrices: number[],
  symbol: string
): StatArbResult {
  // Calculate price ratio
  const ratio = symbolPrices.map((p, i) => p / (btcPrices[i] || 1));
  const currentZScore = zScore(ratio);

  if (Math.abs(currentZScore) > 2) {
    const type = 'MEAN_REVERSION';
    const direction = currentZScore > 0 ? 'overvalued vs BTC' : 'undervalued vs BTC';
    return {
      opportunity: true,
      type,
      zScore: Math.round(currentZScore * 100) / 100,
      description: `${symbol} statistically ${direction} (Z-Score: ${currentZScore.toFixed(2)})`,
      confidence: Math.min(95, 60 + Math.abs(currentZScore) * 10),
    };
  }

  return {
    opportunity: false,
    type: 'NONE',
    zScore: Math.round(currentZScore * 100) / 100,
    description: `${symbol} within normal range vs BTC`,
    confidence: 0,
  };
}
