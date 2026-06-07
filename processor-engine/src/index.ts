// ============================================================
// PROCESSOR ENGINE — Signal detection from market data
// ============================================================

import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { WhaleDetector } from './detectors/whaleDetector';
import { VolumeSpikeDetector } from './detectors/volumeSpikeDetector';
import { PriceMovementDetector } from './detectors/priceMovementDetector';
import { SignalEmitter } from './emitters/signalEmitter';
import { REDIS_CHANNELS, SERVICE_PORTS } from '../../shared/src/constants';
import { NormalizedMarketData } from '../../shared/src/types';
import { createLogger } from '../../shared/src/utils';
import { createServer } from 'http';

const logger = createLogger('processor-engine');

async function bootstrap() {
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

  const redisSub = new Redis(REDIS_URL, { retryStrategy: (t) => Math.min(t * 200, 5000) });
  const redisPub = new Redis(REDIS_URL, { retryStrategy: (t) => Math.min(t * 200, 5000) });
  const prisma = new PrismaClient();

  // Detectors
  const whaleDetector = new WhaleDetector();
  const volumeDetector = new VolumeSpikeDetector();
  const priceDetector = new PriceMovementDetector();

  // Signal emitter — persists + publishes signals
  const emitter = new SignalEmitter(prisma, redisPub);

  // Subscribe to market data from scanner
  redisSub.subscribe(REDIS_CHANNELS.MARKET_DATA, (err) => {
    if (err) logger.error('Subscribe error', { error: err.message });
    else logger.info('Subscribed to market data channel');
  });

  redisSub.on('message', async (channel, message) => {
    try {
      const event = JSON.parse(message);

      if (event.type === 'ticker') {
        const data = event.payload as NormalizedMarketData;

        // Run all detectors in parallel
        const [whaleSignals, volumeSignals, priceSignals] = await Promise.all([
          whaleDetector.detect(data),
          volumeDetector.detect(data),
          priceDetector.detect(data),
        ]);

        // Emit all detected signals
        const allSignals = [...whaleSignals, ...volumeSignals, ...priceSignals];
        for (const signal of allSignals) {
          await emitter.emit(signal);
        }
      } else if (event.type === 'trade') {
        // Detect whale trades specifically
        const whaleSignals = await whaleDetector.detectTrade(event.payload);
        for (const signal of whaleSignals) {
          await emitter.emit(signal);
        }
      }
    } catch (err) {
      logger.error('Processing error', { error: (err as Error).message });
    }
  });

  logger.info('Processor Engine started');

  // Health endpoint
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'processor' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(SERVICE_PORTS.PROCESSOR, () => {
    logger.info(`Processor health on port ${SERVICE_PORTS.PROCESSOR}`);
  });

  process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    redisSub.disconnect();
    redisPub.disconnect();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  logger.error('Processor bootstrap failed', { error: err.message });
  process.exit(1);
});
