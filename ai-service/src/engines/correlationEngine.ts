// ============================================================
// CORRELATION ENGINE
// Detects statistical relationships between assets
// ============================================================

export interface CorrelationResult {
  symbol: string;
  btcCorrelation: number;
  isLeading: boolean;
  isLagging: boolean;
  divergence: boolean;
  divergenceDirection: 'POSITIVE' | 'NEGATIVE' | 'NONE';
  signal: string;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const meanX = x.slice(-n).reduce((a, b) => a + b, 0) / n;
  const meanY = y.slice(-n).reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[x.length - n + i] - meanX;
    const dy = y[y.length - n + i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  return num / Math.sqrt(denX * denY) || 0;
}

export function runCorrelationEngine(
  symbolPrices: number[],
  btcPrices: number[],
  symbol: string
): CorrelationResult {
  const correlation = pearsonCorrelation(symbolPrices, btcPrices);

  const btcChange = ((btcPrices[btcPrices.length - 1] - btcPrices[btcPrices.length - 24]) / btcPrices[btcPrices.length - 24]) * 100;
  const symbolChange = ((symbolPrices[symbolPrices.length - 1] - symbolPrices[symbolPrices.length - 24]) / symbolPrices[symbolPrices.length - 24]) * 100;

  const divergence = Math.abs(btcChange - symbolChange) > 5 && Math.abs(correlation) > 0.7;
  const divergenceDirection = divergence
    ? symbolChange > btcChange ? 'POSITIVE' : 'NEGATIVE'
    : 'NONE';

  const isLeading = divergenceDirection === 'POSITIVE';
  const isLagging = divergenceDirection === 'NEGATIVE';

  let signal = '';
  if (divergence && divergenceDirection === 'POSITIVE') {
    signal = `${symbol} outperforming BTC — potential rotation target`;
  } else if (divergence && divergenceDirection === 'NEGATIVE') {
    signal = `${symbol} underperforming BTC — potential catch-up or weakness`;
  } else {
    signal = `${symbol} moving in line with BTC (correlation: ${correlation.toFixed(2)})`;
  }

  return { symbol, btcCorrelation: correlation, isLeading, isLagging, divergence, divergenceDirection, signal };
}
