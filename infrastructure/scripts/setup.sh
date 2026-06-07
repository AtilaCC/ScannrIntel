#!/bin/bash
# ============================================================
# CRYPTO INTELLIGENCE PLATFORM — Setup Script
# ============================================================
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   CryptoIntel — Platform Setup       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# Check requirements
command -v node >/dev/null 2>&1 || error "Node.js is required (v20+)"
command -v docker >/dev/null 2>&1 || error "Docker is required"
command -v docker compose >/dev/null 2>&1 || error "Docker Compose is required"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  error "Node.js 18+ required (found v$NODE_VERSION)"
fi

ok "Node.js $(node -v) found"
ok "Docker found"

# Copy .env if not exists
if [ ! -f ".env" ]; then
  cp .env.example .env
  warn ".env created from .env.example — EDIT IT before continuing!"
  warn "Required: ANTHROPIC_API_KEY, JWT secrets"
  echo ""
  read -p "Press Enter after you've updated .env..."
fi

ok ".env file ready"

# Install dependencies
log "Installing dependencies..."
for svc in backend scanner-service processor-engine ai-service frontend; do
  log "  → $svc"
  cd "$svc" && npm install --silent && cd ..
done
ok "Dependencies installed"

# Generate Prisma client
log "Generating Prisma client..."
cd backend && npx prisma generate --silent && cd ..
ok "Prisma client generated"

# Start infrastructure
log "Starting PostgreSQL and Redis..."
docker compose up -d postgres redis

log "Waiting for databases..."
sleep 5

# Run migrations
log "Running database migrations..."
cd backend
DATABASE_URL=$(grep DATABASE_URL ../.env | cut -d '=' -f2-) npx prisma migrate deploy 2>/dev/null || \
  DATABASE_URL=$(grep DATABASE_URL ../.env | cut -d '=' -f2-) npx prisma db push --accept-data-loss
cd ..
ok "Database ready"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup complete! Start with:            ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║   docker compose up                      ║${NC}"
echo -e "${GREEN}║   (or: ./scripts/dev.sh for hot-reload)  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Frontend:  ${CYAN}http://localhost:3000${NC}"
echo -e "  Backend:   ${CYAN}http://localhost:4000${NC}"
echo -e "  Health:    ${CYAN}http://localhost:4000/health${NC}"
echo ""
