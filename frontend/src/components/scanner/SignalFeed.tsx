'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Zap, TrendingUp, TrendingDown, BarChart2, Fish } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const SIGNAL_ICONS: Record<string, any> = {
  BALEIA_TRADE: Fish,
  VOLUME_SPIKE: BarChart2,
  PREÇO_SURGE: TrendingUp,
  PREÇO_CRASH: TrendingDown,
  ACCUMULATION_PATTERN: TrendingUp,
  DUMP_PATTERN: TrendingDown,
  LIQUIDITY_ANOMALY: Zap,
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'severity-critical',
  HIGH: 'severity-high',
  MEDIUM: 'severity-medium',
  LOW: 'severity-low',
};

interface SignalFeedProps {
  signals: any[];
}

export function SignalFeed({ signals }: SignalFeedProps) {
  if (!signals.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-muted">
        <Zap className="w-8 h-8 mb-3 opacity-30" />
        <p className="text-sm">Monitorando sinais...</p>
        <p className="text-xs mt-1 font-mono opacity-60">Análise ao vivo ativa</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-96 divide-y divide-bg-border/50">
      <AnimatePresence initial={false}>
        {signals.map((signal) => {
          const Icon = SIGNAL_ICONS[signal.type] || Zap;
          const sStyle = SEVERITY_STYLES[signal.severity] || SEVERITY_STYLES.LOW;

          return (
            <motion.div
              key={signal.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="px-4 py-3 hover:bg-bg-tertiary/50 transition-colors cursor-default"
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${sStyle}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-text-primary text-xs">
                      {signal.symbol?.replace('USDT', '')}/USDT
                    </span>
                    <span className={`text-xs border rounded px-1.5 py-0.5 font-mono ${sStyle}`}>
                      {signal.severity}
                    </span>
                  </div>
                  <div className="text-text-secondary text-xs mt-0.5">
                    {formatSignalType(signal.type)}
                  </div>
                  {signal.metadata?.price && (
                    <div className="text-text-muted text-xs font-mono mt-0.5">
                      ${formatPrice(signal.metadata.price)}
                      {signal.metadata?.priceChange !== 0 && (
                        <span className={`ml-2 ${signal.metadata.priceChange >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {signal.metadata.priceChange >= 0 ? '+' : ''}{signal.metadata.priceChange?.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-text-muted text-xs mt-1 font-mono opacity-60">
                    {signal.createdAt
                      ? formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true, locale: ptBR })
                      : 'agora mesmo'}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function formatSignalType(type: string): string {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(8);
}
