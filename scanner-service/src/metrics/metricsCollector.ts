// ============================================================
// METRICS COLLECTOR
// Tracks scanner health and throughput metrics.
// Exposed via the /metrics HTTP endpoint and written to Redis.
// ============================================================

import { ScannerMetrics, SymbolMetrics } from '../types';

export class MetricsCollector {
  private startedAt:             number = Date.now();
  private totalMessages:         number = 0;
  private totalTrades:           number = 0;
  private totalTickers:          number = 0;
  private totalKlines:           number = 0;
  private redisPublishErrors:    number = 0;
  private lastTickAt:            number | null = null;
  private symbolStats:           Map<string, SymbolMetrics> = new Map();

  // For messages-per-second calculation
  private msgCountWindow:        number[] = [];   // timestamps of recent messages
  private readonly windowSizeMs: number = 5_000;  // 5-second rolling window

  // ── Record events ─────────────────────────────────────────

  recordTicker(symbol: string, price: number): void {
    this.totalMessages++;
    this.totalTickers++;
    this.lastTickAt = Date.now();
    this.msgCountWindow.push(Date.now());
    this.pruneWindow();

    const s = this.getOrCreateSymbol(symbol);
    s.tickersReceived++;
    s.lastPrice    = price;
    s.lastTickerAt = Date.now();
  }

  recordTrade(symbol: string, price: number): void {
    this.totalMessages++;
    this.totalTrades++;
    this.msgCountWindow.push(Date.now());
    this.pruneWindow();

    const s = this.getOrCreateSymbol(symbol);
    s.tradesReceived++;
    s.lastPrice   = price;
    s.lastTradeAt = Date.now();
  }

  recordKline(): void {
    this.totalMessages++;
    this.totalKlines++;
  }

  recordRedisError(): void {
    this.redisPublishErrors++;
  }

  // ── Snapshot ──────────────────────────────────────────────

  snapshot(connectedStreams: number, totalStreams: number, totalSymbols: number): ScannerMetrics {
    return {
      uptime:                Date.now() - this.startedAt,
      totalSymbols,
      connectedStreams,
      totalStreams,
      messagesPerSecond:     this.computeMps(),
      totalMessagesReceived: this.totalMessages,
      totalTradesReceived:   this.totalTrades,
      totalTickersReceived:  this.totalTickers,
      redisPublishErrors:    this.redisPublishErrors,
      lastTickAt:            this.lastTickAt,
      symbolMetrics:         Object.fromEntries(this.symbolStats),
    };
  }

  // ── Per-symbol access ─────────────────────────────────────

  getSymbol(symbol: string): SymbolMetrics | undefined {
    return this.symbolStats.get(symbol);
  }

  getAllSymbols(): SymbolMetrics[] {
    return Array.from(this.symbolStats.values());
  }

  // ── Private ───────────────────────────────────────────────

  private getOrCreateSymbol(symbol: string): SymbolMetrics {
    if (!this.symbolStats.has(symbol)) {
      this.symbolStats.set(symbol, {
        symbol,
        tradesReceived: 0,
        tickersReceived: 0,
        lastPrice: 0,
        lastTradeAt: null,
        lastTickerAt: null,
      });
    }
    return this.symbolStats.get(symbol)!;
  }

  private computeMps(): number {
    this.pruneWindow();
    const count = this.msgCountWindow.length;
    return parseFloat((count / (this.windowSizeMs / 1000)).toFixed(2));
  }

  private pruneWindow(): void {
    const cutoff = Date.now() - this.windowSizeMs;
    while (this.msgCountWindow.length > 0 && this.msgCountWindow[0] < cutoff) {
      this.msgCountWindow.shift();
    }
  }
}
