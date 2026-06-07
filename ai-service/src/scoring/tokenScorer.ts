// ============================================================
// TOKEN SCORER — Deterministic rule-based pre-scoring
//
// Computes 6 independent factor scores from market data
// BEFORE Claude runs. This provides:
//   1. A calibrated baseline so Claude can't hallucinate scores
//   2. Structured per-factor explanations
//   3. Consistent scoring even when Claude produces fallback output
//
// Factor weights sum to 1.0:
//   volatility    0.20  — price movement intensity
//   volume        0.20  — trading activity relative to average
//   momentum      0.15  — directional price trend
//   liquidity     0.15  — bid-ask spread & order book depth
//   signalHistory 0.15  — recent anomaly frequency for this token
//   tradeSize     0.15  — magnitude of the triggering event
// ============================================================

import { DbSignal, MarketContext, ScoreFactor, ScoreBreakdown } from '../types';

// ── Factor weight definitions ─────────────────────────────────

interface FactorDef {
  name:      string;
  weight:    number;
  direction: 'RISK' | 'OPPORTUNITY' | 'BOTH';
}

const FACTORS: Record<string, FactorDef> = {
  volatility:    { name: 'Price Volatility',       weight: 0.20, direction: 'BOTH' },
  volume:        { name: 'Volume Anomaly',          weight: 0.20, direction: 'BOTH' },
  momentum:      { name: 'Price Momentum',          weight: 0.15, direction: 'BOTH' },
  liquidity:     { name: 'Liquidity Conditions',    weight: 0.15, direction: 'RISK'  },
  signalHistory: { name: 'Signal Frequency',        weight: 0.15, direction: 'RISK'  },
  tradeSize:     { name: 'Event Magnitude',         weight: 0.15, direction: 'BOTH' },
};

// ── Clamp helper ──────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

// ── Individual factor scorers ─────────────────────────────────

/** Volatility: how much has price moved in short windows? */
function scoreVolatility(ctx: MarketContext): {
  risk: number; opportunity: number; explanation: string;
} {
  const change24h = Math.abs(ctx.priceChange24h);
  const change1h  = Math.abs(ctx.priceChange1h ?? 0);

  // Risk: extreme moves in either direction = high risk
  const riskFrom24h = clamp(change24h * 4);          // 25% move → 100 risk
  const riskFrom1h  = clamp(change1h  * 10);         // 10% move in 1h → 100 risk
  const risk        = clamp((riskFrom24h * 0.5) + (riskFrom1h * 0.5));

  // Opportunity: upward moves score higher than downward
  const upside = ctx.priceChange24h > 0
    ? clamp(ctx.priceChange24h * 5)     // +20% → 100
    : clamp(Math.abs(ctx.priceChange24h) * 2); // downward move = some recovery opportunity

  const explanation = change24h >= 10
    ? `Extreme ${change24h.toFixed(1)}% 24h move — high volatility`
    : change24h >= 5
    ? `Significant ${change24h.toFixed(1)}% 24h move`
    : `Moderate ${change24h.toFixed(1)}% 24h change`;

  return { risk, opportunity: upside, explanation };
}

/** Volume: how does current volume compare to the rolling average? */
function scoreVolume(ctx: MarketContext): {
  risk: number; opportunity: number; explanation: string;
} {
  const ratio = ctx.volumeRatio ?? 1.0;

  // Volume spike → both risk (manipulation possible) and opportunity (conviction)
  const risk        = clamp(ratio >= 5 ? 90 : ratio >= 3 ? 70 : ratio >= 2 ? 45 : ratio >= 1.5 ? 25 : 10);
  const opportunity = clamp(ratio >= 5 ? 85 : ratio >= 3 ? 75 : ratio >= 2 ? 55 : ratio >= 1.5 ? 35 : 15);

  const explanation = ratio >= 3
    ? `Volume ${ratio.toFixed(1)}x above 20-period MA — extreme spike`
    : ratio >= 2
    ? `Volume ${ratio.toFixed(1)}x above average — significant spike`
    : ratio >= 1.5
    ? `Volume ${ratio.toFixed(1)}x above average — elevated`
    : `Volume near average (${ratio.toFixed(1)}x MA)`;

  return { risk, opportunity, explanation };
}

