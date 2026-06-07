// ============================================================
// AI SERVICE CONFIG
// ============================================================

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) { console.error(`❌ Missing required env var: ${key}`); process.exit(1); }
  return val;
}

function optionalInt(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v ? parseInt(v, 10) : fallback;
  return isNaN(n) ? fallback : n;
}

function optionalFloat(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v ? parseFloat(v) : fallback;
  return isNaN(n) ? fallback : n;
}

export const config = {
  nodeEnv:   process.env.NODE_ENV || 'development',
  port:      optionalInt('PORT', 4003),

  // Redis
  redisUrl:  process.env.REDIS_URL || 'redis://localhost:6379',

  // Database
  databaseUrl: requireEnv('DATABASE_URL'),

  // Anthropic
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  claudeModel:     process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  claudeMaxTokens: optionalInt('CLAUDE_MAX_TOKENS', 1024),
  claudeTemp:      optionalFloat('CLAUDE_TEMPERATURE', 0.2),

  // Rate limiting (against Claude API)
  rateLimitRpm:     optionalInt('CLAUDE_RATE_LIMIT_RPM',     50),   // requests per minute
  rateLimitTpm:     optionalInt('CLAUDE_RATE_LIMIT_TPM', 40_000),   // tokens per minute

  // Queue
  queueConcurrency:   optionalInt('QUEUE_CONCURRENCY',    3),
  queueMaxAttempts:   optionalInt('QUEUE_MAX_ATTEMPTS',   3),
  queueRetryBaseMs:   optionalInt('QUEUE_RETRY_BASE_MS', 2_000),
  queueBrpopTimeout:  optionalInt('QUEUE_BRPOP_TIMEOUT',  5),    // seconds
  deadLetterTtlHours: optionalInt('DEAD_LETTER_TTL_H',   24),

  // Analysis
  signalDedupeWindowMs:  optionalInt('SIGNAL_DEDUPE_WINDOW_MS', 60_000),  // 1 min
  skipAlreadyAnalyzed:   process.env.SKIP_ANALYZED !== 'false',
  minSeverityToAnalyze:  process.env.MIN_SEVERITY || 'LOW',  // LOW|MEDIUM|HIGH|CRITICAL
  contextLookbackSignals: optionalInt('CONTEXT_LOOKBACK_SIGNALS', 5),

  // Alert checking
  alertCacheWindowMs:      optionalInt('ALERT_CACHE_WINDOW_MS',   5 * 60_000),
  alertMinRetriggerMs:     optionalInt('ALERT_MIN_RETRIGGER_MS',  5 * 60_000),
  alertDbCacheRefreshMs:   optionalInt('ALERT_DB_CACHE_REFRESH_MS', 30_000),

  // Notifications
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  emailFrom:        process.env.EMAIL_FROM,
  smtpHost:         process.env.SMTP_HOST,
  smtpPort:         optionalInt('SMTP_PORT', 587),
  smtpUser:         process.env.SMTP_USER,
  smtpPass:         process.env.SMTP_PASS,
} as const;

// Priority mapping: signal severity → queue priority
export const SEVERITY_PRIORITY: Record<string, number> = {
  CRITICAL: 0,
  HIGH:     1,
  MEDIUM:   2,
  LOW:      3,
};

// Claude estimated cost per token (input / output) in USD
export const TOKEN_COST = {
  input:  0.000003,   // $3 per million input tokens
  output: 0.000015,   // $15 per million output tokens
} as const;
