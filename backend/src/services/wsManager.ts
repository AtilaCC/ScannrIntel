// ============================================================
// WEBSOCKET MANAGER — Real-time push to frontend
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';
import { JWTPayload } from '../utils/shared';

interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
  role: string;
  subscriptions: Set<string>;
  isAlive: boolean;
}

export class WSManager {
  private clients: Map<string, AuthenticatedClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(private readonly wss: WebSocketServer) {
    this.wss.on('connection', this.handleConnection.bind(this));

    // Heartbeat — remove dead connections every 60s
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, id) => {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(id);
          return;
        }
        client.isAlive = false;
        client.ws.ping();
      });
    }, 60_000);

    logger.info('WebSocket manager initialized');
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Authenticate via token in query string
    const url = new URL(req.url || '', `http://localhost`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    let payload: JWTPayload;
    try {
      payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as JWTPayload;
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    const clientId = `${payload.sub}_${Date.now()}`;
    const client: AuthenticatedClient = {
      ws,
      userId: payload.sub,
      role: payload.role,
      subscriptions: new Set(['market_data', 'signals', 'ai_insights']),
      isAlive: true,
    };

    this.clients.set(clientId, client);
    logger.info('WS client connected', { userId: payload.sub, clientId });

    // Send welcome message
    this.send(ws, 'connected', { clientId, userId: payload.sub });

    // Handle pong
    ws.on('pong', () => { client.isAlive = true; });

    // Handle messages from client (e.g. subscribe/unsubscribe)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleClientMessage(clientId, msg);
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      logger.info('WS client disconnected', { clientId });
    });

    ws.on('error', (err) => {
      logger.error('WS client error', { clientId, error: err.message });
      this.clients.delete(clientId);
    });
  }

  private handleClientMessage(clientId: string, msg: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (msg.type === 'subscribe' && msg.channel) {
      client.subscriptions.add(msg.channel);
    } else if (msg.type === 'unsubscribe' && msg.channel) {
      client.subscriptions.delete(msg.channel);
    } else if (msg.type === 'ping') {
      this.send(client.ws, 'pong', { ts: Date.now() });
    }
  }

  broadcast(channel: string, payload: unknown): void {
    const channelName = channel.replace('channel:', '');
    const message = JSON.stringify({ type: channelName, payload, timestamp: Date.now() });

    this.clients.forEach((client) => {
      if (client.subscriptions.has(channelName) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  broadcastToUser(userId: string, type: string, payload: unknown): void {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    this.clients.forEach((client) => {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  private send(ws: WebSocket, type: string, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
    }
  }

  get connectedCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    clearInterval(this.heartbeatInterval);
    this.clients.forEach((c) => c.ws.terminate());
    this.clients.clear();
  }
}
