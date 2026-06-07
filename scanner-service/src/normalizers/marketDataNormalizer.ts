// ============================================================
// MARKET DATA NORMALIZER
// Converts raw Binance wire-format messages → typed internal
// structs. All parsing and coercion lives here so the rest of
// the service works with clean number types.
// ============================================================

import {
  BinanceRawTicker,
  BinanceRawTrade,
  BinanceRawKline,
  BinanceRawBookTicker,
  NormalizedTicker,
  NormalizedTrade,
  NormalizedKline,
  NormalizedBookTicker,
} from '../types';

// ── Helpers ───────────────────────────────────────────────────

function p(v: string | number | undefined): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : 0;
}

// ── Normalizer class ─────────────────────────────────────────

export class MarketDataNormalizer {

  ticker(raw: BinanceRawTicker): NormalizedTicker {
    const price        = p(raw.c);
    const priceChange  = p(raw.p);
    const pricePct     = p(raw.P);
    const openPrice    = p(raw.o);

    return {
      symbol:                raw.s,
      price,
      priceChange24h:        priceChange,
      priceChangePercent24h: pricePct,
      weightedAvgPrice:      p(raw.w),
      volume24h:             p(raw.v),
      quoteVolume24h:        p(raw.q),
      high24h:               p(raw.h),
      low24h:                p(raw.l),
      openPrice,
      tradeCount:            raw.n ?? 0,
      openTime:              raw.O,
      closeTime:             raw.C,
      timestamp:             raw.E,
    };
  }

  trade(raw: BinanceRawTrade): NormalizedTrade {
    const price    = p(raw.p);
    const quantity = p(raw.q);

    return {
      symbol:        raw.s,
      tradeId:       raw.t,
      price,
      quantity,
      quoteQty:      price * quantity,
      isBuyerMaker:  raw.m,
      timestamp:     raw.T,
      eventTime:     raw.E,
    };
  }

  kline(raw: BinanceRawKline): NormalizedKline {
    const k = raw.k;
    return {
      symbol:                raw.s,
      interval:              k.i,
      openTime:              k.t,
      closeTime:             k.T,
      open:                  p(k.o),
      high:                  p(k.h),
      low:                   p(k.l),
      close:                 p(k.c),
      volume:                p(k.v),
      quoteVolume:           p(k.q),
      tradeCount:            k.n,
      takerBuyBaseVolume:    p(k.V),
      takerBuyQuoteVolume:   p(k.Q),
      isClosed:              k.x,
    };
  }

  bookTicker(raw: BinanceRawBookTicker): NormalizedBookTicker {
    const bid     = p(raw.b);
    const ask     = p(raw.a);
    const mid     = (bid + ask) / 2;
    const spread  = ask - bid;

    return {
      symbol:        raw.s,
      bidPrice:      bid,
      bidQty:        p(raw.B),
      askPrice:      ask,
      askQty:        p(raw.A),
      spread,
      spreadPercent: mid > 0 ? (spread / mid) * 100 : 0,
      midPrice:      mid,
      updateId:      raw.u,
      timestamp:     Date.now(),
    };
  }

  /**
   * Detect the event type from a raw Binance combined-stream message
   * and route to the correct normalizer.
   */
  dispatch(data: any): {
    type: 'ticker' | 'trade' | 'kline' | 'bookTicker' | 'unknown';
    payload: NormalizedTicker | NormalizedTrade | NormalizedKline | NormalizedBookTicker | null;
  } {
    const eventType = data?.e;

    if (eventType === '24hrTicker') {
      return { type: 'ticker',     payload: this.ticker(data) };
    }
    if (eventType === 'trade') {
      return { type: 'trade',      payload: this.trade(data) };
    }
    if (eventType === 'kline') {
      return { type: 'kline',      payload: this.kline(data) };
    }
    // bookTicker has no 'e' field — identify by presence of 'b' and 'a' keys
    if (data?.b !== undefined && data?.a !== undefined && data?.s) {
      return { type: 'bookTicker', payload: this.bookTicker(data) };
    }

    return { type: 'unknown', payload: null };
  }
}
