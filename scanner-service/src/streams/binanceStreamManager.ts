// ============================================================
// BINANCE STREAM MANAGER
// Manages multiple combined WebSocket connections to Binance.
// Each connection handles a batch of symbols and subscribes to
// ticker + trade + (optionally) kline + bookTicker streams.
//
// Features:
//   - Combined stream batching (up to 50 symbols / connection)
//   - Per-connection ReconnectManager with circuit breaker
//   - Heartbeat / ping-pong monitoring
//   - Per-connection health tracking
//   - Graceful stop with drain
// ============================================================

import WebSocket from 'ws';
import { ReconnectManager } from '../reconnect/reconnectManager';
import { MarketDataNormalizer } from '../normalizers/marketDataNormalizer';
import { MetricsCollector } from '../metrics/metricsCollector';
import { SymbolCache } from '../cache/symbolCache';
import { CandleAggregator } from '../aggregators/candleAggregator';
import {
  StreamHealth,
  StreamStatus,
  NormalizedTicker,
  NormalizedTrade,
  NormalizedKline,
  NormalizedBookTicker,
  ScannerConfig,
} from '../types';
import { createLogger } from '../utils/constants';

const logger = createLogger('stream-manager');

const BINANCE_WS = process.env.BINANCE_WS_URL || 'wss://stream.binance.us:9443/stream';

// ── Per-connection state ──────────────────────────────────────

interface Connection {
  key:         string;
  symbols:     string[];
  url:         string;
  ws:          WebSocket | null;
  reconnect:   ReconnectManager;
  health:      StreamHealth;
  heartbeat:   NodeJS.Timeout | null;
}

// ── Callbacks injected by index.ts ───────────────────────────

export interface StreamCallbacks {
  onTicker:     (data: NormalizedTicker)    => Promise<void>;
  onTrade:      (data: NormalizedTrade)     => Promise<void>;
  onKline:      (data: NormalizedKline)     => Promise<void>;
  onBookTicker: (data: NormalizedBookTicker) => Promise<void>;
}

// ── Manager ───────────────────────────────────────────────────

export class BinanceStreamManager {
  private connections: Map<string, Connection> = new Map();
  private normalizer:  MarketDataNormalizer;
  private stopped:     boolean = false;

