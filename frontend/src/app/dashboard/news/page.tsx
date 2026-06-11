'use client';

import { useState, useEffect, useCallback } from 'react';
import { Newspaper, TrendingUp, TrendingDown, Minus, RefreshCw, ExternalLink, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface NewsItem {
  id: number;
  title: string;
  url: string;
  source: string;
  currencies: string[];
  publishedAt: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  votes: { positive: number; negative: number; important: number };
}

const FILTERS = [
  { key: 'hot',       label: 'Em Alta'    },
  { key: 'rising',    label: 'Subindo'    },
  { key: 'bullish',   label: 'Altista'    },
  { key: 'bearish',   label: 'Baixista'   },
  { key: 'important', label: 'Macro'      },
];

function SentimentIcon({ s }: { s: string }) {
  if (s === 'BULLISH')  return <TrendingUp   className="w-4 h-4 text-green-400" />;
  if (s === 'BEARISH')  return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-yellow-400" />;
}

function ImpactBadge({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
    HIGH:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
    MEDIUM:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    LOW:      'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  const labels: Record<string, string> = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Médio', LOW: 'Baixo' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${colors[impact] ?? colors.LOW}`}>
      {labels[impact] ?? impact}
    </span>
  );
}

export default function NewsPage() {
  const [news,    setNews]    = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('hot');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/news?filter=${filter}`);
      setNews(res.data.data ?? []);
    } catch {
      toast.error('Falha ao carregar notícias');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60)  return `${m}min atrás`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h atrás`;
    return `${Math.floor(h / 24)}d atrás`;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Newspaper className="w-6 h-6 text-cyan-400" />
            Notícias & Macro
          </h1>
          <p className="text-gray-400 text-sm mt-1">Feed em tempo real de notícias do mercado cripto</p>
        </div>
        <button onClick={load} inativo={loading} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-sm transition-all">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f.key
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* News Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      ) : news.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Nenhuma notícia encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {news.map(item => (
            <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-all">
              <div className="flex items-start gap-3">
                <SentimentIcon s={item.sentiment} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-white hover:text-cyan-400 transition-colors line-clamp-2 flex-1">
                      {item.title}
                      <ExternalLink className="inline w-3 h-3 ml-1 opacity-50" />
                    </a>
                    <ImpactBadge impact={item.impact} />
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-gray-500">{item.source}</span>
                    <span className="text-xs text-gray-600">•</span>
                    <span className="text-xs text-gray-500">{timeAgo(item.publishedAt)}</span>
                    {item.currencies.length > 0 && (
                      <>
                        <span className="text-xs text-gray-600">•</span>
                        <div className="flex gap-1">
                          {item.currencies.slice(0, 3).map(c => (
                            <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-cyan-400 font-mono">{c}</span>
                          ))}
                        </div>
                      </>
                    )}
                    {item.votes.positive + item.votes.negative > 0 && (
                      <span className="text-xs text-gray-600 ml-auto flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {item.votes.positive + item.votes.negative} votos
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
