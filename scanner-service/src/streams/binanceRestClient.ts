// ============================================================
// BINANCE REST CLIENT
// Fetches initial market data snapshots on startup so the
// scanner has seed data before WebSocket streams connect.
// Also used to validate symbol lists against the exchange.
// ============================================================

import { NormalizedTicker, NormalizedKline } from '../types';
import { createLogger } from '../../../../shared/src/utils';

const logger = createLogger('binance-rest');

const BASE = 'https://api.binance.com/api/v3';
const TIMEOUT_MS = 10_000;

async function fetchJSON<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

function p(v: string | number): number {
  const n = parseFloat(String(v));
  return isFinite(n) ? n : 0;
}

// ── Public API ────────────────────────────────────────────────

export const binanceRest = {
  /**
   * Fetch 24hr ticker for all symbols or a specific symbol.
   * Returns normalized tickers ready for the cache layer.
   */
  async getTickers(symbols?: string[]): Promise<NormalizedTicker[]> {
    try {
      let data: any[];

      if (symbols && symbols.length === 1) {
        const raw = await fetchJSON<any>(`/ticker/24hr?symbol=${symbols[0]}`);
        data = [raw];
      } else {
        data = await fetchJSON<any[]>('/ticker/24hr');
        if (symbols) {
          const set = new Set(symbols);
          data = data.filter((d: any) => set.has(d.symbol));
        }
      }

      return data.map((raw: any): NormalizedTicker => ({
        symbol:                raw.symbol,
        price:                 p(raw.lastPrice),
        priceChange24h:        p(raw.priceChange),
        priceChangePercent24h: p(raw.priceChangePercent),
        weightedAvgPrice:      p(raw.weightedAvgPrice),
        volume24h:             p(raw.volume),
        quoteVolume24h:        p(raw.quoteVolume),
        high24h:               p(raw.highPrice),
        low24h:                p(raw.lowPrice),
        openPrice:             p(raw.openPrice),
        tradeCount:            raw.count ?? 0,
        openTime:              raw.openTime,
        closeTime:             raw.closeTime,
        timestamp:             Date.now(),
      }));
    } catch (err) {
      logger.error('Failed to fetch tickers from REST', { error: (err as Error).message });
      return [];
    }
  },

  /**
   * Fetch historical klines (OHLCV candles).
   * Used on startup to pre-populate the candle aggregator.
   */
  async getKlines(
    symbol:   string,
    interval: string,
    limit:    number = 100,
  ): Promise<NormalizedKline[]> {
    try {
      const data = await fetchJSON<any[]>(
        `/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      );

      return data.map((k: any): NormalizedKline => ({
        symbol,
        interval,
        openTime:              k[0],
        open:                  p(k[1]),
        high:                  p(k[2]),
        low:                   p(k[3]),
        close:                 p(k[4]),
        volume:                p(k[5]),
        closeTime:             k[6],
        quoteVolume:           p(k[7]),
        tradeCount:            k[8],
        takerBuyBaseVolume:    p(k[9]),
        takerBuyQuoteVolume:   p(k[10]),
        isClosed:              true,
      }));
    } catch (err) {
      logger.error('Failed to fetch klines from REST', {
        symbol, interval, error: (err as Error).message,
      });
      return [];
    }
  },

  /**
   * Validate which symbols actually exist on Binance and are trading.
   * Returns the filtered list of valid USDT pairs.
   */
  async validateSymbols(symbols: string[]): Promise<string[]> {
    try {
      const info = await fetchJSON<any>('/exchangeInfo');
      const tradingSymbols = new Set<string>(
        info.symbols
          .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
          .map((s: any) => s.symbol),
      );

      const valid   = symbols.filter((s) => tradingSymbols.has(s));
      const invalid = symbols.filter((s) => !tradingSymbols.has(s));

      if (invalid.length > 0) {
        logger.warn('Removed invalid/non-trading symbols', { invalid });
      }

      logger.info('Symbol validation complete', {
        requested: symbols.length,
        valid: valid.length,
      });

      return valid;
    } catch (err) {
      logger.error('Symbol validation failed — using all requested symbols', {
        error: (err as Error).message,
      });
      return symbols; // Fallback: trust the config
    }
  },

  /**
   * Fetch current best bid/ask for a symbol.
   */
  async getBookTicker(symbol: string): Promise<{
    bidPrice: number;
    askPrice: number;
    spread: number;
  } | null> {
    try {
      const data = await fetchJSON<any>(`/ticker/bookTicker?symbol=${symbol}`);
      const bid  = p(data.bidPrice);
      const ask  = p(data.askPrice);
      return { bidPrice: bid, askPrice: ask, spread: ask - bid };
    } catch {
      return null;
    }
  },
};
