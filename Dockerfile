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

# Copy browser-ready vendor bundles used by self-contained HTML generation.
# Next standalone tracing does not include these dynamic fs reads from node_modules.
RUN mkdir -p public/vendor && \
    cp node_modules/chart.js/dist/chart.umd.min.js public/vendor/chart.umd.min.js && \
    cp node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js public/vendor/chartjs-plugin-datalabels.min.js && \
    cp node_modules/mermaid/dist/mermaid.min.js public/vendor/mermaid.min.js && \
    echo "=== HTML vendor bundle sizes ===" && \
    ls -lh public/vendor/

# Build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 3: Runner
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_ROOT=/app

# Install gosu for dropping privileges, k6 CLI for load testing,
# and Playwright Chromium for server-side chart/diagram rendering
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

# Install Playwright Chromium for server-side HTML chart/diagram rendering.
# This adds ~200MB to the image but eliminates client-side JS dependencies in generated HTML.
# Browsers are installed directly to a shared location so the non-root nextjs user can access them.
COPY --from=builder /app/node_modules/playwright ./node_modules/playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN mkdir -p /opt/playwright-browsers && \
    node ./node_modules/playwright/cli.js install chromium --with-deps && \
    echo "=== Playwright Chromium installed ===" && \
    ls -la /opt/playwright-browsers/

# Create non-root user
RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs nextjs

# Ensure the nextjs user can access the Playwright browsers
RUN chown -R nextjs:nodejs /opt/playwright-browsers

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
