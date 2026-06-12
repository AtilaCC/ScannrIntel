'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { Zap, TrendingUp, TrendingDown, Minus, AlertTriangle, ArrowLeft, Lock } from 'lucide-react';

interface Decision {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  riskScore: number;
  analysis: string;
  keyDrivers: string[];
  entryType: 'EARLY' | 'CONFIRMATION' | 'LATE';
}

const EXEMPLOS = [
  '🐋 4.200 BTC transferidos para Coinbase — possível venda',
  '📰 Fed sinaliza corte de juros — mercado reagindo',
  '📊 ETH volume 5x acima da média nas últimas 2 horas',
  '🔴 SEC processa exchange — regulação cripto em risco',
];

export default function TradingEnginePage() {
  const router = useRouter();
  const { plan } = useAuthStore();
  const [input, setInput] = useState('');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Decision | null>(null);
  const [error, setError] = useState('');

  const isPro = plan === 'PRO' || plan === 'ENTERPRISE';

  const analyze = async () => {
    if (!input.trim() || !isPro) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const token = localStorage.getItem('crypto-intel-auth');
      const parsed = token ? JSON.parse(token) : null;
      const accessToken = parsed?.state?.accessToken;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/trading-engine/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ signal: input, symbol }),
      });
      if (!res.ok) throw new Error('Falha na análise');
      const data = await res.json();
      setResult(data?.data || data);
    } catch {
      setError('Erro ao analisar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const actionColor = result?.action === 'BUY' ? 'text-green-400' : result?.action === 'SELL' ? 'text-red-400' : 'text-yellow-400';
  const actionBg = result?.action === 'BUY' ? 'bg-green-500/10 border-green-500/30' : result?.action === 'SELL' ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30';

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar ao Painel
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Zap className="w-6 h-6 text-cyan-400" />
          <h1 className="text-2xl font-bold">Motor de Decisão</h1>
        </div>
        <p className="text-gray-400 text-sm">Análise quantitativa institucional com IA</p>
      </div>

      {!isPro && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-6 mb-6 flex items-start gap-4">
          <Lock className="w-6 h-6 text-purple-400 mt-1 shrink-0" />
          <div>
            <p className="font-semibold text-purple-300 mb-1">Recurso PRO</p>
            <p className="text-gray-400 text-sm">Disponível apenas para usuários PRO e Empresarial.</p>
            <button onClick={() => router.push('/dashboard/billing')} className="mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors">
              Atualizar para PRO
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Símbolo</label>
          <select value={symbol} onChange={e => setSymbol(e.target.value)} disabled={!isPro} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50">
            {['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','LINKUSDT'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label className="text-xs text-gray-500 mb-1 block">Sinal / Notícia / Evento</label>
        <textarea value={input} onChange={e => setInput(e.target.value)} disabled={!isPro} placeholder={isPro ? "Descreva o sinal ou evento..." : "Disponível apenas para PRO"} rows={4} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 resize-none disabled:opacity-50" />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXEMPLOS.map((ex, i) => <button key={i} onClick={() => isPro && setInput(ex)} disabled={!isPro} className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full px-3 py-1 text-gray-400 transition-colors disabled:opacity-40">{ex}</button>)}
        </div>
        <button onClick={analyze} disabled={!isPro || !input.trim() || loading} className="mt-4 w-full py-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2">
          {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analisando...</> : <><Zap className="w-4 h-4" />Analisar Sinal</>}
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 flex items-center gap-3"><AlertTriangle className="w-5 h-5 text-red-400" /><p className="text-red-300 text-sm">{error}</p></div>}

      {result && (
        <div className={`border rounded-xl p-5 ${actionBg}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-gray-300">{result.symbol}</span>
              <span className={`text-2xl font-black ${actionColor}`}>{result.action === 'BUY' ? 'COMPRAR' : result.action === 'SELL' ? 'VENDER' : 'MANTER'}</span>
            </div>
            <div className="flex items-center gap-2">
              {result.sentiment === 'BULLISH' ? <TrendingUp className="w-5 h-5 text-green-400" /> : result.sentiment === 'BEARISH' ? <TrendingDown className="w-5 h-5 text-red-400" /> : <Minus className="w-5 h-5 text-yellow-400" />}
              <span className="text-sm text-gray-400">{result.entryType}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-black/20 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Confiança</p>
              <p className="text-xl font-bold">{result.confidence}%</p>
              <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2"><div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${result.confidence}%` }} /></div>
            </div>
            <div className="bg-black/20 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Risco</p>
              <p className="text-xl font-bold">{result.riskScore}%</p>
              <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2"><div className="bg-red-500 h-1.5 rounded-full" style={{ width: `${result.riskScore}%` }} /></div>
            </div>
          </div>
          {result.keyDrivers?.length > 0 && <div className="mb-4"><p className="text-xs text-gray-500 mb-2">Fatores Principais</p><div className="flex flex-wrap gap-2">{result.keyDrivers.map((d, i) => <span key={i} className="text-xs bg-black/30 border border-gray-700 rounded-full px-3 py-1 text-gray-300">{d}</span>)}</div></div>}
          {result.analysis && <div><p className="text-xs text-gray-500 mb-2">Análise</p><p className="text-sm text-gray-300 leading-relaxed">{result.analysis}</p></div>}
        </div>
      )}
      <p className="text-center text-xs text-gray-600 mt-6">Não é conselho financeiro.</p>
    </div>
  );
}
