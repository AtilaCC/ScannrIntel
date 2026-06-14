// ============================================================
// SHARED CONSTANTS
// ============================================================

export const THRESHOLDS = {
  PRICE_CHANGE_HIGH: 5,
  PRICE_CHANGE_MEDIUM: 3,
  PRICE_CHANGE_LOW: 1.5,
  VOLUME_SPIKE_HIGH: 3,
  VOLUME_SPIKE_MEDIUM: 1.8,
  MIN_USD_WHALE: 500_000,
} as const;

export const REDIS_CHANNELS = {
  MARKET_DATA: 'market:data',
  SIGNALS: 'signals:new',
  AI_ANALYSIS: 'ai:analysis',
  ALERTS: 'alerts:dispatch',
} as const;

export const SCAN_INTERVALS = ['1m', '5m', '15m', '1h'] as const;

export const TOP_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'UNIUSDT',
] as const;
