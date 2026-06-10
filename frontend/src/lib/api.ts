// ============================================================
// API CLIENT — Axios-based API helper
// ============================================================

import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
});

// Attach token on every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('crypto-intel-auth');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.accessToken) {
        config.headers.Authorization = `Bearer ${parsed.state.accessToken}`;
      }
    }
  }
  return config;
});

// Auto refresh token on 401
let isRefreshing = false;
let refreshQueue: ((token: string) => void)[] = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }
      isRefreshing = true;
      try {
        const stored = localStorage.getItem('crypto-intel-auth');
        if (stored) {
          const parsed = JSON.parse(stored);
          const refreshToken = parsed?.state?.refreshToken;
          if (refreshToken) {
            const res = await axios.post(`${API_URL}/api/v1/auth/refresh`, { refreshToken });
            const newToken = res.data?.data?.accessToken;
            if (newToken) {
              parsed.state.accessToken = newToken;
              localStorage.setItem('crypto-intel-auth', JSON.stringify(parsed));
              refreshQueue.forEach((cb) => cb(newToken));
              refreshQueue = [];
              original.headers.Authorization = `Bearer ${newToken}`;
              return api(original);
            }
          }
        }
      } catch {
        // refresh failed — redirect to login
        if (typeof window !== 'undefined') window.location.href = '/auth/login';
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

// ── API Methods ───────────────────────────────────────────

export const tokenApi = {
  getAll: () => api.get('/tokens'),
  getOne: (symbol: string) => api.get(`/tokens/${symbol}`),
  getWatchlist: () => api.get('/tokens/watchlist/me'),
  toggleWatchlist: (symbol: string) => api.post(`/tokens/${symbol}/watchlist`),
};

export const signalApi = {
  getAll: (params?: { page?: number; limit?: number; symbol?: string; type?: string }) =>
    api.get('/signals', { params }),
  getOne: (id: string) => api.get(`/signals/${id}`),
};

export const insightApi = {
  getAll: (params?: { page?: number; symbol?: string }) =>
    api.get('/insights', { params }),
  getLatest: () => api.get('/insights/latest'),
};

export const alertApi = {
  getAll: () => api.get('/alerts'),
  create: (data: any) => api.post('/alerts', data),
  delete: (id: string) => api.delete(`/alerts/${id}`),
  toggle: (id: string) => api.patch(`/alerts/${id}/toggle`),
  getTriggered: () => api.get('/alerts/triggered'),
  markRead: (id: string) => api.patch(`/alerts/triggered/${id}/read`),
};

export const subscriptionApi = {
  getPlans:      ()                                        => api.get('/subscriptions/plans'),
  getMe:         ()                                        => api.get('/subscriptions/me'),
  getUsage:      ()                                        => api.get('/subscriptions/me/usage'),
  getInvoices:   ()                                        => api.get('/subscriptions/me/invoices'),
  checkout:      (plan: string, interval: string)          => api.post('/subscriptions/checkout', { plan, interval }),
  cancel:        ()                                        => api.post('/subscriptions/cancel'),
  reactivate:    ()                                        => api.post('/subscriptions/reactivate'),
  adminOverride: (userId: string, plan: string, note?: string) =>
    api.patch(`/subscriptions/admin/${userId}`, { plan, note }),
  adminStats:    ()                                        => api.get('/subscriptions/admin/stats'),
};

export const scoresApi = {
  getAll:              ()              => api.get('/scores'),
  getBySymbol:         (s: string)    => api.get(`/scores/${s}`),
  getHistory:          (s: string, l = 50) => api.get(`/scores/${s}/history?limit=${l}`),
  getLeaderboardRisk:  (l = 10)       => api.get(`/scores/leaderboard/risk?limit=${l}`),
  getLeaderboardOpp:   (l = 10)       => api.get(`/scores/leaderboard/opportunity?limit=${l}`),
};

export const userApi = {
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data: any) => api.patch('/users/profile', data),
};

export const tradingEngineApi = {
  analyze: (data: {
    symbol: string;
    signalType: 'NEWS_SIGNAL' | 'MACRO_EVENT' | 'SOCIAL_SPIKE' | 'MARKET_SIGNAL';
    input: string;
    marketData?: { price?: number; change24h?: number; volume24h?: number; volumeRatio?: number };
  }) => api.post('/trading-engine/analyze', data),

  manual: (data: {
    text: string;
    symbols?: string[];
  }) => api.post('/trading-engine/manual', data),
};
