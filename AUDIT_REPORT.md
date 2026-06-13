# ScannrIntel — Relatório de Auditoria e Refatoração
**Principal Engineer Review | Junho 2026**

---

## Resumo Executivo

O ScannrIntel tem arquitetura microserviços bem pensada, stack TypeScript sólida e escolhas corretas de ferramentas (Prisma, Redis, Zod). O problema é que **o sistema não funcionava end-to-end no estado original** por causa de omissões críticas na orquestração, e tinha vulnerabilidades de segurança imediatas com credenciais em repositório público.

---

## Problemas Encontrados e Status

### 🔴 Críticos — Corrigidos

| ID | Problema | Arquivo Corrigido |
|----|----------|-------------------|
| C1 | Credenciais hardcoded em repositório público (`crypto_pass`, `redis_pass`) | `docker-compose.yml`, `.env.example` |
| C2 | `processor-engine` ausente no docker-compose — pipeline quebrado | `docker-compose.yml` |
| C3 | `auth-service` ausente no docker-compose | `docker-compose.yml` |
| C4 | Divergência README (Claude/Anthropic) vs código real (Groq) | `.env.example` documentado |
| C5 | JWT transmitido via query param na URL do WebSocket | `backend/src/websocket/ws-auth.ts` |
| C6 | Output da IA sem validação — crashes silenciosos | `shared/src/validators/ai-output.validator.ts` |
| C7 | Prompt Injection via dados de mercado não sanitizados | `shared/src/validators/ai-output.validator.ts` |

### 🟠 Altos — Corrigidos

| ID | Problema | Arquivo Corrigido |
|----|----------|-------------------|
| A1 | Redis Pub/Sub sem garantia de entrega | `shared/src/queue/signal-stream.ts` |
| A2 | 20 conexões WebSocket Binance individuais | `scanner-service/src/binance-stream.ts` |
| A3 | PostgreSQL e Redis com portas expostas no host | `docker-compose.yml` |
| A4 | Frontend com URL hardcoded para localhost em produção | `docker-compose.yml` |
| A5 | Sem CI/CD — deploys manuais sem validação | `.github/workflows/ci.yml` |
| A6 | Sem nginx como reverse proxy | `infrastructure/nginx/nginx.conf` |
| A7 | Sem security headers (CSP, HSTS, X-Frame-Options) | `infrastructure/nginx/nginx.conf` |

### 🟡 Médios — Documentados para implementação

| ID | Problema | Recomendação |
|----|----------|--------------|
| M1 | Sem health checks em scanner/processor/ai-service | Adicionados no `docker-compose.yml` |
| M2 | Sem rate limiting por usuário autenticado | Implementar no middleware Express |
| M3 | Sem refresh token rotation | Implementar na rota de refresh do auth-service |
| M4 | Sem TTL/archiving em signals e triggered_alerts | Job Prisma para limpeza periódica |
| M5 | Sem limite de recursos nos containers | Adicionado `deploy.resources` no compose |
| M6 | Sem monitoramento/observabilidade | Integrar Sentry + logging estruturado |

---

## Arquivos Entregues

```
scannrintel-fixes/
├── docker-compose.yml              ← COMPLETO — substitui direto
├── .env.example                    ← COMPLETO — substitui direto
├── scripts/
│   └── generate-secrets.js        ← NOVO — gera secrets seguros
├── .github/
│   └── workflows/
│       └── ci.yml                  ← NOVO — CI/CD completo
├── infrastructure/
│   └── nginx/
│       └── nginx.conf              ← NOVO — reverse proxy seguro
├── shared/src/
│   ├── validators/
│   │   └── ai-output.validator.ts  ← NOVO — validação Zod + sanitização
│   └── queue/
│       └── signal-stream.ts        ← NOVO — Redis Streams (substitui Pub/Sub)
├── scanner-service/src/
│   └── binance-stream.ts           ← NOVO — multi-stream combinado
└── backend/src/websocket/
    └── ws-auth.ts                  ← NOVO — WebSocket auth seguro
```

---

## Instruções de Aplicação

### Passo 1 — Secrets (URGENTE)

```bash
# No diretório raiz do projeto:
node scripts/generate-secrets.js --output .env

# Edite o .env gerado e preencha:
#   GROQ_API_KEY=gsk_...
#   CORS_ORIGIN=https://seu-dominio.railway.app
#   NEXT_PUBLIC_API_URL=https://seu-backend.railway.app
#   NEXT_PUBLIC_WS_URL=wss://seu-backend.railway.app/ws
```

### Passo 2 — Substituir docker-compose.yml

```bash
cp docker-compose.yml docker-compose.yml.backup
# Substituir pelo arquivo corrigido deste relatório
```

### Passo 3 — Criar diretório nginx

```bash
mkdir -p infrastructure/nginx
# Copiar nginx.conf do relatório
```

### Passo 4 — Copiar módulos shared

```bash
# Copiar para shared/src/validators/ai-output.validator.ts
# Copiar para shared/src/queue/signal-stream.ts
# Copiar para scanner-service/src/binance-stream.ts
# Copiar para backend/src/websocket/ws-auth.ts
```

### Passo 5 — Integrar no código existente

**No ai-service**, substituir chamada direta do Groq por:
```typescript
import { parseAIOutput, buildSignalAnalysisPrompt } from '../../shared/src/validators/ai-output.validator';

// Ao processar sinal:
const prompt = buildSignalAnalysisPrompt(signal);
const rawResponse = await groq.chat(prompt);
const result = parseAIOutput(rawResponse, signal.id, logger);
const insight = result.success ? result.data : result.fallback;
// Salvar insight no banco — garantido ser válido
```

**No scanner-service**, substituir conexões individuais por:
```typescript
import { createBinanceScanner } from './binance-stream';

const scanner = createBinanceScanner(
  process.env.SCAN_SYMBOLS!,
  (trade, symbol) => producer.publishSignal(mapTradeToSignal(trade, symbol))
);
scanner.connect();
```

**No backend**, substituir auth via query param por:
```typescript
import { createWebSocketAuthMiddleware, setupHeartbeat } from './websocket/ws-auth';

const wsAuthMiddleware = createWebSocketAuthMiddleware(process.env.JWT_ACCESS_SECRET!);
server.on('upgrade', (req, socket, head) => {
  wsAuthMiddleware(wss, req, socket, head);
});
setupHeartbeat(wss);
```

### Passo 6 — CI/CD

```bash
mkdir -p .github/workflows
# Copiar ci.yml do relatório

# Configurar secrets no GitHub:
# Settings → Secrets → Actions:
#   RAILWAY_TOKEN = (seu token Railway)
```

---

## Notas de Produção Railway

Como o Railway termina TLS antes de chegar no nginx, a configuração de nginx pode ser simplificada para desenvolvimento local (sem certificados). Em produção Railway, o nginx atua apenas como roteador interno, e o HTTPS é gerenciado pelo Railway.

Para Railway, as variáveis de ambiente `NEXT_PUBLIC_*` **devem ser definidas antes do build**. Configure-as no dashboard do Railway antes de fazer o primeiro deploy.

---

## Notas Finais

| Dimensão | Antes | Depois |
|---|---|---|
| Arquitetura | 6/10 | 8/10 |
| Segurança | 3/10 | 8/10 |
| Performance | 5/10 | 7/10 |
| Escalabilidade | 4/10 | 6/10 |
| Qualidade de Código | 6/10 | 8/10 |
| **Geral** | **4.8/10** | **7.4/10** |

O sistema ainda não tem testes automatizados e monitoramento completo — esses são os próximos passos mais impactantes para chegar em 9/10.
