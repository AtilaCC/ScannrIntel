// ============================================================
// ScannrIntel — scanner-service/src/binance-stream.ts
// Principal Engineer Review — junho 2026
//
// PROBLEMA ORIGINAL (inferido):
//   20 conexões WebSocket individuais para 20 tokens:
//   wss://stream.binance.com/ws/btcusdt@aggTrade
//   wss://stream.binance.com/ws/ethusdt@aggTrade
//   ... (×20)
//
//   PROBLEMAS:
//   - 20 handshakes TLS = 20x overhead de conexão
//   - 20 keep-alive pings simultâneos
//   - Se a Binance limitar conexões por IP, estoura
//   - 20 reconnect handlers = complexidade desnecessária
//
// SOLUÇÃO: Combined stream — UMA conexão para todos os símbolos
//   wss://stream.binance.com/stream?streams=btcusdt@aggTrade/ethusdt@aggTrade/...
//
//   BENEFÍCIOS:
//   - 1 conexão WebSocket ao invés de 20
//   - 95% menos overhead de rede
//   - Reconnect centralizado com backoff exponencial
//   - Rate limit de streams: Binance permite 1024 streams/conexão
// ============================================================

import WebSocket from 'ws';

// ── Tipos Binance ─────────────────────────────────────────

interface BinanceCombinedMessage {
  stream: string;
  data: BinanceAggTrade | BinanceKline | BinanceMiniTicker;
}

export interface BinanceAggTrade {
  e: 'aggTrade';
  E: number;   // Event time
  s: string;   // Symbol
  a: number;   // Aggregate trade ID
  p: string;   // Price
  q: string;   // Quantity
  f: number;   // First trade ID
  l: number;   // Last trade ID
  T: number;   // Trade time
  m: boolean;  // Is buyer market maker
}

export interface BinanceMiniTicker {
  e: '24hrMiniTicker';
  E: number;
  s: string;   // Symbol
  c: string;   // Close price
  o: string;   // Open price
  h: string;   // High price
  l: string;   // Low price
  v: string;   // Total traded base volume
  q: string;   // Total traded quote volume
}

export interface BinanceKline {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number;   // Kline start time
    T: number;   // Kline close time
    s: string;   // Symbol
    i: string;   // Interval
    o: string;   // Open price
    c: string;   // Close price
    h: string;   // High price
    l: string;   // Low price
    v: string;   // Base asset volume
    n: number;   // Number of trades
    x: boolean;  // Is this kline closed
    q: string;   // Quote asset volume
  };
}

type StreamHandler = (data: BinanceCombinedMessage['data'], symbol: string) => void;

// ── Multi-Stream Manager ──────────────────────────────────

export class BinanceMultiStreamManager {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, StreamHandler[]>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(
    private symbols: string[],
    private streamTypes: ('aggTrade' | 'miniTicker' | 'kline_1m')[],
    private onError?: (err: Error) => void
  ) {}

  // Constrói URL combinada — UMA conexão para todos os símbolos
  private buildCombinedStreamUrl(): string {
    const streams: string[] = [];
    for (const symbol of this.symbols) {
      const sym = symbol.toLowerCase();
      for (const type of this.streamTypes) {
        streams.push(`${sym}@${type}`);
      }
    }
    // Limite da Binance: 1024 streams por conexão
    if (streams.length > 1024) {
      throw new Error(`Streams (${streams.length}) excedem o limite de 1024 da Binance`);
    }
    return `wss://stream.binance.com/stream?streams=${streams.join('/')}`;
  }

  on(streamName: string, handler: StreamHandler): void {
    const existing = this.handlers.get(streamName) || [];
    this.handlers.set(streamName, [...existing, handler]);
  }

  connect(): void {
    if (this.isDestroyed) return;

    const url = this.buildCombinedStreamUrl();
    console.log(
      `[BinanceStream] Conectando com ${this.symbols.length} símbolos × ` +
      `${this.streamTypes.length} tipos = ${this.symbols.length * this.streamTypes.length} streams`
    );

    this.ws = new WebSocket(url, {
      handshakeTimeout: 10_000,
      perMessageDeflate: true,  // compressão reduz banda ~40%
    });

    this.ws.on('open', () => {
      console.log('[BinanceStream] Conectado — combined stream ativo');
      this.reconnectAttempts = 0;  // reset após conexão bem-sucedida
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const combined: BinanceCombinedMessage = JSON.parse(raw.toString());
        const [symbolRaw, streamType] = combined.stream.split('@');
        const symbol = symbolRaw.toUpperCase();

        // Dispatcha para handlers registrados
        const streamKey = `${symbol}@${streamType}`;
        const streamHandlers = this.handlers.get(streamKey) || [];
        const globalHandlers = this.handlers.get('*') || [];

        [...streamHandlers, ...globalHandlers].forEach((handler) => {
          try {
            handler(combined.data, symbol);
          } catch (err) {
            console.error(`[BinanceStream] Erro em handler para ${streamKey}:`, err);
          }
        });
      } catch (err) {
        console.error('[BinanceStream] Erro ao parsear mensagem:', err);
      }
    });

    this.ws.on('ping', (data) => {
      // Responde ao ping da Binance (obrigatório para manter conexão)
      this.ws?.pong(data);
    });

    this.ws.on('error', (err) => {
      console.error('[BinanceStream] WebSocket error:', err.message);
      this.onError?.(err);
    });

    this.ws.on('close', (code, reason) => {
      console.warn(
        `[BinanceStream] Conexão fechada. Code: ${code}, Reason: ${reason.toString()}`
      );
      if (!this.isDestroyed) {
        this.scheduleReconnect();
      }
    });
  }

  // Backoff exponencial: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[BinanceStream] Máximo de tentativas atingido. Scanner parado.');
      this.onError?.(new Error('BinanceStream: max reconnect attempts reached'));
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60_000);
    this.reconnectAttempts++;

    console.log(
      `[BinanceStream] Reconectando em ${delay}ms ` +
      `(tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'Client disconnect');
    this.ws = null;
  }

  getConnectionStats() {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      symbols: this.symbols.length,
      streamTypes: this.streamTypes.length,
      totalStreams: this.symbols.length * this.streamTypes.length,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// ── Factory helper ────────────────────────────────────────

export function createBinanceScanner(
  symbolsEnv: string,
  onTrade: (trade: BinanceAggTrade, symbol: string) => void,
  onTicker?: (ticker: BinanceMiniTicker, symbol: string) => void
): BinanceMultiStreamManager {
  const symbols = symbolsEnv
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const streamTypes: ('aggTrade' | 'miniTicker')[] = ['aggTrade', 'miniTicker'];

  const manager = new BinanceMultiStreamManager(symbols, streamTypes);

  // Handler global para todos os símbolos
  manager.on('*', (data, symbol) => {
    if ((data as BinanceAggTrade).e === 'aggTrade') {
      onTrade(data as BinanceAggTrade, symbol);
    } else if ((data as BinanceMiniTicker).e === '24hrMiniTicker' && onTicker) {
      onTicker(data as BinanceMiniTicker, symbol);
    }
  });

  return manager;
}
