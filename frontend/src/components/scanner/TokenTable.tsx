'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, Star } from 'lucide-react';
import { MarketTicker } from '../../store/marketStore';
import { tokenApi } from '../../lib/api';
import { toast } from 'sonner';

interface TokenTableProps {
  tokens: any[];
  liveTickers: Record<string, MarketTicker>;
}

type SortKey = 'symbol' | 'price' | 'priceChangePercent24h' | 'quoteVolume24h';

export function TokenTable({ tokens, liveTickers }: TokenTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('quoteVolume24h');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Merge static token list with live prices
  const merged = tokens.map((t) => {
    const live = liveTickers[t.symbol];
    return live ? { ...t, ...live } : t;
  });

  // Also add any live tickers not in the static list
  const knownSímbolos = new Set(tokens.map((t) => t.symbol));
  Object.values(liveTickers).forEach((ticker) => {
    if (!knownSímbolos.has(ticker.symbol)) merged.push(ticker);
  });

  const sorted = [...merged].sort((a, b) => {
    const aVal = a[sortKey] ?? 0;
    const bVal = b[sortKey] ?? 0;
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const toggleWatchlist = async (symbol: string) => {
    try {
      await tokenApi.toggleWatchlist(symbol);
      setWatchlist((prev) => {
        const next = new Set(prev);
        if (next.has(symbol)) { next.delete(symbol); toast.info(`Removed ${symbol} from watchlist`); }
        else { next.add(symbol); toast.success(`Adicionared ${symbol} to watchlist`); }
        return next;
      });
    } catch { toast.error('Falha ao atualizar watchlist'); }
  };

  const setDir = setSortDir;

  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-bg-card z-10">
          <tr className="border-b border-bg-border">
            {[
              { key: 'symbol', label: 'PAR' },
              { key: 'price', label: 'PREÇO' },
              { key: 'priceChangePercent24h', label: '24H %' },
              { key: 'quoteVolume24h', label: 'VOLUME' },
            ].map(({ key, label }) => (
              <th
                key={key}
                onClick={() => handleSort(key as SortKey)}
                className="px-4 py-3 text-left text-text-muted font-mono text-xs cursor-pointer hover:text-text-secondary select-none"
              >
                <div className="flex items-center gap-1">
                  {label}
                  <ArrowUpDown className="w-3 h-3 opacity-50" />
                </div>
              </th>
            ))}
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <AnimatePresence mode="sync">
            {sorted.slice(0, 50).map((token, i) => {
              const change = token.priceChangePercent24h ?? 0;
              const isUp = change >= 0;
              const isWatched = watchlist.has(token.symbol);
              const hasFlash = token.prevPrice !== undefined && token.prevPrice !== token.price;
              const flashDir = token.price > (token.prevPrice ?? token.price) ? 'price-up' : 'price-down';

              return (
                <motion.tr
                  key={token.symbol}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-b border-bg-border/50 hover:bg-bg-tertiary/50 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan font-bold text-xs">
                        {token.symbol?.charAt(0)}
                      </div>
                      <div>
                        <div className="text-text-primary font-mono font-semibold text-xs">
                          {token.symbol?.replace('USDT', '')}<span className="text-text-muted">/USDT</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={`px-4 py-3 font-mono text-text-primary font-semibold ${hasFlash ? flashDir : ''}`}>
                    ${formatPrice(token.price ?? token.lastPrice ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-xs font-bold px-2 py-1 rounded ${
                      isUp
                        ? 'text-accent-green bg-accent-green/10'
                        : 'text-accent-red bg-accent-red/10'
                    }`}>
                      {isUp ? '+' : ''}{change.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                    {formatVolume(token.quoteVolume24h ?? token.volumeUsd24h ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleWatchlist(token.symbol)}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                        isWatched ? 'text-accent-yellow' : 'text-text-muted hover:text-accent-yellow'
                      }`}
                    >
                      <Star className="w-3.5 h-3.5" fill={isWatched ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(8);
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(0)}`;
}
