// ============================================================
// ScannrIntel — shared/src/validators/ai-output.validator.ts
// Principal Engineer Review — junho 2026
//
// PROBLEMA ORIGINAL:
//   O AI Service retorna JSON estruturado da Groq API sem validação.
//   Se o modelo retornar campo faltando, número fora do range, ou
//   JSON malformado → crash silencioso no insert do PostgreSQL,
//   ou NaN/undefined chegando ao frontend.
//
// SOLUÇÃO:
//   Schema Zod com parse estrito + fallbacks seguros.
//   Usado no ai-service antes de salvar em DB.
// ============================================================

import { z } from 'zod';

// ── Schema do output bruto da IA ──────────────────────────

export const AIInsightRawSchema = z.object({
  summary: z
    .string()
    .min(1, 'Summary não pode ser vazio')
    .max(500, 'Summary muito longo')
    .trim(),

  details: z
    .string()
    .min(10, 'Details muito curto')
    .max(5000, 'Details muito longo')
    .trim(),

  risk_score: z
    .number()
    .min(0, 'risk_score deve ser >= 0')
    .max(100, 'risk_score deve ser <= 100')
    .int('risk_score deve ser inteiro'),

  opportunity_score: z
    .number()
    .min(0)
    .max(100)
    .int(),

  sentiment: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL'], {
    errorMap: () => ({ message: 'sentiment deve ser BULLISH, BEARISH ou NEUTRAL' }),
  }),

  tags: z
    .array(z.string().min(1).max(50))
    .min(0)
    .max(10)
    .default([]),

  recommendations: z
    .array(z.string().min(1).max(200))
    .min(0)
    .max(5)
    .default([]),

  confidence: z
    .number()
    .min(0, 'confidence deve ser >= 0')
    .max(1, 'confidence deve ser <= 1'),
});

export type AIInsightRaw = z.infer<typeof AIInsightRawSchema>;

// ── Resultado de parse com discriminated union ─────────────

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[]; fallback: T };

// ── Fallback seguro quando o modelo retorna lixo ──────────

function createFallbackInsight(
  rawResponse: string,
  signalId: string
): AIInsightRaw {
  return {
    summary: 'Análise não disponível — resposta da IA inválida',
    details: `O modelo retornou uma resposta que não pôde ser validada para o sinal ${signalId}. Raw: ${rawResponse.substring(0, 200)}`,
    risk_score: 50,         // valor neutro, não 0 (que seria enganoso)
    opportunity_score: 50,
    sentiment: 'NEUTRAL',
    tags: ['parse_error', 'requires_review'],
    recommendations: ['Revisar manualmente este sinal'],
    confidence: 0,          // 0 indica claramente que não há confiança
  };
}

// ── Parser principal ──────────────────────────────────────

/**
 * Parseia e valida o output bruto da Groq/Claude.
 * 
 * Estratégia de parsing defensivo:
 * 1. Remove markdown code fences (```json ... ```)
 * 2. Tenta JSON.parse
 * 3. Valida com Zod
 * 4. Em caso de erro, retorna fallback + log de erro
 * 
 * NUNCA lança exceção — sempre retorna um valor válido.
 */
