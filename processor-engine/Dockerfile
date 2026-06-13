FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY processor-engine/ ./processor-engine/
COPY shared/ ./shared/
WORKDIR /app/processor-engine
RUN npm install --prefix /app
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
COPY --from=builder /app/processor-engine/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
CMD ["node", "dist/index.js"]
