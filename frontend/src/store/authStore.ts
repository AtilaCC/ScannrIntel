// ============================================================
// AUTH STORE — Zustand global state
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface User {
  id: string;
  email: string;
  role: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
  setTokens: (access: string, refresh: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
      isAuthenticated: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const res = await axios.post(`${API_URL}/api/v1/auth/login`, { email, password });
          const { user, accessToken, refreshToken } = res.data.data;
          set({ user, accessToken, refreshToken, isAuthenticated: true, isLoading: false });
          setupAxiosInterceptors(accessToken, get().refreshAccessToken);
        } catch (err: any) {
          set({ isLoading: false });
          throw new Error(err.response?.data?.error || 'Login failed');
        }
      },

      register: async (email, password) => {
        set({ isLoading: true });
        try {
          const res = await axios.post(`${API_URL}/api/v1/auth/register`, { email, password });
          const { user, accessToken, refreshToken } = res.data.data;
          set({ user, accessToken, refreshToken, isAuthenticated: true, isLoading: false });
          setupAxiosInterceptors(accessToken, get().refreshAccessToken);
        } catch (err: any) {
          set({ isLoading: false });
          throw new Error(err.response?.data?.error || 'Registration failed');
        }
      },

      logout: async () => {
        const { refreshToken, accessToken } = get();
        try {
          await axios.post(
            `${API_URL}/api/v1/auth/logout`,
            { refreshToken },
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch { /* best-effort */ }
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
      },

      refreshAccessToken: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const res = await axios.post(`${API_URL}/api/v1/auth/refresh`, { refreshToken });
          const { accessToken } = res.data.data;
          set({ accessToken });
          return true;
        } catch {
          set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
          return false;
        }
      },

      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
    }),
    {
      name: 'crypto-intel-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Auto-initialize interceptors when store loads with existing token
if (typeof window !== 'undefined') {
  setTimeout(() => {
    const state = useAuthStore.getState();
    if (state.accessToken && state.isAuthenticated) {
      setupAxiosInterceptors(state.accessToken, state.refreshAccessToken);
    }
  }, 0);
}

// Axios interceptor for automatic token refresh
let interceptorSetup = false;
function setupAxiosInterceptors(token: string, refreshFn: () => Promise<boolean>) {
  if (interceptorSetup) return;
  interceptorSetup = true;

  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  axios.interceptors.response.use(
    (res) => res,
    async (err) => {
      const original = err.config;
      if (err.response?.status === 401 && !original._retry) {
        original._retry = true;
        const refreshed = await refreshFn();
        if (refreshed) {
          const newToken = useAuthStore.getState().accessToken;
          axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
          original.headers['Authorization'] = `Bearer ${newToken}`;
          return axios(original);
        }
        window.location.href = '/auth/login';
      }
      return Promise.reject(err);
    }
  );
}
