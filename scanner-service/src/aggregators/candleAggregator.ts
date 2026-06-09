// ============================================================
// CANDLE AGGREGATOR
// Maintains a rolling window of OHLCV candles per symbol per
// interval. Fed by:
//   - Kline WebSocket events   (primary, when enabled)
//   - Individual trade events  (fallback local aggregation)
// ============================================================

import { Candle, NormalizedKline, NormalizedTrade } from '../types';
import { createLogger } from '../utils/constants';

const logger = createLogger('candle-aggregator');

// Interval → milliseconds
const INTERVAL_MS: Record<string, number> = {
  '1m':  60_000,
  '3m':  3  * 60_000,
  '5m':  5  * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h':  60 * 60_000,
  '4h':  4  * 60 * 60_000,
  '1d':  24 * 60 * 60_000,
};

// State for a single symbol + interval combo
interface CandleState {
  history:    Candle[];       // closed candles, newest last
  current:    Candle | null;  // open (incomplete) candle
  maxHistory: number;
}

export class CandleAggregator {
  // key: `${symbol}:${interval}`
  private state: Map<string, CandleState> = new Map();

  constructor(
    private readonly intervals: string[],
    private readonly maxHistory: number = 100,
  ) {}

  // ── Ingest from Binance kline WS event ───────────────────

  ingestKline(kline: NormalizedKline): {
    symbol:   string;
    interval: string;
    candle:   Candle;
    closed:   boolean;
  } {
    const candle: Candle = {
      symbol:      kline.symbol,
      interval:    kline.interval,
      openTime:    kline.openTime,
      closeTime:   kline.closeTime,
      open:        kline.open,
      high:        kline.high,
      low:         kline.low,
      close:       kline.close,
      volume:      kline.volume,
      quoteVolume: kline.quoteVolume,
      tradeCount:  kline.tradeCount,
      isClosed:    kline.isClosed,
    };

    const key   = `${kline.symbol}:${kline.interval}`;
    const state = this.getOrCreate(key);

    if (kline.isClosed) {
      // Push to history, evict oldest
      state.history.push(candle);
      if (state.history.length > state.maxHistory) {
        state.history.shift();
      }
      state.current = null;
    } else {
      state.current = candle;
    }

    return { symbol: kline.symbol, interval: kline.interval, candle, closed: kline.isClosed };
  }

  // ── Ingest from trade events (local aggregation) ──────────
  // Used when kline streams are disabled or as a cross-check.

  ingestTrade(trade: NormalizedTrade, interval: string): Candle | null {
    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) return null;

    const key       = `${trade.symbol}:${interval}`;
    const state     = this.getOrCreate(key);
    const openTime  = Math.floor(trade.timestamp / intervalMs) * intervalMs;
    const closeTime = openTime + intervalMs - 1;

    // If we have a current candle and the trade belongs to it — update it
    if (state.current && state.current.openTime === openTime) {
      const c = state.current;
      c.close  = trade.price;
      c.high   = Math.max(c.high, trade.price);
      c.low    = Math.min(c.low,  trade.price);
      c.volume      += trade.quantity;
      c.quoteVolume += trade.quoteQty;
      c.tradeCount  += 1;
      return c;
    }

    // Close the previous candle if any
    if (state.current) {
      const closed = { ...state.current, isClosed: true };
      state.history.push(closed);
      if (state.history.length > state.maxHistory) state.history.shift();
    }

    // Open a new candle
    state.current = {
      symbol:      trade.symbol,
      interval,
      openTime,
      closeTime,
      open:        trade.price,
      high:        trade.price,
      low:         trade.price,
      close:       trade.price,
      volume:      trade.quantity,
      quoteVolume: trade.quoteQty,
      tradeCount:  1,
      isClosed:    false,
    };

    return state.current;
  }

  // ── Query API ─────────────────────────────────────────────

  /** Return the last N closed candles for a symbol + interval. */
  getHistory(symbol: string, interval: string, limit = 50): Candle[] {
    const state = this.state.get(`${symbol}:${interval}`);
    if (!state) return [];
    return state.history.slice(-limit);
  }

  /** Return the live (open) candle for a symbol + interval. */
  getCurrent(symbol: string, interval: string): Candle | null {
    return this.state.get(`${symbol}:${interval}`)?.current ?? null;
  }

  /** Return full snapshot for a symbol across all intervals. */
  getSymbolCandles(symbol: string): Record<string, { history: Candle[]; current: Candle | null }> {
    const result: Record<string, { history: Candle[]; current: Candle | null }> = {};
    for (const interval of this.intervals) {
      const state = this.state.get(`${symbol}:${interval}`);
      result[interval] = {
        history: state?.history ?? [],
        current: state?.current ?? null,
      };
    }
    return result;
  }

  /**
   * Compute a simple volume moving average over the last N candles.
   * Used by the processor engine for volume-spike detection.
   */
  getVolumeMA(symbol: string, interval: string, periods = 20): number {
    const candles = this.getHistory(symbol, interval, periods);
    if (candles.length === 0) return 0;
    const sum = candles.reduce((acc, c) => acc + c.quoteVolume, 0);
    return sum / candles.length;
  }

  /**
   * Compute approximate price change % over last N closed candles.
   */
  getPriceChangePercent(symbol: string, interval: string, periods = 5): number {
    const candles = this.getHistory(symbol, interval, periods);
    if (candles.length < 2) return 0;
    const first = candles[0].open;
    const last  = candles[candles.length - 1].close;
    if (first === 0) return 0;
    return ((last - first) / first) * 100;
  }

  /** How many symbol/interval pairs are being tracked. */
  get size(): number {
    return this.state.size;
  }

  // ── Private ───────────────────────────────────────────────

  private getOrCreate(key: string): CandleState {
    if (!this.state.has(key)) {
      this.state.set(key, { history: [], current: null, maxHistory: this.maxHistory });
    }
    return this.state.get(key)!;
  }
}
