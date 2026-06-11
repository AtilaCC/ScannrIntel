'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert, TrendingUp, AtualizarCw, ArrowUpDown,
  Brain, Activity, Trophy, Zap,
} from 'lucide-react';
import { ScoreMeter } from '@/components/insights/ScoreMeter';
import { UpgradePrompt } from '@/components/billing/PlanBadge';
import { api } from '@/lib/api';
import { useMarketStore } from '@/store/marketStore';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────

interface TokenScoreRow {
  symbol:           string;
  riskScore:        number;
  opportunityScore: number;
  sentiment:        'ALTISTA' | 'BAIXISTA' | 'NEUTRO';
  computedAt:       string;
  factors?:         any[];
  compositeRisco?:   number;
  compositeOportunidade?: number;
  claudeRisco?:      number;
  claudeOportunidade?: number;
  ruleWeight?:      number;
  claudeWeight?:    number;
}

interface LeaderEntry { rank: number; symbol: string; score: number; sentiment: string; }

type ViewMode  = 'grid' | 'leaderboard';
type OrdenarField = 'risk' | 'opportunity' | 'symbol';

// ── Helpers ───────────────────────────────────────────────────

function scoreColour(score: number, type: 'risk' | 'opp'): string {
  if (type === 'risk') {
    if (score >= 80) return 'text-red-400';
    if (score >= 60) return 'text-orange-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-green-400';
  }
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-cyan-400';
  if (score >= 25) return 'text-blue-400';
  return 'text-text-muted';
}

function scoreBg(score: number, type: 'risk' | 'opp'): string {
  if (type === 'risk') {
    if (score >= 80) return 'bg-red-500/10 border-red-500/20';
    if (score >= 60) return 'bg-orange-500/10 border-orange-500/20';
    if (score >= 40) return 'bg-yellow-500/10 border-yellow-500/20';
    return 'bg-green-500/10 border-green-500/20';
  }
  if (score >= 75) return 'bg-emerald-500/10 border-emerald-500/20';
  if (score >= 50) return 'bg-cyan-500/10 border-cyan-500/20';
  return 'bg-blue-500/10 border-blue-500/20';
}

