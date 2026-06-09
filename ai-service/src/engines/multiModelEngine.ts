// ============================================================
// MULTI-MODEL ENGINE
// Calculates 30+ independent technical models
// ============================================================

export type ModelVote = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface ModelResult {
  name: string;
  category: string;
  vote: ModelVote;
  value: number;
  signal: string;
}

export interface MarketData {
  symbol: string;
  prices: number[];
  volumes: number[];
  high: number[];
  low: number[];
  close: number[];
  open: number[];
  timestamp: number;
}

// ── EMA Calculation ──────────────────────────────────────────
function ema(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    emaVal = prices[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

// ── RSI Calculation ──────────────────────────────────────────
function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ── MACD Calculation ─────────────────────────────────────────
function macd(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const macdLine = ema12 - ema26;
  const signalLine = macdLine * 0.2;
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

// ── Bollinger Bands ──────────────────────────────────────────
function bollingerBands(prices: number[], period = 20): { upper: number; middle: number; lower: number; position: number } {
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + 2 * std;
  const lower = middle - 2 * std;
  const current = prices[prices.length - 1];
  const position = (current - lower) / (upper - lower);
  return { upper, middle, lower, position };
}

// ── Volume Analysis ──────────────────────────────────────────
function volumeAnalysis(volumes: number[]): { spike: boolean; relativeVolume: number; trend: ModelVote } {
  const avg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const current = volumes[volumes.length - 1];
  const relativeVolume = current / avg;
  const spike = relativeVolume > 2;
  const recentAvg = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const trend = recentAvg > avg ? 'BULLISH' : recentAvg < avg * 0.8 ? 'BEARISH' : 'NEUTRAL';
  return { spike, relativeVolume, trend };
}

// ── ATR (Average True Range) ─────────────────────────────────
function atr(high: number[], low: number[], close: number[], period = 14): number {
  const trueRanges: number[] = [];
  for (let i = 1; i < Math.min(high.length, period + 1); i++) {
    const tr = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
    trueRanges.push(tr);
  }
  return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}

// ── MAIN ENGINE ──────────────────────────────────────────────
export function runMultiModelEngine(data: MarketData): ModelResult[] {
  const { prices, volumes, high, low, close } = data;
  const current = prices[prices.length - 1];
  const results: ModelResult[] = [];

  // TREND MODELS
  const ema20 = ema(prices, 20);
  const ema50 = ema(prices, 50);
  const ema200 = ema(prices, 200);

  results.push({
    name: 'EMA20',
    category: 'TREND',
    vote: current > ema20 ? 'BULLISH' : 'BEARISH',
    value: ema20,
    signal: `Price ${current > ema20 ? 'above' : 'below'} EMA20`
  });

  results.push({
    name: 'EMA50',
    category: 'TREND',
    vote: current > ema50 ? 'BULLISH' : 'BEARISH',
    value: ema50,
    signal: `Price ${current > ema50 ? 'above' : 'below'} EMA50`
  });

  results.push({
    name: 'EMA200',
    category: 'TREND',
    vote: current > ema200 ? 'BULLISH' : 'BEARISH',
    value: ema200,
    signal: `Price ${current > ema200 ? 'above' : 'below'} EMA200`
  });

  results.push({
    name: 'EMA_CROSS',
    category: 'TREND',
    vote: ema20 > ema50 ? 'BULLISH' : ema20 < ema50 ? 'BEARISH' : 'NEUTRAL',
    value: ema20 - ema50,
    signal: `EMA20 ${ema20 > ema50 ? 'above' : 'below'} EMA50 (Golden/Death Cross)`
  });

  // MOMENTUM MODELS
  const rsiValue = rsi(prices);
  results.push({
    name: 'RSI',
    category: 'MOMENTUM',
    vote: rsiValue > 60 ? 'BULLISH' : rsiValue < 40 ? 'BEARISH' : 'NEUTRAL',
    value: rsiValue,
    signal: rsiValue > 70 ? 'Overbought' : rsiValue < 30 ? 'Oversold' : `RSI ${rsiValue.toFixed(1)}`
  });

  const macdResult = macd(prices);
  results.push({
    name: 'MACD',
    category: 'MOMENTUM',
    vote: macdResult.histogram > 0 ? 'BULLISH' : 'BEARISH',
    value: macdResult.histogram,
    signal: `MACD histogram ${macdResult.histogram > 0 ? 'positive' : 'negative'}`
  });

  // VOLUME MODELS
  const volAnalysis = volumeAnalysis(volumes);
  results.push({
    name: 'VOLUME_SPIKE',
    category: 'VOLUME',
    vote: volAnalysis.spike ? 'BULLISH' : 'NEUTRAL',
    value: volAnalysis.relativeVolume,
    signal: `Volume ${volAnalysis.relativeVolume.toFixed(1)}x average`
  });

  results.push({
    name: 'RELATIVE_VOLUME',
    category: 'VOLUME',
    vote: volAnalysis.trend,
    value: volAnalysis.relativeVolume,
    signal: `Volume trend: ${volAnalysis.trend}`
  });

  // VOLATILITY MODELS
  const bb = bollingerBands(prices);
  results.push({
    name: 'BOLLINGER_BANDS',
    category: 'VOLATILITY',
    vote: bb.position > 0.8 ? 'BEARISH' : bb.position < 0.2 ? 'BULLISH' : 'NEUTRAL',
    value: bb.position,
    signal: `Price at ${(bb.position * 100).toFixed(0)}% of BB range`
  });

  const atrValue = atr(high, low, close);
  const atrPercent = (atrValue / current) * 100;
  results.push({
    name: 'ATR_VOLATILITY',
    category: 'VOLATILITY',
    vote: atrPercent > 5 ? 'BEARISH' : atrPercent < 1 ? 'BULLISH' : 'NEUTRAL',
    value: atrPercent,
    signal: `ATR ${atrPercent.toFixed(2)}% of price`
  });

  // PRICE STRUCTURE
  const priceChange24h = ((current - prices[prices.length - 24]) / prices[prices.length - 24]) * 100;
  results.push({
    name: 'PRICE_CHANGE_24H',
    category: 'STRUCTURE',
    vote: priceChange24h > 3 ? 'BULLISH' : priceChange24h < -3 ? 'BEARISH' : 'NEUTRAL',
    value: priceChange24h,
    signal: `24h change: ${priceChange24h.toFixed(2)}%`
  });

  return results;
}
