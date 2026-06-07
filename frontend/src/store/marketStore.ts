// ============================================================
// MARKET STORE — Real-time market data state
// ============================================================

import { create } from 'zustand';

export interface MarketTicker {
  symbol: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  volume24h: number;
  quoteVolume24h: number;
  high24h: number;
  low24h: number;
  tradeCount: number;
  timestamp: number;
  prevPrice?: number;
}

export interface LiveSignal {
  id: string;
  symbol: string;
  type: string;
  severity: string;
  data: any;
  metadata: any;
  createdAt: string;
}

export interface LiveInsight {
  id: string;
  signalId: string;
  symbol: string;
  summary: string;
  details: string;
  riskScore: number;
  opportunityScore: number;
  sentiment: string;
  tags: string[];
  recommendations: string[];
  confidence: number;
  createdAt: string;
}

export interface TriggeredAlert {
  id: string;
  alertConfigId: string;
  userId: string;
  symbol: string;
  condition: string;
  triggerValue: number;
  threshold: number;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface MarketState {
  tickers: Record<string, MarketTicker>;
  signals: LiveSignal[];
  insights: LiveInsight[];
  triggeredAlerts: TriggeredAlert[];

  updateMarketData: (data: MarketTicker) => void;
  addSignal: (signal: LiveSignal) => void;
  addInsight: (insight: LiveInsight) => void;
  addTriggeredAlert: (alert: TriggeredAlert) => void;
  markAlertRead: (id: string) => void;
  clearOldSignals: () => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  tickers: {},
  signals: [],
  insights: [],
  triggeredAlerts: [],

  updateMarketData: (data) =>
    set((state) => ({
      tickers: {
        ...state.tickers,
        [data.symbol]: {
          ...data,
          prevPrice: state.tickers[data.symbol]?.price,
        },
      },
    })),

  addSignal: (signal) =>
    set((state) => ({
      signals: [signal, ...state.signals].slice(0, 200), // Keep last 200
    })),

  addInsight: (insight) =>
    set((state) => ({
      insights: [insight, ...state.insights].slice(0, 100),
    })),

  addTriggeredAlert: (alert) =>
    set((state) => ({
      triggeredAlerts: [alert, ...state.triggeredAlerts].slice(0, 50),
    })),

  markAlertRead: (id) =>
    set((state) => ({
      triggeredAlerts: state.triggeredAlerts.map((a) =>
        a.id === id ? { ...a, isRead: true } : a
      ),
    })),

  clearOldSignals: () =>
    set((state) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return {
        signals: state.signals.filter((s) => new Date(s.createdAt).getTime() > cutoff),
      };
    }),
}));
