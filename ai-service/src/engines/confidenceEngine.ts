// ============================================================
// CONFIDENCE ENGINE
// Calculates confidence score based on model agreement
// ============================================================

import { VotingResult } from './votingEngine';

export interface ConfidenceResult {
  score: number;
  level: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  factors: string[];
  penalties: string[];
}

export interface MarketContext {
  volumeSpike: boolean;
  relativeVolume: number;
  atrPercent: number;
  macroAligned: boolean;
  onChainAligned: boolean;
  derivativesAligned: boolean;
}

export function runConfidenceEngine(voting: VotingResult, context: MarketContext): ConfidenceResult {
  let score = 50;
  const factors: string[] = [];
  const penalties: string[] = [];

  // Base score from consensus
  const agreement = Math.max(voting.bullishVotes, voting.bearishVotes) / voting.totalVotes;
  score += (agreement - 0.5) * 60;
  factors.push(`Model agreement: ${(agreement * 100).toFixed(0)}%`);

  // Volume confirmation
  if (context.volumeSpike) {
    score += 10;
    factors.push('Volume spike confirms signal');
  }
  if (context.relativeVolume > 1.5) {
    score += 5;
    factors.push(`High relative volume: ${context.relativeVolume.toFixed(1)}x`);
  }

  // Macro alignment
  if (context.macroAligned) {
    score += 10;
    factors.push('Macro conditions aligned');
  } else {
    score -= 10;
    penalties.push('Macro conditions not aligned');
  }

  // On-chain alignment
  if (context.onChainAligned) {
    score += 8;
    factors.push('On-chain data confirms signal');
  }

  // Derivatives alignment
  if (context.derivativesAligned) {
    score += 8;
    factors.push('Derivatives confirm signal');
  }

  // High volatility penalty
  if (context.atrPercent > 8) {
    score -= 15;
    penalties.push(`Very high volatility (ATR ${context.atrPercent.toFixed(1)}%)`);
  } else if (context.atrPercent > 5) {
    score -= 8;
    penalties.push(`High volatility (ATR ${context.atrPercent.toFixed(1)}%)`);
  }

  // Neutral consensus penalty
  if (voting.consensus === 'NEUTRAL') {
    score -= 20;
    penalties.push('No clear consensus among models');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: ConfidenceResult['level'];
  if (score >= 80) level = 'VERY_HIGH';
  else if (score >= 65) level = 'HIGH';
  else if (score >= 45) level = 'MEDIUM';
  else if (score >= 25) level = 'LOW';
  else level = 'VERY_LOW';

  return { score, level, factors, penalties };
}
