// ============================================================
// ANALYSIS PROMPT — Claude prompt engineering for market signals
// ============================================================

export function buildAnalysisPrompt(signal: any): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are an expert cryptocurrency market analyst and quantitative trader with 15 years of experience.
You specialize in on-chain analysis, order flow analysis, and market microstructure.

Your task is to analyze market signals detected by our real-time scanning system and provide:
1. A concise, actionable analysis
2. Risk and opportunity scores
3. Market sentiment classification
4. Specific recommendations

You MUST respond with ONLY valid JSON in this exact format:
\`\`\`json
{
  "summary": "One clear sentence summarizing the signal (max 120 chars)",
  "details": "2-3 paragraphs of detailed analysis explaining what this means, what patterns it suggests, and market context",
  "riskScore": <integer 0-100, where 100 = maximum risk>,
  "opportunityScore": <integer 0-100, where 100 = maximum opportunity>,
  "sentiment": "<BULLISH|BEARISH|NEUTRAL>",
  "tags": ["tag1", "tag2", "tag3"],
  "recommendations": [
    "Specific actionable recommendation 1",
    "Specific actionable recommendation 2"
  ],
  "confidence": <float 0.0-1.0>
}
\`\`\`

Be factual, data-driven, and never give financial advice. Frame recommendations as observations.`;

  const signalContext = formatSignalContext(signal);

  const userPrompt = `Analyze this market signal detected on the Binance exchange:

${signalContext}

Provide your expert analysis following the JSON format specified.`;

  return { systemPrompt, userPrompt };
}

function formatSignalContext(signal: any): string {
  const meta = signal.metadata || {};
  const data = signal.data || {};

  const lines = [
    `**Signal Type:** ${signal.type}`,
    `**Asset:** ${signal.symbol}`,
    `**Severity:** ${signal.severity}`,
    `**Detected At:** ${new Date(signal.createdAt).toISOString()}`,
    ``,
    `**Market Data at Detection:**`,
    `- Current Price: $${meta.price?.toLocaleString() || 'N/A'}`,
    `- Volume (USD): $${meta.volume?.toLocaleString() || 'N/A'}`,
    `- Price Change: ${meta.priceChange?.toFixed(2) || '0'}%`,
  ];

  if (signal.type === 'WHALE_TRADE') {
    lines.push(``, `**Whale Trade Details:**`);
    lines.push(`- Trade Size (USD): $${data.tradeUSD?.toLocaleString() || 'N/A'}`);
    lines.push(`- Direction: ${data.direction || 'N/A'}`);
    lines.push(`- Price: $${data.price?.toLocaleString() || 'N/A'}`);
  }

  if (signal.type === 'VOLUME_SPIKE') {
    lines.push(``, `**Volume Spike Details:**`);
    lines.push(`- Volume Multiplier: ${data.multiplier}x above average`);
    lines.push(`- Average Volume: $${data.avgVolume?.toLocaleString() || 'N/A'}`);
    lines.push(`- Current Volume: $${data.currentVolume?.toLocaleString() || 'N/A'}`);
  }

  if (signal.type === 'PRICE_SURGE' || signal.type === 'PRICE_CRASH') {
    lines.push(``, `**Price Movement Details:**`);
    lines.push(`- Change Percent: ${data.changePercent?.toFixed(2) || data.changePercent24h?.toFixed(2)}%`);
    lines.push(`- From Price: $${data.fromPrice?.toLocaleString() || 'N/A'}`);
    lines.push(`- To Price: $${data.toPrice?.toLocaleString() || 'N/A'}`);
    if (data.windowMs) lines.push(`- Time Window: ${data.windowMs / 60000} minutes`);
  }

  if (signal.type === 'ACCUMULATION_PATTERN') {
    lines.push(``, `**Accumulation Pattern Details:**`);
    lines.push(`- Large Buy Orders: ${data.largeBuyCount}`);
    lines.push(`- Total USD Accumulated: $${data.totalUSD?.toLocaleString()}`);
  }

  return lines.join('\n');
}
