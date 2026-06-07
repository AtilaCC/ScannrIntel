#!/bin/bash
# ============================================================
# DEV SCRIPT — Start all services with hot reload
# Requires: tmux or runs in background
# ============================================================

set -e

export $(grep -v '^#' .env | xargs) 2>/dev/null || true

# Start infrastructure
echo "Starting databases..."
docker compose up -d postgres redis
sleep 3

echo "Starting services..."

# Backend
cd backend && npm run dev &
BACKEND_PID=$!
cd ..

# Scanner
cd scanner-service && npm run dev &
SCANNER_PID=$!
cd ..

# Processor
cd processor-engine && npm run dev &
PROCESSOR_PID=$!
cd ..

# AI Service
cd ai-service && npm run dev &
AI_PID=$!
cd ..

# Frontend
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ All services started!"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:4000"
echo ""
echo "Press Ctrl+C to stop all services"

cleanup() {
  echo "Stopping all services..."
  kill $BACKEND_PID $SCANNER_PID $PROCESSOR_PID $AI_PID $FRONTEND_PID 2>/dev/null
  docker compose stop postgres redis
  exit 0
}

trap cleanup INT TERM
wait
