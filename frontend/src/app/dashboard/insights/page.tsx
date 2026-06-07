'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, RefreshCw, Filter } from 'lucide-react';
import { insightApi } from '../../lib/api';
import { useMarketStore } from '../../store/marketStore';
import { AIInsightsFeed } from '../../components/insights/AIInsightsFeed';
import { toast } from 'sonner';

const SYMBOLS = ['All', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const SENTIMENTS = ['All', 'BULLISH', 'BEARISH', 'NEUTRAL'];

export default function InsightsPage() {
  const { insights: liveInsights } = useMarketStore();
  const [historicalInsights, setHistoricalInsights] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSymbol, setFilterSymbol] = useState('All');
  const [filterSentiment, setFilterSentiment] = useState('All');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchInsights = async (p = 1) => {
    setLoading(true);
    try {
      const res = await insightApi.getAll({
        page: p,
        symbol: filterSymbol === 'All' ? undefined : filterSymbol,
      });
      setHistoricalInsights(p === 1 ? res.data.data : (prev: any) => [...prev, ...res.data.data]);
      setTotal(res.data.meta?.total || 0);
    } catch { toast.error('Failed to load insights'); }
    finally { setLoading(false); }
  };

  useEffect(() => { setPage(1); fetchInsights(1); }, [filterSymbol]);

  const allInsights = [...liveInsights, ...historicalInsights]
    .filter((ins, i, arr) => arr.findIndex((x) => x.id === ins.id) === i)
    .filter((ins) => filterSentiment === 'All' || ins.sentiment === filterSentiment);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">AI Insights</h1>
          <p className="text-text-secondary text-sm mt-1">
            Market analysis powered by{' '}
            <span className="text-accent-purple font-semibold">Claude AI</span>
          </p>
        </div>
        <button
          onClick={() => fetchInsights(1)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-bg-border rounded-lg text-text-secondary hover:border-accent-cyan hover:text-accent-cyan text-sm transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div>
          <div className="text-text-muted text-xs font-mono mb-1.5 uppercase">Symbol</div>
          <div className="flex flex-wrap gap-1.5">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => setFilterSymbol(s)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${
                  filterSymbol === s
                    ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                    : 'bg-bg-secondary text-text-muted border border-bg-border hover:border-text-muted'
                }`}
              >
                {s === 'All' ? 'All' : s.replace('USDT', '')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-text-muted text-xs font-mono mb-1.5 uppercase">Sentiment</div>
          <div className="flex gap-1.5">
            {SENTIMENTS.map((s) => (
              <button
                key={s}
                onClick={() => setFilterSentiment(s)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${
                  filterSentiment === s
                    ? s === 'BULLISH' ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                    : s === 'BEARISH' ? 'bg-accent-red/20 text-accent-red border border-accent-red/30'
                    : 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                    : 'bg-bg-secondary text-text-muted border border-bg-border hover:border-text-muted'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Insights', value: total, color: 'text-accent-purple' },
          { label: 'Bullish', value: allInsights.filter((i) => i.sentiment === 'BULLISH').length, color: 'text-accent-green' },
          { label: 'Bearish', value: allInsights.filter((i) => i.sentiment === 'BEARISH').length, color: 'text-accent-red' },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-card rounded-xl p-4 text-center">
            <div className={`font-display text-2xl font-bold tabular-nums ${color}`}>{value}</div>
            <div className="text-text-muted text-xs mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Insights feed */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-bg-border">
          <Brain className="w-4 h-4 text-accent-purple" />
          <h2 className="font-display font-bold text-text-primary text-sm">
            {allInsights.length} insights {filterSentiment !== 'All' && `· ${filterSentiment}`}
          </h2>
        </div>
        <div className="max-h-none">
          {loading && allInsights.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-text-muted">
              <RefreshCw className="w-6 h-6 animate-spin mr-3" />
              Loading insights...
            </div>
          ) : (
            <AIInsightsFeed insights={allInsights} />
          )}
        </div>
      </div>

      {/* Load more */}
      {allInsights.length < total && (
        <div className="text-center">
          <button
            onClick={() => { const next = page + 1; setPage(next); fetchInsights(next); }}
            disabled={loading}
            className="px-6 py-2 bg-bg-secondary border border-bg-border text-text-secondary rounded-lg text-sm hover:border-accent-cyan hover:text-accent-cyan transition-all disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}
