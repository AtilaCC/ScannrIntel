import Redis from 'ioredis';
import { PriceMovementDetector } from './detectors/PriceMovementDetector';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL);
const redisPub = new Redis(REDIS_URL);
const detector = new PriceMovementDetector();
const log = (level: string, msg: string, meta?: any) =>
  console.log(JSON.stringify({ level, service: 'processor', msg, ...meta, ts: new Date().toISOString() }));
async function bootstrap() {
  log('info', '⚙️ Starting Processor Engine');
  await redis.ping();
  log('info', 'Redis connected');
  const redisSub = new Redis(REDIS_URL);
  await redisSub.subscribe('market_data', 'market:data');
  redisSub.on('message', async (_ch: string, raw: string) => {
    try {
      const event = JSON.parse(raw);
      const ticker = event.payload || event;
      if (!ticker?.symbol) return;
      const signals = await detector.detect(ticker);
      for (const s of signals) {
        await redisPub.publish('signals', JSON.stringify({ type: 'signal', payload: s, timestamp: Date.now() }));
        log('info', `Signal: ${s.type} on ${s.symbol}`, { severity: s.severity });
      }
    } catch {}
  });
  log('info', '✅ Processor Engine fully started');
}
bootstrap().catch(err => { log('error', 'Bootstrap failed', { error: err.message }); process.exit(1); });
