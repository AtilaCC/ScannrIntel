// ============================================================
// SUBSCRIPTION TESTS
// Tests plan logic, limits, upgrade/downgrade, usage counting
// ============================================================

import {
  PLANS, PlanTier, getFeature, withinLimit,
  canAccessSignalType, canUseAlertChannel,
  compareTiers, isUpgrade, isDowngrade,
} from '../src/config/plans';

// ── Plan definitions ──────────────────────────────────────────

describe('PLANS definitions', () => {
  it('all tiers exist', () => {
    expect(PLANS.FREE).toBeDefined();
    expect(PLANS.PRO).toBeDefined();
    expect(PLANS.ENTERPRISE).toBeDefined();
  });

  it('FREE is cheaper than PRO', () => {
    expect(PLANS.FREE.pricing.monthlyUsd).toBe(0);
    expect(PLANS.PRO.pricing.monthlyUsd).toBeGreaterThan(0);
  });

  it('PRO is cheaper than ENTERPRISE', () => {
    expect(PLANS.PRO.pricing.monthlyUsd).toBeLessThan(PLANS.ENTERPRISE.pricing.monthlyUsd);
  });

  it('annual pricing is cheaper per month than monthly', () => {
    const proMonthly = PLANS.PRO.pricing.monthlyUsd * 12;
    const proAnnual  = PLANS.PRO.pricing.annualUsd;
    expect(proAnnual).toBeLessThan(proMonthly);
  });

  it('ENTERPRISE features are superset of PRO', () => {
    const pro = PLANS.PRO.features;
    const ent = PLANS.ENTERPRISE.features;
    // Numeric limits: enterprise >= pro (or -1 = unlimited)
    expect(ent.maxAlerts === -1 || ent.maxAlerts >= pro.maxAlerts).toBe(true);
    expect(ent.aiInsightsPerDay === -1 || ent.aiInsightsPerDay >= pro.aiInsightsPerDay).toBe(true);
    // Boolean features: enterprise has everything pro has
    expect(ent.tokenScores).toBe(true);
    expect(ent.apiAccess).toBe(true);
    expect(ent.dataExport).toBe(true);
  });

  it('PRO has more features than FREE', () => {
    const free = PLANS.FREE.features;
    const pro  = PLANS.PRO.features;
    expect(pro.maxAlerts).toBeGreaterThan(free.maxAlerts);
    expect(pro.tokenScores).toBe(true);
    expect(free.tokenScores).toBe(false);
    expect(pro.apiAccess).toBe(true);
    expect(free.apiAccess).toBe(false);
  });

  it('highlighted plan is PRO', () => {
    expect(PLANS.PRO.highlighted).toBe(true);
    expect(PLANS.FREE.highlighted).toBe(false);
    expect(PLANS.ENTERPRISE.highlighted).toBe(false);
  });
});

// ── getFeature ────────────────────────────────────────────────

describe('getFeature()', () => {
  it('returns correct numeric limit', () => {
    expect(getFeature('FREE', 'maxAlerts')).toBe(3);
    expect(getFeature('PRO', 'maxAlerts')).toBe(25);
    expect(getFeature('ENTERPRISE', 'maxAlerts')).toBe(-1);
  });

  it('returns correct boolean feature', () => {
    expect(getFeature('FREE', 'tokenScores')).toBe(false);
    expect(getFeature('PRO', 'tokenScores')).toBe(true);
    expect(getFeature('ENTERPRISE', 'tokenScores')).toBe(true);
  });

  it('returns correct string feature', () => {
    expect(getFeature('FREE', 'supportLevel')).toBe('community');
    expect(getFeature('PRO', 'supportLevel')).toBe('email');
    expect(getFeature('ENTERPRISE', 'supportLevel')).toBe('priority');
  });

  it('returns API rate limits correctly', () => {
    expect(getFeature('FREE', 'apiRateLimit')).toBe(0);
    expect(getFeature('PRO', 'apiRateLimit')).toBe(60);
    expect(getFeature('ENTERPRISE', 'apiRateLimit')).toBe(600);
  });
});

// ── withinLimit ───────────────────────────────────────────────

describe('withinLimit()', () => {
  it('returns true when count < limit', () => {
    expect(withinLimit(2, 3)).toBe(true);
  });

  it('returns false when count equals limit', () => {
    expect(withinLimit(3, 3)).toBe(false);
  });

  it('returns false when count exceeds limit', () => {
    expect(withinLimit(10, 3)).toBe(false);
  });

  it('returns true for unlimited (-1)', () => {
    expect(withinLimit(9999, -1)).toBe(true);
  });

  it('returns true for zero count', () => {
    expect(withinLimit(0, 5)).toBe(true);
  });
});

// ── canAccessSignalType ───────────────────────────────────────

describe('canAccessSignalType()', () => {
  it('FREE can access WHALE_TRADE', () => {
    expect(canAccessSignalType('FREE', 'WHALE_TRADE')).toBe(true);
  });

  it('FREE can access VOLUME_SPIKE', () => {
    expect(canAccessSignalType('FREE', 'VOLUME_SPIKE')).toBe(true);
  });

  it('FREE cannot access PRICE_SURGE', () => {
    expect(canAccessSignalType('FREE', 'PRICE_SURGE')).toBe(false);
  });

  it('FREE cannot access ACCUMULATION_PATTERN', () => {
    expect(canAccessSignalType('FREE', 'ACCUMULATION_PATTERN')).toBe(false);
  });

  it('PRO can access all signal types', () => {
    const allTypes = [
      'WHALE_TRADE', 'VOLUME_SPIKE', 'PRICE_SURGE', 'PRICE_CRASH',
      'ACCUMULATION_PATTERN', 'DUMP_PATTERN', 'LIQUIDITY_ANOMALY',
    ];
    allTypes.forEach((t) => {
      expect(canAccessSignalType('PRO', t)).toBe(true);
    });
  });

  it('ENTERPRISE can access all signal types', () => {
    expect(canAccessSignalType('ENTERPRISE', 'LIQUIDITY_ANOMALY')).toBe(true);
  });

  it('returns false for unknown signal type', () => {
    expect(canAccessSignalType('PRO', 'UNKNOWN_TYPE')).toBe(false);
  });
});