export function parseAIOutput(
  rawText: string,
  signalId: string,
  logger?: { warn: (msg: string, meta?: object) => void }
): ParseResult<AIInsightRaw> {
  const errors: string[] = [];

  // Passo 1: Limpar markdown fences comuns
  let cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Passo 2: Extrair JSON se vier com texto antes/depois
  // Ex: "Aqui está minha análise:\n{...}\nEspero que ajude!"
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  // Passo 3: Tentar parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    errors.push(`JSON.parse falhou: ${(err as Error).message}`);
    logger?.warn('AIOutput: JSON parse error', {
      signalId,
      error: (err as Error).message,
      rawPreview: rawText.substring(0, 200),
    });
    return {
      success: false,
      errors,
      fallback: createFallbackInsight(rawText, signalId),
    };
  }

  // Passo 4: Validar com Zod
  const result = AIInsightRawSchema.safeParse(parsed);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Passo 5: Tentar recuperação parcial — preencher campos inválidos com defaults
  const zodErrors = result.error.issues.map(
    (i) => `${i.path.join('.')}: ${i.message}`
  );
  errors.push(...zodErrors);

  logger?.warn('AIOutput: Zod validation errors', {
    signalId,
    errors: zodErrors,
    rawPreview: rawText.substring(0, 200),
  });

  // Tentativa de recuperação parcial (pega o que der)
  const partialParsed = parsed as Record<string, unknown>;
  const recovered = AIInsightRawSchema.safeParse({
    summary: typeof partialParsed.summary === 'string' ? partialParsed.summary : 'Análise parcial',
    details: typeof partialParsed.details === 'string' ? partialParsed.details : 'Detalhes indisponíveis',
    risk_score: typeof partialParsed.risk_score === 'number'
      ? Math.max(0, Math.min(100, Math.round(partialParsed.risk_score))) : 50,
    opportunity_score: typeof partialParsed.opportunity_score === 'number'
      ? Math.max(0, Math.min(100, Math.round(partialParsed.opportunity_score))) : 50,
    sentiment: ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(partialParsed.sentiment as string)
      ? partialParsed.sentiment : 'NEUTRAL',
    tags: Array.isArray(partialParsed.tags) ? partialParsed.tags.slice(0, 10) : ['parse_partial'],
    recommendations: Array.isArray(partialParsed.recommendations)
      ? partialParsed.recommendations.slice(0, 5) : [],
    confidence: typeof partialParsed.confidence === 'number'
      ? Math.max(0, Math.min(1, partialParsed.confidence)) : 0.3,
  });

  if (recovered.success) {
    return {
      success: false,   // indica que houve erros, mesmo com recuperação
      errors,
      fallback: recovered.data,
    };
  }

  return {
    success: false,
    errors,
    fallback: createFallbackInsight(rawText, signalId),
  };
}

// ── Prompt builder com sanitização de input ───────────────

/**
 * CORRIGE [SEC-5]: Prompt Injection via dados de mercado.
 * 
 * Tokens da Binance, volumes e preços são sanitizados antes
 * de serem inseridos no prompt da IA.
 */
export function sanitizeForPrompt(value: string | number): string {
  if (typeof value === 'number') {
    // Valida que é um número real, não Infinity ou NaN
    if (!isFinite(value)) return '0';
    return value.toString();
  }

  return value
    .trim()
    // Remove caracteres que poderiam ser usados para injeção
    .replace(/[<>{}[\]`\\]/g, '')
    // Limita tamanho para evitar prompt stuffing
    .substring(0, 100);
}

/**
 * Constrói o prompt para análise de sinal com inputs sanitizados.
 * 
 * PROBLEMA ORIGINAL: Dados da Binance inseridos diretamente no
 * prompt sem sanitização → possível Prompt Injection.
 */
export function buildSignalAnalysisPrompt(signal: {
  type: string;
  symbol: string;
  price: number;
  volume: number;
  priceChange?: number;
  tradeValue?: number;
}): string {
  const safeType = sanitizeForPrompt(signal.type);
  const safeSymbol = sanitizeForPrompt(signal.symbol);
  const safePrice = sanitizeForPrompt(signal.price);
  const safeVolume = sanitizeForPrompt(signal.volume);
  const safePriceChange = signal.priceChange !== undefined
    ? sanitizeForPrompt(signal.priceChange) : 'N/A';
  const safeTradeValue = signal.tradeValue !== undefined
    ? sanitizeForPrompt(signal.tradeValue) : 'N/A';

  return `Você é um analista de mercado crypto experiente e objetivo.

Analise este sinal de mercado detectado:

SINAL:
- Tipo: ${safeType}
- Ativo: ${safeSymbol}
- Preço atual: $${safePrice}
- Volume: ${safeVolume}
- Variação de preço: ${safePriceChange}%
- Valor da operação: $${safeTradeValue}

TAREFA:
Retorne APENAS um objeto JSON válido, sem texto adicional, sem markdown, sem explicações fora do JSON.

SCHEMA OBRIGATÓRIO:
{
  "summary": "string (max 200 chars) — resumo em uma linha",
  "details": "string (max 1000 chars) — análise detalhada em 2-3 parágrafos",
  "risk_score": number (0-100, inteiro),
  "opportunity_score": number (0-100, inteiro),
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "tags": ["string", ...] (max 5 tags),
  "recommendations": ["string", ...] (max 3 itens),
  "confidence": number (0.0 a 1.0)
}

IMPORTANTE: Responda APENAS com o JSON. Nenhum outro texto.`;
}
