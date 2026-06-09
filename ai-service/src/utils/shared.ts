export const createLogger = (service: string) => ({
  info: (msg: string, meta?: any) =>
    console.log(JSON.stringify({ level: 'info', service, msg, ...meta, ts: new Date().toISOString() })),
  warn: (msg: string, meta?: any) =>
    console.warn(JSON.stringify({ level: 'warn', service, msg, ...meta, ts: new Date().toISOString() })),
  error: (msg: string, meta?: any) =>
    console.error(JSON.stringify({ level: 'error', service, msg, ...meta, ts: new Date().toISOString() })),
  debug: (msg: string, meta?: any) =>
    process.env.NODE_ENV !== 'production' &&
    console.debug(JSON.stringify({ level: 'debug', service, msg, ...meta, ts: new Date().toISOString() })),
});

export const REDIS_CHANNELS = {
  SIGNALS: 'signals',
  MARKET_DATA: 'market_data',
  AI_INSIGHTS: 'ai_insights',
  WHALE_ALERTS: 'whale_alerts',
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const generateId = (): string => {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};
