# Voice + Next.js server (inbound + outbound). Long-lived WebSocket — not for Vercel.
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN mkdir -p recordings call_logs \
  && npx prisma generate \
  && npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Railway / Render inject PORT; server.ts already reads process.env.PORT
CMD ["npm", "run", "start:voice"]
