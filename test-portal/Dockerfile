# Build with `test-portal/` as the Docker context. Stable repository paths are
# deliberately unavailable to every stage.
FROM node:22-alpine AS dependencies
WORKDIR /portal
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /portal
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /portal/node_modules ./node_modules
COPY . .
RUN npm run test:isolation && npm run type-check && npm run build

FROM node:22-alpine AS runner
WORKDIR /portal
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 portal && \
    adduser --system --uid 1001 --ingroup portal portal
COPY --from=builder --chown=portal:portal /portal/public ./public
COPY --from=builder --chown=portal:portal /portal/.next/standalone ./
COPY --from=builder --chown=portal:portal /portal/.next/static ./.next/static
USER portal
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/readiness >/dev/null || exit 1
CMD ["node", "server.js"]
