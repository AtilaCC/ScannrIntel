// ============================================================
// SCORE AGGREGATOR
// Merges the deterministic rule-based scores from TokenScorer
// with Claude's qualitative factor scores into a single
// calibrated final score for each token.
//
// Blending strategy:
//   - Rule-based scores form a reliable floor/ceiling
//   - Claude's scores adjust the composite within a trust band
//   - Trust band widens as Claude confidence increases
//   - Final scores are smoothed against the previous score to
//     prevent jarring jumps from a single signal
// ============================================================

import { ParsedInsight, ScoreBreakdown, ScoreFactor, MarketContext } from '../types';

// How much to trust Claude vs rule-based scores
const BASE_RULE_WEIGHT   = 0.55;  // rules anchor 55% of final score
const BASE_CLAUDE_WEIGHT = 0.45;  // Claude adjusts the remaining 45%

// How much previous score dampens the new score (momentum smoothing)
const SMOOTHING_FACTOR = 0.20;    // 20% previous, 80% new

// Maximum adjustment Claude can push a score away from the rule baseline
const MAX_CLAUDE_DELTA = 20;      // ±20 points

function clamp(v: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

export class ScoreAggregator {

  /**
   * Produce a complete ScoreBreakdown by blending:
   *   1. Rule-based composite scores
   *   2. Claude's raw riskScore / opportunityScore
   *   3. Claude's per-factor scores (when available)
   *   4. Previous score for smoothing
   */
  aggregate(opts: {
    signal:              { id: string; symbol: string; type: string; severity: string };
    insight:             ParsedInsight;
    ruleFactors:         ScoreFactor[];
    compositeRisk:       number;
    compositeOpportunity:number;
    ctx:                 MarketContext;
  }): ScoreBreakdown {

    const {
      insight,
      ruleFactors,
      compositeRisk,
      compositeOpportunity,
      ctx,
    } = opts;

    // ── Adjust trust weights based on Claude confidence ──────
    // Higher confidence → Claude gets more weight
    const confBoost     = (insight.confidence - 0.6) * 0.5; // ±0.2 adjustment
    const claudeWeight  = clamp(BASE_CLAUDE_WEIGHT + confBoost, 0, 1);
    const ruleWeight    = 1 - claudeWeight;

    // ── Clamp Claude's adjustment within MAX_CLAUDE_DELTA ────
    // Prevents Claude from overriding the rule baseline by too much
    const claudeRiskAdj = clamp(
      compositeRisk + clampDelta(insight.riskScore - compositeRisk, MAX_CLAUDE_DELTA),
    );
    const claudeOppAdj  = clamp(
      compositeOpportunity + clampDelta(insight.opportunityScore - compositeOpportunity, MAX_CLAUDE_DELTA),
    );

    // ── Blend ─────────────────────────────────────────────────
    let blendedRisk = clamp(
      compositeRisk   * ruleWeight +
      claudeRiskAdj   * claudeWeight,
    );
    let blendedOpp  = clamp(
      compositeOpportunity * ruleWeight +
      claudeOppAdj         * claudeWeight,
    );

    // ── Apply per-factor Claude scores if provided ───────────
    if (insight.factorScores) {
      const cf = insight.factorScores;
      const enrichedFactors = ruleFactors.map((f) => {
        const key = factorNameToKey(f.name);
        const claudeFactorScore = cf[key as keyof typeof cf];
        if (claudeFactorScore === undefined) return f;

        // Blend the per-factor score too
        return {
          ...f,
          score: clamp(
            f.score * ruleWeight +
            clamp(claudeFactorScore) * claudeWeight,
          ),
          explanation: f.explanation + ` (Claude: ${claudeFactorScore})`,
        };
      });

      // Re-compute composite from enriched per-factor scores
      blendedRisk = clamp(
        enrichedFactors
          .filter((f) => f.direction === 'RISK' || f.direction === 'BOTH')
          .reduce((sum, f) => sum + f.score * f.weight, 0),
      );
      blendedOpp = clamp(
        enrichedFactors
          .filter((f) => f.direction === 'OPPORTUNITY' || f.direction === 'BOTH')
          .reduce((sum, f) => sum + f.score * f.weight, 0),
      );
    }

    // ── Smooth against previous score ─────────────────────────
    const prev     = ctx.previousScore;
    let finalRisk  = blendedRisk;
    let finalOpp   = blendedOpp;

    if (prev && prev.computedAt > Date.now() - 4 * 60 * 60 * 1000) {
      // Only smooth if previous score is < 4 hours old
      finalRisk = clamp(prev.risk * SMOOTHING_FACTOR + blendedRisk * (1 - SMOOTHING_FACTOR));
      finalOpp  = clamp(prev.opportunity * SMOOTHING_FACTOR + blendedOpp * (1 - SMOOTHING_FACTOR));
    }

    // ── Consistency enforcement ────────────────────────────────
    // BEARISH sentiment should not have high opportunity score
    // BULLISH sentiment should not have high risk score without volume
    finalRisk = enforceConsistency('RISK', finalRisk, finalOpp, insight.sentiment, opts.ctx);
    finalOpp  = enforceConsistency('OPP',  finalRisk, finalOpp, insight.sentiment, opts.ctx);

    return {
      factors:             ruleFactors,
      compositeRisk,
      compositeOpportunity,
      claudeRisk:          insight.riskScore,
      claudeOpportunity:   insight.opportunityScore,
      finalRisk:           clamp(finalRisk),
      finalOpportunity:    clamp(finalOpp),
      ruleWeight:          parseFloat(ruleWeight.toFixed(2)),
      claudeWeight:        parseFloat(claudeWeight.toFixed(2)),
      computedAt:          Date.now(),
    };
  }
}

// ── Private helpers ───────────────────────────────────────────

function clampDelta(delta: number, max: number): number {
  return Math.sign(delta) * Math.min(Math.abs(delta), max);
}

function factorNameToKey(name: string): string {
  const map: Record<string, string> = {
    'Price Volatility':    'volatility',
    'Volume Anomaly':      'volume',
    'Price Momentum':      'momentum',
    'Liquidity Conditions':'liquidity',
    'Signal Frequency':    'sentiment',
    'Event Magnitude':     'manipulation',
  };
  return map[name] ?? name.toLowerCase();
}

function enforceConsistency(
  which:     'RISK' | 'OPP',
  risk:      number,
  opp:       number,
  sentiment: string,
  ctx:       MarketContext,
): number {
  if (which === 'OPP') {
    // Extreme risk + bearish = cap opportunity
    if (risk > 80 && sentiment === 'BEARISH') return clamp(Math.min(opp, 35));
    // Very low volume + bullish = temper opportunity
    if ((ctx.volumeRatio ?? 1) < 0.5 && sentiment === 'BULLISH') return clamp(opp * 0.8);
    return opp;
  }
  if (which === 'RISK') {
    // Bullish + strong volume = slight risk reduction
    if (sentiment === 'BULLISH' && (ctx.volumeRatio ?? 1) >= 2) return clamp(risk * 0.92);
    return risk;
  }
  return which === 'RISK' ? risk : opp;
}
