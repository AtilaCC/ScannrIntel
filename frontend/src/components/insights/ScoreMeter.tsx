'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, ShieldAlert, TrendingUp, Info } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface ScoreFactor {
  name:        string;
  score:       number;
  weight:      number;
  direction:   string;
  explanation: string;
}

interface ScoreBreakdown {
  factors:             ScoreFactor[];
  compositeRisk:       number;
  compositeOpportunity:number;
  claudeRisk:          number;
  claudeOpportunity:   number;
  finalRisk:           number;
  finalOpportunity:    number;
  ruleWeight:          number;
  claudeWeight:        number;
  computedAt:          number;
}

interface ScoreMeterProps {
  symbol:          string;
  riskScore:       number;
  opportunityScore:number;
  sentiment:       'ALTISTA' | 'BAIXISTA' | 'NEUTRO';
  breakdown?:      ScoreBreakdown;
  computedAt?:     number;
  compact?:        boolean; // condensed mode for table rows
}

// ── Score colour helpers ──────────────────────────────────────

function riskColour(score: number): string {
  if (score >= 80) return 'text-red-400';
  if (score >= 60) return 'text-orange-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-green-400';
}

function riskBg(score: number): string {
  if (score >= 80) return 'bg-red-500';
  if (score >= 60) return 'bg-orange-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-green-500';
}

function oppColour(score: number): string {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-cyan-400';
  if (score >= 25) return 'text-blue-400';
  return 'text-text-muted';
}

function oppBg(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-cyan-500';
  if (score >= 25) return 'bg-blue-500';
  return 'bg-gray-600';
}

function riskLabel(score: number): string {
  if (score >= 80) return 'EXTREME';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  if (score >= 20) return 'LOW';
  return 'MINIMAL';
}

function oppLabel(score: number): string {
  if (score >= 75) return 'STRONG';
  if (score >= 50) return 'MODERATE';
  if (score >= 25) return 'WEAK';
  return 'NONE';
}

// ── Arc gauge ────────────────────────────────────────────────

