// ============================================================
// PLAN DEFINITIONS — single source of truth for all tiers
//
// Every limit enforced anywhere in the system MUST be read
// from here — never hard-coded in routes or middleware.
// ============================================================

export type PlanTier = 'FREE' | 'PRO' | 'ENTERPRISE';
export type BillingInterval = 'MONTHLY' | 'ANNUAL';

// ── Feature flags ─────────────────────────────────────────────

export interface PlanFeatures {
  // Scanner
  maxWatchlistSymbols:    number;   // tokens in personal watchlist
  scannerPairs:           number;   // live pairs visible in scanner
  // Alerts
  maxAlerts:              number;   // total active alert configs
  alertChannels:          string[]; // IN_APP | EMAIL | TELEGRAM
  // AI Insights
  aiInsightsPerDay:       number;   // -1 = unlimited
  aiInsightHistory:       number;   // days of insight history accessible
  // Signals
  signalTypes:            string[]; // which signal types are accessible
  signalHistory:          number;   // days of signal history
  signalSeverityFilter:   boolean;  // can filter by severity
  // Scores
  tokenScores:            boolean;  // access to risk/opportunity scores
  scoreHistory:           number;   // days of score history
  scoreLeaderboard:       boolean;  // access to leaderboards
  // API
  apiAccess:              boolean;  // REST API key access
  apiRateLimit:           number;   // requests per minute (0 = no API)
  // Export
  dataExport:             boolean;  // CSV/JSON export
  // Support
  supportLevel:           'community' | 'email' | 'priority';
  // Sessions
  maxConcurrentSessions:  number;
}

// ── Pricing ───────────────────────────────────────────────────

export interface PlanPricing {
  monthlyUsd:  number;   // 0 = free
  annualUsd:   number;   // annual total (discount applied)
  // Stripe price IDs (set via env — different per environment)
  stripePriceIdMonthly?: string;
  stripePriceIdAnnual?:  string;
}

// ── Full plan definition ──────────────────────────────────────

export interface PlanDefinition {
  tier:        PlanTier;
  displayName: string;
  description: string;
  badge:       string;      // emoji or short label
  features:    PlanFeatures;
  pricing:     PlanPricing;
  highlighted: boolean;     // "most popular" flag
}

// ── The three tiers ───────────────────────────────────────────

export const PLANS: Record<PlanTier, PlanDefinition> = {

  FREE: {
    tier:        'FREE',
    displayName: 'Free',
    description: 'Get started with real-time market monitoring',
    badge:       '🆓',
    highlighted: false,
    pricing: {
      monthlyUsd: 0,
      annualUsd:  0,
    },
    features: {
      maxWatchlistSymbols:   5,
      scannerPairs:          10,
      maxAlerts:             3,
      alertChannels:         ['IN_APP'],
      aiInsightsPerDay:      5,
      aiInsightHistory:      7,
      signalTypes:           ['WHALE_TRADE', 'VOLUME_SPIKE'],
      signalHistory:         1,
      signalSeverityFilter:  false,
      tokenScores:           false,
      scoreHistory:          0,
      scoreLeaderboard:      false,
      apiAccess:             false,
      apiRateLimit:          0,
      dataExport:            false,
      supportLevel:          'community',
      maxConcurrentSessions: 2,
    },
  },

  PRO: {
    tier:        'PRO',
    displayName: 'Pro',
    description: 'Full AI analysis for serious traders',
    badge:       '⚡',
    highlighted: true,
    pricing: {
      monthlyUsd:           49,
      annualUsd:            470,   // ~20% discount
      stripePriceIdMonthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      stripePriceIdAnnual:  process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
    },
    features: {
      maxWatchlistSymbols:   50,
      scannerPairs:          50,
      maxAlerts:             25,
      alertChannels:         ['IN_APP', 'EMAIL', 'TELEGRAM'],
      aiInsightsPerDay:      100,
      aiInsightHistory:      90,
      signalTypes:           ['WHALE_TRADE', 'VOLUME_SPIKE', 'PRICE_SURGE', 'PRICE_CRASH', 'ACCUMULATION_PATTERN', 'DUMP_PATTERN', 'LIQUIDITY_ANOMALY'],
      signalHistory:         30,
      signalSeverityFilter:  true,
      tokenScores:           true,
      scoreHistory:          30,
      scoreLeaderboard:      true,
      apiAccess:             true,
      apiRateLimit:          60,
      dataExport:            true,
      supportLevel:          'email',
      maxConcurrentSessions: 5,
    },
  },

  ENTERPRISE: {
    tier:        'ENTERPRISE',
    displayName: 'Enterprise',
    description: 'Unlimited access for teams and institutions',
    badge:       '🏢',
    highlighted: false,
    pricing: {
      monthlyUsd:           299,
      annualUsd:            2870,  // ~20% discount
      stripePriceIdMonthly: process.env.STRIPE_ENT_MONTHLY_PRICE_ID,
      stripePriceIdAnnual:  process.env.STRIPE_ENT_ANNUAL_PRICE_ID,
    },
    features: {
      maxWatchlistSymbols:   -1,   // unlimited
      scannerPairs:          -1,
      maxAlerts:             -1,
      alertChannels:         ['IN_APP', 'EMAIL', 'TELEGRAM'],
      aiInsightsPerDay:      -1,
      aiInsightHistory:      365,
      signalTypes:           ['WHALE_TRADE', 'VOLUME_SPIKE', 'PRICE_SURGE', 'PRICE_CRASH', 'ACCUMULATION_PATTERN', 'DUMP_PATTERN', 'LIQUIDITY_ANOMALY'],
      signalHistory:         365,
      signalSeverityFilter:  true,
      tokenScores:           true,
      scoreHistory:          365,
      scoreLeaderboard:      true,
      apiAccess:             true,
      apiRateLimit:          600,
      dataExport:            true,
      supportLevel:          'priority',
      maxConcurrentSessions: 20,
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────

export function getPlan(tier: PlanTier): PlanDefinition {
  return PLANS[tier];
}

export function getFeature<K extends keyof PlanFeatures>(
  tier: PlanTier,
  feature: K,
): PlanFeatures[K] {
  return PLANS[tier].features[feature];
}

/**
 * Returns true if the given count is within the plan limit.
 * -1 means unlimited.
 */
export function withinLimit(current: number, limit: number): boolean {
  if (limit === -1) return true;
  return current < limit;
}

/**
 * Returns true if the tier has access to a specific signal type.
 */
export function canAccessSignalType(tier: PlanTier, signalType: string): boolean {
  return PLANS[tier].features.signalTypes.includes(signalType);
}

/**
 * Returns true if the tier can use a specific alert channel.
 */
export function canUseAlertChannel(tier: PlanTier, channel: string): boolean {
  return PLANS[tier].features.alertChannels.includes(channel);
}

/**
 * Compare plan tiers (returns positive if a > b).
 */
const TIER_ORDER: Record<PlanTier, number> = { FREE: 0, PRO: 1, ENTERPRISE: 2 };
export function compareTiers(a: PlanTier, b: PlanTier): number {
  return TIER_ORDER[a] - TIER_ORDER[b];
}

export function isUpgrade(from: PlanTier, to: PlanTier): boolean {
  return compareTiers(to, from) > 0;
}

export function isDowngrade(from: PlanTier, to: PlanTier): boolean {
  return compareTiers(to, from) < 0;
}
