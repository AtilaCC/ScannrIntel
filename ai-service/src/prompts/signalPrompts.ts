// ============================================================
// SIGNAL PROMPTS
// One builder per signal type. Each prompt provides Claude
// with exactly the data it needs — no more, no less.
// ============================================================

import { DbSignal, MarketContext } from '../types';

// ── Shared header ─────────────────────────────────────────────

function header(signal: DbSignal, ctx: MarketContext): string {
  const base   = signal.symbol.replace('USDT', '');
  const ts     = new Date(signal.createdAt).toUTCString();
  const change = ctx.priceChange24h >= 0
    ? `+${ctx.priceChange24h.toFixed(2)}%`
    : `${ctx.priceChange24h.toFixed(2)}%`;

  return [
    `SIGNAL: ${signal.type} | SEVERITY: ${signal.severity} | ASSET: ${base}/USDT`,
    `DETECTED: ${ts}`,
    ``,
    `MARKET STATE AT DETECTION`,
    `  Price:           $${ctx.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `  24h Change:      ${change}`,
    `  24h Volume:      $${(ctx.volume24h / 1e6).toFixed(2)}M`,
    `  24h High/Low:    $${ctx.high24h.toLocaleString()} / $${ctx.low24h.toLocaleString()}`,
    ctx.priceChange1h !== undefined
      ? `  1h Price Change: ${ctx.priceChange1h >= 0 ? '+' : ''}${ctx.priceChange1h.toFixed(2)}%`
      : '',
    ctx.volumeRatio !== undefined
      ? `  Volume Ratio:    ${ctx.volumeRatio.toFixed(2)}x 20-period MA ($${((ctx.volumeMA20 ?? 0) / 1e6).toFixed(2)}M avg)`
      : '',
  ].filter(Boolean).join('\n');
}

function recentSignalsBlock(ctx: MarketContext): string {
  if (!ctx.recentSignals?.length) return '';
  const lines = ctx.recentSignals.slice(0, 4).map(
    (s) => `  - ${s.type} (${s.severity}) at ${new Date(s.createdAt).toUTCString()}`,
  );
  return `\nRECENT SIGNALS FOR THIS ASSET (last 24h)\n${lines.join('\n')}`;
}

// ── WHALE_TRADE ───────────────────────────────────────────────

export function buildWhaleTradePrompt(signal: DbSignal, ctx: MarketContext): string {
  const d = signal.data as any;
  return [
    header(signal, ctx),
    ``,
    `WHALE TRADE DETAILS`,
    `  Trade Size (USD):  $${(d.tradeUSD ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    `  Direction:         ${d.direction ?? 'UNKNOWN'} (${d.isBuyerMaker ? 'seller initiated' : 'buyer initiated'})`,
    `  Execution Price:   $${(d.price ?? ctx.currentPrice).toLocaleString()}`,
    `  Quantity:          ${(d.quantity ?? 0).toLocaleString()} ${signal.symbol.replace('USDT', '')}`,
    d.tradeUSD >= 1_000_000
      ? `  Classification:    INSTITUTIONAL (>$1M single order)`
      : `  Classification:    LARGE RETAIL / SMALL INSTITUTIONAL`,
    recentSignalsBlock(ctx),
    ``,
    `Analyze this whale trade. Consider: (1) whether this size typically moves price, (2) accumulation vs distribution context given recent signals, (3) what similar-sized orders have historically preceded in this asset.`,
  ].join('\n');
}

// ── VOLUME_SPIKE ──────────────────────────────────────────────

export function buildVolumeSpikePrompt(signal: DbSignal, ctx: MarketContext): string {
  const d = signal.data as any;
  return [
    header(signal, ctx),
    ``,
    `VOLUME SPIKE DETAILS`,
    `  Spike Multiplier:  ${(d.multiplier ?? 0).toFixed(2)}x above 20-period average`,
    `  Current Volume:    $${((d.currentVolume ?? 0) / 1e6).toFixed(2)}M`,
    `  Average Volume:    $${((d.avgVolume ?? 0) / 1e6).toFixed(2)}M`,
    `  Volume Type:       ${d.multiplier >= 10 ? 'EXTREME' : d.multiplier >= 5 ? 'VERY HIGH' : 'HIGH'}`,
    `  Price Action:      ${ctx.priceChange24h >= 0 ? 'Upward' : 'Downward'} (${ctx.priceChange24h.toFixed(2)}% 24h)`,
    recentSignalsBlock(ctx),
    ``,
    `Analyze this volume spike. Key questions: (1) Is volume confirming price direction or diverging? (2) What does ${(d.multiplier ?? 0).toFixed(1)}x volume mean for this specific asset? (3) Is this consistent with external catalysts (listing, news) or more likely organic?`,
  ].join('\n');
}

// ── PRICE_SURGE ───────────────────────────────────────────────

export function buildPriceSurgePrompt(signal: DbSignal, ctx: MarketContext): string {
  const d = signal.data as any;
  const windowMin = d.windowMs ? (d.windowMs / 60_000).toFixed(0) : '5';
  return [
    header(signal, ctx),
    ``,
    `PRICE SURGE DETAILS`,
    `  Move Size:         +${(d.changePercent ?? d.changePercent24h ?? 0).toFixed(2)}%`,
    `  Time Window:       ${windowMin} minutes`,
    `  From Price:        $${(d.fromPrice ?? 0).toLocaleString()}`,
    `  To Price:          $${(d.toPrice ?? ctx.currentPrice).toLocaleString()}`,
    `  Price Velocity:    $${(((d.toPrice ?? 0) - (d.fromPrice ?? 0)) / parseFloat(windowMin)).toFixed(2)}/min`,
    recentSignalsBlock(ctx),
    ``,
    `Analyze this rapid price surge. Consider: (1) Is this a genuine breakout or a liquidity grab? (2) What is the likely retracement target? (3) Does the volume data support this move?`,
  ].join('\n');
}

// ── PRICE_CRASH ───────────────────────────────────────────────

export function buildPriceCrashPrompt(signal: DbSignal, ctx: MarketContext): string {
  const d = signal.data as any;
  const windowMin = d.windowMs ? (d.windowMs / 60_000).toFixed(0) : '5';
  return [
    header(signal, ctx),
    ``,
    `PRICE CRASH DETAILS`,
    `  Move Size:         ${(d.changePercent ?? d.changePercent24h ?? 0).toFixed(2)}%`,
    `  Time Window:       ${windowMin} minutes`,
    `  From Price:        $${(d.fromPrice ?? 0).toLocaleString()}`,
    `  To Price:          $${(d.toPrice ?? ctx.currentPrice).toLocaleString()}`,
    `  Price Velocity:    $${(((d.fromPrice ?? 0) - (d.toPrice ?? 0)) / parseFloat(windowMin)).toFixed(2)}/min drop`,
    recentSignalsBlock(ctx),
    ``,
    `Analyze this rapid price drop. Consider: (1) Stop-loss cascade vs coordinated dump? (2) Key support levels to watch. (3) Is this a buying opportunity or the start of a larger downtrend?`,
  ].join('\n');
}

// ── ACCUMULATION_PATTERN ──────────────────────────────────────

export function buildAccumulationPrompt(signal: DbSignal, ctx: MarketContext): string {
  const d = signal.data as any;
  return [
    header(signal, ctx),
    ``,
    `ACCUMULATION PATTERN DETAILS`,
    `  Large Buy Orders:  ${d.largeBuyCount ?? 0} orders (each ≥$50,000)`,
    `  Total Accumulated: $${((d.totalUSD ?? 0) / 1e6).toFixed(2)}M over 5-minute window`,
    `  Avg Order Size:    $${(((d.totalUSD ?? 0) / Math.max(1, d.largeBuyCount ?? 1)) / 1e3).toFixed(0)}K`,
    `  Pattern Type:      Coordinated buyer pressure`,
    recentSignalsBlock(ctx),
    ``,
    `Analyze this accumulation pattern. Consider: (1) Is this consistent with institutional DCA or a single large actor splitting orders? (2) Is price responding to the buying pressure? (3) What is the likely exit strategy for this accumulator?`,
  ].join('\n');
}

// ── DUMP_PATTERN ──────────────────────────────────────────────

export function buildDumpPatternPrompt(signal: DbSignal, ctx: MarketContext): string {
  const d = signal.data as any;
  return [
    header(signal, ctx),
    ``,
    `DUMP PATTERN DETAILS`,
    `  Large Sell Orders: ${d.largeSellCount ?? 0} orders`,
    `  Total Sold (USD):  $${((d.totalUSD ?? 0) / 1e6).toFixed(2)}M over 5-minute window`,
    `  Avg Order Size:    $${(((d.totalUSD ?? 0) / Math.max(1, d.largeSellCount ?? 1)) / 1e3).toFixed(0)}K`,
    recentSignalsBlock(ctx),
    ``,
    `Analyze this sell-side pressure. Consider: (1) Profit-taking at resistance vs panic selling? (2) Is this a major holder exiting or distributed selling? (3) Where is likely support?`,
  ].join('\n');
}

// ── LIQUIDITY_ANOMALY ─────────────────────────────────────────

export function buildLiquidityAnomalyPrompt(signal: DbSignal, ctx: MarketContext): string {
  const d = signal.data as any;
  return [
    header(signal, ctx),
    ``,
    `LIQUIDITY ANOMALY DETAILS`,
    `  Spread:            ${(d.spreadPercent ?? 0).toFixed(3)}% (normal: <0.05%)`,
    `  Bid Price:         $${(d.bidPrice ?? 0).toLocaleString()}`,
    `  Ask Price:         $${(d.askPrice ?? 0).toLocaleString()}`,
    `  Bid Qty:           ${(d.bidQty ?? 0).toLocaleString()} ${signal.symbol.replace('USDT', '')}`,
    `  Ask Qty:           ${(d.askQty ?? 0).toLocaleString()} ${signal.symbol.replace('USDT', '')}`,
    recentSignalsBlock(ctx),
    ``,
    `Analyze this liquidity anomaly. Consider: (1) Is this a market-maker withdrawal or a genuine supply/demand imbalance? (2) What price impact would a moderate-sized order have? (3) Is this a manipulation setup?`,
  ].join('\n');
}

// ── Router ────────────────────────────────────────────────────

export function buildUserPrompt(signal: DbSignal, ctx: MarketContext): string {
  switch (signal.type) {
    case 'WHALE_TRADE':          return buildWhaleTradePrompt(signal, ctx);
    case 'VOLUME_SPIKE':         return buildVolumeSpikePrompt(signal, ctx);
    case 'PRICE_SURGE':          return buildPriceSurgePrompt(signal, ctx);
    case 'PRICE_CRASH':          return buildPriceCrashPrompt(signal, ctx);
    case 'ACCUMULATION_PATTERN': return buildAccumulationPrompt(signal, ctx);
    case 'DUMP_PATTERN':         return buildDumpPatternPrompt(signal, ctx);
    case 'LIQUIDITY_ANOMALY':    return buildLiquidityAnomalyPrompt(signal, ctx);
    default:
      return [
        header(signal, ctx),
        ``,
        `SIGNAL DATA\n${JSON.stringify(signal.data, null, 2)}`,
        ``,
        `Analyze this market signal and provide your expert assessment.`,
      ].join('\n');
  }
}

/** Estimate token count for rate limiting pre-check. */
export function estimatePromptTokens(signal: DbSignal): number {
  // Rough estimate: system ~500 tokens + user ~300 tokens + response ~400 tokens
  const systemTokens = 500;
  const userTokens   = 300;
  const replyTokens  = 400;
  return systemTokens + userTokens + replyTokens;
}
