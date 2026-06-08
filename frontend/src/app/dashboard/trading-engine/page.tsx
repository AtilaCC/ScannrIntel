'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Crosshair, Zap, TrendingUp, TrendingDown, Minus,
  Clock, Target, AlertTriangle, ChevronRight, RotateCcw,
  Loader2, Sparkles, History, Send,
} from 'lucide-react';
import { tradingEngineApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { motion, AnimatePresence } from 'framer-motion';

// ── Types ─────────────────────────────────────────────────────

type SignalType = 'NEWS_SIGNAL' | 'MACRO_EVENT' | 'SOCIAL_SPIKE' | 'MARKET_SIGNAL';

interface TradingDecision {
  id: string;
  symbol: string;
  eventType: SignalType;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  action: 'BUY' | 'SELL' | 'HOLD';
  entryType: 'EARLY' | 'CONFIRMATION' | 'LATE';
  summary: string;
  riskScore: number;
  opportunityScore: number;
  confidence: number;
  riskRewardRatio: number;
  timeHorizon: 'SHORT' | 'MID' | 'LONG';
  expectedMoveWindow: string;
  keyDrivers: string[];
  analysis: string;
  isEarlySignal: boolean;
  analyzedAt: string;
}

// ── Example inputs ────────────────────────────────────────────

const EXAMPLES = [
  {
    label: '🐋 Whale Alert',
    type: 'MARKET_SIGNAL' as SignalType,
    text: '🚨 WHALE ALERT: 4,200 BTC ($287M) transferred from unknown wallet to Coinbase. Confirmed 3 minutes ago. BTC flat at $68,400, volume 1.2x average.',
  },
  {
    label: '📰 Fed News',
    type: 'MACRO_EVENT' as SignalType,
    text: 'BREAKING: Federal Reserve signals surprise rate cut citing crypto-friendly banking reform bill passing Senate 67-33. Market reaction minimal so far — futures down 0.2%.',
  },
  {
    label: '🐦 Elon Tweet',
    type: 'SOCIAL_SPIKE' as SignalType,
    text: 'Elon Musk just tweeted "Doge 🚀🌕". Posted 2 minutes ago, 45k likes. DOGE at $0.142, volume up 3.4x in last 15 minutes.',
  },
  {
    label: '📋 New Listing',
    type: 'NEWS_SIGNAL' as SignalType,
    text: 'Coinbase Pro listing announcement: PEPE/USD going live in 48 hours. Currently on DEX only at $0.0000143. Volume ~$8M/day. No price move yet.',
  },
  {
    label: '⚖️ SEC Action',
    type: 'MACRO_EVENT' as SignalType,
    text: 'SEC announces emergency enforcement action against Binance.US. Trading halt expected. BTC -2.1% in 5 mins, ETH -3.4%. Volume spiking 8x across all pairs.',
  },
];

const SIGNAL_TYPES: { value: SignalType; label: string }[] = [
  { value: 'NEWS_SIGNAL',    label: 'News'     },
  { value: 'MACRO_EVENT',    label: 'Macro'    },
  { value: 'SOCIAL_SPIKE',   label: 'Social'   },
  { value: 'MARKET_SIGNAL',  label: 'Market'   },
];

// ── Helpers ───────────────────────────────────────────────────

function actionMeta(action: string) {
  if (action === 'BUY')  return { color: 'text-accent-green', bg: 'bg-accent-green/10 border-accent-green/30', icon: TrendingUp,   glow: 'shadow-[0_0_20px_rgba(0,255,136,0.15)]' };
  if (action === 'SELL') return { color: 'text-accent-red',   bg: 'bg-accent-red/10 border-accent-red/30',     icon: TrendingDown, glow: 'shadow-[0_0_20px_rgba(255,68,102,0.15)]' };
  return                        { color: 'text-accent-yellow',bg: 'bg-accent-yellow/10 border-accent-yellow/30',icon: Minus,       glow: '' };
}

function sentimentColor(s: string) {
  if (s === 'BULLISH') return 'text-accent-green';
  if (s === 'BEARISH') return 'text-accent-red';
  return 'text-accent-yellow';
}

function entryMeta(e: string) {
  if (e === 'EARLY')        return { color: 'text-accent-green bg-accent-green/10',   label: '⚡ EARLY' };
  if (e === 'CONFIRMATION') return { color: 'text-accent-yellow bg-accent-yellow/10', label: '✓ CONFIRMATION' };
  return                           { color: 'text-accent-red bg-accent-red/10',        label: '⚠ LATE' };
}

function scoreRing(value: number, max = 100) {
  const pct = value / max;
  const r   = 28, circ = 2 * Math.PI * r;
  return { dashArray: circ, dashOffset: circ * (1 - pct) };
}

function scoreColor(v: number) {
  if (v >= 70) return '#ff4466';
  if (v >= 40) return '#ffcc00';
  return '#00ff88';
}
function oppColor(v: number) {
  if (v >= 70) return '#00ff88';
  if (v >= 40) return '#ffcc00';
  return '#888';
}

// ── Score ring ────────────────────────────────────────────────

function ScoreRing({ value, color, label }: { value: number; color: string; label: string }) {
  const { dashArray, dashOffset } = scoreRing(value);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-16 h-16">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
          <circle
            cx="32" cy="32" r="28" fill="none"
            stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={dashArray} strokeDashoffset={dashOffset}
            style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono font-bold text-sm text-white">
          {value}
        </span>
      </div>
      <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
    </div>
  );
}

