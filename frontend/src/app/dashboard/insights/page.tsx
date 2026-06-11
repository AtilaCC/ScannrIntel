'use client';

import { useEffect, useState } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import { insightApi } from '@/lib/api';
import { useMarketStore } from '@/store/marketStore';
import { AIInsightsFeed } from '@/components/insights/AIInsightsFeed';
import { toast } from 'sonner';

const SYMBOLS   = ['Todos', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const SENTIMENTOS = ['Todos', 'BULLISH', 'BEARISH', 'NEUTRAL'];
const SENTIMENTO_LABELS: Record<string, string> = { Todos: 'Todos', BULLISH: 'Altista', BEARISH: 'Baixista', NEUTRAL: 'Neutro' };

export default function InsightsPage() {
  const { insights: liveInsights } = useMarketStore();
  const [historicalInsights, setHistoricalInsights] = useState<any[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [filterSymbol,  setFilterSymbol]  = useState('Todos');
  const [filterSentiment, setFilterSentiment] = useState('Todos');
  const [page,  setPage]  = useState(1);
  const [total, setTotal] = useState(0);

  const fetchInsights = async (p = 1) => {
    setLoading(true);
    try {
      const res = await insightApi.getAll({
        page: p,
        symbol: filterSymbol === 'Todos' ? undefined : filterSymbol,
      });
      setHistoricalInsights(p === 1 ? res.data.data : (prev: any) => [...prev, ...res.data.data]);
      setTotal(res.data.meta?.total || 0);
    } catch { toast.error('Falha ao carregar insights'); }
    finally { setLoading(false); }
  };

  useEffect(() => { setPage(1); fetchInsights(1); }, [filterSymbol]);

  const allInsights = [...liveInsights, ...historicalInsights]
    .filter((ins, i, arr) => arr.findIndex((x: any) => x.id === ins.id) === i)
    .filter((ins) => filterSentiment === 'Todos' || ins.sentiment === filterSentiment);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Insights de IA</h1>
          <p className="text-text-secondary text-sm mt-1">
            Análise de mercado por{' '}
            <span className="text-accent-purple font-semibold">IA</span>
          </p>
        </div>
        <button
          onClick={() => fetchInsights(1)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-bg-border rounded-lg text-text-secondary hover:border-accent-cyan hover:text-accent-cyan text-sm transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div>
          <div className="text-text-muted text-xs font-mono mb-1.5 uppercase">Símbolo</div>
          <div className="flex flex-wrap gap-1.5">
            {SYMBOLS.map((s) => (
              <button key={s} onClick={() => setFilterSymbol(s)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${
                  filterSymbol === s
                    ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                    : 'bg-bg-secondary text-text-muted border border-bg-border hover:border-text-muted'
                }`}>
                {s === 'Todos' ? 'Todos' : s.replace('USDT', '')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-text-muted text-xs font-mono mb-1.5 uppercase">Sentimento</div>
          <div className="flex gap-1.5">
            {SENTIMENTOS.map((s) => (
              <button key={s} onClick={() => setFilterSentiment(s)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${
                  filterSentiment === s
                    ? s === 'BULLISH' ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                    : s === 'BEARISH' ? 'bg-accent-red/20 text-accent-red border border-accent-red/30'
                    : 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                    : 'bg-bg-secondary text-text-muted border border-bg-border hover:border-text-muted'
                }`}>
                {SENTIMENTO_LABELS[s] ?? s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total de Insights', value: total,                                                            color: 'text-accent-purple' },
          { label: 'Altista',           value: allInsights.filter((i) => i.sentiment === 'BULLISH').length,      color: 'text-accent-green'  },
          { label: 'Baixista',          value: allInsights.filter((i) => i.sentiment === 'BEARISH').length,      color: 'text-accent-red'    },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-card rounded-xl p-4 text-center">
            <div className={`font-display text-2xl font-bold tabular-nums ${color}`}>{value}</div>
            <div className="text-text-muted text-xs mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Feed de insights */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-bg-border">
          <Brain className="w-4 h-4 text-accent-purple" />
          <h2 className="font-display font-bold text-text-primary text-sm">
            {allInsights.length} insights {filterSentiment !== 'Todos' && `· ${SENTIMENTO_LABELS[filterSentiment]}`}
          </h2>
        </div>
        <div>
          {loading && allInsights.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-text-muted">
              <RefreshCw className="w-6 h-6 animate-spin mr-3" />
              Carregando insights...
            </div>
          ) : allInsights.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-3">
              <Brain className="w-12 h-12 opacity-20" />
              <p className="text-sm">Aguardando sinais de mercado para analisar...</p>
              <p className="text-xs opacity-60">Motor de IA pronto</p>
            </div>
          ) : (
            <AIInsightsFeed insights={allInsights} />
          )}
        </div>
      </div>

      {allInsights.length < total && (
        <div className="text-center">
          <button
            onClick={() => { const next = page + 1; setPage(next); fetchInsights(next); }}
            disabled={loading}
            className="px-6 py-2 bg-bg-secondary border border-bg-border text-text-secondary rounded-lg text-sm hover:border-accent-cyan hover:text-accent-cyan transition-all disabled:opacity-50"
          >
            {loading ? 'Carregando...' : 'Carregar Mais'}
          </button>
        </div>
      )}
    </div>
  );
}
