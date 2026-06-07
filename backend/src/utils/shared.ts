import { v4 as uuidv4 } from 'uuid';

export const generateId = (): string => uuidv4();

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

export interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  plan?: string;
  iat?: number;
  exp?: number;
}

export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
};

export const REDIS_CHANNELS = {
  SIGNALS: 'signals',
  MARKET_DATA: 'market_data',
  AI_INSIGHTS: 'ai_insights',
};
