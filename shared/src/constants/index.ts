// ============================================================
// SHARED CONSTANTS
// ============================================================

export const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';
export const BINANCE_REST_BASE = 'https://api.binance.com/api/v3';

// Default trading pairs to scan
export const DEFAULT_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT',
  'UNIUSDT', 'ATOMUSDT', 'LTCUSDT', 'ETCUSDT', 'XLMUSDT',
  'ALGOUSDT', 'VETUSDT', 'FILUSDT', 'TRXUSDT', 'AAVEUSDT',
];

// Signal detection thresholds
export const THRESHOLDS = {
  WHALE_TRADE_USD: 100_000,           // $100k+ trade = whale
  VOLUME_SPIKE_MULTIPLIER: 3.0,       // 3x average = spike
  PRICE_SURGE_PERCENT: 5.0,           // 5% up in short window
  PRICE_CRASH_PERCENT: -5.0,          // 5% down in short window
  LIQUIDITY_ANOMALY_SPREAD: 2.0,      // 2% bid-ask spread
  ACCUMULATION_WINDOW_MS: 5 * 60_000, // 5 minutes
  VOLUME_WINDOW_CANDLES: 20,          // look-back candles
} as const;

// AI service config
export const AI_CONFIG = {
  MAX_TOKENS: 1024,
  MODEL: 'claude-sonnet-4-20250514',
  QUEUE_CONCURRENCY: 3,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 2000,
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX_REQUESTS: 50,
} as const;

// JWT
export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  ALGORITHM: 'HS256',
} as const;

// HTTP Status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Service ports
export const SERVICE_PORTS = {
  BACKEND: 4000,
  SCANNER: 4001,
  PROCESSOR: 4002,
  AI_SERVICE: 4003,
  AUTH_SERVICE: 4004,
  FRONTEND: 3000,
} as const;
