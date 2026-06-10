'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

const WS_BASE = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000').replace(/\/ws$/, '');

type MessageHandler = (type: string, payload: any) => void;

interface UseWebSocketReturn {
  isConnected: boolean;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
}

export function useWebSocket(onMessage: MessageHandler): UseWebSocketReturn {
  const { accessToken, isAuthenticated } = useAuthStore();
  const [isConnected, setIsConnected] = useState(false);
  
  // Use refs to avoid stale closures and prevent re-renders from causing reconnects
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const tokenRef = useRef(accessToken);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);

  // Keep refs in sync without triggering reconnects
  onMessageRef.current = onMessage;
  tokenRef.current = accessToken;

  const clearTimers = useCallback(() => {
    if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (!tokenRef.current || !isAuthenticated) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const url = `${WS_BASE}/ws?token=${tokenRef.current}`;
    
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setIsConnected(true);
        attemptsRef.current = 0;
        
        // Keepalive ping every 20s
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== 'pong') {
            onMessageRef.current(msg.type, msg.payload);
          }
        } catch {}
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        clearTimers();
        setIsConnected(false);
        wsRef.current = null;

        // Don't reconnect on auth errors
        if (event.code === 4001) return;

        // Exponential backoff reconnect
        if (attemptsRef.current < 5) {
          const delay = Math.min(2000 * Math.pow(2, attemptsRef.current), 30000);
          attemptsRef.current++;
          reconnectRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };

    } catch {}
  }, [isAuthenticated, clearTimers]);

  // Only connect/disconnect when auth state changes
  useEffect(() => {
    mountedRef.current = true;
    
    if (isAuthenticated && accessToken) {
      // Small delay to ensure token is stable
      const timer = setTimeout(connect, 500);
      return () => {
        clearTimeout(timer);
        mountedRef.current = false;
        clearTimers();
        if (wsRef.current) {
          wsRef.current.close(1000, 'unmounted');
          wsRef.current = null;
        }
        setIsConnected(false);
      };
    }
  // Only re-run when auth state changes, not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, !!accessToken]);

  const subscribe = useCallback((channel: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  return { isConnected, subscribe, unsubscribe };
}
