# =============================================================================
# Drive Connector Microservice — Dockerfile
# =============================================================================
# Phase 1 shared service-identity connector for Google Sheets / Drive / Docs.
# Zero runtime dependencies (Node built-ins only) so the image stays tiny.
# =============================================================================

# --- Build stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /build

# Install dev dependencies needed for compilation only.
COPY package.json package-lock.json* ./
RUN npm ci

# Compile TypeScript.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Tini for proper signal handling (PID 1) and clean shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled output only — no node_modules needed (no runtime deps).
COPY --from=build /build/dist ./dist

# Non-root user for defense in depth.
RUN useradd --create-home --uid 1001 connector
USER connector

ENV NODE_ENV=production
ENV PORT=8090
ENV LOG_LEVEL=info
# Service-account JSON is injected at runtime via a secret env var or a
# mounted file at /run/secrets/gcp-service-account.json.
ENV SERVICE_ACCOUNT_PATH=/run/secrets/gcp-service-account.json

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8090)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
