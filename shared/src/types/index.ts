// ============================================================
// SHARED TYPES — used across all microservices
// ============================================================

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
}

export interface Token {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  network: 'binance' | 'binance-alpha';
  isActive: boolean;
}

// Raw trade data from WebSocket
export interface RawTradeEvent {
  eventType: string;
  eventTime: number;
  symbol: string;
  tradeId: number;
  price: string;
  quantity: string;
  buyerOrderId: number;
  sellerOrderId: number;
  tradeTime: number;
  isBuyerMaker: boolean;
}

// Raw ticker data from WebSocket
export interface RawTickerEvent {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  count: number;
}

// Normalized market data
export interface NormalizedMarketData {
  symbol: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  volume24h: number;
  quoteVolume24h: number;
  high24h: number;
  low24h: number;
  tradeCount: number;
  timestamp: number;
}

// Detected signal types
export type SignalType =
  | 'WHALE_TRADE'
  | 'VOLUME_SPIKE'
  | 'PRICE_SURGE'
  | 'PRICE_CRASH'
  | 'LIQUIDITY_ANOMALY'
  | 'ACCUMULATION_PATTERN'
  | 'DUMP_PATTERN';

export type SignalSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DetectedSignal {
  id: string;
  symbol: string;
  type: SignalType;
  severity: SignalSeverity;
  data: Record<string, unknown>;
  timestamp: number;
  metadata: {
    price: number;
    volume: number;
    priceChange: number;
    volumeChange?: number;
    tradeSize?: number;
  };
}

// AI Analysis output
export interface AIInsight {
  id: string;
  signalId: string;
  symbol: string;
  summary: string;
  details: string;
  riskScore: number;       // 0-100
  opportunityScore: number; // 0-100
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  tags: string[];
  recommendations: string[];
  confidence: number; // 0-1
  createdAt: Date;
}

// Alert configuration
export interface AlertConfig {
  id: string;
  userId: string;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
  isActive: boolean;
  channels: AlertChannel[];
  createdAt: Date;
}

export type AlertCondition =
  | 'PRICE_ABOVE'
  | 'PRICE_BELOW'
  | 'VOLUME_SPIKE_PERCENT'
  | 'PRICE_CHANGE_PERCENT'
  | 'WHALE_TRADE_SIZE';

export type AlertChannel = 'IN_APP' | 'EMAIL' | 'TELEGRAM';

// Alert triggered event
export interface TriggeredAlert {
  id: string;
  alertConfigId: string;
  userId: string;
  symbol: string;
  condition: AlertCondition;
  triggerValue: number;
  threshold: number;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

// WebSocket message envelope
export interface WSMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

// Redis channel names
export const REDIS_CHANNELS = {
  MARKET_DATA: 'channel:market_data',
  SIGNALS: 'channel:signals',
  AI_INSIGHTS: 'channel:ai_insights',
  ALERTS: 'channel:alerts',
  AI_QUEUE: 'queue:ai_analysis',
} as const;

// JWT payload
export interface JWTPayload {
  sub: string;    // userId
  email: string;
  role: 'admin' | 'user';
  iat: number;
  exp: number;
}

// API Response wrapper
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
}
