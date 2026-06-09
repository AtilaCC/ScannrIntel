// ============================================================
// HEALTH SERVER
// Exposes HTTP endpoints for container health checks,
// load balancer probes, and ops dashboards.
//
// GET /health          → liveness + readiness probe
// GET /metrics         → full scanner metrics JSON
// GET /symbols         → list of tracked symbols + last price
// GET /symbols/:symbol → single symbol snapshot
// GET /streams         → WebSocket connection health
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BinanceStreamManager } from '../streams/binanceStreamManager';
import { MetricsCollector } from '../metrics/metricsCollector';
import { SymbolCache } from '../cache/symbolCache';
import { CandleAggregator } from '../aggregators/candleAggregator';
import { createLogger } from '../utils/constants';

const logger = createLogger('health-server');

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Cache-Control': 'no-cache',
  });
  res.end(payload);
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: 'Not found' });
}

export function createHealthServer(
  port:          number,
  streamManager: BinanceStreamManager,
  metrics:       MetricsCollector,
  cache:         SymbolCache,
  candles:       CandleAggregator,
  symbols:       string[],
) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url?.split('?')[0] ?? '/';

    // ── GET /health ─────────────────────────────────────────
    if (url === '/health' && req.method === 'GET') {
      const connected = streamManager.connectedCount;
      const total     = streamManager.totalConnections;
      const isReady   = connected > 0;

      json(res, isReady ? 200 : 503, {
        status:    isReady ? 'ok' : 'degraded',
        service:   'scanner-service',
        version:   '1.0.0',
        ready:     isReady,
        streams:   { connected, total },
        symbols:   symbols.length,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── GET /metrics ────────────────────────────────────────
    if (url === '/metrics' && req.method === 'GET') {
      const snapshot = metrics.snapshot(
        streamManager.connectedCount,
        streamManager.totalConnections,
        symbols.length,
      );
      json(res, 200, {
        ...snapshot,
        uptimeSeconds: Math.floor(snapshot.uptime / 1000),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── GET /streams ────────────────────────────────────────
    if (url === '/streams' && req.method === 'GET') {
      json(res, 200, {
        streams: streamManager.getAllHealth(),
        summary: {
          total:      streamManager.totalConnections,
          connected:  streamManager.connectedCount,
          degraded:   streamManager.totalConnections - streamManager.connectedCount,
        },
      });
      return;
    }

    // ── GET /symbols ─────────────────────────────────────────
    if (url === '/symbols' && req.method === 'GET') {
      const tickers = cache.getAllTickers();
      json(res, 200, {
        count: tickers.length,
        symbols: tickers.map((t) => ({
          symbol:                t.symbol,
          price:                 t.price,
          priceChangePercent24h: t.priceChangePercent24h,
          quoteVolume24h:        t.quoteVolume24h,
          lastUpdated:           new Date(t.timestamp).toISOString(),
        })),
      });
      return;
    }

    // ── GET /symbols/:symbol ──────────────────────────────────
    const symbolMatch = url.match(/^\/symbols\/([A-Z0-9]+)$/i);
    if (symbolMatch && req.method === 'GET') {
      const symbol  = symbolMatch[1].toUpperCase();
      const ticker  = cache.getLastTicker(symbol);
      const book    = cache.getLastBook(symbol);
      const symMetrics = metrics.getSymbol(symbol);

      if (!ticker) {
        json(res, 404, { error: `Symbol ${symbol} not found or not yet received` });
        return;
      }

      // Get candles for all intervals
      const candleData = candles.getSymbolCandles(symbol);

      json(res, 200, {
        symbol,
        ticker,
        book,
        candles:  Object.fromEntries(
          Object.entries(candleData).map(([interval, data]) => [
            interval,
            {
              current: data.current,
              history: data.history.slice(-20), // last 20 candles per interval
            },
          ]),
        ),
        metrics: symMetrics,
      });
      return;
    }

    notFound(res);
  });

  server.listen(port, () => {
    logger.info(`Health server listening on port ${port}`);
  });

  server.on('error', (err) => {
    logger.error('Health server error', { error: err.message });
  });

  return server;
}
