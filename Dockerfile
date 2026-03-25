# Stage 1: Dependencies
FROM node:20-slim AS deps
WORKDIR /app

# Install build dependencies for better-sqlite3 and native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci --legacy-peer-deps

# Stage 2: Builder
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure public directory exists
RUN mkdir -p public

# Build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 3: Runner
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install gosu for dropping privileges and k6 CLI for load testing
RUN apt-get update && \
    apt-get install -y --no-install-recommends gosu gnupg2 curl ca-certificates && \
    mkdir -p /root/.gnupg && chmod 700 /root/.gnupg && \
    curl -fsSL https://dl.k6.io/key.gpg | gpg --batch --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
      tee /etc/apt/sources.list.d/k6.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends k6 && \
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/* /root/.gnupg

# Create non-root user
RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy ONNX runtime native libraries for local reranker (Transformers.js)
# Only copy linux/x64 binaries needed for production
COPY --from=builder /app/node_modules/onnxruntime-node/bin/napi-v3/linux/x64 ./node_modules/onnxruntime-node/bin/napi-v3/linux/x64

# Create data directory
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Create transformers cache directories with proper ownership for non-root user
RUN mkdir -p /tmp/transformers_cache /tmp/cache && \
    chown -R nextjs:nodejs /tmp/transformers_cache /tmp/cache && \
    chmod 755 /tmp/transformers_cache /tmp/cache

# Copy entrypoint script (handles volume permissions and drops privileges)
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Entrypoint fixes permissions on mounted volumes, then runs as nextjs user
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
