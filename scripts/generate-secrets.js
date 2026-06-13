#!/usr/bin/env node
/**
 * ScannrIntel — scripts/generate-secrets.js
 * 
 * PROBLEMA ORIGINAL: .env.example com senhas fracas como "crypto_pass"
 * SOLUÇÃO: Gera automaticamente todos os secrets seguros para o .env
 * 
 * USO:
 *   node scripts/generate-secrets.js
 *   node scripts/generate-secrets.js --output .env
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const outputFile = args.includes('--output') 
  ? args[args.indexOf('--output') + 1] 
  : null;

// Gerador de secret criptograficamente seguro
function generateSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Gerador de senha com caracteres especiais
function generatePassword(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const randomBytes = crypto.randomBytes(length);
  return Array.from(randomBytes, byte => chars[byte % chars.length]).join('');
}

const secrets = {
  JWT_ACCESS_SECRET: generateSecret(48),
  JWT_REFRESH_SECRET: generateSecret(48),  // Deliberadamente diferente do ACCESS
  POSTGRES_PASSWORD: generatePassword(32),
  REDIS_PASSWORD: generatePassword(32),
};

// Verificação: os dois JWT secrets DEVEM ser diferentes
if (secrets.JWT_ACCESS_SECRET === secrets.JWT_REFRESH_SECRET) {
  console.error('❌ ERRO CRÍTICO: JWT secrets gerados são iguais. Execute novamente.');
  process.exit(1);
}

const envContent = `# ============================================================
# ScannrIntel — .env (GERADO AUTOMATICAMENTE)
# Gerado em: ${new Date().toISOString()}
# NUNCA commite este arquivo no git!
# ============================================================

# ── JWT ────────────────────────────────────────────────────
JWT_ACCESS_SECRET=${secrets.JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${secrets.JWT_REFRESH_SECRET}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ── Banco de Dados ─────────────────────────────────────────
POSTGRES_USER=scannr_prod
POSTGRES_PASSWORD=${secrets.POSTGRES_PASSWORD}
POSTGRES_DB=crypto_intelligence

# ── Redis ──────────────────────────────────────────────────
REDIS_PASSWORD=${secrets.REDIS_PASSWORD}
REDIS_MAX_MEMORY=256mb

# ── APIs de IA (preencher manualmente) ────────────────────
GROQ_API_KEY=
# ANTHROPIC_API_KEY=

# ── APIs Externas (opcional) ──────────────────────────────
CRYPTOPANIC_API_KEY=
WHALE_ALERT_API_KEY=

# ── CORS ───────────────────────────────────────────────────
CORS_ORIGIN=http://localhost:3000

# ── URLs do Frontend ──────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws

# ── App ────────────────────────────────────────────────────
NODE_ENV=development
LOG_LEVEL=info
BCRYPT_ROUNDS=12
APP_VERSION=1.0.0

# ── Scanner ────────────────────────────────────────────────
SCAN_SYMBOLS=BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT

# ── AI Service ─────────────────────────────────────────────
AI_WORKER_COUNT=3
AI_RATE_LIMIT_RPM=50
`;

if (outputFile) {
  // Verifica se .env já existe para não sobrescrever acidentalmente
  const fullPath = path.resolve(process.cwd(), outputFile);
  if (fs.existsSync(fullPath)) {
    console.error(`❌ ERRO: ${outputFile} já existe. Delete-o primeiro se quiser regenerar.`);
    process.exit(1);
  }
  fs.writeFileSync(fullPath, envContent, { mode: 0o600 });  // chmod 600
  console.log(`✅ Arquivo ${outputFile} criado com permissões 600`);
} else {
  console.log('# Cole o conteúdo abaixo no seu .env:\n');
  console.log(envContent);
}

console.log('\n📋 Resumo dos secrets gerados:');
console.log(`  JWT_ACCESS_SECRET:  ${secrets.JWT_ACCESS_SECRET.substring(0, 16)}... (${secrets.JWT_ACCESS_SECRET.length * 4} bits)`);
console.log(`  JWT_REFRESH_SECRET: ${secrets.JWT_REFRESH_SECRET.substring(0, 16)}... (${secrets.JWT_REFRESH_SECRET.length * 4} bits)`);
console.log(`  POSTGRES_PASSWORD:  ${secrets.POSTGRES_PASSWORD.substring(0, 8)}... (${secrets.POSTGRES_PASSWORD.length} chars)`);
console.log(`  REDIS_PASSWORD:     ${secrets.REDIS_PASSWORD.substring(0, 8)}... (${secrets.REDIS_PASSWORD.length} chars)`);
console.log('\n⚠️  Preencha GROQ_API_KEY manualmente antes de subir os serviços.');
