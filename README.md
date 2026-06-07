# 🚀 CryptoIntel — AI-Powered Crypto Intelligence Platform

> Real-time market scanning with Claude AI analysis, multi-user authentication, and production-grade microservices architecture.

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│              Browser (Next.js + WebSocket)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP / WSS
                    ┌──────▼──────┐
                    │    NGINX    │  Reverse Proxy
                    └──────┬──────┘
          ┌────────────────┼──────────────────┐
          │                │                  │
   ┌──────▼──────┐  ┌──────▼──────┐  ┌────────▼──────┐
   │  Backend    │  │  Frontend   │  │  WebSocket     │
   │  REST API   │  │  Next.js    │  │  Gateway       │
   │  (Port 4000)│  │  (Port 3000)│  │  (Port 4000/ws)│
   └──────┬──────┘  └─────────────┘  └────────────────┘
          │
     ┌────▼────┐
     │  Redis  │  Pub/Sub + Cache
     └────┬────┘
          │ Subscribe
   ┌──────┴──────────────────────────────────┐
   │           │               │             │
┌──▼──────┐ ┌──▼──────┐ ┌──▼──────────┐ ┌──▼──────┐
│ Scanner │ │Processor│ │  AI Service │ │  Auth   │
│ Service │ │ Engine  │ │  (Claude)   │ │ Service │
└──┬──────┘ └──┬──────┘ └──┬──────────┘ └─────────┘
   │           │            │
   │      ┌────▼────┐  ┌────▼────┐
   │      │Postgres │  │ Queue   │
   │      └─────────┘  └─────────┘
   │
   └──► Binance WebSocket API
```

---

## 🛠️ Services

| Service | Port | Description |
|---------|------|-------------|
| **Frontend** | 3000 | Next.js 14 + Tailwind UI |
| **Backend API** | 4000 | REST API + WebSocket server |
| **Scanner** | 4001 | Binance WebSocket ingestion |
| **Processor** | 4002 | Signal detection engine |
| **AI Service** | 4003 | Claude AI analysis + alert checker |
| **PostgreSQL** | 5432 | Primary database |
| **Redis** | 6379 | Pub/Sub + cache |

---

## ⚡ Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Anthropic API Key → [console.anthropic.com](https://console.anthropic.com)

### 1. Clone & Configure

```bash
git clone https://github.com/youruser/crypto-intelligence.git
cd crypto-intelligence

cp .env.example .env
# Edit .env — required fields:
#   ANTHROPIC_API_KEY=sk-ant-...
#   JWT_ACCESS_SECRET=<random 32+ chars>
#   JWT_REFRESH_SECRET=<random 32+ chars>
```

### 2. Start with Docker (Recommended)

```bash
docker compose up --build
```

### 3. Or Start Locally (Development)

```bash
# Install all dependencies
npm run setup

# Start all services with hot reload
npm run dev
```

### 4. Access

| URL | Service |
|-----|---------|
| http://localhost:3000 | Frontend |
| http://localhost:4000/health | Backend health |
| http://localhost:3000/auth/login | Login page |

---

## 🔐 Authentication

The platform uses **JWT-based authentication**:

- **Access Token**: 15-minute lifetime, sent in `Authorization: Bearer <token>` header
- **Refresh Token**: 7-day lifetime, stored client-side, used to renew access tokens
- **Password**: Hashed with bcrypt (12 rounds)

### Register / Login

```bash
# Register
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "Password123"}'

