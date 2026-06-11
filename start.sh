#!/bin/bash
echo "================================"
echo "  CryptoIntel - Iniciando..."
echo "================================"

if ! docker info > /dev/null 2>&1; then
  echo "ERRO: Docker não está rodando."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Arquivo .env criado. Edite com suas chaves."
  exit 1
fi

docker compose up --build -d

echo ""
echo "================================"
echo " Sistema iniciado com sucesso!"
echo " Acesse: http://localhost:3000"
echo "================================"
