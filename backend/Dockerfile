FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npx tsc --skipLibCheck || true

EXPOSE 4000
ENV PORT=4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
