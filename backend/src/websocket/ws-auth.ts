// ============================================================
// ScannrIntel — backend/src/websocket/ws-auth.ts
// Principal Engineer Review — junho 2026
//
// PROBLEMA ORIGINAL:
//   JWT transmitido via query param na URL do WebSocket:
//   wss://backend/ws?token=eyJhbG...
//
//   RISCOS:
//   - Token aparece em nginx access logs
//   - Token aparece em server logs do Node.js
//   - Token fica no histórico do browser
//   - Token pode vazar via Referrer header para third-party URLs
//   - Token visível em network inspector para qualquer pessoa
//     com acesso ao computador
//
// SOLUÇÃO:
//   Autenticação via Sec-WebSocket-Protocol header no handshake.
//   O token nunca aparece em URLs ou logs de acesso.
//
//   PROTOCOLO:
//   Client → Server: Sec-WebSocket-Protocol: bearer, <token>
//   Server → Client: 101 Switching Protocols (token validado)
//
// COMO USAR NO CLIENTE (Next.js):
//   const ws = new WebSocket(
//     'wss://api.exemplo.com/ws',
//     ['bearer', `${accessToken}`]
//   );
// ============================================================

import { WebSocket, WebSocketServer, RawData } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userEmail?: string;
  isAlive?: boolean;
}

interface JWTPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

// ── Extrai e valida token do handshake WebSocket ──────────

function extractTokenFromHandshake(req: IncomingMessage): string | null {
  // Método 1 (RECOMENDADO): Sec-WebSocket-Protocol header
  // Cliente envia: Sec-WebSocket-Protocol: bearer, eyJhbG...
  const protocols = req.headers['sec-websocket-protocol'];
  if (protocols) {
    const protocolList = protocols.split(',').map((p) => p.trim());
    const bearerIndex = protocolList.indexOf('bearer');
    if (bearerIndex !== -1 && protocolList[bearerIndex + 1]) {
      return protocolList[bearerIndex + 1];
    }
  }

  // Método 2 (FALLBACK para desenvolvimento local apenas):
  // Cookie httpOnly — seguro para produção também
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    if (cookies['access_token']) {
      return decodeURIComponent(cookies['access_token']);
    }
  }

  // NÃO suportar query param — explicitamente rejeitado
  // if (req.url?.includes('?token=')) { ... }  // ← REMOVIDO

  return null;
}

// ── Middleware de autenticação WebSocket ──────────────────

export function createWebSocketAuthMiddleware(jwtSecret: string) {
  return function handleUpgrade(
    wss: WebSocketServer,
    req: IncomingMessage,
    socket: NodeJS.Socket,
    head: Buffer
  ): void {
    const token = extractTokenFromHandshake(req);

    if (!token) {
      // Rejeita conexão sem fechar o socket abruptamente
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        'Content-Type: text/plain\r\n' +
        'Connection: close\r\n\r\n' +
        'WebSocket authentication required.\n' +
        'Send token via Sec-WebSocket-Protocol header: bearer, <token>'
      );
      socket.destroy();
      return;
    }

    let payload: JWTPayload;
    try {
      payload = jwt.verify(token, jwtSecret) as JWTPayload;
    } catch (err) {
      const isExpired = err instanceof jwt.TokenExpiredError;
      socket.write(
        `HTTP/1.1 401 Unauthorized\r\n` +
        `Content-Type: text/plain\r\n` +
        `Connection: close\r\n\r\n` +
        `Token ${isExpired ? 'expirado' : 'inválido'}.\n`
      );
      socket.destroy();
      return;
    }

    // Completa o upgrade apenas se autenticado
    wss.handleUpgrade(req, socket, head, (ws) => {
      const authWs = ws as AuthenticatedWebSocket;
      authWs.userId = payload.sub;
      authWs.userEmail = payload.email;
      authWs.isAlive = true;
      wss.emit('connection', authWs, req);
    });
  };
}

// ── Ping/Pong para detectar conexões mortas ───────────────

export function setupHeartbeat(wss: WebSocketServer): NodeJS.Timeout {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const authWs = ws as AuthenticatedWebSocket;
      if (authWs.isAlive === false) {
        console.log(`[WS] Terminando conexão morta do usuário ${authWs.userId}`);
        authWs.terminate();
        return;
      }
      authWs.isAlive = false;
      authWs.ping();
    });
  }, 30_000);  // verifica a cada 30s

  wss.on('close', () => clearInterval(interval));
  return interval;
}

// ── Handler de pong no cliente ────────────────────────────

export function setupClientPongHandler(ws: AuthenticatedWebSocket): void {
  ws.on('pong', () => {
    ws.isAlive = true;
  });
}

// ── Broadcast seguro com filtro por userId ────────────────

export function broadcastToUser(
  wss: WebSocketServer,
  userId: string,
  data: object
): void {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    const authWs = client as AuthenticatedWebSocket;
    if (
      authWs.userId === userId &&
      authWs.readyState === WebSocket.OPEN
    ) {
      authWs.send(message);
    }
  });
}

export function broadcastToAll(wss: WebSocketServer, data: object): void {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ── Instrução para o cliente Next.js ─────────────────────

/**
 * COMO CONECTAR NO FRONTEND (Next.js):
 *
 * // hooks/useWebSocket.ts
 * export function useWebSocket(accessToken: string) {
 *   const ws = useRef<WebSocket | null>(null);
 *
 *   useEffect(() => {
 *     if (!accessToken) return;
 *
 *     // Token vai no protocolo, NÃO na URL
 *     ws.current = new WebSocket(
 *       process.env.NEXT_PUBLIC_WS_URL!,
 *       ['bearer', accessToken]   // ← seguro, não aparece em logs
 *     );
 *
 *     ws.current.onmessage = (event) => {
 *       const data = JSON.parse(event.data);
 *       // processar sinal/insight
 *     };
 *
 *     return () => ws.current?.close();
 *   }, [accessToken]);
 *
 *   return ws;
 * }
 */
