'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, TrendingUp, BarChart2, RefreshCw } from 'lucide-react';
import { useMarketStore } from '../../store/marketStore';
import { tokenApi, signalApi } from '../../lib/api';
import { TokenTable } from '../../components/scanner/TokenTable';
import { SignalFeed } from '../../components/scanner/SignalFeed';

export default function ScannerPage() {
  const { tickers, signals } = useMarketStore();
  const [tokens, setTokens] = useState<any[]>([]);
  const [historicalSignals, setHistoricalSignals] = useState<any[]>([]);
  const [filterType, setFilterType] = useState('All');
  const [filterSeverity, setFilterSeverity] = useState('All');

  useEffect(() => {
    (async () => {
      try {
        const [toks, sigs] = await Promise.all([
          tokenApi.getAll(),
          signalApi.getAll({ limit: 50 }),
        ]);
        setTokens(toks.data.data || []);
        setHistoricalSignals(sigs.data.data || []);
      } catch (err) { console.error(err); }
    })();
  }, []);

  const SIGNAL_TYPES = ['All', 'WHALE_TRADE', 'VOLUME_SPIKE', 'PRICE_SURGE', 'PRICE_CRASH', 'ACCUMULATION_PATTERN'];
  const SEVERITIES = ['All', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  const allSignals = [...signals, ...historicalSignals]
    .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
    .filter((s) => filterType === 'All' || s.type === filterType)
    .filter((s) => filterSeverity === 'All' || s.severity === filterSeverity);

  const liveCount = Object.keys(tickers).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Market Scanner</h1>
          <p className="text-text-secondary text-sm mt-1">
            Live Binance feed ·{' '}
            <span className="text-accent-green font-mono">{liveCount || tokens.length} pairs active</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-accent-green bg-accent-green/10 border border-accent-green/20 rounded-lg px-3 py-2">
          <Activity className="w-3 h-3 animate-pulse" />
          STREAMING
        </div>
      </div>

      {/* Market overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Signals', value: allSignals.length, icon: Activity, color: 'text-accent-cyan' },
          { label: 'Critical', value: allSignals.filter((s) => s.severity === 'CRITICAL').length, icon: TrendingUp, color: 'text-accent-red' },
          { label: 'Whale Trades', value: allSignals.filter((s) => s.type === 'WHALE_TRADE').length, icon: BarChart2, color: 'text-accent-yellow' },
          { label: 'Vol Spikes', value: allSignals.filter((s) => s.type === 'VOLUME_SPIKE').length, icon: BarChart2, color: 'text-accent-purple' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass-card rounded-xl p-4">
            <Icon className={`w-4 h-4 ${color} mb-2`} />
            <div className={`font-display text-xl font-bold tabular-nums ${color}`}>{value}</div>
            <div className="text-text-muted text-xs mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Token table */}
        <div className="xl:col-span-3 glass-card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-bg-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent-cyan" />
            <h2 className="font-display font-bold text-text-primary text-sm">LIVE PRICES</h2>
          </div>
          <TokenTable tokens={tokens} liveTickers={tickers} />
        </div>

        {/* Signals with filters */}
        <div className="xl:col-span-2 glass-card rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-bg-border">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-accent-yellow" />
              <h2 className="font-display font-bold text-text-primary text-sm">SIGNALS</h2>
              <span className="ml-auto font-mono text-xs text-text-muted">{allSignals.length}</span>
            </div>
            {/* Type filters */}
            <div className="flex flex-wrap gap-1">
              {['All', 'WHALE', 'VOLUME', 'PRICE'].map((t) => {
                const full = t === 'All' ? 'All' : t === 'WHALE' ? 'WHALE_TRADE' : t === 'VOLUME' ? 'VOLUME_SPIKE' : 'PRICE_SURGE';
                return (
                  <button
                    key={t}
                    onClick={() => setFilterType(full)}
                    className={`px-2 py-0.5 rounded text-xs font-mono transition-all ${
                      filterType === full || (t === 'PRICE' && (filterType === 'PRICE_SURGE' || filterType === 'PRICE_CRASH'))
                        ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                        : 'text-text-muted bg-bg-secondary border border-bg-border hover:text-text-secondary'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            <SignalFeed signals={allSignals} />
          </div>
        </div>
      </div>
    </div>
  );
}