// ── RR bar ────────────────────────────────────────────────────

function RRBar({ ratio }: { ratio: number }) {
  const pct = Math.min(100, (ratio / 5) * 100);
  const col = ratio >= 2.5 ? '#00ff88' : ratio >= 1.5 ? '#ffcc00' : '#ff4466';
  const quality = ratio >= 2.5 ? 'High quality' : ratio >= 1.5 ? 'Acceptable' : 'Avoid';
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-widest text-text-muted">Risk / Reward</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted">{quality}</span>
          <span className="font-mono font-bold text-sm" style={{ color: col }}>{ratio.toFixed(1)}x</span>
        </div>
      </div>
      <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: col, boxShadow: `0 0 8px ${col}` }}
        />
      </div>
    </div>
  );
}

// ── Decision card ─────────────────────────────────────────────

function DecisionCard({ d }: { d: TradingDecision }) {
  const am  = actionMeta(d.action);
  const em  = entryMeta(d.entryType);
  const ActionIcon = am.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-5 space-y-4 ${am.bg} ${am.glow}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center w-12 h-12 rounded-lg border ${am.bg}`}>
            <ActionIcon className={`w-6 h-6 ${am.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`font-mono font-black text-2xl ${am.color}`}>{d.action}</span>
              <span className="text-text-primary font-bold text-base">{d.symbol}</span>
              {d.isEarlySignal && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-green/20 text-accent-green font-bold border border-accent-green/30">
                  ⚡ EARLY
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs font-mono ${sentimentColor(d.sentiment)}`}>{d.sentiment}</span>
              <span className="text-text-muted">·</span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${em.color}`}>{em.label}</span>
              <span className="text-text-muted">·</span>
              <span className="text-xs text-text-muted font-mono">{d.eventType.replace('_', ' ')}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right flex-shrink-0">
          <div>
            <div className="text-xs text-text-muted font-mono">{d.expectedMoveWindow}</div>
            <div className="text-[10px] text-text-muted">{d.timeHorizon}</div>
          </div>
          <Clock className="w-3.5 h-3.5 text-text-muted" />
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-text-secondary leading-relaxed border-l-2 border-white/10 pl-3">
        {d.summary}
      </p>

      {/* Scores */}
      <div className="flex justify-around py-3 bg-black/20 rounded-lg border border-white/5">
        <ScoreRing value={d.riskScore}        color={scoreColor(d.riskScore)}       label="Risk"        />
        <ScoreRing value={d.opportunityScore} color={oppColor(d.opportunityScore)}   label="Opportunity" />
        <ScoreRing value={d.confidence}       color="#6688ff"                        label="Confidence"  />
      </div>

      {/* RR */}
      <RRBar ratio={d.riskRewardRatio} />

      {/* Key drivers */}
      {d.keyDrivers.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-widest text-text-muted">Key Drivers</span>
          <div className="flex flex-wrap gap-2">
            {d.keyDrivers.map((drv, i) => (
              <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-bg-tertiary text-text-secondary border border-bg-border">
                {drv}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Analysis */}
      {d.analysis && (
        <div className="p-3 rounded-lg bg-black/30 border border-white/5">
          <p className="text-xs text-text-muted font-mono leading-relaxed">{d.analysis}</p>
        </div>
      )}
    </motion.div>
  );
}

// ── History row ───────────────────────────────────────────────

function HistoryRow({ d, onClick }: { d: TradingDecision; onClick: () => void }) {
  const am = actionMeta(d.action);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-bg-tertiary hover:bg-bg-border border border-transparent hover:border-bg-border text-left transition-all"
    >
      <span className={`font-mono font-bold text-xs w-9 flex-shrink-0 ${am.color}`}>{d.action}</span>
      <span className="font-semibold text-sm text-text-primary w-14 flex-shrink-0">{d.symbol}</span>
      <span className="text-xs text-text-muted flex-1 truncate">{d.summary}</span>
      <div className="flex gap-3 flex-shrink-0 font-mono text-[10px]">
        <span style={{ color: scoreColor(d.riskScore) }}>R:{d.riskScore}</span>
        <span style={{ color: oppColor(d.opportunityScore) }}>O:{d.opportunityScore}</span>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function TradingEnginePage() {
  const { user } = useAuthStore();
  const [text,       setText]       = useState('');
  const [signalType, setSignalType] = useState<SignalType>('NEWS_SIGNAL');
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<TradingDecision | null>(null);
  const [error,      setError]      = useState('');
  const [history,    setHistory]    = useState<TradingDecision[]>([]);
  const [activeTab,  setActiveTab]  = useState<'analyze' | 'history'>('analyze');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isPro = user?.plan === 'PRO' || user?.plan === 'ENTERPRISE';

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const analyze = useCallback(async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res  = await tradingEngineApi.manual({ text, symbols: [] });
      const data = res.data.data as TradingDecision;
      data.id    = data.id ?? crypto.randomUUID();
      setResult(data);
      setHistory((h) => [data, ...h].slice(0, 20));
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Analysis failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [text, loading]);

  function loadExample(ex: typeof EXAMPLES[0]) {
    setText(ex.text);
    setSignalType(ex.type);
    setResult(null);
    setError('');
    textareaRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 flex items-center justify-center flex-shrink-0">
            <Crosshair className="w-5 h-5 text-accent-cyan" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary font-display leading-none">
              Trading Decision Engine
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Paste any market signal — news, tweet, whale alert, macro event. Get an instant hedge-fund-grade decision.
            </p>
          </div>
        </div>

        {/* PRO gate */}
        {!isPro && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-accent-yellow/5 border border-accent-yellow/20">
            <AlertTriangle className="w-5 h-5 text-accent-yellow flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-text-primary">PRO feature</p>
              <p className="text-xs text-text-muted">Upgrade your plan to access the Trading Decision Engine.</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-bg-secondary rounded-lg border border-bg-border">
          {(['analyze', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === t
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {t === 'analyze' ? <Sparkles className="w-3.5 h-3.5" /> : <History className="w-3.5 h-3.5" />}
              {t === 'analyze' ? 'Analyze' : `History ${history.length > 0 ? `(${history.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* Analyze tab */}
        {activeTab === 'analyze' && (
          <div className="space-y-4">

            {/* Signal type selector */}
            <div className="flex gap-2">
              {SIGNAL_TYPES.map((st) => (
                <button
                  key={st.value}
                  onClick={() => setSignalType(st.value)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    signalType === st.value
                      ? 'bg-accent-cyan/10 border-accent-cyan/40 text-accent-cyan'
                      : 'bg-bg-secondary border-bg-border text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Quick examples */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Quick examples</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => loadExample(ex)}
                    className="text-xs px-3 py-1.5 rounded-md bg-bg-secondary border border-bg-border text-text-muted hover:text-text-primary hover:border-bg-border/60 transition-all"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Textarea */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') analyze(); }}
                disabled={!isPro}
                placeholder="Paste any market signal here — news headline, tweet, whale alert, macro event, price action..."
                rows={5}
                className="w-full bg-bg-secondary border border-bg-border rounded-xl p-4 text-sm text-text-primary placeholder:text-text-muted resize-y focus:outline-none focus:border-accent-cyan/40 transition-colors disabled:opacity-40 font-mono"
              />
              <div className="absolute bottom-3 right-3 text-[10px] text-text-muted">
                ⌘+Enter
              </div>
            </div>

            {/* Analyze button */}
            <button
              onClick={analyze}
              disabled={!isPro || loading || !text.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all
                bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan
                hover:bg-accent-cyan/20 hover:border-accent-cyan/50
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Running decision engine...</>
              ) : (
                <><Send className="w-4 h-4" />Analyze Signal</>
              )}
            </button>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 text-accent-red text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Result */}
            <AnimatePresence>
              {result && !loading && <DecisionCard d={result} />}
            </AnimatePresence>
          </div>
        )}

        {/* History tab */}
        {activeTab === 'history' && (
          <div className="space-y-2">
            {history.length === 0 ? (
              <div className="text-center py-16 text-text-muted">
                <Target className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No decisions yet. Analyze a signal first.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs text-text-muted">{history.length} decision{history.length !== 1 ? 's' : ''} this session</span>
                  <button
                    onClick={() => setHistory([])}
                    className="flex items-center gap-1 text-xs text-text-muted hover:text-accent-red transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Clear
                  </button>
                </div>
                {history.map((d) => (
                  <HistoryRow
                    key={d.id}
                    d={d}
                    onClick={() => { setResult(d); setActiveTab('analyze'); }}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-center text-[10px] text-text-muted uppercase tracking-widest pb-4">
          Not financial advice · Informational purposes only
        </p>
      </div>
    </div>
  );
}