  constructor(
    private readonly config:    ScannerConfig,
    private readonly callbacks: StreamCallbacks,
    private readonly metrics:   MetricsCollector,
    private readonly cache:     SymbolCache,
    private readonly candles:   CandleAggregator,
  ) {
    this.normalizer = new MarketDataNormalizer();
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async start(): Promise<void> {
    this.stopped = false;
    const { symbols, batchSize } = this.config;

    logger.info('Starting stream manager', {
      symbols:    symbols.length,
      batchSize,
      klines:     this.config.enableKlineStreams,
      bookTicker: this.config.enableBookTickerStreams,
    });

    // Split symbols into batches
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const key   = `batch_${Math.floor(i / batchSize)}`;
      this.createConnection(key, batch);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    logger.info('Stopping all streams...');

    this.connections.forEach((conn) => {
      conn.reconnect.stop();
      if (conn.heartbeat) clearInterval(conn.heartbeat);
      conn.ws?.terminate();
      conn.health.status = 'STOPPED';
    });

    this.connections.clear();
    logger.info('All streams stopped');
  }

  // ── Health / metrics access ───────────────────────────────

  get connectedCount(): number {
    return Array.from(this.connections.values())
      .filter((c) => c.health.status === 'CONNECTED').length;
  }

  get totalConnections(): number {
    return this.connections.size;
  }

  getAllHealth(): StreamHealth[] {
    return Array.from(this.connections.values()).map((c) => c.health);
  }

  // ── Connection management ─────────────────────────────────

  private createConnection(key: string, symbols: string[]): void {
    const url = this.buildUrl(symbols);

    const reconnect = new ReconnectManager(
      key,
      () => this.openWebSocket(conn),
      {
        baseDelayMs:  this.config.reconnectBaseDelayMs,
        maxDelayMs:   this.config.reconnectMaxDelayMs,
        maxAttempts:  this.config.reconnectMaxAttempts,
      },
    );

    const health: StreamHealth = {
      key,
      symbols,
      status:            'CONNECTING',
      connectedAt:       null,
      reconnectAttempts: 0,
      messagesReceived:  0,
      lastMessageAt:     null,
      errorCount:        0,
    };

    const conn: Connection = { key, symbols, url, ws: null, reconnect, health, heartbeat: null };
    this.connections.set(key, conn);

    reconnect.start();
    this.openWebSocket(conn);
  }

  private openWebSocket(conn: Connection): void {
    if (this.stopped) return;

    conn.health.status = 'CONNECTING';

    try {
      const ws = new WebSocket(conn.url, {
        handshakeTimeout:   12_000,
        perMessageDeflate:  false,
      });

      conn.ws = ws;

      ws.on('open',    ()      => this.onOpen(conn));
      ws.on('message', (data)  => this.onMessage(conn, data.toString()));
      ws.on('ping',    (data)  => ws.pong(data));
      ws.on('pong',    ()      => { /* heartbeat acknowledged */ });
      ws.on('close',   (code, reason) => this.onClose(conn, code, reason.toString()));
      ws.on('error',   (err)   => this.onError(conn, err));
    } catch (err) {
      logger.error(`[${conn.key}] Failed to open WebSocket`, { error: (err as Error).message });
      conn.reconnect.onFailure((err as Error).message);
    }
  }

  // ── WebSocket event handlers ──────────────────────────────

  private onOpen(conn: Connection): void {
    conn.health.status      = 'CONNECTED';
    conn.health.connectedAt = Date.now();
    conn.reconnect.onSuccess();

    logger.info(`[${conn.key}] Connected`, { symbols: conn.symbols.length });

    // Start heartbeat
    if (conn.heartbeat) clearInterval(conn.heartbeat);
    conn.heartbeat = setInterval(() => {
      if (conn.ws?.readyState === WebSocket.OPEN) {
        conn.ws.ping();
      }
    }, this.config.heartbeatIntervalMs);
  }

  private async onMessage(conn: Connection, raw: string): Promise<void> {
    conn.health.messagesReceived++;
    conn.health.lastMessageAt = Date.now();

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // ignore malformed JSON
    }

    // Combined stream wraps payload in { stream, data }
    const data       = parsed.data ?? parsed;
    const streamName = parsed.stream ?? '';
    const { type, payload } = this.normalizer.dispatch(data);

    if (!payload) return;

    try {
      switch (type) {
        case 'ticker': {
          const t = payload as NormalizedTicker;
          this.metrics.recordTicker(t.symbol, t.price);
          await this.cache.writeTicker(t);
          await this.callbacks.onTicker(t);
          break;
        }
        case 'trade': {
          const t = payload as NormalizedTrade;
          this.metrics.recordTrade(t.symbol, t.price);
          // Aggregate into local candles (fallback)
          for (const interval of this.config.klineIntervals) {
            this.candles.ingestTrade(t, interval);
          }
          await this.cache.writeTrade(t);
          await this.callbacks.onTrade(t);
          break;
        }
        case 'kline': {
          const k = payload as NormalizedKline;
          this.metrics.recordKline();
          this.candles.ingestKline(k);
          await this.callbacks.onKline(k);
          break;
        }
        case 'bookTicker': {
          const b = payload as NormalizedBookTicker;
          await this.cache.writeBookTicker(b);
          await this.callbacks.onBookTicker(b);
          break;
        }
      }
    } catch (err) {
      logger.error(`[${conn.key}] Callback error`, {
        type,
        error: (err as Error).message,
      });
    }
  }

  private onClose(conn: Connection, code: number, reason: string): void {
    conn.health.status = 'RECONNECTING';
    if (conn.heartbeat) { clearInterval(conn.heartbeat); conn.heartbeat = null; }

    logger.warn(`[${conn.key}] Closed`, { code, reason: reason || '(none)' });

    if (!this.stopped) {
      conn.health.reconnectAttempts++;
      conn.reconnect.onFailure(`close:${code}`);
    }
  }

  private onError(conn: Connection, err: Error): void {
    conn.health.errorCount++;
    logger.error(`[${conn.key}] Error`, { error: err.message });
    conn.ws?.terminate();
    // onClose will fire next and handle reconnect
  }

  // ── URL builder ───────────────────────────────────────────

  private buildUrl(symbols: string[]): string {
    const streams: string[] = [];

    for (const s of symbols) {
      const sym = s.toLowerCase();
      streams.push(`${sym}@ticker`);
      streams.push(`${sym}@trade`);
      if (this.config.enableKlineStreams) {
        for (const interval of this.config.klineIntervals) {
          streams.push(`${sym}@kline_${interval}`);
        }
      }
      if (this.config.enableBookTickerStreams) {
        streams.push(`${sym}@bookTicker`);
      }
    }

    return `${BINANCE_WS}?streams=${streams.join('/')}`;
  }
}
