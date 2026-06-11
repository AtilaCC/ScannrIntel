// ============================================================
// SCANNER SERVICE — Production entry point
//
// Boot sequence:
//   1. Validate config
//   2. Connect Redis
//   3. Validate symbols against Binance exchange info
//   4. Pre-warm caches with REST snapshots + kline history
//   5. Start WebSocket stream manager
//   6. Start health / metrics HTTP server
//   7. Register signal handlers for graceful shutdown
// ============================================================

import { scannerConfig, env } from './config';
import { BinanceStreamManager } from './streams/binanceStreamManager';
import { RedisPublisher } from './streams/redisPublisher';
import { binanceRest } from './streams/binanceRestClient';
import { MarketDataNormalizer } from './normalizers/marketDataNormalizer';
import { MetricsCollector } from './metrics/metricsCollector';
import { SymbolCache } from './cache/symbolCache';
import { CandleAggregator } from './aggregators/candleAggregator';
import { createHealthServer } from './health/healthServer';
import {
  NormalizedTicker,
  NormalizedTrade,
  NormalizedKline,
  NormalizedBookTicker,
} from './types';
import { createLogger } from './utils/constants';
import { processMarketSnapshot } from './processors/signalProcessor';
import { fetchWhaleTransactions } from './processors/whaleAlert';
import { fetchCryptoNews } from './processors/newsProcessor';

const logger = createLogger('scanner-service');

// ── Global state ──────────────────────────────────────────────
let streamManager: BinanceStreamManager | null = null;
let redisPublisher: RedisPublisher | null = null;

