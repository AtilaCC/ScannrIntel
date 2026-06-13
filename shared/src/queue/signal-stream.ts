// ============================================================
// ScannrIntel — shared/src/queue/signal-stream.ts
// Principal Engineer Review — junho 2026
//
// PROBLEMA ORIGINAL: Redis Pub/Sub simples
//   - Se o processor-engine estiver down → mensagens PERDIDAS
//   - Sem replay, sem persistência, sem ACK
//   - Fire-and-forget sem garantia de entrega
//
// SOLUÇÃO: Redis Streams com Consumer Groups
//   - Mensagens persistidas no stream
//   - Consumer groups garantem que cada mensagem é processada
//   - Se consumer cair, mensagens ficam "pending" e podem ser
//     reclamadas por outro consumer (XCLAIM)
//   - Suporte a replay de mensagens antigas
//   - Monitoramento de lag do grupo
//
// IMPACTO: De "best effort" para "at-least-once delivery"
// ============================================================

import { createClient, RedisClientType } from 'redis';

// ── Constantes ────────────────────────────────────────────

export const STREAMS = {
  SIGNALS: 'stream:signals',           // Scanner → Processor
  PROCESSED_SIGNALS: 'stream:processed', // Processor → AI Service
} as const;

export const CONSUMER_GROUPS = {
  PROCESSOR: 'processor-group',
  AI_SERVICE: 'ai-service-group',
} as const;

// Máximo de mensagens retidas no stream (evita crescimento infinito)
const MAX_STREAM_LENGTH = 10_000;
// Timeout para reclamar mensagens "pendentes" de consumers mortos (30s)
const PENDING_CLAIM_TIMEOUT_MS = 30_000;

// ── Tipos ─────────────────────────────────────────────────

export interface SignalMessage {
  signalId: string;
  type: string;
  symbol: string;
  price: string;
  volume: string;
  priceChange?: string;
  tradeValue?: string;
  severity: string;
  detectedAt: string;
}

export interface ProcessedSignalMessage {
  signalId: string;
  symbol: string;
  type: string;
  severity: string;
  price: string;
  volume: string;
  processedAt: string;
}

// ── Produtor — Scanner publica sinais ─────────────────────

export class SignalProducer {
  constructor(private redis: RedisClientType) {}

  /**
   * Publica sinal no stream com MAXLEN para controle de tamanho.
   * Retorna o ID da mensagem gerado pelo Redis.
   */
  async publishSignal(signal: SignalMessage): Promise<string> {
    // Redis Streams exige campos como strings
    const fields: Record<string, string> = {
      signalId: signal.signalId,
      type: signal.type,
      symbol: signal.symbol,
      price: signal.price,
      volume: signal.volume,
      severity: signal.severity,
      detectedAt: signal.detectedAt,
    };

    if (signal.priceChange) fields.priceChange = signal.priceChange;
    if (signal.tradeValue) fields.tradeValue = signal.tradeValue;

    const messageId = await this.redis.xAdd(
      STREAMS.SIGNALS,
      '*',              // Redis gera o ID automaticamente (timestamp-based)
      fields,
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~',   // aproximado para performance
          threshold: MAX_STREAM_LENGTH,
        },
      }
    );

    return messageId;
  }

  async publishProcessedSignal(signal: ProcessedSignalMessage): Promise<string> {
    return this.redis.xAdd(
      STREAMS.PROCESSED_SIGNALS,
      '*',
      {
        signalId: signal.signalId,
        symbol: signal.symbol,
        type: signal.type,
        severity: signal.severity,
        price: signal.price,
        volume: signal.volume,
        processedAt: signal.processedAt,
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~',
          threshold: MAX_STREAM_LENGTH,
        },
      }
    );
  }
}

// ── Consumer — Processor e AI Service consomem sinais ─────

export class SignalConsumer {
  private consumerName: string;

  constructor(
    private redis: RedisClientType,
    private groupName: string,
    private stream: string,
    consumerNamePrefix: string
  ) {
    // Nome único por instância (importante para scale horizontal)
    this.consumerName = `${consumerNamePrefix}-${process.pid}-${Date.now()}`;
  }

