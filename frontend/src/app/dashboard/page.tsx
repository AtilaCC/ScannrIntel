'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Zap, Brain, Bell, Activity } from 'lucide-react';
import { useMarketStore } from '../store/marketStore';
import { useAuthStore } from '../store/authStore';
import { insightApi, signalApi, alertApi, tokenApi } from '../lib/api';
import { TokenTable } from '../components/scanner/TokenTable';
import { AIInsightsFeed } from '../components/insights/AIInsightsFeed';
import { SignalFeed } from '../components/scanner/SignalFeed';
import { MiniPriceChart } from '../components/scanner/MiniPriceChart';
import { StatCard } from '../components/ui/StatCard';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { tickers, signals, insights, triggeredAlerts } = useMarketStore();
  const [latestInsights, setLatestInsights] = useState<any[]>([]);
  const [latestSignals, setLatestSignals] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [ins, sigs, toks, triggered] = await Promise.all([
          insightApi.getLatest(),
          signalApi.getAll({ limit: 20 }),
          tokenApi.getAll(),
          alertApi.getTriggered(),
        ]);
        setLatestInsights(ins.data.data || []);
        setLatestSignals(sigs.data.data || []);
        setTokens(toks.data.data || []);
        const unread = triggered.data.data?.filter((a: any) => !a.isRead).length || 0;
        setUnreadCount(unread);
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      }
    })();
  }, []);

  // Merge real-time signals with initial load
  const allSignals = [...signals, ...latestSignals].slice(0, 20);
  const allInsights = [...insights, ...latestInsights].slice(0, 10);

  // Stats
  const totalTickers = Object.keys(tickers).length;
  const bullish = Object.values(tickers).filter((t) => t.priceChangePercent24h > 0).length;
  const bearish = Object.values(tickers).filter((t) => t.priceChangePercent24h < 0).length;
  const criticalSignals = allSignals.filter((s) => s.severity === 'CRITICAL').length;

  const staggered = {
    container: { animate: { transition: { staggerChildren: 0.08 } } },
    item: {
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0, transition: { duration: 0.4 } },
    },
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">
            Good {getTimeOfDay()},{' '}
            <span className="text-accent-cyan">{user?.email?.split('@')[0]}</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-text-muted bg-bg-secondary border border-bg-border rounded-lg px-3 py-2">
          <Activity className="w-3 h-3 text-accent-green animate-pulse" />
          LIVE
        </div>
      </motion.div>

      {/* Stats row */}
      <motion.div
        variants={staggered.container}
        initial="initial"
        animate="animate"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {[
          { label: 'Pairs Monitored', value: totalTickers || 20, icon: Activity, color: 'cyan', suffix: '' },
          { label: 'Bullish 24h', value: bullish, icon: TrendingUp, color: 'green', suffix: '' },
          { label: 'Bearish 24h', value: bearish, icon: TrendingDown, color: 'red', suffix: '' },
          { label: 'Critical Signals', value: criticalSignals, icon: Zap, color: 'yellow', suffix: '' },
        ].map((stat) => (
          <motion.div key={stat.label} variants={staggered.item}>
            <StatCard {...stat} />
          </motion.div>
        ))}
      </motion.div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Token table — takes 2 cols */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="xl:col-span-2"
        >
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-accent-cyan" />
                <h2 className="font-display font-bold text-text-primary text-sm tracking-wide">LIVE PRICES</h2>
              </div>
              <span className="text-text-muted text-xs font-mono">
                {totalTickers || tokens.length} pairs
              </span>
            </div>
            <TokenTable tokens={tokens} liveTickers={tickers} />
          </div>
        </motion.div>

        {/* Signal feed — 1 col */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="glass-card rounded-xl overflow-hidden h-full">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-bg-border">
              <Zap className="w-4 h-4 text-accent-yellow" />
              <h2 className="font-display font-bold text-text-primary text-sm tracking-wide">SIGNALS</h2>
              {allSignals.length > 0 && (
                <span className="ml-auto bg-accent-yellow/20 text-accent-yellow text-xs font-mono px-2 py-0.5 rounded">
                  {allSignals.length}
                </span>
              )}
            </div>
            <SignalFeed signals={allSignals} />
          </div>
        </motion.div>
      </div>

      {/* AI Insights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-accent-purple" />
              <h2 className="font-display font-bold text-text-primary text-sm tracking-wide">AI INSIGHTS</h2>
              <span className="text-xs font-mono text-text-muted bg-accent-purple/10 border border-accent-purple/20 px-2 py-0.5 rounded">
                Claude AI
              </span>
            </div>
            {unreadCount > 0 && (
              <span className="text-xs font-mono text-accent-red">{unreadCount} unread alerts</span>
            )}
          </div>
          <AIInsightsFeed insights={allInsights} />
        </div>
      </motion.div>
    </div>
  );
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