/** Momentum: directional strength and consistency. */
function scoreMomentum(ctx: MarketContext): {
  risk: number; opportunity: number; explanation: string;
} {
  const change24h = ctx.priceChange24h;
  const change1h  = ctx.priceChange1h ?? 0;

  // Aligned momentum (both timeframes same direction) = stronger signal
  const aligned = (change24h > 0 && change1h > 0) || (change24h < 0 && change1h < 0);

  // Risk: sharp negative momentum
  const downRisk = change24h < 0
    ? clamp(Math.abs(change24h) * 5 * (aligned ? 1.2 : 0.8))
    : 10;

  // Opportunity: strong upward momentum
  const upOpportunity = change24h > 0
    ? clamp(change24h * 5 * (aligned ? 1.2 : 0.8))
    : 15;

  // Reversal setup: price near 24h low after big drop = recovery opportunity
  const rangePos = ctx.rangePosition ?? 0.5;
  const reversalBonus = (change24h < -5 && rangePos < 0.2) ? 20 : 0;

  const explanation = aligned
    ? `Aligned momentum: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}% (24h), ${change1h >= 0 ? '+' : ''}${change1h.toFixed(1)}% (1h)`
    : `Mixed momentum: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}% (24h), ${change1h >= 0 ? '+' : ''}${change1h.toFixed(1)}% (1h)`;

  return {
    risk:        clamp(downRisk),
    opportunity: clamp(upOpportunity + reversalBonus),
    explanation,
  };
}

/** Liquidity: wide spreads = higher risk of slippage and manipulation. */
function scoreLiquidity(ctx: MarketContext): {
  risk: number; opportunity: number; explanation: string;
} {
  const spread = ctx.spreadPercent ?? 0.05; // default to normal spread

  // Wider spread = more risk (harder to exit, more manipulation risk)
  const risk = clamp(
    spread >= 1.0 ? 90 :
    spread >= 0.5 ? 70 :
    spread >= 0.2 ? 45 :
    spread >= 0.1 ? 25 : 10,
  );

  // Tight spread = better opportunity (easier to enter/exit)
  const opportunity = clamp(
    spread <= 0.05 ? 60 :
    spread <= 0.1  ? 45 :
    spread <= 0.2  ? 30 : 15,
  );

  const explanation = spread >= 0.5
    ? `Wide ${spread.toFixed(2)}% spread — poor liquidity conditions`
    : spread >= 0.1
    ? `Elevated ${spread.toFixed(2)}% spread — normal for conditions`
    : `Tight ${spread.toFixed(2)}% spread — good liquidity`;

  return { risk, opportunity, explanation };
}

/** Signal history: how many anomalies has this token seen recently? */
function scoreSignalHistory(ctx: MarketContext, signal: DbSignal): {
  risk: number; opportunity: number; explanation: string;
} {
  const recent     = ctx.recentSignals ?? [];
  const count24h   = recent.length;
  const criticals  = recent.filter((s) => s.severity === 'CRITICAL').length;
  const sameType   = recent.filter((s) => s.type === signal.type).length;

  // Many recent anomalies = elevated risk (possible coordinated activity)
  const risk = clamp(
    criticals >= 3 ? 85 :
    criticals >= 1 ? 65 :
    count24h  >= 5 ? 55 :
    count24h  >= 3 ? 35 :
    count24h  >= 1 ? 20 : 5,
  );

  // Repeated same signal type = confirmation pattern (opportunity)
  const opportunity = clamp(
    sameType >= 3 ? 70 :
    sameType >= 2 ? 50 :
    count24h >= 3 ? 40 : 20,
  );

  const explanation = criticals > 0
    ? `${criticals} critical signal(s) in last 24h — elevated activity`
    : count24h > 0
    ? `${count24h} signal(s) in last 24h — pattern forming`
    : 'No recent signals — baseline conditions';

  return { risk, opportunity, explanation };
}