// ── canUseAlertChannel ────────────────────────────────────────

describe('canUseAlertChannel()', () => {
  it('FREE can only use IN_APP', () => {
    expect(canUseAlertChannel('FREE', 'IN_APP')).toBe(true);
    expect(canUseAlertChannel('FREE', 'EMAIL')).toBe(false);
    expect(canUseAlertChannel('FREE', 'TELEGRAM')).toBe(false);
  });

  it('PRO can use all channels', () => {
    expect(canUseAlertChannel('PRO', 'IN_APP')).toBe(true);
    expect(canUseAlertChannel('PRO', 'EMAIL')).toBe(true);
    expect(canUseAlertChannel('PRO', 'TELEGRAM')).toBe(true);
  });

  it('ENTERPRISE can use all channels', () => {
    expect(canUseAlertChannel('ENTERPRISE', 'TELEGRAM')).toBe(true);
  });
});

// ── compareTiers / isUpgrade / isDowngrade ────────────────────

describe('tier comparison', () => {
  describe('compareTiers()', () => {
    it('FREE < PRO', () => expect(compareTiers('FREE', 'PRO')).toBeLessThan(0));
    it('PRO < ENTERPRISE', () => expect(compareTiers('PRO', 'ENTERPRISE')).toBeLessThan(0));
    it('FREE < ENTERPRISE', () => expect(compareTiers('FREE', 'ENTERPRISE')).toBeLessThan(0));
    it('PRO > FREE', () => expect(compareTiers('PRO', 'FREE')).toBeGreaterThan(0));
    it('same tier = 0', () => expect(compareTiers('PRO', 'PRO')).toBe(0));
  });

  describe('isUpgrade()', () => {
    it('FREE → PRO is upgrade', () => expect(isUpgrade('FREE', 'PRO')).toBe(true));
    it('FREE → ENTERPRISE is upgrade', () => expect(isUpgrade('FREE', 'ENTERPRISE')).toBe(true));
    it('PRO → ENTERPRISE is upgrade', () => expect(isUpgrade('PRO', 'ENTERPRISE')).toBe(true));
    it('PRO → FREE is not upgrade', () => expect(isUpgrade('PRO', 'FREE')).toBe(false));
    it('same tier is not upgrade', () => expect(isUpgrade('PRO', 'PRO')).toBe(false));
  });

  describe('isDowngrade()', () => {
    it('PRO → FREE is downgrade', () => expect(isDowngrade('PRO', 'FREE')).toBe(true));
    it('ENTERPRISE → PRO is downgrade', () => expect(isDowngrade('ENTERPRISE', 'PRO')).toBe(true));
    it('FREE → PRO is not downgrade', () => expect(isDowngrade('FREE', 'PRO')).toBe(false));
    it('same tier is not downgrade', () => expect(isDowngrade('FREE', 'FREE')).toBe(false));
  });
});

// ── Limit enforcement scenarios ───────────────────────────────

describe('limit enforcement scenarios', () => {
  it('FREE user at alert limit cannot create more', () => {
    const limit   = getFeature('FREE', 'maxAlerts');
    const current = 3; // at limit
    expect(withinLimit(current, limit)).toBe(false);
  });

  it('FREE user under alert limit can create', () => {
    const limit   = getFeature('FREE', 'maxAlerts');
    const current = 2;
    expect(withinLimit(current, limit)).toBe(true);
  });

  it('ENTERPRISE user never hits alert limit', () => {
    const limit   = getFeature('ENTERPRISE', 'maxAlerts');
    const current = 10_000;
    expect(withinLimit(current, limit)).toBe(true); // -1 = unlimited
  });

  it('PRO user at 5-insight limit is blocked', () => {
    const limit   = getFeature('PRO', 'aiInsightsPerDay');
    // PRO has 100 per day
    expect(withinLimit(100, limit)).toBe(false);
    expect(withinLimit(99,  limit)).toBe(true);
  });

  it('FREE daily AI insight limit is enforced', () => {
    const limit = getFeature('FREE', 'aiInsightsPerDay');
    expect(limit).toBe(5);
    expect(withinLimit(5, limit)).toBe(false);
    expect(withinLimit(4, limit)).toBe(true);
  });

  it('watchlist limit: FREE cannot exceed 5 symbols', () => {
    const limit = getFeature('FREE', 'maxWatchlistSymbols');
    expect(limit).toBe(5);
    expect(withinLimit(5, limit)).toBe(false);
    expect(withinLimit(4, limit)).toBe(true);
  });

  it('signal history day limits are correct', () => {
    expect(getFeature('FREE', 'signalHistory')).toBe(1);
    expect(getFeature('PRO', 'signalHistory')).toBe(30);
    expect(getFeature('ENTERPRISE', 'signalHistory')).toBe(365);
  });

  it('concurrent session limits are correct', () => {
    expect(getFeature('FREE', 'maxConcurrentSessions')).toBe(2);
    expect(getFeature('PRO', 'maxConcurrentSessions')).toBe(5);
    expect(getFeature('ENTERPRISE', 'maxConcurrentSessions')).toBe(20);
  });
});
