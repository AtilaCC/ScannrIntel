// Fallback list used only if auto-discovery fails
export const DEFAULT_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'UNIUSDT',
  'ATOMUSDT', 'LTCUSDT', 'ETCUSDT', 'XLMUSDT', 'ALGOUSDT',
  'VETUSDT', 'FILUSDT', 'TRXUSDT', 'NEARUSDT', 'DOGEUSDT',
  'SHIBUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT',
  'SUIUSDT', 'TIAUSDT', 'WLDUSDT', 'SEIUSDT', 'FETUSDT',
];

// Auto-discover all active USDT pairs from Binance.us (up to maxPairs)
export async function fetchAllUSDTPairs(maxPairs = 300): Promise<string[]> {
  try {
    const res = await fetch('https://api.binance.us/api/v3/exchangeInfo');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;
    const pairs = (data.symbols as any[])
      .filter(s =>
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING' &&
        s.isSpotTradingAllowed === true
      )
      .map(s => s.symbol)
      .slice(0, maxPairs);
    console.log(JSON.stringify({ level: 'info', service: 'pair-discovery', msg: `Discovered ${pairs.length} USDT pairs` }));
    return pairs;
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', service: 'pair-discovery', msg: `Auto-discovery failed: ${err.message} — using DEFAULT_PAIRS` }));
    return DEFAULT_PAIRS;
  }
}

export const REDIS_CHANNELS = {
  SIGNALS: 'signals',
  MARKET_DATA: 'market_data',
  AI_INSIGHTS: 'ai_insights',
  WHALE_ALERTS: 'whale_alerts',
};

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

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
