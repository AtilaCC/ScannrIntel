// ============================================================
// SCANNER TYPES — internal to scanner-service
// ============================================================

// ── Raw Binance wire formats ──────────────────────────────────

export interface BinanceRawTicker {
  e: '24hrTicker';
  E: number;   // event time
  s: string;   // symbol
  p: string;   // price change
  P: string;   // price change percent
  w: string;   // weighted avg price
  c: string;   // last price
  Q: string;   // last qty
  o: string;   // open price
  h: string;   // high price
  l: string;   // low price
  v: string;   // base volume
  q: string;   // quote volume
  O: number;   // open time
  C: number;   // close time
  F: number;   // first trade id
  L: number;   // last trade id
  n: number;   // trade count
}

export interface BinanceRawTrade {
  e: 'trade';
  E: number;   // event time
  s: string;   // symbol
  t: number;   // trade id
  p: string;   // price
  q: string;   // quantity
  b: number;   // buyer order id
  a: number;   // seller order id
  T: number;   // trade time
  m: boolean;  // is buyer maker
  M: boolean;  // ignore
}

export interface BinanceRawKline {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number;   // open time
    T: number;   // close time
    s: string;   // symbol
    i: string;   // interval
    o: string;   // open
    c: string;   // close
    h: string;   // high
    l: string;   // low
    v: string;   // base volume
    q: string;   // quote volume
    n: number;   // trade count
    x: boolean;  // is closed
    V: string;   // taker buy base vol
    Q: string;   // taker buy quote vol
  };
}

export interface BinanceRawBookTicker {
  u: number;   // update id
  s: string;   // symbol
  b: string;   // best bid price
  B: string;   // best bid qty
  a: string;   // best ask price
  A: string;   // best ask qty
}

export interface BinanceCombinedMessage {
  stream: string;
  data: BinanceRawTicker | BinanceRawTrade | BinanceRawKline | BinanceRawBookTicker;
}

// ── Normalized internal types ─────────────────────────────────

export interface NormalizedTicker {
  symbol: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  weightedAvgPrice: number;
  volume24h: number;         // base asset volume
  quoteVolume24h: number;    // USDT volume
  high24h: number;
  low24h: number;
  openPrice: number;
  tradeCount: number;
  openTime: number;
  closeTime: number;
  timestamp: number;
}

export interface NormalizedTrade {
  symbol: string;
  tradeId: number;
  price: number;
  quantity: number;
  quoteQty: number;          // price * quantity (USD value)
  isBuyerMaker: boolean;     // true = sell, false = buy
  timestamp: number;
  eventTime: number;
}

export interface NormalizedKline {
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
  isClosed: boolean;
}

export interface NormalizedBookTicker {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  spread: number;       // ask - bid
  spreadPercent: number; // spread / mid * 100
  midPrice: number;
  updateId: number;
  timestamp: number;
}

// ── Candle (OHLCV) aggregated locally ───────────────────────

export interface Candle {
  symbol: string;
  interval: string;   // '1m', '5m', '15m', '1h'
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
  isClosed: boolean;
}

// ── Market snapshot (written to Redis) ──────────────────────

export interface MarketSnapshot {
  symbol: string;
  ticker: NormalizedTicker | null;
  book: NormalizedBookTicker | null;
  candles: Record<string, Candle[]>; // interval → last N candles
  lastTradePrice: number;
  lastUpdatedAt: number;
}

// ── Stream health ────────────────────────────────────────────

export type StreamStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'FAILED' | 'STOPPED';

export interface StreamHealth {
  key: string;
  symbols: string[];
  status: StreamStatus;
  connectedAt: number | null;
  reconnectAttempts: number;
  messagesReceived: number;
  lastMessageAt: number | null;
  errorCount: number;
}

// ── Scanner metrics ──────────────────────────────────────────

export interface ScannerMetrics {
  uptime: number;
  totalSymbols: number;
  connectedStreams: number;
  totalStreams: number;
  messagesPerSecond: number;
  totalMessagesReceived: number;
  totalTradesReceived: number;
  totalTickersReceived: number;
  redisPublishErrors: number;
  lastTickAt: number | null;
  symbolMetrics: Record<string, SymbolMetrics>;
}

export interface SymbolMetrics {
  symbol: string;
  tradesReceived: number;
  tickersReceived: number;
  lastPrice: number;
  lastTradeAt: number | null;
  lastTickerAt: number | null;
}

// ── Config ───────────────────────────────────────────────────

export interface ScannerConfig {
  symbols: string[];
  batchSize: number;
  minTradeUsdThreshold: number;
  enableKlineStreams: boolean;
  enableBookTickerStreams: boolean;
  klineIntervals: string[];
  candleHistorySize: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  reconnectMaxAttempts: number;
  heartbeatIntervalMs: number;
  redisSnapshotTtlSeconds: number;
  publishThrottleMs: number;
}
