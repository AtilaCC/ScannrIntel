// ============================================================
// SCANNER CONFIG — env-validated configuration
// ============================================================

import { ScannerConfig } from '../types';
import { DEFAULT_PAIRS } from '../utils/constants';

function parseSymbols(): string[] {
  const raw = process.env.SCAN_SYMBOLS || DEFAULT_PAIRS.join(',');
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0 && s.endsWith('USDT'));
}

function parseIntervals(): string[] {
  const raw = process.env.KLINE_INTERVALS || '1m,5m,15m,1h';
  return raw.split(',').map((s) => s.trim());
}

function requireEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

export const env = {
  NODE_ENV:   process.env.NODE_ENV || 'development',
  PORT:       parseInt(process.env.PORT || '4001', 10),
  REDIS_URL:  requireEnv('REDIS_URL', 'redis://localhost:6379'),
  LOG_LEVEL:  process.env.LOG_LEVEL || 'info',
};

export const scannerConfig: ScannerConfig = {
  symbols:                   parseSymbols(),
  batchSize:                 parseInt(process.env.STREAM_BATCH_SIZE  || '100',    10),
  minTradeUsdThreshold:      parseInt(process.env.MIN_TRADE_USD      || '10000',  10),
  enableKlineStreams:         process.env.ENABLE_KLINE_STREAMS        !== 'false',
  enableBookTickerStreams:    process.env.ENABLE_BOOK_TICKER_STREAMS  !== 'false',
  klineIntervals:            parseIntervals(),
  candleHistorySize:         parseInt(process.env.CANDLE_HISTORY_SIZE || '100',   10),
  reconnectBaseDelayMs:      parseInt(process.env.RECONNECT_BASE_MS   || '1000',  10),
  reconnectMaxDelayMs:       parseInt(process.env.RECONNECT_MAX_MS    || '30000', 10),
  reconnectMaxAttempts:      parseInt(process.env.RECONNECT_MAX_TRIES || '50',    10),
  heartbeatIntervalMs:       parseInt(process.env.HEARTBEAT_MS        || '30000', 10),
  redisSnapshotTtlSeconds:   parseInt(process.env.SNAPSHOT_TTL_S      || '60',    10),
  publishThrottleMs:         parseInt(process.env.PUBLISH_THROTTLE_MS || '100',   10),
};
