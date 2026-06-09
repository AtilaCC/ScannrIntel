FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

ENV NODE_ENV=production

HEALTHCHECK NONE

CMD ["npx", "ts-node", "--transpile-only", "src/index.ts"]
