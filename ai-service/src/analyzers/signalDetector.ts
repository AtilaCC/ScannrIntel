// ============================================================
// SIGNAL DETECTOR
// Analyzes incoming tickers and generates signals when
// anomalies are detected (volume spikes, price movements)
// ============================================================

import { createLogger } from '../utils/shared';

const logger = createLogger('signal-detector');

interface Ticker {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  quoteVolume: number;
  high: number;
  low: number;
  timestamp: number;
}

interface Signal {
  id: string;
  symbol: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  price: number;
  priceChangePercent: number;
  volume: number;
  metadata: Record<string, any>;
  timestamp: number;
}

export class SignalDetector {
  private volumeHistory = new Map<string, number[]>();
  private priceHistory = new Map<string, number[]>();
  private lastSignal = new Map<string, number>();
  private readonly SIGNAL_COOLDOWN_MS = 10 * 60 * 1000; // 10 min per symbol

  detect(ticker: Ticker): Signal | null {
    const now = Date.now();
    const lastSig = this.lastSignal.get(ticker.symbol) || 0;

    // Cooldown to avoid signal spam
    if (now - lastSig < this.SIGNAL_COOLDOWN_MS) return null;

    // Update history
    const volumes = this.volumeHistory.get(ticker.symbol) || [];
    const prices = this.priceHistory.get(ticker.symbol) || [];

    volumes.push(ticker.volume);
    prices.push(ticker.price);

    if (volumes.length > 20) volumes.shift();
    if (prices.length > 20) prices.shift();

    this.volumeHistory.set(ticker.symbol, volumes);
    this.priceHistory.set(ticker.symbol, prices);

    if (volumes.length < 3) return null;

    // Calculate averages
    const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
    const relativeVolume = avgVolume > 0 ? ticker.volume / avgVolume : 1;
    const priceChange = Math.abs(ticker.priceChangePercent);

    let signal: Signal | null = null;

    // CRITICAL: Extreme price movement + high volume
    if (priceChange > 5 && relativeVolume > 2) {
      signal = {
        id: `${ticker.symbol}-${now}`,
        symbol: ticker.symbol,
        type: ticker.priceChangePercent > 0 ? 'PUMP_DETECTED' : 'DUMP_DETECTED',
        severity: 'CRITICAL',
        price: ticker.price,
        priceChangePercent: ticker.priceChangePercent,
        volume: ticker.volume,
        metadata: { relativeVolume, avgVolume, high: ticker.high, low: ticker.low },
        timestamp: now,
      };
    }
    // HIGH: Strong price movement or volume spike
    else if (priceChange > 3 || relativeVolume > 3) {
      signal = {
        id: `${ticker.symbol}-${now}`,
        symbol: ticker.symbol,
        type: relativeVolume > 4 ? 'VOLUME_SPIKE' : ticker.priceChangePercent > 0 ? 'BULLISH_MOMENTUM' : 'BEARISH_MOMENTUM',
        severity: 'HIGH',
        price: ticker.price,
        priceChangePercent: ticker.priceChangePercent,
        volume: ticker.volume,
        metadata: { relativeVolume, avgVolume },
        timestamp: now,
      };
    }
    // MEDIUM: Notable movement
    else if (priceChange > 1.5 || relativeVolume > 1.8) {
      signal = {
        id: `${ticker.symbol}-${now}`,
        symbol: ticker.symbol,
        type: 'NOTABLE_MOVEMENT',
        severity: 'MEDIUM',
        price: ticker.price,
        priceChangePercent: ticker.priceChangePercent,
        volume: ticker.volume,
        metadata: { relativeVolume, avgVolume },
        timestamp: now,
      };
    }

    if (signal) {
      this.lastSignal.set(ticker.symbol, now);
      logger.info(`Signal detected: ${signal.type} on ${signal.symbol}`, {
        severity: signal.severity,
        priceChange: signal.priceChangePercent,
        relativeVolume,
      });
    }

    return signal;
  }
}
