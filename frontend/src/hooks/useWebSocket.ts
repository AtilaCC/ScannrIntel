// ============================================================
// USE WEBSOCKET HOOK — Real-time data from backend WS
// ============================================================

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../store/authStore';

const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000').replace(/\/ws$/, '');

type MessageHandler = (type: string, payload: any) => void;

interface UseWebSocketReturn {
  isConnected: boolean;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
}

export function useWebSocket(onMessage: MessageHandler): UseWebSocketReturn {
  const { accessToken, isAuthenticated } = useAuthStore();
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const onMessageRef = useRef(onMessage);
  const MAX_RECONNECT = 10;

  // Keep onMessage ref stable to avoid reconnect loops
  useEffect(() => { onMessageRef.current = onMessage; });

  const connect = useCallback(() => {
    if (!isAuthenticated || !accessToken) return;
    if (ws.current?.readyState === WebSocket.OPEN) return;

    try {
      const wsInstance = new WebSocket(`${WS_URL}/ws?token=${accessToken}`);

      wsInstance.onopen = () => {
        setIsConnected(true);
        reconnectAttempts.current = 0;
        console.log('[WS] Connected');
      };

      wsInstance.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onMessageRef.current(msg.type, msg.payload);
        } catch { /* ignore malformed */ }
      };

      wsInstance.onclose = (event) => {
        setIsConnected(false);
        console.log('[WS] Disconnected', event.code);

        if (reconnectAttempts.current < MAX_RECONNECT) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30_000);
          reconnectAttempts.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      wsInstance.onerror = () => {
        wsInstance.close();
      };

      ws.current = wsInstance;
    } catch (err) {
      console.error('[WS] Connection error', err);
    }
  }, [accessToken, isAuthenticated, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close(1000, 'Component unmounted');
    };
  }, [connect]);

  const subscribe = useCallback((channel: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  return { isConnected, subscribe, unsubscribe };
}
