// ============================================================
// ALERT CHECKER TESTS
// Uses mocked Prisma and Redis — no real DB calls.
// ============================================================

import { AlertChecker } from '../analyzers/alertChecker';

// ── Mocks ────────────────────────────────────────────────────

const mockCreate      = jest.fn().mockResolvedValue({ id: 'trig_001', message: 'Alert triggered' });
const mockFindUnique  = jest.fn().mockResolvedValue(null);
const mockFindMany    = jest.fn();

const mockPrisma = {
  triggeredAlert:    { create: mockCreate },
  userPreferences:   { findUnique: mockFindUnique },
  alertConfig:       { findMany: mockFindMany },
} as any;

const mockPublish = jest.fn().mockResolvedValue(1);
const mockRedis   = { publish: mockPublish } as any;

// ── Helpers ───────────────────────────────────────────────────

function makeTicker(overrides: Record<string, unknown> = {}) {
  return {
    symbol:                'BTCUSDT',
    price:                 65000,
    priceChangePercent24h: 3.5,
    quoteVolume24h:        1_200_000_000,
    ...overrides,
  };
}

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id:        'alert_001',
    userId:    'user_001',
    symbol:    'BTCUSDT',
    condition: 'PRICE_ABOVE',
    threshold: 60000,
    isActive:  true,
    channels:  ['IN_APP'],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('AlertChecker', () => {
  let checker: AlertChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    checker = new AlertChecker(mockPrisma, mockRedis);
  });

  // ── PRICE_ABOVE ───────────────────────────────────────────

  describe('PRICE_ABOVE condition', () => {
    it('triggers when price exceeds threshold', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_ABOVE', threshold: 60000 }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      expect(mockCreate).toHaveBeenCalledTimes(1);

      const call = mockCreate.mock.calls[0][0].data;
      expect(call.condition).toBe('PRICE_ABOVE');
      expect(call.triggerValue).toBe(65000);
      expect(call.threshold).toBe(60000);
    });

    it('does NOT trigger when price is below threshold', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_ABOVE', threshold: 70000 }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── PRICE_BELOW ───────────────────────────────────────────

  describe('PRICE_BELOW condition', () => {
    it('triggers when price falls below threshold', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_BELOW', threshold: 70000 }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('does NOT trigger when price is above threshold', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_BELOW', threshold: 60000 }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── PRICE_CHANGE_PERCENT ──────────────────────────────────

  describe('PRICE_CHANGE_PERCENT condition', () => {
    it('triggers on positive change exceeding threshold', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_CHANGE_PERCENT', threshold: 3.0 }),
      ]);

      await checker.check(makeTicker({ priceChangePercent24h: 3.5 }));
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('triggers on negative change exceeding threshold (absolute value)', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_CHANGE_PERCENT', threshold: 3.0 }),
      ]);

      await checker.check(makeTicker({ priceChangePercent24h: -4.2 }));
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('does NOT trigger when change is within threshold', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_CHANGE_PERCENT', threshold: 5.0 }),
      ]);

      await checker.check(makeTicker({ priceChangePercent24h: 2.1 }));
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── VOLUME_SPIKE_PERCENT ──────────────────────────────────

  describe('VOLUME_SPIKE_PERCENT condition', () => {
    it('triggers when volume exceeds threshold', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'VOLUME_SPIKE_PERCENT', threshold: 1_000_000_000 }),
      ]);

      await checker.check(makeTicker({ quoteVolume24h: 1_200_000_000 }));
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ── Inactive alerts ───────────────────────────────────────

  describe('inactive alerts', () => {
    it('does NOT trigger inactive alerts', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ isActive: false }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── Cooldown ──────────────────────────────────────────────

  describe('cooldown enforcement', () => {
    it('does NOT re-trigger within cooldown window', async () => {
      mockFindMany.mockResolvedValue([
        makeAlert({ condition: 'PRICE_ABOVE', threshold: 60000 }),
      ]);

      const ticker = makeTicker({ price: 65000 });
      await checker.check(ticker);
      await checker.check(ticker); // immediate second check

      // Only one trigger despite two checks
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ── No matching alerts ────────────────────────────────────

  describe('no matching symbol', () => {
    it('does nothing when no alerts for symbol', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ symbol: 'ETHUSDT' }), // different symbol
      ]);

      await checker.check(makeTicker({ symbol: 'BTCUSDT' }));
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── Notification publishing ───────────────────────────────

  describe('Redis publishing', () => {
    it('publishes to alerts channel on trigger', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_ABOVE', threshold: 60000 }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      expect(mockPublish).toHaveBeenCalledTimes(1);

      const [channel, payload] = mockPublish.mock.calls[0];
      expect(channel).toContain('alerts');
      const parsed = JSON.parse(payload);
      expect(parsed.type).toBe('alert_triggered');
    });
  });

  // ── Message building ──────────────────────────────────────

  describe('message formatting', () => {
    it('builds PRICE_ABOVE message with formatted values', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_ABOVE', threshold: 60000 }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      const msg = mockCreate.mock.calls[0][0].data.message;
      expect(msg).toContain('BTCUSDT');
      expect(msg).toContain('65,000');
      expect(msg).toContain('60,000');
    });

    it('builds PRICE_CHANGE_PERCENT message with sign', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeAlert({ condition: 'PRICE_CHANGE_PERCENT', threshold: 3.0 }),
      ]);

      await checker.check(makeTicker({ priceChangePercent24h: 5.5 }));
      const msg = mockCreate.mock.calls[0][0].data.message;
      expect(msg).toContain('+5.50%');
    });
  });

  // ── Stats ─────────────────────────────────────────────────

  describe('stats tracking', () => {
    it('tracks triggered count', async () => {
      mockFindMany.mockResolvedValue([
        makeAlert({ condition: 'PRICE_ABOVE', threshold: 60000 }),
      ]);

      await checker.check(makeTicker({ price: 65000 }));
      expect(checker.stats.triggered).toBe(1);
    });

    it('tracks checks run', async () => {
      mockFindMany.mockResolvedValue([]);
      await checker.check(makeTicker());
      await checker.check(makeTicker());
      expect(checker.stats.checksRun).toBe(2);
    });
  });
});
