// ============================================================
// WHALE DETECTOR — Detects large trades and accumulation
// ============================================================

import { DetectedSignal, NormalizedMarketData } from '../../../shared/src/types';
import { THRESHOLDS } from '../../../shared/src/constants';
import { generateId } from '../../../shared/src/utils';

interface TradeEvent {
  symbol: string;
  price: number;
  quantity: number;
  tradeUSD: number;
  isBuyerMaker: boolean;
  timestamp: number;
}

// Track recent trades per symbol for accumulation detection
const recentTrades = new Map<string, TradeEvent[]>();

export class WhaleDetector {
  async detect(_data: NormalizedMarketData): Promise<DetectedSignal[]> {
    // Ticker-level whale detection: if volume is massive relative to price
    return [];
  }

  async detectTrade(trade: TradeEvent): Promise<DetectedSignal[]> {
    const signals: DetectedSignal[] = [];

    // ── Single whale trade ────────────────────────────────
    if (trade.tradeUSD >= THRESHOLDS.WHALE_TRADE_USD) {
      const severity =
        trade.tradeUSD >= 10_000_000 ? 'CRITICAL' :
        trade.tradeUSD >= 1_000_000 ? 'HIGH' :
        trade.tradeUSD >= 500_000 ? 'MEDIUM' : 'LOW';

      signals.push({
        id: generateId(),
        symbol: trade.symbol,
        type: 'WHALE_TRADE',
        severity,
        data: {
          tradeUSD: trade.tradeUSD,
          price: trade.price,
          quantity: trade.quantity,
          direction: trade.isBuyerMaker ? 'SELL' : 'BUY',
        },
        timestamp: trade.timestamp,
        metadata: {
          price: trade.price,
          volume: trade.tradeUSD,
          priceChange: 0,
          tradeSize: trade.tradeUSD,
        },
      });
    }

    // ── Accumulation pattern (multiple large buys in window) ──
    this.trackTrade(trade);
    const accumulation = this.detectAccumulation(trade.symbol);
    if (accumulation) signals.push(accumulation);

    return signals;
  }

  private trackTrade(trade: TradeEvent): void {
    const windowMs = THRESHOLDS.ACCUMULATION_WINDOW_MS;
    const cutoff = Date.now() - windowMs;

    const trades = recentTrades.get(trade.symbol) || [];
    const fresh = trades.filter((t) => t.timestamp > cutoff);
    fresh.push(trade);
    recentTrades.set(trade.symbol, fresh.slice(-500)); // keep last 500
  }

  private detectAccumulation(symbol: string): DetectedSignal | null {
    const trades = recentTrades.get(symbol) || [];
    const windowMs = THRESHOLDS.ACCUMULATION_WINDOW_MS;
    const cutoff = Date.now() - windowMs;
    const recent = trades.filter((t) => t.timestamp > cutoff && !t.isBuyerMaker);

    // More than 5 large buy trades in 5 minutes
    const largeBuys = recent.filter((t) => t.tradeUSD >= 50_000);
    if (largeBuys.length < 5) return null;

    const totalUSD = largeBuys.reduce((sum, t) => sum + t.tradeUSD, 0);
    if (totalUSD < 500_000) return null;

    return {
      id: generateId(),
      symbol,
      type: 'ACCUMULATION_PATTERN',
      severity: totalUSD >= 5_000_000 ? 'HIGH' : 'MEDIUM',
      data: { largeBuyCount: largeBuys.length, totalUSD },
      timestamp: Date.now(),
      metadata: {
        price: largeBuys[largeBuys.length - 1]?.price || 0,
        volume: totalUSD,
        priceChange: 0,
      },
    };
  }
}
