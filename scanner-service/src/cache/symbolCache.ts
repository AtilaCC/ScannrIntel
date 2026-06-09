// ============================================================
// SYMBOL CACHE
// Writes live market data snapshots to Redis so the backend
// API can serve them without subscribing to WS streams.
//
// Throttles writes per-symbol to avoid flooding Redis at the
// rate of incoming trade events (can be 1000s/sec on BTC).
// ============================================================

import Redis from 'ioredis';
import { NormalizedTicker, NormalizedBookTicker, NormalizedTrade } from '../types';
import { REDIS_CHANNELS } from '../utils/constants';
import { createLogger } from '../utils/constants';

const logger = createLogger('symbol-cache');

export class SymbolCache {
  // Throttle: last publish time per symbol for ticker/trade
  private lastTickerPublish: Map<string, number> = new Map();
  private lastTradePublish:  Map<string, number> = new Map();

  // Last known values — used to detect meaningful changes
  private lastTicker: Map<string, NormalizedTicker>    = new Map();
  private lastBook:   Map<string, NormalizedBookTicker> = new Map();

  constructor(
    private readonly redis:          Redis,
    private readonly ttlSeconds:     number = 60,
    private readonly throttleMs:     number = 100,   // max 10 ticker publishes/sec per symbol
    private readonly tradeThrottleMs:number = 50,    // max 20 trade publishes/sec per symbol
  ) {}

  // ── Ticker ────────────────────────────────────────────────

  async writeTicker(ticker: NormalizedTicker): Promise<void> {
    const now  = Date.now();
    const last = this.lastTickerPublish.get(ticker.symbol) ?? 0;

    if (now - last < this.throttleMs) return; // throttle
    this.lastTickerPublish.set(ticker.symbol, now);
    this.lastTicker.set(ticker.symbol, ticker);

    const key     = `market:ticker:${ticker.symbol}`;
    const payload = JSON.stringify(ticker);

    try {
      await Promise.all([
        // Write snapshot for REST API consumption
        this.redis.setex(key, this.ttlSeconds, payload),

        // Publish for real-time WS clients
        this.redis.publish(
          REDIS_CHANNELS.MARKET_DATA,
          JSON.stringify({ type: 'ticker', payload: ticker, timestamp: now }),
        ),
      ]);
    } catch (err) {
      logger.error('Redis ticker write failed', {
        symbol: ticker.symbol,
        error: (err as Error).message,
      });
    }
  }

  // ── Trade ─────────────────────────────────────────────────

  async writeTrade(trade: NormalizedTrade): Promise<void> {
    const now  = Date.now();
    const last = this.lastTradePublish.get(trade.symbol) ?? 0;

    if (now - last < this.tradeThrottleMs) return; // throttle
    this.lastTradePublish.set(trade.symbol, now);

    // Update last price in ticker cache
    const existing = this.lastTicker.get(trade.symbol);
    if (existing) {
      existing.price = trade.price;
      await this.redis.setex(
        `market:ticker:${trade.symbol}`,
        this.ttlSeconds,
        JSON.stringify(existing),
      ).catch(() => {});
    }

    try {
      await this.redis.publish(
        REDIS_CHANNELS.MARKET_DATA,
        JSON.stringify({ type: 'trade', payload: trade, timestamp: now }),
      );
    } catch (err) {
      logger.error('Redis trade publish failed', { error: (err as Error).message });
    }
  }

  // ── Book ticker ───────────────────────────────────────────

  async writeBookTicker(book: NormalizedBookTicker): Promise<void> {
    const prev = this.lastBook.get(book.symbol);

    // Only publish if spread changed meaningfully (> 0.01%)
    if (prev && Math.abs(book.spreadPercent - prev.spreadPercent) < 0.01) return;
    this.lastBook.set(book.symbol, book);

    try {
      await Promise.all([
        this.redis.setex(
          `market:book:${book.symbol}`,
          this.ttlSeconds,
          JSON.stringify(book),
        ),
        this.redis.publish(
          REDIS_CHANNELS.MARKET_DATA,
          JSON.stringify({ type: 'book', payload: book, timestamp: Date.now() }),
        ),
      ]);
    } catch (err) {
      logger.error('Redis book write failed', { error: (err as Error).message });
    }
  }

  // ── Batch snapshot (called periodically) ─────────────────

  async writeAllSnapshots(): Promise<void> {
    const pipeline = this.redis.pipeline();
    let count = 0;

    this.lastTicker.forEach((ticker, symbol) => {
      pipeline.setex(`market:ticker:${symbol}`, this.ttlSeconds, JSON.stringify(ticker));
      count++;
    });

    this.lastBook.forEach((book, symbol) => {
      pipeline.setex(`market:book:${symbol}`, this.ttlSeconds, JSON.stringify(book));
    });

    if (count > 0) {
      await pipeline.exec().catch((err) =>
        logger.error('Snapshot batch write failed', { error: (err as Error).message }),
      );
    }
  }

  // ── Read helpers (for health/metrics endpoints) ───────────

  getLastTicker(symbol: string): NormalizedTicker | null {
    return this.lastTicker.get(symbol) ?? null;
  }

  getLastBook(symbol: string): NormalizedBookTicker | null {
    return this.lastBook.get(symbol) ?? null;
  }

  getAllTickers(): NormalizedTicker[] {
    return Array.from(this.lastTicker.values());
  }

  get trackedSymbols(): string[] {
    return Array.from(this.lastTicker.keys());
  }
}
