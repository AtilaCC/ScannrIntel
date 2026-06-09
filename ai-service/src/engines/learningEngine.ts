// ============================================================
// LEARNING ENGINE
// Tracks performance metrics and improves signal quality
// ============================================================

export interface TradeRecord {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  confidence: number;
  pnlPercent: number;
  timestamp: Date;
}

export interface LearningMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  recommendation: string;
}

export function calculateLearningMetrics(trades: TradeRecord[]): LearningMetrics {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winRate: 0, profitFactor: 0, sharpeRatio: 0,
      sortinoRatio: 0, maxDrawdown: 0, expectancy: 0,
      avgWin: 0, avgLoss: 0, bestTrade: 0, worstTrade: 0,
      recommendation: 'Insufficient data — need more trades',
    };
  }

  const wins = trades.filter(t => t.pnlPercent > 0);
  const losses = trades.filter(t => t.pnlPercent <= 0);

  const winRate = wins.length / trades.length;
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnlPercent, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnlPercent, 0) / losses.length) : 0;

  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  const returns = trades.map(t => t.pnlPercent);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  const downReturns = returns.filter(r => r < 0);
  const downStd = downReturns.length > 0
    ? Math.sqrt(downReturns.reduce((a, r) => a + r * r, 0) / downReturns.length)
    : 0;
  const sortinoRatio = downStd > 0 ? (avgReturn / downStd) * Math.sqrt(252) : 0;

  let cumulative = 0, peak = 0, maxDrawdown = 0;
  for (const r of returns) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const bestTrade = Math.max(...returns);
  const worstTrade = Math.min(...returns);

  let recommendation = '';
  if (sharpeRatio > 2) recommendation = 'Excellent performance — maintain strategy';
  else if (sharpeRatio > 1) recommendation = 'Good performance — minor optimizations needed';
  else if (winRate < 0.4) recommendation = 'Low win rate — review signal quality filters';
  else if (profitFactor < 1.2) recommendation = 'Marginal edge — improve risk/reward ratio';
  else recommendation = 'Acceptable performance — continue monitoring';

  return {
    totalTrades: trades.length, winRate, profitFactor,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    sortinoRatio: Math.round(sortinoRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    bestTrade: Math.round(bestTrade * 100) / 100,
    worstTrade: Math.round(worstTrade * 100) / 100,
    recommendation,
  };
}