  /**
   * Cria o consumer group se não existir.
   * '>' = ler apenas mensagens novas; '0' = reprocessar desde o início.
   * 
   * Deve ser chamado na inicialização do serviço.
   */
  async ensureGroupExists(): Promise<void> {
    try {
      await this.redis.xGroupCreate(this.stream, this.groupName, '$', {
        MKSTREAM: true,  // cria o stream se não existir
      });
      console.log(`Consumer group '${this.groupName}' criado em stream '${this.stream}'`);
    } catch (err: unknown) {
      // BUSYGROUP = grupo já existe, ignorar
      if (err instanceof Error && err.message.includes('BUSYGROUP')) {
        console.log(`Consumer group '${this.groupName}' já existe — OK`);
        return;
      }
      throw err;
    }
  }

  /**
   * Lê próximas mensagens para processar.
   * Usa '>' para pegar mensagens não entregues a nenhum consumer.
   */
  async readMessages(
    count = 10,
    blockMs = 2000
  ): Promise<Array<{ id: string; message: Record<string, string> }>> {
    const response = await this.redis.xReadGroup(
      this.groupName,
      this.consumerName,
      [{ key: this.stream, id: '>' }],
      { COUNT: count, BLOCK: blockMs }
    );

    if (!response || response.length === 0) return [];

    const streamData = response[0];
    return streamData.messages.map((msg) => ({
      id: msg.id,
      message: msg.message as Record<string, string>,
    }));
  }

  /**
   * Confirma processamento bem-sucedido de uma mensagem.
   * Remove da lista de pending do consumer group.
   */
  async acknowledge(messageId: string): Promise<void> {
    await this.redis.xAck(this.stream, this.groupName, messageId);
  }

  /**
   * Reclaima mensagens pendentes de consumers mortos.
   * Deve ser chamado periodicamente (ex: a cada 30s).
   * 
   * Cenário: Consumer A pegou mensagem mas morreu antes de ACK.
   * Este método transfere a mensagem para o consumer atual.
   */
  async reclaimStalePending(): Promise<number> {
    let reclaimedCount = 0;

    // Lista mensagens pending no grupo
    const pending = await this.redis.xPending(
      this.stream,
      this.groupName
    );

    if (!pending || pending.pending === 0) return 0;

    // Reclaima mensagens idle há mais de PENDING_CLAIM_TIMEOUT_MS
    const claimed = await this.redis.xAutoClaim(
      this.stream,
      this.groupName,
      this.consumerName,
      PENDING_CLAIM_TIMEOUT_MS,
      '0-0',
      { COUNT: 50 }
    );

    if (claimed && claimed.messages) {
      reclaimedCount = claimed.messages.length;
      if (reclaimedCount > 0) {
        console.warn(
          `[SignalConsumer] Reclamadas ${reclaimedCount} mensagens pendentes de consumers mortos`
        );
      }
    }

    return reclaimedCount;
  }

  /**
   * Retorna métricas do lag do consumer group.
   * Útil para monitoramento e alertas.
   */
  async getGroupLag(): Promise<{
    pendingCount: number;
    lag: number;
    consumers: number;
  }> {
    const info = await this.redis.xInfoGroups(this.stream);
    const group = info.find((g: { name: string }) => g.name === this.groupName);

    if (!group) return { pendingCount: 0, lag: 0, consumers: 0 };

    return {
      pendingCount: group.pending as number,
      lag: group.lag as number ?? 0,
      consumers: group.consumers as number,
    };
  }
}

// ── Factory helper ────────────────────────────────────────

export async function createSignalConsumer(
  redisUrl: string,
  groupName: string,
  stream: string,
  consumerPrefix: string
): Promise<SignalConsumer> {
  const redis = createClient({ url: redisUrl });
  await redis.connect();

  const consumer = new SignalConsumer(
    redis as RedisClientType,
    groupName,
    stream,
    consumerPrefix
  );
  await consumer.ensureGroupExists();

  return consumer;
}

export async function createSignalProducer(
  redisUrl: string
): Promise<SignalProducer> {
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  return new SignalProducer(redis as RedisClientType);
}
