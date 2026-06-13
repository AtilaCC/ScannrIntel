FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY shared/ ./shared/
COPY processor-engine/ ./processor-engine/
RUN npm install
WORKDIR /app/processor-engine
RUN npx tsc

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
COPY --from=builder /app/processor-engine/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
CMD ["node", "dist/index.js"]
