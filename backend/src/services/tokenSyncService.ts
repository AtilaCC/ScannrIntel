// ============================================================
// TOKEN SYNC SERVICE
// Subscribes to Redis market_data channel and upserts token
// prices into the Postgres tokens table so scores/insights work.
// ============================================================

import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { createLogger } from '../utils/shared';

const logger = createLogger('token-sync');

export function startTokenSync(prisma: PrismaClient, redisSub: Redis) {
  redisSub.subscribe('market_data', (err) => {
    if (err) logger.error('Failed to subscribe to market_data', { error: err.message });
    else logger.info('Token sync subscribed to market_data');
  });

  redisSub.on('message', async (channel, raw) => {
    if (channel !== 'market_data') return;
    try {
      const event = JSON.parse(raw);
      const payload = event?.payload ?? event;
      if (event?.type !== 'ticker' && payload?.type !== 'ticker') return;

      const ticker = payload?.payload ?? payload;
      if (!ticker?.symbol) return;

      const symbol = ticker.symbol as string;
      const baseAsset  = symbol.replace('USDT', '');
      const quoteAsset = 'USDT';

      await prisma.token.upsert({
        where:  { symbol },
        update: {
          lastPrice:    ticker.price        ?? null,
          priceChange:  ticker.priceChangePercent24h ?? null,
          volumeUsd24h: ticker.quoteVolume24h ?? null,
          high24h:      ticker.high24h       ?? null,
          low24h:       ticker.low24h        ?? null,
        },
        create: {
          symbol,
          baseAsset,
          quoteAsset,
          network:      'binance',
          lastPrice:    ticker.price        ?? null,
          priceChange:  ticker.priceChangePercent24h ?? null,
          volumeUsd24h: ticker.quoteVolume24h ?? null,
          high24h:      ticker.high24h       ?? null,
          low24h:       ticker.low24h        ?? null,
        },
      });
    } catch (err: any) {
      // Silently ignore — high frequency updates
    }
  });

  logger.info('Token sync service started');
}
