export interface NormalizedMarketData {
  symbol: string; price: number; priceChangePercent: number;
  volume: number; high: number; low: number; timestamp: number;
}
export interface Signal {
  id: string; symbol: string; type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  price: number; priceChangePercent: number; volume: number;
  metadata: Record<string, any>; timestamp: number;
}
export class PriceMovementDetector {
  private history = new Map<string, number[]>();
  private lastSignal = new Map<string, number>();
  private readonly COOLDOWN_MS = 5 * 60 * 1000;
  async detect(data: NormalizedMarketData): Promise<Signal[]> {
    const now = Date.now();
    if (now - (this.lastSignal.get(data.symbol) || 0) < this.COOLDOWN_MS) return [];
    const history = this.history.get(data.symbol) || [];
    history.push(data.volume);
    if (history.length > 20) history.shift();
    this.history.set(data.symbol, history);
    if (history.length < 5) return [];
    const avgVolume = history.slice(0, -1).reduce((a, b) => a + b, 0) / (history.length - 1);
    const relVol = avgVolume > 0 ? data.volume / avgVolume : 1;
    const priceChange = Math.abs(data.priceChangePercent);
    let severity: Signal['severity'] | null = null;
    let type = '';
    if (priceChange > 5 && relVol > 2) { severity = 'CRITICAL'; type = data.priceChangePercent > 0 ? 'PUMP_DETECTED' : 'DUMP_DETECTED'; }
    else if (priceChange > 3 || relVol > 3) { severity = 'HIGH'; type = relVol > 3 ? 'VOLUME_SPIKE' : 'STRONG_MOVEMENT'; }
    else if (priceChange > 1.5 || relVol > 1.8) { severity = 'MEDIUM'; type = 'NOTABLE_MOVEMENT'; }
    if (severity && type) {
      this.lastSignal.set(data.symbol, now);
      return [{ id: `${data.symbol}-${now}`, symbol: data.symbol, type, severity, price: data.price, priceChangePercent: data.priceChangePercent, volume: data.volume, metadata: { relativeVolume: relVol }, timestamp: now }];
    }
    return [];
  }
}
