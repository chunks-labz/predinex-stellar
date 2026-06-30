# ─── Builder ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies, keep only production deps
RUN npm ci --omit=dev --ignore-scripts

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Minimal runtime hardening
RUN addgroup -S bot && adduser -S bot -G bot
WORKDIR /app

# Copy compiled output and production node_modules from builder
COPY --from=builder --chown=bot:bot /app/dist ./dist
COPY --from=builder --chown=bot:bot /app/node_modules ./node_modules
COPY --from=builder --chown=bot:bot /app/package.json ./package.json

USER bot

# The bot reads all config from environment variables.
# See .env.example for the full reference.
ENV NODE_ENV=production

# Healthcheck: verify the process is alive
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "dist/index.js"]
