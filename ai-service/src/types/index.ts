// ============================================================
// AI SERVICE TYPES
// ============================================================

// ── Claude API wire types ─────────────────────────────────────

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model:      string;
  max_tokens: number;
  system:     string;
  messages:   ClaudeMessage[];
  temperature?: number;
}

export interface ClaudeResponse {
  id:            string;
  type:          'message';
  role:          'assistant';
  content:       Array<{ type: 'text'; text: string }>;
  model:         string;
  stop_reason:   'end_turn' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens:  number;
    output_tokens: number;
  };
}

export interface ClaudeErrorResponse {
  type:  'error';
  error: { type: string; message: string };
}

// ── Score breakdown (per-factor scoring) ─────────────────────

export interface ScoreFactor {
  name:        string;    // human-readable factor name
  score:       number;    // 0–100 for this factor
  weight:      number;    // 0–1, how much this factor contributes
  direction:   'RISK' | 'OPPORTUNITY' | 'BOTH';
  explanation: string;    // one-line reason for this score
}

export interface ScoreBreakdown {
  // Rule-based pre-scores (computed deterministically before Claude)
  factors:          ScoreFactor[];

  // Composite scores — weighted average of all factors
  compositeRisk:        number;   // 0–100
  compositeOpportunity: number;   // 0–100

  // Claude's qualitative overlay
  claudeRisk:        number;
  claudeOpportunity: number;

  // Final calibrated scores (blend of rule-based + Claude)
  finalRisk:        number;   // 0–100  ← THE authoritative score
  finalOpportunity: number;   // 0–100  ← THE authoritative score

  // Score metadata
  ruleWeight:   number;   // 0–1, how much rule-based score contributed
  claudeWeight: number;   // 0–1, how much Claude score contributed
  computedAt:   number;   // timestamp
}

export interface TokenScore {
  symbol:          string;
  finalRisk:       number;
  finalOpportunity:number;
  sentiment:       'BULLISH' | 'BEARISH' | 'NEUTRAL';
  breakdown:       ScoreBreakdown;
  signalId:        string;
  insightId:       string;
  computedAt:      number;
}

// ── Parsed insight from Claude ────────────────────────────────

export interface ParsedInsight {
  summary:          string;
  details:          string;
  riskScore:        number;   // 0–100  (Claude's raw score)
  opportunityScore: number;   // 0–100  (Claude's raw score)
  sentiment:        'BULLISH' | 'BEARISH' | 'NEUTRAL';
  tags:             string[];
  recommendations:  string[];
  confidence:       number;   // 0–1
  keyLevels?:       { support?: number | null; resistance?: number | null };
  timeframe?:       string;
  // Per-factor scores from Claude
  factorScores?: {
    volatility?:    number;
    volume?:        number;
    momentum?:      number;
    liquidity?:     number;
    sentiment?:     number;
    manipulation?:  number;
  };
}

// ── Queue item ────────────────────────────────────────────────

export type QueuePriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface QueueItem {
  id:          string;   // unique job id
  signalId:    string;
  signal:      DbSignal;
  priority:    QueuePriority;
  enqueuedAt:  number;
  attempts:    number;
  maxAttempts: number;
  nextRetryAt: number;
}

export interface DeadLetterItem extends QueueItem {
  failedAt:    number;
  lastError:   string;
}

// ── DB signal shape (as read from Prisma) ────────────────────

export interface DbSignal {
  id:        string;
  symbol:    string;
  type:      string;
  severity:  string;
  data:      Record<string, unknown>;
  metadata:  Record<string, unknown>;
  createdAt: Date;
}

// ── Market context (enriched before sending to Claude) ────────

export interface MarketContext {
  symbol:            string;
  currentPrice:      number;
  priceChange24h:    number;
  volume24h:         number;
  high24h:           number;
  low24h:            number;
  // Candle-based context
  priceChange1h?:    number;
  priceChange5m?:    number;
  volumeMA20?:       number;   // 20-period volume moving average
  volumeRatio?:      number;   // current / MA20
  // Spread / liquidity
  spreadPercent?:    number;   // current bid-ask spread %
  // Position within 24h range (0 = at low, 1 = at high)
  rangePosition?:    number;
  // Recent signals for the same symbol
  recentSignals?:    Array<{ type: string; severity: string; createdAt: string }>;
  // Recent AI insight for the symbol (avoid duplicate analysis)
  lastInsightAt?:    string;
  // Prior score for trend context
  previousScore?:    { risk: number; opportunity: number; computedAt: number };
}

// ── Token usage tracking ──────────────────────────────────────

export interface TokenUsage {
  inputTokens:  number;
  outputTokens: number;
  totalTokens:  number;
  estimatedCostUsd: number;
}

export interface UsageSummary {
  totalRequests:    number;
  totalInputTokens: number;
  totalOutputTokens:number;
  totalCostUsd:     number;
  avgLatencyMs:     number;
  errorRate:        number;
  windowStart:      number;
}

// ── Error classification ──────────────────────────────────────

export type ClaudeErrorType =
  | 'RATE_LIMIT'       // 429
  | 'OVERLOADED'       // 529
  | 'INVALID_REQUEST'  // 400
  | 'AUTH_ERROR'       // 401
  | 'NOT_FOUND'        // 404
  | 'SERVER_ERROR'     // 5xx
  | 'NETWORK_ERROR'    // fetch failed
  | 'PARSE_ERROR'      // response not valid JSON/schema
  | 'TIMEOUT';         // request took too long

export interface ClassifiedError {
  type:       ClaudeErrorType;
  retryable:  boolean;
  retryAfterMs?: number;
  message:    string;
  statusCode?: number;
}

// ── Notification payload ──────────────────────────────────────

export interface NotificationPayload {
  userId:    string;
  alertId:   string;
  symbol:    string;
  message:   string;
  condition: string;
  value:     number;
  threshold: number;
  channels:  string[];
}

// ── Service health ────────────────────────────────────────────

export interface AIServiceHealth {
  status:            'ok' | 'degraded' | 'down';
  uptime:            number;
  queue: {
    pending:         number;
    active:          number;
    deadLetter:      number;
  };
  claude: {
    requestsTotal:   number;
    requestsOk:      number;
    requestsFailed:  number;
    rateLimitHits:   number;
    avgLatencyMs:    number;
    estimatedCostUsd:number;
  };
  alerts: {
    checked:         number;
    triggered:       number;
  };
}
