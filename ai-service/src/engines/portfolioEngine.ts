// ============================================================
// PORTFOLIO ENGINE
// Think in portfolios, not individual trades
// ============================================================

export interface Position {
  symbol: string;
  sizePercent: number;
  entryPrice: number;
  currentPrice: number;
  pnlPercent: number;
  regime: string;
}

export interface PortfolioResult {
  totalExposure: number;
  concentrationRisk: boolean;
  correlationRisk: boolean;
  recommendations: string[];
  maxNewPositionSize: number;
  portfolioScore: number;
}

export function runPortfolioEngine(positions: Position[], newPositionSize: number): PortfolioResult {
  const recommendations: string[] = [];
  let portfolioScore = 80;

  const totalExposure = positions.reduce((sum, p) => sum + p.sizePercent, 0);
  const concentrationRisk = positions.some(p => p.sizePercent > 30);
  const correlationRisk = positions.length > 3 &&
    positions.filter(p => p.symbol.includes('BTC') || p.symbol.includes('ETH')).length > positions.length * 0.7;

  // Max exposure check
  const remainingCapacity = Math.max(0, 80 - totalExposure);
  const maxNewPositionSize = Math.min(newPositionSize, remainingCapacity, 20);

  if (totalExposure > 80) {
    recommendations.push('Portfolio at maximum exposure — reduce before adding new positions');
    portfolioScore -= 20;
  }

  if (concentrationRisk) {
    recommendations.push('Concentration risk detected — single position >30%');
    portfolioScore -= 15;
  }

  if (correlationRisk) {
    recommendations.push('High correlation risk — most positions move with BTC');
    portfolioScore -= 10;
  }

  const losingPositions = positions.filter(p => p.pnlPercent < -10);
  if (losingPositions.length > 0) {
    recommendations.push(`${losingPositions.length} position(s) down >10% — review stop losses`);
    portfolioScore -= losingPositions.length * 5;
  }

  if (recommendations.length === 0) {
    recommendations.push('Portfolio health good — within risk parameters');
  }

  return {
    totalExposure,
    concentrationRisk,
    correlationRisk,
    recommendations,
    maxNewPositionSize,
    portfolioScore: Math.max(0, portfolioScore),
  };
}