function MiniBar({ score, type }: { score: number; type: 'risk' | 'opp' }) {
  const colour = type === 'risk'
    ? score >= 80 ? 'bg-red-500' : score >= 60 ? 'bg-orange-500' : score >= 40 ? 'bg-yellow-500' : 'bg-green-500'
    : score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-cyan-500' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-bg-border rounded-full overflow-hidden w-16">
        <motion.div
          className={`h-full rounded-full ${colour}`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className={`font-mono text-xs font-bold w-6 text-right ${scoreColour(score, type)}`}>
        {score}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function ScoresPage() {
  const { tickers } = useMarketStore();
  const { user }    = useAuthStore();
  const plan        = (user as any)?.plan ?? 'FREE';

  const [scores,      setScores]      = useState<TokenScoreRow[]>([]);
  const [riskLeader,  setRiscoLeader]  = useState<LeaderEntry[]>([]);
  const [oppLeader,   setOppLeader]   = useState<LeaderEntry[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [view,        setView]        = useState<ViewMode>('grid');
  const [sortField,   setOrdenarField]   = useState<OrdenarField>('risk');
  const [sortDir,     setOrdenarDir]     = useState<'asc' | 'desc'>('desc');
  const [selected,    setSelected]    = useState<TokenScoreRow | null>(null);
  const [filterSentiment, setFiltrarSentiment] = useState<string>('Todos');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [allRes, riskRes, oppRes] = await Promise.all([
        api.get('/scores'),
        api.get('/scores/leaderboard/risk?limit=10'),
        api.get('/scores/leaderboard/opportunity?limit=10'),
      ]);

      // allRes.data.data is array of { symbol, score | null }
      const rows: TokenScoreRow[] = (allRes.data.data || [])
        .filter((d: any) => d.score !== null)
        .map((d: any) => ({ symbol: d.symbol, ...d.score }));

      setScores(rows);
      setRiscoLeader(riskRes.data.data || []);
      setOppLeader(oppRes.data.data  || []);
    } catch (err) {
      toast.error('Falha ao carregar pontuações');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Gate: FREE users see upgrade prompt
  if (plan === 'FREE') {
    return (
      <div className="p-6">
        <UpgradePrompt
          feature="Pontuações de Tokens"
          requiredPlan="PRO"
          currentPlan="FREE"
        />
      </div>
    );
  }

  // ── Ordenaring ───────────────────────────────────────────────
  const handleOrdenar = (field: OrdenarField) => {
    if (sortField === field) setOrdenarDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setOrdenarField(field); setOrdenarDir('desc'); }
  };

  const sorted = [...scores]
    .filter((s) => filterSentiment === 'Todos' || s.sentiment === filterSentiment)
    .sort((a, b) => {
      const mul = sortDir === 'desc' ? -1 : 1;
      if (sortField === 'risk')        return mul * (a.riskScore        - b.riskScore);
      if (sortField === 'opportunity') return mul * (a.opportunityScore - b.opportunityScore);
      return mul * a.symbol.localeCompare(b.symbol);
    });

  // ── Summary stats ─────────────────────────────────────────
  const avgRisco        = scores.length ? Math.round(scores.reduce((s, r) => s + r.riskScore,        0) / scores.length) : 0;
  const avgOpp         = scores.length ? Math.round(scores.reduce((s, r) => s + r.opportunityScore, 0) / scores.length) : 0;
  const highRiscoCount  = scores.filter((s) => s.riskScore >= 70).length;
  const strongOppCount = scores.filter((s) => s.opportunityScore >= 70).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Pontuações de Tokens</h1>
          <p className="text-text-secondary text-sm mt-1">
            Risco calibrado por IA &amp; pontuações de oportunidade · Rule-based + Claude analysis
          </p>
        </div>
        <button
          onClick={fetchData}
          inativo={loading}
          className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-bg-border rounded-lg text-text-secondary hover:border-accent-cyan hover:text-accent-cyan text-sm transition-all"
        >
          <AtualizarCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Avg Risco',       value: avgRisco,        icon: ShieldAlert, colour: scoreColour(avgRisco,       'risk') },
          { label: 'Avg Oportunidade',value: avgOpp,         icon: TrendingUp,  colour: scoreColour(avgOpp,        'opp')  },
          { label: 'High Risco (≥70)', value: highRiscoCount,  icon: Zap,         colour: 'text-accent-red'                  },
          { label: 'Strong Opp (≥70)',value: strongOppCount, icon: Trophy,      colour: 'text-accent-green'                },
        ].map(({ label, value, icon: Icon, colour }) => (
          <div key={label} className="glass-card rounded-xl p-4">
            <Icon className={`w-4 h-4 ${colour} mb-2`} />
            <div className={`font-display text-2xl font-bold tabular-nums ${colour}`}>{value}</div>
            <div className="text-text-muted text-xs mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* View toggle + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-bg-secondary border border-bg-border rounded-lg p-1">
          {(['grid', 'leaderboard'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded text-sm font-medium capitalize transition-all ${
                view === v
                  ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Sentiment filter */}
        <div className="flex gap-1.5">
          {['Todos', 'ALTISTA', 'NEUTRO', 'BAIXISTA'].map((s) => (
            <button
              key={s}
              onClick={() => setFiltrarSentiment(s)}
              className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${
                filterSentiment === s
                  ? s === 'ALTISTA' ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : s === 'BAIXISTA' ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                  : 'bg-bg-secondary text-text-muted border border-bg-border hover:text-text-secondary'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-text-muted">
          <AtualizarCw className="w-6 h-6 animate-spin mr-3" />
          Loading scores...
        </div>
      ) : (
        <>
          {/* ── GRID VIEW ─────────────────────────────────── */}
          {view === 'grid' && (
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-accent-purple" />
                  <h2 className="font-display font-bold text-text-primary text-sm">
                    {sorted.length} Scored Tokens
                  </h2>
                </div>
                {/* Ordenar controls */}
                <div className="flex gap-2">
                  {(['risk', 'opportunity', 'symbol'] as OrdenarField[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => handleOrdenar(f)}
                      className={`px-2 py-1 rounded text-xs font-mono flex items-center gap-1 transition-all ${
                        sortField === f
                          ? 'text-accent-cyan bg-accent-cyan/10'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {f.toUpperCase()}
                      <ArrowUpDown className="w-2.5 h-2.5" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-auto max-h-[600px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-card z-10">
                    <tr className="border-b border-bg-border">
                      <th className="px-4 py-3 text-left text-text-muted font-mono text-xs">PAR</th>
                      <th className="px-4 py-3 text-left text-text-muted font-mono text-xs">PREÇO</th>
                      <th className="px-4 py-3 text-left text-text-muted font-mono text-xs">RISK</th>
                      <th className="px-4 py-3 text-left text-text-muted font-mono text-xs">OPPORTUNITY</th>
                      <th className="px-4 py-3 text-left text-text-muted font-mono text-xs">SENTIMENTO</th>
                      <th className="px-4 py-3 text-left text-text-muted font-mono text-xs">ATUALIZADO</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {sorted.map((row, i) => {
                        const live       = tickers[row.symbol];
                        const price      = live?.price ?? 0;
                        const sentColour =
                          row.sentiment === 'ALTISTA' ? 'text-accent-green' :
                          row.sentiment === 'BAIXISTA' ? 'text-accent-red'   : 'text-text-muted';

                        return (
                          <motion.tr
                            key={row.symbol}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.02 }}
                            onClick={() => setSelected(selected?.symbol === row.symbol ? null : row)}
                            className="border-b border-bg-border/50 hover:bg-bg-tertiary/50 cursor-pointer transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold">
                                  {row.symbol.charAt(0)}
                                </div>
                                <span className="font-mono font-semibold text-text-primary text-xs">
                                  {row.symbol.replace('USDT', '')}<span className="text-text-muted">/USDT</span>
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-text-primary">
                              {price > 0 ? `$${price >= 1000 ? price.toLocaleString('en-US', { maximumFractionDigits: 0 }) : price.toFixed(4)}` : '—'}
                            </td>
                            <td className="px-4 py-3 w-36">
                              <MiniBar score={row.riskScore} type="risk" />
                            </td>
                            <td className="px-4 py-3 w-36">
                              <MiniBar score={row.opportunityScore} type="opp" />
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-bold ${sentColour}`}>{row.sentiment}</span>
                            </td>
                            <td className="px-4 py-3 text-text-muted text-xs font-mono">
                              {row.computedAt ? new Date(row.computedAt).toLocaleTimeString() : '—'}
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── LEADERBOARD VIEW ──────────────────────────── */}
          {view === 'leaderboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Risco leaderboard */}
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-bg-border">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  <h2 className="font-display font-bold text-text-primary text-sm">Maior Risco</h2>
                </div>
                <div className="divide-y divide-bg-border/50">
                  {riskLeader.map((entry) => (
                    <div
                      key={entry.symbol}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-bg-tertiary/50 transition-colors"
                    >
                      <span className="font-display text-lg font-bold text-text-muted w-6 text-center">
                        {entry.rank}
                      </span>
                      <div className="flex-1 font-mono text-sm font-semibold text-text-primary">
                        {entry.symbol.replace('USDT', '')}/USDT
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <MiniBar score={entry.score} type="risk" />
                        </div>
                      </div>
                    </div>
                  ))}
                  {riskLeader.length === 0 && (
                    <div className="py-10 text-center text-text-muted text-sm">
                      Sem dados de pontuação ainda
                    </div>
                  )}
                </div>
              </div>

              {/* Oportunidade leaderboard */}
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-bg-border">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <h2 className="font-display font-bold text-text-primary text-sm">Melhor Oportunidade</h2>
                </div>
                <div className="divide-y divide-bg-border/50">
                  {oppLeader.map((entry) => (
                    <div
                      key={entry.symbol}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-bg-tertiary/50 transition-colors"
                    >
                      <span className="font-display text-lg font-bold text-text-muted w-6 text-center">
                        {entry.rank}
                      </span>
                      <div className="flex-1 font-mono text-sm font-semibold text-text-primary">
                        {entry.symbol.replace('USDT', '')}/USDT
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <MiniBar score={entry.score} type="opp" />
                        </div>
                      </div>
                    </div>
                  ))}
                  {oppLeader.length === 0 && (
                    <div className="py-10 text-center text-text-muted text-sm">
                      Sem dados de pontuação ainda
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Detail panel (slide-in on row click) ─────────── */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 w-96 z-50 shadow-card"
          >
            <ScoreMeter
              symbol={selected.symbol}
              riskScore={selected.riskScore}
              opportunityScore={selected.opportunityScore}
              sentiment={selected.sentiment}
              breakdown={selected.factors ? {
                factors:              selected.factors,
                compositeRisco:        selected.compositeRisco        ?? selected.riskScore,
                compositeOportunidade: selected.compositeOportunidade ?? selected.opportunityScore,
                claudeRisco:           selected.claudeRisco           ?? selected.riskScore,
                claudeOportunidade:    selected.claudeOportunidade    ?? selected.opportunityScore,
                finalRisco:            selected.riskScore,
                finalOportunidade:     selected.opportunityScore,
                ruleWeight:           selected.ruleWeight            ?? 0.55,
                claudeWeight:         selected.claudeWeight          ?? 0.45,
                computedAt:           new Date(selected.computedAt).getTime(),
              } : undefined}
              computedAt={selected.computedAt ? new Date(selected.computedAt).getTime() : undefined}
            />
            <button
              onClick={() => setSelected(null)}
              className="absolute top-2 right-2 text-text-muted hover:text-text-primary w-6 h-6 flex items-center justify-center rounded-full bg-bg-secondary border border-bg-border text-xs"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