async function bootstrap() {
  logger.info('🚀 Starting CryptoIntel Scanner Service', {
    nodeEnv:     env.NODE_ENV,
    port:        env.PORT,
    symbols:     scannerConfig.symbols.length,
    batchSize:   scannerConfig.batchSize,
    klines:      scannerConfig.enableKlineStreams,
    bookTicker:  scannerConfig.enableBookTickerStreams,
    intervals:   scannerConfig.klineIntervals,
  });

  // ── 1. Infrastructure ──────────────────────────────────────
  const metrics  = new MetricsCollector();
  redisPublisher = new RedisPublisher(env.REDIS_URL, metrics);

  logger.info('Waiting for Redis...');
  await redisPublisher.waitReady(15_000);

  // ── 2. Validate symbols ───────────────────────────────────
  logger.info('Validating symbols against Binance exchange info...');
  const validSymbols = await binanceRest.validateSymbols(scannerConfig.symbols);

  if (validSymbols.length === 0) {
    logger.error('No valid symbols — aborting');
    process.exit(1);
  }

  // Update config with validated symbols
  scannerConfig.symbols = validSymbols;

  // ── 3. Aggregators / cache ────────────────────────────────
  const candles = new CandleAggregator(
    scannerConfig.klineIntervals,
    scannerConfig.candleHistorySize,
  );

  const cache = new SymbolCache(
    redisPublisher.client,
    scannerConfig.redisSnapshotTtlSeconds,
    scannerConfig.publishThrottleMs,
  );

  // ── 4. Pre-warm with REST snapshots ───────────────────────
  logger.info('Pre-warming ticker cache from REST API...');
  const initialTickers = await binanceRest.getTickers(validSymbols);

  for (const ticker of initialTickers) {
    await cache.writeTicker(ticker);
  }

  logger.info(`Cached ${initialTickers.length} initial tickers`);

  // Pre-warm kline history (only for primary interval to limit startup time)
  if (scannerConfig.enableKlineStreams && scannerConfig.klineIntervals.length > 0) {
    const primaryInterval = scannerConfig.klineIntervals[0]; // e.g. '1m'
    logger.info(`Pre-warming ${primaryInterval} kline history...`);

    // Only load first 10 symbols to keep startup fast; rest fill in via WS
    const seedSymbols = validSymbols.slice(0, 10);
    await Promise.allSettled(
      seedSymbols.map(async (symbol) => {
        const klines = await binanceRest.getKlines(
          symbol,
          primaryInterval,
          scannerConfig.candleHistorySize,
        );
        for (const k of klines) candles.ingestKline(k);
      }),
    );

    logger.info(`Kline pre-warm complete for ${seedSymbols.length} symbols`);
  }

  // ── 5. Callbacks ──────────────────────────────────────────
  const callbacks = {
    onTicker: async (ticker: NormalizedTicker) => {
      // Already written to cache by stream manager — nothing extra needed here
      // unless you want to add business logic (e.g. top-gainer tracking)
    },

    onTrade: async (trade: NormalizedTrade) => {
      // Only publish trades above the configured USD threshold
      if (trade.quoteQty >= scannerConfig.minTradeUsdThreshold) {
        await redisPublisher!.publishMarketData('trade', {
          symbol:       trade.symbol,
          price:        trade.price,
          quantity:     trade.quantity,
          quoteQty:     trade.quoteQty,
          isBuyerMaker: trade.isBuyerMaker,
          timestamp:    trade.timestamp,
        });
      }
    },

    onKline: async (kline: NormalizedKline) => {
      // Only publish closed candles to reduce noise
      if (kline.isClosed) {
        await redisPublisher!.publishMarketData('kline', kline);
      }
    },

    onBookTicker: async (book: NormalizedBookTicker) => {
      // Only publish when spread is anomalous (> 0.5%) to reduce noise
      if (book.spreadPercent > 0.5) {
        await redisPublisher!.publishMarketData('book', book);
      }
    },
  };

  // ── 6. Stream manager ─────────────────────────────────────
  streamManager = new BinanceStreamManager(
    scannerConfig,
    callbacks,
    metrics,
    cache,
    candles,
  );

  await streamManager.start();

  // ── 7. Periodic snapshot write (keeps Redis keys warm) ───
  const snapshotInterval = setInterval(
    () => cache.writeAllSnapshots(),
    30_000, // every 30s
  );

  // ── 8. Processor Engine — news, whale alerts, auto-signals ─
  const processorInterval = setInterval(async () => {
    try {
      // News & Macro
      const news = await fetchCryptoNews('hot');
      const highImpact = news.filter(n => n.impact === 'HIGH' || n.impact === 'CRITICAL');
      for (const item of highImpact.slice(0, 3)) {
        await redisPublisher!.publishSignal({
          id:        `news-${item.id}`,
          symbol:    item.currencies[0] ? `${item.currencies[0]}USDT` : 'MARKET',
          type:      'NEWS_SIGNAL',
          severity:  item.impact,
          data:      { title: item.title, url: item.url, source: item.source, sentiment: item.sentiment },
          metadata:  { publishedAt: item.publishedAt, votes: item.votes },
          timestamp: Date.now(),
        });
      }

      // Whale Alert
      const whales = await fetchWhaleTransactions();
      for (const tx of whales) {
        await redisPublisher!.publishSignal({
          id:       `whale-${tx.id}`,
          symbol:   `${tx.symbol}USDT`,
          type:     'WHALE_TRADE',
          severity: tx.amountUsd >= 1_000_000 ? 'CRITICAL' : 'HIGH',
          data:     { amountUsd: tx.amountUsd, from: tx.from, to: tx.to, blockchain: tx.blockchain, hash: tx.hash },
          metadata: { timestamp: tx.timestamp },
          timestamp: Date.now(),
        });
      }

      // Auto-signal from ticker snapshots
      const tickers = cache.getAllTickers();
      for (const ticker of tickers) {
        const signals = processMarketSnapshot({
          symbol:     ticker.symbol,
          price:      ticker.price,
          prevPrice:  ticker.prevPrice ?? ticker.price,
          volume24h:  ticker.volume,
          prevVolume: ticker.volume,
        });
        for (const sig of signals) {
          await redisPublisher!.publishSignal({ ...sig, id: `auto-${sig.symbol}-${Date.now()}`, timestamp: Date.now() });
        }
      }
    } catch (err: any) {
      logger.error('Processor engine error', { error: err.message });
    }
  }, 60_000); // every 60s

  // ── 9. Health / metrics HTTP server ──────────────────────
  createHealthServer(
    env.PORT,
    streamManager,
    metrics,
    cache,
    candles,
    validSymbols,
  );

  logger.info('✅ Scanner Service fully started', {
    symbols:  validSymbols.length,
    streams:  streamManager.totalConnections,
  });

  // ── 9. Graceful shutdown ──────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down scanner...`);
    clearInterval(snapshotInterval);
    clearInterval(processorInterval);

    if (streamManager) {
      await streamManager.stop();
    }

    // Final snapshot flush
    await cache.writeAllSnapshots().catch(() => {});

    if (redisPublisher) {
      await redisPublisher.disconnect();
    }

    logger.info('Scanner stopped cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    // Do NOT exit — let the process continue; log and monitor
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

bootstrap().catch((err) => {
  logger.error('Scanner bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
