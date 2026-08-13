# =============================================================================
# Browser Worker — Isolated Playwright Chromium sidecar
# =============================================================================
# Runs a single dedicated Chromium with its sandbox ENABLED (no --no-sandbox),
# as a non-root user, with no app source or secrets mounted. Egress is guarded
# in JS (context.route) and further restricted at the network layer in compose.
#
# NOTE on Chromium sandbox in Docker:
#   The Chromium sandbox needs a compatible seccomp profile / user-namespace
#   configuration. The official Playwright base image below ships Chromium with
#   its dependencies and is the supported way to run a sandboxed browser in a
#   container. Do NOT add --no-sandbox.
# =============================================================================

# --- Build stage -------------------------------------------------------------
FROM node:20-bookworm-slim AS build

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage (official Playwright image: Chromium + deps preinstalled) --
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS runtime

WORKDIR /app

# Copy compiled output + the playwright npm package (browsers come from the base image).
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist

# Non-root user. The browser profile lives in a tmpfs at runtime (compose).
RUN useradd --create-home --uid 1001 browser \
    && mkdir -p /tmp/browser-profile \
    && chown -R browser:browser /tmp/browser-profile

USER browser

ENV NODE_ENV=production
ENV PORT=8780
ENV LOG_LEVEL=info

EXPOSE 8780

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8780)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
