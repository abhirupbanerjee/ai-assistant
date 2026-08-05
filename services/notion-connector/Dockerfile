# =============================================================================
# Notion Connector Microservice — Dockerfile
# =============================================================================
# Per-user Notion workspace access with OAuth.
# Zero runtime dependencies (Node built-ins only).
# =============================================================================

FROM node:22-bookworm-slim AS build

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /build/dist ./dist

RUN useradd --create-home --uid 1001 connector
USER connector

ENV NODE_ENV=production
ENV PORT=8092
ENV LOG_LEVEL=info

EXPOSE 8092

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8092)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
