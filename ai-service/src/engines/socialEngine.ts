// ============================================================
// SOCIAL INTELLIGENCE ENGINE
// Evaluates social signals and influencer impact
// ============================================================

export interface SocialSignal {
  source: string;
  author: string;
  content: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  credibilityScore: number;
  influenceScore: number;
  timestamp: Date;
}

export interface SocialResult {
  overallSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  weightedScore: number;
  topSignals: SocialSignal[];
  warnings: string[];
}

const INFLUENCER_WEIGHTS: Record<string, number> = {
  'Jerome Powell': 100,
  'Federal Reserve': 100,
  'SEC': 95,
  'CZ': 85,
  'Vitalik Buterin': 80,
  'Michael Saylor': 70,
  'BlackRock': 90,
  'Fidelity': 85,
};

export function runSocialEngine(signals: SocialSignal[]): SocialResult {
  if (signals.length === 0) {
    return {
      overallSentiment: 'NEUTRAL',
      weightedScore: 50,
      topSignals: [],
      warnings: ['No social signals available'],
    };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  const warnings: string[] = [];

  for (const signal of signals) {
    const weight = INFLUENCER_WEIGHTS[signal.author] || signal.influenceScore;
    const sentimentValue = signal.sentiment === 'BULLISH' ? 1 : signal.sentiment === 'BEARISH' ? -1 : 0;
    weightedSum += sentimentValue * weight * signal.credibilityScore;
    totalWeight += weight;

    if (signal.author === 'Jerome Powell' || signal.author === 'Federal Reserve') {
      warnings.push(`⚠️ Fed signal detected: "${signal.content.substring(0, 100)}..."`);
    }
  }

  const normalizedScore = totalWeight > 0 ? (weightedSum / totalWeight + 1) / 2 * 100 : 50;
  const overallSentiment = normalizedScore > 60 ? 'BULLISH' : normalizedScore < 40 ? 'BEARISH' : 'NEUTRAL';

  const topSignals = signals
    .sort((a, b) => (INFLUENCER_WEIGHTS[b.author] || b.influenceScore) - (INFLUENCER_WEIGHTS[a.author] || a.influenceScore))
    .slice(0, 3);

  return {
    overallSentiment,
    weightedScore: Math.round(normalizedScore),
    topSignals,
    warnings,
  };
}