/** Trade/event size: how large is the triggering event? */
function scoreTradeSize(signal: DbSignal, ctx: MarketContext): {
  risk: number; opportunity: number; explanation: string;
} {
  const data = signal.data as any;
  let sizeUsd = 0;
  let explanation = '';

  if (signal.type === 'WHALE_TRADE') {
    sizeUsd = data.tradeUSD ?? 0;
    const risk = clamp(
      sizeUsd >= 10_000_000 ? 95 :
      sizeUsd >= 5_000_000  ? 85 :
      sizeUsd >= 1_000_000  ? 70 :
      sizeUsd >= 500_000    ? 50 :
      sizeUsd >= 100_000    ? 30 : 15,
    );
    const dir = data.direction === 'BUY' ? 'buy' : 'sell';
    explanation = `$${(sizeUsd / 1e6).toFixed(2)}M ${dir} order — ${sizeUsd >= 1e6 ? 'institutional' : 'large retail'} size`;
    return {
      risk,
      opportunity: data.direction === 'BUY' ? clamp(risk * 0.9) : clamp(risk * 0.4),
      explanation,
    };
  }

  if (signal.type === 'VOLUME_SPIKE') {
    const multiplier = data.multiplier ?? 1;
    const risk       = clamp(multiplier >= 10 ? 90 : multiplier >= 5 ? 70 : multiplier >= 3 ? 45 : 20);
    explanation      = `${multiplier.toFixed(1)}x volume multiplier — ${multiplier >= 5 ? 'extreme' : 'significant'} spike`;
    return { risk, opportunity: clamp(risk * 0.85), explanation };
  }

  if (signal.type === 'PRICE_SURGE' || signal.type === 'PRICE_CRASH') {
    const pct  = Math.abs(data.changePercent ?? data.changePercent24h ?? 0);
    const risk = clamp(pct >= 20 ? 95 : pct >= 10 ? 80 : pct >= 5 ? 55 : 30);
    explanation = `${pct.toFixed(1)}% price ${signal.type === 'PRICE_SURGE' ? 'surge' : 'crash'} — ${pct >= 10 ? 'extreme' : 'significant'} move`;
    return {
      risk,
      opportunity: signal.type === 'PRICE_CRASH'
        ? clamp(pct >= 10 ? 65 : 40)  // crashes create buy opportunities
        : clamp(risk * 0.7),
      explanation,
    };
  }

  if (signal.type === 'ACCUMULATION_PATTERN') {
    const totalUsd = data.totalUSD ?? 0;
    const risk     = clamp(totalUsd >= 5e6 ? 70 : totalUsd >= 1e6 ? 50 : 30);
    explanation    = `$${(totalUsd / 1e6).toFixed(1)}M accumulated — ${data.largeBuyCount ?? 0} orders`;
    return { risk, opportunity: clamp(risk * 1.1), explanation }; // accumulation = higher opportunity
  }

  // Generic fallback based on signal severity
  const severityScore = signal.severity === 'CRITICAL' ? 85 : signal.severity === 'HIGH' ? 65 : signal.severity === 'MEDIUM' ? 40 : 20;
  explanation = `${signal.severity} severity ${signal.type.replace(/_/g, ' ').toLowerCase()}`;
  return { risk: severityScore, opportunity: severityScore * 0.7, explanation };
}

// ── Main scorer class ─────────────────────────────────────────

export class TokenScorer {

  /**
   * Compute a full ScoreBreakdown from market data alone.
   * This runs BEFORE Claude and provides the rule-based baseline.
   * Claude's scores are merged in by ScoreAggregator afterwards.
   */
  computeRuleBasedScores(signal: DbSignal, ctx: MarketContext): {
    factors:          ScoreFactor[];
    compositeRisk:    number;
    compositeOpportunity: number;
  } {
    // Compute each factor
    const vol     = scoreVolatility(ctx);
    const volume  = scoreVolume(ctx);
    const mom     = scoreMomentum(ctx);
    const liq     = scoreLiquidity(ctx);
    const hist    = scoreSignalHistory(ctx, signal);
    const size    = scoreTradeSize(signal, ctx);

    const rawScores = { vol, volume, mom, liq, hist, size };
    const factorKeys = ['volatility', 'volume', 'momentum', 'liquidity', 'signalHistory', 'tradeSize'] as const;
    const rawValues  = [vol, volume, mom, liq, hist, size];

    // Build ScoreFactor array
    const factors: ScoreFactor[] = factorKeys.map((key, i) => {
      const def    = FACTORS[key];
      const raw    = rawValues[i];
      // For RISK factors, score = risk; for OPPORTUNITY = opportunity; for BOTH = average
      const score  = def.direction === 'RISK'
        ? raw.risk
        : def.direction === 'OPPORTUNITY'
        ? raw.opportunity
        : Math.round((raw.risk + raw.opportunity) / 2);

      return {
        name:        def.name,
        score,
        weight:      def.weight,
        direction:   def.direction,
        explanation: raw.explanation,
      };
    });

    // Weighted composite scores
    let compositeRisk        = 0;
    let compositeOpportunity = 0;

    factorKeys.forEach((key, i) => {
      const def = FACTORS[key];
      const raw = rawValues[i];
      compositeRisk        += raw.risk        * def.weight;
      compositeOpportunity += raw.opportunity * def.weight;
    });

    return {
      factors,
      compositeRisk:        clamp(compositeRisk),
      compositeOpportunity: clamp(compositeOpportunity),
    };
  }
}
