// ============================================================
// VOTING ENGINE
// Aggregates votes from all models into consensus score
// ============================================================

import { ModelResult, ModelVote } from './multiModelEngine';

export interface VotingResult {
  bullishVotes: number;
  bearishVotes: number;
  neutralVotes: number;
  totalVotes: number;
  consensusScore: number;
  consensus: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
  dominantVote: ModelVote;
  categoryBreakdown: Record<string, { bullish: number; bearish: number; neutral: number }>;
}

export function runVotingEngine(models: ModelResult[]): VotingResult {
  let bullish = 0, bearish = 0, neutral = 0;
  const categoryBreakdown: Record<string, { bullish: number; bearish: number; neutral: number }> = {};

  for (const model of models) {
    if (model.vote === 'BULLISH') bullish++;
    else if (model.vote === 'BEARISH') bearish++;
    else neutral++;

    if (!categoryBreakdown[model.category]) {
      categoryBreakdown[model.category] = { bullish: 0, bearish: 0, neutral: 0 };
    }
    if (model.vote === 'BULLISH') categoryBreakdown[model.category].bullish++;
    else if (model.vote === 'BEARISH') categoryBreakdown[model.category].bearish++;
    else categoryBreakdown[model.category].neutral++;
  }

  const total = models.length;
  const consensusScore = ((bullish - bearish) / total) * 100;

  let consensus: VotingResult['consensus'];
  if (consensusScore >= 60) consensus = 'STRONG_BULLISH';
  else if (consensusScore >= 20) consensus = 'BULLISH';
  else if (consensusScore <= -60) consensus = 'STRONG_BEARISH';
  else if (consensusScore <= -20) consensus = 'BEARISH';
  else consensus = 'NEUTRAL';

  const dominantVote: ModelVote = bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'NEUTRAL';

  return {
    bullishVotes: bullish,
    bearishVotes: bearish,
    neutralVotes: neutral,
    totalVotes: total,
    consensusScore: Math.round(consensusScore),
    consensus,
    dominantVote,
    categoryBreakdown,
  };
}
