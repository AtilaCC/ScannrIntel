// ============================================================
// VOLUME SPIKE DETECTOR
// ============================================================

import { DetectedSignal, NormalizedMarketData } from '../../../shared/src/types';
import { THRESHOLDS } from '../../../shared/src/constants';
import { generateId } from '../../../shared/src/utils';

// Rolling volume history per symbol
const volumeHistory = new Map<string, number[]>();

export class VolumeSpikeDetector {
  async detect(data: NormalizedMarketData): Promise<DetectedSignal[]> {
    const signals: DetectedSignal[] = [];

    const history = volumeHistory.get(data.symbol) || [];
    history.push(data.quoteVolume24h);

    // Keep last N candles
    if (history.length > THRESHOLDS.VOLUME_WINDOW_CANDLES + 1) {
      history.shift();
    }
    volumeHistory.set(data.symbol, history);

    if (history.length < 5) return signals; // Not enough data yet

    // Calculate average of all except the latest
    const baseline = history.slice(0, -1);
    const avg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const current = data.quoteVolume24h;

    if (avg === 0) return signals;

    const multiplier = current / avg;

    if (multiplier >= THRESHOLDS.VOLUME_SPIKE_MULTIPLIER) {
      const severity =
        multiplier >= 10 ? 'CRITICAL' :
        multiplier >= 6 ? 'HIGH' :
        multiplier >= 4 ? 'MEDIUM' : 'LOW';

      signals.push({
        id: generateId(),
        symbol: data.symbol,
        type: 'VOLUME_SPIKE',
        severity,
        data: { multiplier: parseFloat(multiplier.toFixed(2)), avgVolume: avg, currentVolume: current },
        timestamp: data.timestamp,
        metadata: {
          price: data.price,
          volume: current,
          priceChange: data.priceChangePercent24h,
          volumeChange: multiplier,
        },
      });
    }

    return signals;
  }
}

// ============================================================
// PRICE MOVEMENT DETECTOR
// ============================================================

// Short-window price history (5-minute ticks)
const priceHistory = new Map<string, { price: number; ts: number }[]>();
const PRICE_WINDOW_MS = 5 * 60_000;

export class PriceMovementDetector {
  async detect(data: NormalizedMarketData): Promise<DetectedSignal[]> {
    const signals: DetectedSignal[] = [];

    const history = priceHistory.get(data.symbol) || [];
    history.push({ price: data.price, ts: data.timestamp });

    // Keep only last 5 minutes
    const cutoff = data.timestamp - PRICE_WINDOW_MS;
    const fresh = history.filter((h) => h.ts > cutoff);
    priceHistory.set(data.symbol, fresh);

    if (fresh.length < 3) return signals;

    const oldest = fresh[0].price;
    const newest = data.price;
    if (oldest === 0) return signals;

    const changePercent = ((newest - oldest) / oldest) * 100;

    // Price surge
    if (changePercent >= THRESHOLDS.PRICE_SURGE_PERCENT) {
      signals.push({
        id: generateId(),
        symbol: data.symbol,
        type: 'PRICE_SURGE',
        severity: changePercent >= 20 ? 'CRITICAL' : changePercent >= 10 ? 'HIGH' : 'MEDIUM',
        data: { changePercent: parseFloat(changePercent.toFixed(2)), fromPrice: oldest, toPrice: newest, windowMs: PRICE_WINDOW_MS },
        timestamp: data.timestamp,
        metadata: { price: data.price, volume: data.quoteVolume24h, priceChange: changePercent },
      });
    }

    // Price crash
    if (changePercent <= THRESHOLDS.PRICE_CRASH_PERCENT) {
      signals.push({
        id: generateId(),
        symbol: data.symbol,
        type: 'PRICE_CRASH',
        severity: changePercent <= -20 ? 'CRITICAL' : changePercent <= -10 ? 'HIGH' : 'MEDIUM',
        data: { changePercent: parseFloat(changePercent.toFixed(2)), fromPrice: oldest, toPrice: newest, windowMs: PRICE_WINDOW_MS },
        timestamp: data.timestamp,
        metadata: { price: data.price, volume: data.quoteVolume24h, priceChange: changePercent },
      });
    }

    // 24h signals from ticker
    if (data.priceChangePercent24h >= 15) {
      signals.push({
        id: generateId(),
        symbol: data.symbol,
        type: 'PRICE_SURGE',
        severity: data.priceChangePercent24h >= 50 ? 'CRITICAL' : 'HIGH',
        data: { changePercent24h: data.priceChangePercent24h },
        timestamp: data.timestamp,
        metadata: { price: data.price, volume: data.quoteVolume24h, priceChange: data.priceChangePercent24h },
      });
    }

    return signals;
  }
}
