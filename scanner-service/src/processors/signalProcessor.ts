// ============================================================
// SIGNAL PROCESSOR ENGINE
// Automatically detects and publishes trading signals from
// market data: volume spikes, price surges, whale-size trades,
// accumulation/dump patterns, and liquidity anomalies.
// ============================================================

import { createLogger } from '../utils/shared';

const logger = createLogger('signal-processor');

export interface MarketSnapshot {
  symbol:      string;
  price:       number;
  prevPrice:   number;
  volume24h:   number;
  prevVolume:  number;
  tradeSize?:  number; // USD value of single trade
  bid?:        number;
  ask?:        number;
}

export interface ProcessedSignal {
  symbol:   string;
  type:     string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  data:     Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// Thresholds
const VOLUME_SPIKE_MULTIPLIER  = 2.5;   // 2.5x avg volume
const PRICE_SURGE_PCT          = 3.0;   // 3% price move
const PRICE_CRASH_PCT          = -3.0;  // -3% price move
const WHALE_TRADE_USD          = 100_000; // $100k single trade
const SPREAD_ANOMALY_PCT       = 0.8;   // 0.8% bid/ask spread

// Rolling volume averages per symbol (in-memory)
const volumeHistory = new Map<string, number[]>();
const priceHistory  = new Map<string, number[]>();

function updateHistory(map: Map<string, number[]>, symbol: string, value: number, maxLen = 20) {
  const arr = map.get(symbol) ?? [];
  arr.push(value);
  if (arr.length > maxLen) arr.shift();
  map.set(symbol, arr);
  return arr;
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function processMarketSnapshot(snap: MarketSnapshot): ProcessedSignal[] {
  const signals: ProcessedSignal[] = [];
  const { symbol, price, prevPrice, volume24h, prevVolume, tradeSize, bid, ask } = snap;

  // ── 1. Volume Spike ────────────────────────────────────────
  const volArr = updateHistory(volumeHistory, symbol, volume24h);
  const avgVol = avg(volArr.slice(0, -1));
  if (avgVol > 0 && volume24h > avgVol * VOLUME_SPIKE_MULTIPLIER) {
    const ratio = volume24h / avgVol;
    signals.push({
      symbol,
      type: 'VOLUME_SPIKE',
      severity: ratio > 5 ? 'CRITICAL' : ratio > 3.5 ? 'HIGH' : 'MEDIUM',
      data: { volume24h, avgVolume: avgVol, ratio: +ratio.toFixed(2) },
      metadata: { detectedAt: Date.now() },
    });
  }

  // ── 2. Price Surge / Crash ─────────────────────────────────
  if (prevPrice > 0) {
    const pctChange = ((price - prevPrice) / prevPrice) * 100;
    if (pctChange >= PRICE_SURGE_PCT) {
      signals.push({
        symbol,
        type: 'PRICE_SURGE',
        severity: pctChange >= 8 ? 'CRITICAL' : pctChange >= 5 ? 'HIGH' : 'MEDIUM',
        data: { price, prevPrice, pctChange: +pctChange.toFixed(2) },
        metadata: { detectedAt: Date.now() },
      });
    } else if (pctChange <= PRICE_CRASH_PCT) {
      signals.push({
        symbol,
        type: 'PRICE_CRASH',
        severity: pctChange <= -8 ? 'CRITICAL' : pctChange <= -5 ? 'HIGH' : 'MEDIUM',
        data: { price, prevPrice, pctChange: +pctChange.toFixed(2) },
        metadata: { detectedAt: Date.now() },
      });
    }
  }

  // ── 3. Whale Trade ─────────────────────────────────────────
  if (tradeSize && tradeSize >= WHALE_TRADE_USD) {
    signals.push({
      symbol,
      type: 'WHALE_TRADE',
      severity: tradeSize >= 1_000_000 ? 'CRITICAL' : tradeSize >= 500_000 ? 'HIGH' : 'MEDIUM',
      data: { tradeSize, price },
      metadata: { detectedAt: Date.now() },
    });
  }

  // ── 4. Accumulation / Dump Pattern ────────────────────────
  const priceArr = updateHistory(priceHistory, symbol, price);
  if (priceArr.length >= 10) {
    const oldest = priceArr[0];
    const trend = ((price - oldest) / oldest) * 100;
    if (trend >= 8) {
      signals.push({
        symbol,
        type: 'ACCUMULATION_PATTERN',
        severity: trend >= 15 ? 'HIGH' : 'MEDIUM',
        data: { trend: +trend.toFixed(2), periods: priceArr.length },
        metadata: { detectedAt: Date.now() },
      });
    } else if (trend <= -8) {
      signals.push({
        symbol,
        type: 'DUMP_PATTERN',
        severity: trend <= -15 ? 'HIGH' : 'MEDIUM',
        data: { trend: +trend.toFixed(2), periods: priceArr.length },
        metadata: { detectedAt: Date.now() },
      });
    }
  }

  // ── 5. Liquidity Anomaly (spread) ─────────────────────────
  if (bid && ask && bid > 0) {
    const spread = ((ask - bid) / bid) * 100;
    if (spread >= SPREAD_ANOMALY_PCT) {
      signals.push({
        symbol,
        type: 'LIQUIDITY_ANOMALY',
        severity: spread >= 2 ? 'HIGH' : 'MEDIUM',
        data: { bid, ask, spreadPct: +spread.toFixed(3) },
        metadata: { detectedAt: Date.now() },
      });
    }
  }

  if (signals.length > 0) {
    logger.info('Signals detected', { symbol, count: signals.length, types: signals.map(s => s.type) });
  }

  return signals;
}
