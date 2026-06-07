FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

EXPOSE 4000
ENV PORT=4000

CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node --skipProject --transpile-only src/index.ts"]
