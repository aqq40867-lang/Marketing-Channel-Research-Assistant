# syntax=docker/dockerfile:1
# Marketing Channel Research Assistant · multi-stage build: deps → build → slim runtime image

ARG NODE_VERSION=22-alpine

# ---------- 1. Install dependencies ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2. Build ----------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 3. Run ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Secrets are injected at runtime via environment variables (docker run --env-file / compose env_file), never baked into the image
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

CMD ["node", "server.js"]