function ArcGauge({
  score, colour, bg, size = 80,
}: { score: number; colour: string; bg: string; size?: number }) {
  const r          = size * 0.38;
  const cx         = size / 2;
  const cy         = size / 2;
  const circumference = Math.PI * r;           // half-circle arc
  const offset     = circumference * (1 - score / 100);

  return (
    <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
      {/* Track */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke="#1E2D4A" strokeWidth="6" strokeLinecap="round"
      />
      {/* Fill */}
      <motion.path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        className={bg.replace('bg-', 'stroke-')}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </svg>
  );
}

// ── Horizontal bar ───────────────────────────────────────────

function ScoreBar({
  score, bg, label,
}: { score: number; bg: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-text-muted truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-bg-border rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${bg}`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="w-8 text-right font-mono text-text-secondary">{score}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function ScoreMeter({
  symbol, riskScore, opportunityScore, sentiment, breakdown, computedAt, compact = false,
}: ScoreMeterProps) {
  const [expanded, setExpanded] = useState(false);

  const sentimentColour =
    sentiment === 'ALTISTA' ? 'text-accent-green' :
    sentiment === 'BAIXISTA' ? 'text-accent-red'   : 'text-text-muted';

  const sentimentBg =
    sentiment === 'ALTISTA' ? 'bg-accent-green/10 border-accent-green/20' :
    sentiment === 'BAIXISTA' ? 'bg-accent-red/10 border-accent-red/20'     :
    'bg-bg-secondary border-bg-border';

  // ── Compact mode (for token table rows) ──────────────────
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {/* Risk pill */}
        <div className="flex items-center gap-1">
          <ShieldAlert className={`w-3 h-3 ${riskColour(riskScore)}`} />
          <span className={`font-mono text-xs font-bold ${riskColour(riskScore)}`}>
            {riskScore}
          </span>
        </div>
        {/* Opportunity pill */}
        <div className="flex items-center gap-1">
          <TrendingUp className={`w-3 h-3 ${oppColour(opportunityScore)}`} />
          <span className={`font-mono text-xs font-bold ${oppColour(opportunityScore)}`}>
            {opportunityScore}
          </span>
        </div>
      </div>
    );
  }

  // ── Full mode ────────────────────────────────────────────
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-text-primary text-sm">
            {symbol.replace('USDT', '')}<span className="text-text-muted">/USDT</span>
          </span>
          <span className={`text-xs font-semibold border rounded px-2 py-0.5 ${sentimentBg} ${sentimentColour}`}>
            {sentiment}
          </span>
        </div>
        {computedAt && (
          <span className="text-text-muted text-xs font-mono">
            {new Date(computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Dual gauge row */}
      <div className="grid grid-cols-2 divide-x divide-bg-border">
        {/* Risk gauge */}
        <div className="flex flex-col items-center py-5 px-4">
          <div className="relative">
            <ArcGauge score={riskScore} colour={riskColour(riskScore)} bg={riskBg(riskScore)} />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
              <div className={`font-display text-2xl font-bold tabular-nums ${riskColour(riskScore)}`}>
                {riskScore}
              </div>
            </div>
          </div>
          <div className="mt-2 text-center">
            <div className="text-text-muted text-xs font-mono uppercase tracking-wider flex items-center gap-1 justify-center">
              <ShieldAlert className="w-3 h-3" /> RISK
            </div>
            <div className={`text-xs font-bold mt-0.5 ${riskColour(riskScore)}`}>
              {riskLabel(riskScore)}
            </div>
          </div>
        </div>

        {/* Opportunity gauge */}
        <div className="flex flex-col items-center py-5 px-4">
          <div className="relative">
            <ArcGauge score={opportunityScore} colour={oppColour(opportunityScore)} bg={oppBg(opportunityScore)} />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
              <div className={`font-display text-2xl font-bold tabular-nums ${oppColour(opportunityScore)}`}>
                {opportunityScore}
              </div>
            </div>
          </div>
          <div className="mt-2 text-center">
            <div className="text-text-muted text-xs font-mono uppercase tracking-wider flex items-center gap-1 justify-center">
              <TrendingUp className="w-3 h-3" /> OPPORTUNITY
            </div>
            <div className={`text-xs font-bold mt-0.5 ${oppColour(opportunityScore)}`}>
              {oppLabel(opportunityScore)}
            </div>
          </div>
        </div>
      </div>

      {/* Blend source info */}
      {breakdown && (
        <div className="px-5 py-2 bg-bg-secondary/50 border-t border-bg-border">
          <div className="flex items-center justify-between text-xs font-mono text-text-muted">
            <span>
              Rules {Math.round(breakdown.ruleWeight * 100)}% ·
              Claude {Math.round(breakdown.claudeWeight * 100)}%
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 hover:text-text-secondary transition-colors"
            >
              <Info className="w-3 h-3" />
              {expanded ? 'Hide' : 'Breakdown'}
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>
      )}

      {/* Expandable factor breakdown */}
      <AnimatePresence>
        {expanded && breakdown && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 space-y-4 border-t border-bg-border">

              {/* Factor bars */}
              <div className="space-y-2.5">
                <div className="text-text-muted text-xs font-mono uppercase tracking-wider mb-3">
                  Factor Breakdown
                </div>
                {breakdown.factors.map((f) => (
                  <div key={f.name} className="space-y-0.5">
                    <ScoreBar
                      score={f.score}
                      bg={f.score >= 70 ? 'bg-red-500' : f.score >= 45 ? 'bg-yellow-500' : 'bg-green-500'}
                      label={f.name}
                    />
                    <p className="text-text-muted text-xs ml-30 pl-[7.5rem]">
                      {f.explanation}
                    </p>
                  </div>
                ))}
              </div>

              {/* Score audit trail */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-bg-border/50">
                <div>
                  <div className="text-text-muted text-xs font-mono mb-2">RISK AUDIT</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Rule composite</span>
                      <span className="font-mono text-text-secondary">{breakdown.compositeRisk}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Claude score</span>
                      <span className="font-mono text-text-secondary">{breakdown.claudeRisk}</span>
                    </div>
                    <div className="flex justify-between border-t border-bg-border/50 pt-1 mt-1">
                      <span className="text-text-secondary font-medium">Final</span>
                      <span className={`font-mono font-bold ${riskColour(breakdown.finalRisk)}`}>
                        {breakdown.finalRisk}
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-text-muted text-xs font-mono mb-2">OPPORTUNITY AUDIT</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Rule composite</span>
                      <span className="font-mono text-text-secondary">{breakdown.compositeOpportunity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Claude score</span>
                      <span className="font-mono text-text-secondary">{breakdown.claudeOpportunity}</span>
                    </div>
                    <div className="flex justify-between border-t border-bg-border/50 pt-1 mt-1">
                      <span className="text-text-secondary font-medium">Final</span>
                      <span className={`font-mono font-bold ${oppColour(breakdown.finalOpportunity)}`}>
                        {breakdown.finalOpportunity}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