# Login
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "Password123"}'
```

---

## 📡 API Reference

All endpoints (except `/auth/*`) require `Authorization: Bearer <token>`.

### Tokens
```
GET  /api/v1/tokens              - List all tokens with live prices
GET  /api/v1/tokens/:symbol      - Get single token
POST /api/v1/tokens/:symbol/watchlist - Toggle watchlist
GET  /api/v1/tokens/watchlist/me - Get user watchlist
```

### Signals
```
GET  /api/v1/signals             - List signals (paginated, filterable)
GET  /api/v1/signals/:id         - Get signal with AI insights
```

### AI Insights
```
GET  /api/v1/insights            - List insights (paginated)
GET  /api/v1/insights/latest     - Latest 10 insights
```

### Alerts
```
GET    /api/v1/alerts            - List user's alert configs
POST   /api/v1/alerts            - Create alert config
DELETE /api/v1/alerts/:id        - Delete alert
PATCH  /api/v1/alerts/:id/toggle - Toggle on/off
GET    /api/v1/alerts/triggered  - Get triggered alerts history
PATCH  /api/v1/alerts/triggered/:id/read - Mark as read
```

---

## 🤖 Claude AI Integration

Each detected signal is processed by Claude with a specialized prompt that generates:

- **Summary**: One-line description of the event
- **Details**: 2-3 paragraph analysis
- **Risk Score** (0-100): How risky the signal is
- **Opportunity Score** (0-100): Trading opportunity assessment
- **Sentiment**: BULLISH / BEARISH / NEUTRAL
- **Tags**: Signal classification tags
- **Recommendations**: Actionable observations
- **Confidence**: Model confidence (0-1)

### Rate Limiting
- 50 requests/minute to Claude API
- 3-worker concurrent processing queue
- Automatic retry with exponential backoff (3 attempts)
- Signal deduplication (30-second window)

---

## 📊 Signal Types

| Signal | Trigger |
|--------|---------|
| `WHALE_TRADE` | Single trade ≥ $100,000 |
| `VOLUME_SPIKE` | Volume ≥ 3x 20-period average |
| `PRICE_SURGE` | +5% in 5-minute window |
| `PRICE_CRASH` | -5% in 5-minute window |
| `ACCUMULATION_PATTERN` | 5+ large buys ($50k+) in 5 minutes totaling $500k+ |

### Severity Levels
- `CRITICAL` — Extreme anomaly (e.g. $10M+ trade, 10x volume)
- `HIGH` — Major anomaly ($1M+ trade, 6x volume)
- `MEDIUM` — Notable anomaly
- `LOW` — Minor signal

---

## ☁️ Railway Deployment

### 1. Create Railway Project

```bash
npm install -g @railway/cli
railway login
railway init
```

### 2. Add Services

In Railway dashboard, create these services:
1. **PostgreSQL** (Railway plugin)
2. **Redis** (Railway plugin)
3. **Backend** → point to `./backend`
4. **Frontend** → point to `./frontend`
5. **Scanner** → point to `./scanner-service`
6. **Processor** → point to `./processor-engine`
7. **AI Service** → point to `./ai-service`

### 3. Environment Variables per Service

**Backend / Processor / AI Service:**
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_ACCESS_SECRET=<your_secret>
JWT_REFRESH_SECRET=<your_secret>
ANTHROPIC_API_KEY=<your_key>
NODE_ENV=production
```

**Frontend:**
```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXT_PUBLIC_WS_URL=wss://your-backend.railway.app
```

---

## 🗄️ Database Schema

```
users          → Authentication, profiles
sessions       → JWT refresh token storage
tokens         → Tracked crypto assets + live prices
signals        → Detected market anomalies
ai_insights    → Claude AI analysis results
alert_configs  → User-configured alert rules
triggered_alerts → Alert notification history
watchlists     → User favorite tokens
```

---

## 🔧 Configuration

All thresholds are configurable in `shared/src/constants/index.ts`:

```typescript
export const THRESHOLDS = {
  WHALE_TRADE_USD: 100_000,        // $100k+ = whale
  VOLUME_SPIKE_MULTIPLIER: 3.0,    // 3x average = spike
  PRICE_SURGE_PERCENT: 5.0,        // 5% surge
  PRICE_CRASH_PERCENT: -5.0,       // 5% crash
  ACCUMULATION_WINDOW_MS: 5 * 60_000, // 5-min window
};
```

---

## 📁 Project Structure

```
crypto-intelligence/
├── frontend/              # Next.js 14 web app
│   ├── src/app/           # Pages (App Router)
│   ├── src/components/    # UI components
│   ├── src/store/         # Zustand state
│   ├── src/hooks/         # Custom hooks
│   └── src/lib/           # API client
├── backend/               # Express REST API + WebSocket
│   ├── src/routes/        # API routes
│   ├── src/middleware/    # Auth, error, rate limit
│   ├── src/services/      # Business logic
│   └── prisma/            # Database schema
├── scanner-service/       # Binance WebSocket ingestion
├── processor-engine/      # Signal detection
├── ai-service/            # Claude AI analysis + alerts
├── shared/                # Shared types, constants, utils
└── infrastructure/        # Docker, Nginx, scripts
```

---

## 🔒 Security Features

- JWT access tokens (15min expiry) + refresh tokens (7 days)
- bcrypt password hashing (12 rounds)
- Rate limiting per IP (300 req/15min, 20 req/15min for auth)
- Helmet.js HTTP security headers
- CORS origin validation
- WebSocket authentication via token query param
- Input validation with Zod schemas
- SQL injection prevention via Prisma ORM
- Session management with DB-stored refresh tokens

---

## 📄 License

MIT — Built for educational and portfolio purposes. Not financial advice.
