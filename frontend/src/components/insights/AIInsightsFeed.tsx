'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Tag } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface AIInsightsFeedProps {
  insights: any[];
}

function SentimentIcon({ sentiment }: { sentiment: string }) {
  if (sentiment === 'ALTISTA') return <TrendingUp className="w-3.5 h-3.5 text-accent-green" />;
  if (sentiment === 'BAIXISTA') return <TrendingDown className="w-3.5 h-3.5 text-accent-red" />;
  return <Minus className="w-3.5 h-3.5 text-text-muted" />;
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-bg-border rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className={`h-full rounded-full ${color}`}
      />
    </div>
  );
}

function InsightCard({ insight }: { insight: any }) {
  const [expanded, setExpanded] = useState(false);

  const sentimentColor =
    insight.sentiment === 'ALTISTA' ? 'text-accent-green' :
    insight.sentiment === 'BAIXISTA' ? 'text-accent-red' : 'text-text-muted';

  return (
    <motion.div
      layout
      className="border border-bg-border rounded-xl overflow-hidden hover:border-accent-purple/30 transition-colors"
    >
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-mono font-bold text-text-primary text-xs bg-bg-secondary px-2 py-0.5 rounded border border-bg-border">
                {insight.symbol?.replace('USDT', '')}/USDT
              </span>
              <span className={`flex items-center gap-1 text-xs font-semibold ${sentimentColor}`}>
                <SentimentIcon sentiment={insight.sentiment} />
                {insight.sentiment}
              </span>
              <span className="text-text-muted text-xs font-mono ml-auto">
                {insight.createdAt
                  ? formatDistanceToNow(new Date(insight.createdAt), { addSuffix: true })
                  : 'just now'}
              </span>
            </div>
            <p className="text-text-primary text-sm leading-relaxed">{insight.summary}</p>
          </div>
          <button className="text-text-muted hover:text-text-secondary flex-shrink-0 mt-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Score bars */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-text-muted">Risco</span>
              <span className="font-mono text-accent-red">{insight.riskScore}</span>
            </div>
            <ScoreBar value={insight.riskScore} color="bg-accent-red" />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-text-muted">Oportunidade</span>
              <span className="font-mono text-accent-green">{insight.opportunityScore}</span>
            </div>
            <ScoreBar value={insight.opportunityScore} color="bg-accent-green" />
          </div>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-bg-border pt-3">
              <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">
                {insight.details}
              </p>

              {insight.recommendations?.length > 0 && (
                <div>
                  <div className="text-text-muted text-xs font-mono mb-2 uppercase tracking-wide">
                    Recommendations
                  </div>
                  <ul className="space-y-1.5">
                    {insight.recommendations.map((rec: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-text-secondary text-xs">
                        <span className="text-accent-cyan font-mono mt-0.5">→</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {insight.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {insight.tags.map((tag: string) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 text-xs font-mono text-text-muted bg-bg-secondary border border-bg-border px-2 py-0.5 rounded"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-text-muted font-mono pt-1">
                <span>Confidence: {(insight.confidence * 100).toFixed(0)}%</span>
                <span className="flex items-center gap-1">
                  <Brain className="w-3 h-3 text-accent-purple" />
                  Claude AI
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function AIInsightsFeed({ insights }: AIInsightsFeedProps) {
  if (!insights.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <Brain className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm">Aguardando sinais de mercado...</p>
        <p className="text-xs mt-1 font-mono opacity-60">Motor de IA pronto</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 max-h-96 overflow-auto">
      <AnimatePresence initial={false}>
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </AnimatePresence>
    </div>
  );
}
