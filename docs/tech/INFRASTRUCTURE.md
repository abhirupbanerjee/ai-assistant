# Policy Bot - Infrastructure & Deployment

## Overview

Policy Bot uses Docker Compose for containerized deployment with a flexible, profile-based service selection system:
- **Local Development**: Local services with hot reload
- **Production**: Full stack with Traefik TLS, provider selected via Docker profiles

### Infrastructure Provider Choices

Policy Bot supports pluggable database and vector store backends, selected at deployment time:

| Component | Options | Selection Method |
|-----------|---------|-----------------|
| **Database** | PostgreSQL | `--profile postgres` Docker profile |
| **Vector Store** | Qdrant | `VECTOR_STORE_PROVIDER` env var + Docker profile |

> **Important:** Always use explicit `--profile` flags — do not rely on `COMPOSE_PROFILES` env var (unreliable across Docker versions).

### LLM Provider Selection

In addition to database and vector store, choose the LLM provider tier based on data sensitivity:

| Provider Tier | Use Case | Data Classification |
|---|---|---|
| **Ollama** (Local) | Simple RAG, document lookup, basic Q&A, non-complex queries | ✅ Government-sensitive / classified — data never leaves your network |
| **Cloud LLMs** — OpenAI, Claude (direct SDK), Gemini, Mistral, DeepSeek | Complex reasoning, tool calls, multi-step workflows, coding | Public / non-sensitive data only — requests route through external APIs (Claude via direct Anthropic SDK, others via LiteLLM) |
| **Fireworks AI** | Developer testing of open-source models (MiniMax M2.5, Kimi K2.5, GPT-OSS, Qwen3) | Development / test environments only — not for production sensitive data |

> **Rule:** Never route government-sensitive or classified data through Cloud LLM or Fireworks AI providers. Use Ollama for all sensitive workloads.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DOCKER HOST                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         TRAEFIK                                  │    │
│  │                    (Reverse Proxy + TLS)                         │    │
│  │                       Port 443                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      NEXT.JS APP                                 │    │
│  │                    (Port 3000 internal)                          │    │
│  │                                                                  │    │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │    │
│  │   │  Chat API    │  │  Admin API   │  │ SuperUser API│          │    │
│  │   └──────────────┘  └──────────────┘  └──────────────┘          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         │              │              │              │                   │
│         ▼              ▼              ▼              ▼                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│  │  DATABASE   │ │VECTOR STORE │ │    REDIS    │ │   LITELLM   │        │
│  │ PostgreSQL  │ │   Qdrant    │ │  Port 6379  │ │  Port 4000  │        │
│  │  Port 5432  │ │  Port 6333  │ │  (internal) │ │  (internal) │        │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘        │
│  * optional containers, via Docker profiles                              │
│         │              │              │              │                   │
│         ▼              ▼              ▼              │                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │                   │
│  │data/postgres│ │ data/qdrant │ │ data/redis  │    │                   │
│  │  (volume)   │ │  (volume)   │ │  (volume)   │    │                   │
│  │             │ │             │ └─────────────┘    │                   │
│  └─────────────┘ └─────────────┘                    │                   │
│         │                                           │                   │
│         ▼                                           ▼                   │
│  ┌─────────────┐                     ┌────────────────────────────┐     │
│  │  app_data   │ ◄── DB files +      │      EXTERNAL SERVICES     │     │
│  │  (volume)   │     global-docs +   │  ┌────────┐ ┌────────┐     │     │
│  └─────────────┘     threads         │  │ OpenAI │ │Mistral │     │     │
│                                      │  ├────────┤ ├────────┤     │     │
│                                      │  │ Tavily │ │ Cohere │     │     │
│                                      │  ├────────┤ ├────────┤     │     │
│                                      │  │ Ollama │ │Azure DI│     │     │
│                                      │  └────────┘ └────────┘     │     │
│                                      └────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Storage Architecture

### Primary Database (PostgreSQL)

Policy Bot stores all structured metadata in PostgreSQL via the Kysely ORM:

| Data | Table | Notes |
|------|-------|-------|
| Users | `users` | Authentication, roles |
| Categories | `categories` | Category definitions |
| Documents metadata | `documents`, `document_categories` | Upload status, category links |
| Subscriptions | `user_subscriptions` | User → category access |
| Super user assignments | `super_user_categories` | Category management rights |
| Threads | `threads`, `thread_categories` | Chat sessions |
| Messages | `messages` | Chat history |
| Settings | `settings` | System configuration |

**PostgreSQL**:
- Container: `policy-bot-postgres` (port 5432 internal)
- Schema auto-initialised on first start via Kysely migrations
- Connection pooling (max 20 connections, configurable)

### Vector Store (Qdrant)

Stores document embeddings for semantic search. Collections use the naming pattern `policy_{slug}`:

| Collection Pattern | Purpose |
|-------------------|---------|
| `policy_hr` | HR category documents |
| `policy_finance` | Finance category documents |
| `policy_{slug}` | Dynamic per category |

Global documents are indexed into ALL category collections.

- Container: `policy-bot-qdrant` (port 6333 internal)
- Data at `data/qdrant/`
- Memory limit: 512MB (configurable in docker-compose)

### Filesystem

| Path | Purpose |
|------|---------|
| `data/postgres/` | PostgreSQL data directory |
| `data/qdrant/` | Qdrant vector data |
| `data/app/global-docs/` | Admin-uploaded policy PDFs |
| `data/app/threads/{userId}/{threadId}/uploads/` | User-uploaded PDFs |
| `data/app/threads/{userId}/{threadId}/outputs/` | AI-generated files |

---

## Environment Files

### Local Development (.env.local)

```env
# LLM Providers (pick at least one)
OPENAI_API_KEY=sk-your-api-key-here
ANTHROPIC_API_KEY=sk-ant-your-key
GEMINI_API_KEY=your-gemini-key
MISTRAL_API_KEY=your-mistral-api-key
DEEPSEEK_API_KEY=your-deepseek-key
FIREWORKS_AI_API_KEY=fw_your-key  # dev/test only
OLLAMA_API_BASE=http://localhost:11434

# Tavily (Optional - for web search)
TAVILY_API_KEY=your-tavily-api-key

# Cohere (Optional - for reranking)
COHERE_API_KEY=your-cohere-api-key

# LiteLLM Proxy (Optional - for multi-provider support)
LITELLM_MASTER_KEY=sk-litellm-master-change-this

# Embeddings (defaults shown)
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMENSIONS=3072

# Vector store provider
VECTOR_STORE_PROVIDER=qdrant
QDRANT_HOST=localhost
QDRANT_PORT=6333

# Redis
REDIS_URL=redis://localhost:6379

# Auth (disabled for local dev)
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=local-dev-secret-change-in-production
AUTH_DISABLED=true

# Admin
ADMIN_EMAILS=admin@example.com

# Storage
DATA_DIR=./data
```

### Production (.env)

```env
# OpenAI
OPENAI_API_KEY=sk-your-api-key-here

# Mistral (Optional - for advanced PDF OCR)
MISTRAL_API_KEY=your-mistral-api-key

# Tavily (Optional - for web search)
TAVILY_API_KEY=your-tavily-api-key

# Cohere (Optional - for reranking)
COHERE_API_KEY=your-cohere-api-key

# LiteLLM Proxy
LITELLM_MASTER_KEY=sk-litellm-master-change-this

# Embeddings
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMENSIONS=3072

# PostgreSQL (always required)
POSTGRES_USER=policybot
POSTGRES_PASSWORD=your-strong-password
POSTGRES_DB=policybot

# Vector store provider
VECTOR_STORE_PROVIDER=qdrant
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# Max upload size for backup restore (requires rebuild to change)
MAX_UPLOAD_SIZE=500mb

# Redis (internal Docker network)
REDIS_URL=redis://redis:6379

# Auth
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=generate-32-char-random-string

# Azure AD OAuth
AZURE_AD_CLIENT_ID=your-azure-client-id
AZURE_AD_CLIENT_SECRET=your-azure-client-secret
AZURE_AD_TENANT_ID=your-azure-tenant-id

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Access Control
ACCESS_MODE=allowlist

AUTH_DISABLED=false

# Admin
ADMIN_EMAILS=admin@example.com

# Storage
DATA_DIR=/app/data

# Domain
DOMAIN=your-domain.com
ACME_EMAIL=admin@example.com
```

---

## Docker Compose — Profile-Based Services

`docker-compose.yml` uses Docker profiles to start only the services you need. Always use explicit `--profile` flags.

### Profile Reference

```
Vector Store:
  --profile qdrant      → Qdrant     (set VECTOR_STORE_PROVIDER=qdrant)

Database:
  --profile postgres    → PostgreSQL (always required)

Local LLM Inference (optional):
  --profile ollama      → Ollama     (set OLLAMA_API_BASE=http://ollama:11434)

Always-on services (no profile needed):
  traefik, app, redis, litellm
```

### Startup Command Examples

```bash
# PostgreSQL + Qdrant
docker compose --profile postgres --profile qdrant up -d
```

### Shutdown — Use Same Profiles as Startup

```bash
# Must include same profiles to stop profile-controlled containers
docker compose --profile postgres --profile qdrant down
```

> **Note:** `COMPOSE_PROFILES` env var is not reliable across Docker versions. Always pass `--profile` flags explicitly on the command line.

---

## Dockerfile

Multi-stage build for production.

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1

# Create public directory if it doesn't exist
RUN mkdir -p public

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create data directory for files
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

**Note**: Uses `npm ci` (not `npm ci --only=production`) because TypeScript and other devDependencies are required during the build stage.

---

## Infrastructure Selection Guide

Before deploying, choose the right combination of database and vector store for your scale.

### Database

PostgreSQL is the sole database backend. It provides connection pooling, high concurrency, and supports managed database services for HA/replication.

### Vector Store

Qdrant is the vector store for all deployments. It provides advanced payload filtering, cluster-ready scalability, and handles large document libraries efficiently.

| Scenario | Command |
|----------|---------|
| All deployments | `--profile postgres --profile qdrant` |

### Tuning for Large Deployments

**PostgreSQL:**
- Default connection pool: 10 max connections (sufficient for most cases)
- For very high traffic, use a managed PostgreSQL (Azure Database, AWS RDS, Supabase)

**Qdrant:**
- Default memory limit: 512MB (set in `docker-compose.yml` `deploy.resources.limits`)
- Increase to 1–2GB for collections >500K vectors by editing docker-compose.yml

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- OpenAI API key

### Steps

```bash
# 1. Clone repository
git clone <repo-url>
cd policy-bot

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env.local
# Edit .env.local with your OpenAI API key

# 4. Start infrastructure services
docker compose -f docker-compose.local.yml up -d

# 5. Wait for services to be healthy
docker compose -f docker-compose.local.yml ps

# 6. Start development server
npm run dev

# 7. Open browser
# http://localhost:3000
```

### Useful Commands

```bash
# View service logs
docker compose -f docker-compose.local.yml logs -f qdrant
docker compose -f docker-compose.local.yml logs -f redis

# Restart services
docker compose -f docker-compose.local.yml restart

# Stop services
docker compose -f docker-compose.local.yml down

# Stop and remove volumes (clean slate)
docker compose -f docker-compose.local.yml down -v
```

---

## Pre-Production Deployment

### Server Requirements

- Ubuntu 22.04+ or similar Linux
- Docker 29.x or later
- Docker Compose v2
- 8GB RAM minimum
- 20GB disk space
- Ports 80, 443 open

**Verify your Docker version:**
```bash
docker --version
# Should show: Docker version 29.x or later
```

> **⚠️ IMPORTANT: Lock Docker & Traefik Versions**
>
> After installation, hold Docker packages to prevent automatic upgrades that may break compatibility:
> ```bash
> # Hold Docker at current version
> sudo apt-mark hold docker-ce docker-ce-cli docker-compose-plugin
>
> # Verify holds are in place
> apt-mark showhold
> ```
>
> Traefik is pinned to a specific version (`traefik:v3.6.1`) in `docker-compose.yml`. Do not change to floating tags like `traefik:latest` or `traefik:v3` as minor updates may introduce breaking changes.
>
> **To upgrade later:** Test new versions in a staging environment first, then update the pinned version in `docker-compose.yml` and run `docker compose pull && docker compose up -d`.

### DNS Configuration

Point domain to server IP:
```
policybot.abhirup.app → <SERVER_IP>
```

### Deployment Steps

```bash
# 1. SSH to server
ssh user@server

# 2. Clone repository
git clone <repo-url>
cd policy-bot

# 3. Create production environment file
cp .env.example .env
# Edit .env — set required values:
# - OPENAI_API_KEY
# - NEXTAUTH_SECRET (generate with: openssl rand -base64 32)
# - VECTOR_STORE_PROVIDER=qdrant
# - POSTGRES_PASSWORD
# - DOMAIN=your-domain.com
# - ACME_EMAIL=admin@example.com

# 4. Choose profiles (postgres is always required, pick a vector store)
# Example: PostgreSQL + Qdrant
docker compose --profile postgres --profile qdrant up -d --build

# 5. Check status
docker compose ps

# 6. View logs
docker compose logs -f app

# 7. Verify TLS certificate
curl -I https://policybot.abhirup.app
```

### Initial Setup

```bash
# 1. Access admin panel
# https://policybot.abhirup.app/admin

# 2. Create categories
# Go to Categories tab, add: HR, Finance, IT, Legal, etc.

# 3. Upload documents
# Go to Documents tab, upload PDFs with category assignments

# 4. Add users
# Go to Users tab, add users with subscriptions
# - Admin: full access
# - SuperUser: assign categories to manage
# - User: subscribe to categories
```

---

## Operations

### Monitoring

```bash
# Container status
docker compose ps

# Resource usage
docker stats

# Application logs
docker compose logs -f app

# All logs
docker compose logs -f

# Database size (PostgreSQL)
docker exec policy-bot-postgres psql -U policybot -c "SELECT pg_size_pretty(pg_database_size('policybot'));"

# Vector store data size
du -sh data/qdrant/
```

### Backup

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/policy-bot"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup PostgreSQL database
docker exec policy-bot-postgres pg_dump -U policybot policybot > $BACKUP_DIR/postgres-$DATE.sql

# Backup app data (global-docs, threads)
docker run --rm \
  -v policy-bot-app-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czvf /backup/app-data-$DATE.tar.gz -C /data .

# Backup Qdrant
docker run --rm \
  -v policy-bot-qdrant-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czvf /backup/qdrant-$DATE.tar.gz -C /data .

# Backup Redis
docker run --rm \
  -v policy-bot-redis-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czvf /backup/redis-$DATE.tar.gz -C /data .

# Keep last 7 days
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
find $BACKUP_DIR -name "*.db" -mtime +7 -delete

echo "Backup completed: $DATE"
```

### Restore

```bash
#!/bin/bash
# restore.sh

BACKUP_DIR="/backups/policy-bot"
DATE=$1  # Pass date as argument

if [ -z "$DATE" ]; then
  echo "Usage: ./restore.sh YYYYMMDD_HHMMSS"
  exit 1
fi

# Stop services
docker compose down

# Restore PostgreSQL database
docker exec -i policy-bot-postgres psql -U policybot policybot < $BACKUP_DIR/postgres-$DATE.sql

# Restore app data (includes global-docs and threads)
docker run --rm \
  -v policy-bot-app-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine sh -c "rm -rf /data/* && tar xzvf /backup/app-data-$DATE.tar.gz -C /data"

# Restore Qdrant
docker run --rm \
  -v policy-bot-qdrant-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine sh -c "rm -rf /data/* && tar xzvf /backup/qdrant-$DATE.tar.gz -C /data"

# Restore Redis
docker run --rm \
  -v policy-bot-redis-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine sh -c "rm -rf /data/* && tar xzvf /backup/redis-$DATE.tar.gz -C /data"

# Start services
docker compose up -d

echo "Restore completed from: $DATE"
```

### Database Maintenance

#### PostgreSQL

```bash
# Check connection and record counts
docker exec policy-bot-postgres psql -U policybot -c "SELECT COUNT(*) FROM users;"
docker exec policy-bot-postgres psql -U policybot -c "SELECT COUNT(*) FROM documents;"

# Database size
docker exec policy-bot-postgres psql -U policybot -c "SELECT pg_size_pretty(pg_database_size('policybot'));"

# Active connections
docker exec policy-bot-postgres psql -U policybot -c "SELECT count(*) FROM pg_stat_activity;"

# Note: PostgreSQL performs auto-vacuum automatically — no manual VACUUM needed
```

### Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart (use same profiles as your deployment)
docker compose --profile postgres --profile qdrant up -d --build

# Verify
docker compose ps
docker compose logs -f app
```

### Rollback

```bash
# If update fails, rollback to previous image
docker compose --profile postgres --profile qdrant down
git checkout <previous-commit>
docker compose --profile postgres --profile qdrant up -d --build
```

### Progressive Web App (PWA) Deployment

Policy Bot includes Progressive Web App capabilities that allow users to install the application on their devices.

> **📖 Full Documentation:** [docs/features/PWA.md](../../features/PWA.md)

#### PWA Components

The PWA implementation consists of the following components that are automatically deployed:

**1. Web App Manifest**
- **Route:** `src/app/manifest.webmanifest/route.ts`
- **Served at:** `https://yourdomain.com/manifest.webmanifest`
- **Dynamic generation** based on admin settings from database
- **No build step required** - generated on-the-fly per request

**2. Service Worker**
- **File:** `public/sw.js`
- **Served at:** `https://yourdomain.com/sw.js`
- **Static file** - bundled during build
- **Registers automatically** on first page load
- **Updates automatically** when file changes

**3. Install Banner Component**
- **Component:** `src/components/pwa/InstallBanner.tsx`
- **Bundled** as part of the React application
- **Detects installability** and shows appropriate prompts

**4. Offline Page**
- **Route:** `src/app/offline/page.tsx`
- **Served at:** `https://yourdomain.com/offline`
- **Static page** shown when user is offline

#### Deployment Checklist

When deploying Policy Bot with PWA support:

**1. HTTPS is Required**
- ✅ Traefik configuration includes Let's Encrypt SSL
- ✅ All requests automatically redirected to HTTPS
- ❌ PWA will NOT work over HTTP (browser requirement)

**2. Service Worker Permissions**
- ✅ `public/sw.js` must be accessible at `/sw.js`
- ✅ Served with correct MIME type (`application/javascript`)
- ✅ No authentication required for `/sw.js`, `/manifest.webmanifest`, `/offline`

**3. Icon Assets**
- **Admin Configuration:** Upload PWA icon in Admin > Settings > PWA
- **Fallback:** Uses Application Logo if no PWA icon set
- **Sizes:** Manifest automatically generates entries for 192x192 and 512x512
- **Format:** PNG recommended (square, 512x512px minimum)

**4. Database Configuration**
```sql
-- Default PWA settings in config table
pwa_enabled = 1
pwa_app_name = 'Policy Bot'  -- Set via Admin dashboard
pwa_short_name = 'Policy'    -- Max 12 characters
pwa_app_icon = NULL          -- URL to icon (or NULL for fallback)
pwa_theme_color = '#6366f1'
pwa_background_color = '#ffffff'
```

**5. Environment Variables**
No additional environment variables required. PWA settings managed via admin dashboard.

#### Testing PWA Installation

After deployment, verify PWA functionality:

**Desktop (Chrome/Edge):**
```bash
1. Visit https://yourdomain.com
2. Look for install icon (⊕) in address bar
3. Click "Install Policy Bot"
4. Verify app opens in standalone window
5. Check app appears in OS app launcher
```

**Mobile (Android Chrome):**
```bash
1. Visit https://yourdomain.com in Chrome
2. Tap install banner or menu → "Install app"
3. Icon appears on home screen
4. Tap to launch in standalone mode
```

**Mobile (iOS Safari):**
```bash
1. Visit https://yourdomain.com in Safari
2. Tap Share button → "Add to Home Screen"
3. Icon appears on home screen
4. Tap to launch
```

#### Service Worker Updates

The service worker automatically updates when `public/sw.js` changes:

**Manual Update (if needed):**
```bash
# After updating sw.js, rebuild and deploy
docker compose down
docker compose up -d --build

# Users will see update prompt on next visit
# Changes activate after closing all app tabs/windows
```

**Cache Strategy:**
- **Static assets:** Cached with stale-while-revalidate
- **API requests:** Network-first (always fresh data)
- **Offline page:** Pre-cached on installation

#### Disabling PWA

If you need to disable PWA:

**Method 1: Via Admin Dashboard**
```
1. Admin > Settings > PWA
2. Toggle "Enable PWA" to OFF
3. Manifest returns 404
4. Install prompts hidden
5. Existing installations continue to work
```

**Method 2: Remove Service Worker**
```bash
# Stop service worker registration
# Edit src/app/layout.tsx and remove:
<script src="/sw-register.js" />

# Rebuild and deploy
docker compose up -d --build
```

#### Troubleshooting PWA

| Issue | Solution |
|-------|----------|
| No install prompt appears | Verify HTTPS, check manifest is accessible at `/manifest.webmanifest`, ensure icons are valid |
| Service worker not registering | Check browser console for errors, verify `/sw.js` is accessible without authentication |
| Offline page not showing | Service worker cache may be stale, hard refresh (Ctrl+Shift+R) or clear cache |
| Icon not updating | Manifest is cached, update `pwa_app_icon` URL with cache-busting query param |
| Updates not applying | Users must close all tabs/windows for service worker update to activate |

#### PWA Limitations

Policy Bot's PWA implementation has intentional limitations:

❌ **No Offline Mode**
- Document search requires server (vector database)
- Chat requires LLM API
- Authentication requires server validation
- Offline page shown when disconnected

❌ **No Push Notifications**
- Not implemented in current version
- Could be added for document upload alerts, share notifications

❌ **No Background Sync**
- Not implemented
- Could be added for offline message queuing

---

## Health Checks

### Endpoints

| Service | URL / Command | Expected | When Active |
|---------|--------------|----------|-------------|
| App | `/api/auth/session` | 200 OK | Always |
| Redis | `redis-cli ping` | PONG | Always |
| LiteLLM | `http://litellm:4000/health/liveliness` | 200 OK | Always |
| Qdrant | `http://qdrant:6333/readyz` | 200 OK | `--profile qdrant` |
| PostgreSQL | `pg_isready -U policybot` | accepting | `--profile postgres` (always) |

> **Tip:** Use Admin → Dashboard → Infrastructure to check provider status via the UI.

### Health Check Script

```bash
#!/bin/bash
# healthcheck.sh — adjust APP_URL and uncomment active providers

APP_URL="https://your-domain.com"

# Always-on services
if curl -sf "$APP_URL/api/auth/session" > /dev/null; then
  echo "✓ App: healthy"
else
  echo "✗ App: unhealthy"
fi

if docker exec policy-bot-redis redis-cli ping | grep -q PONG; then
  echo "✓ Redis: healthy"
else
  echo "✗ Redis: unhealthy"
fi

if docker exec policy-bot-litellm curl -sf http://localhost:4000/health/liveliness > /dev/null; then
  echo "✓ LiteLLM: healthy"
else
  echo "✗ LiteLLM: unhealthy"
fi

# Qdrant
if docker exec policy-bot-qdrant curl -sf http://localhost:6333/readyz > /dev/null; then
  echo "✓ Qdrant: healthy"
else
  echo "✗ Qdrant: unhealthy"
# fi

# PostgreSQL (always active)
if docker exec policy-bot-postgres pg_isready -U policybot | grep -q "accepting"; then
  echo "✓ PostgreSQL: healthy"
else
  echo "✗ PostgreSQL: unhealthy"
fi
```

---

## Security Checklist

### Before Deployment

- [ ] Generate strong `NEXTAUTH_SECRET` (32+ characters)
- [ ] Configure Azure AD app registration
- [ ] Configure Google OAuth credentials (optional)
- [ ] Set `ACCESS_MODE` (allowlist or domain)
- [ ] Add admin emails to `ADMIN_EMAILS`
- [ ] Verify `.env` is in `.gitignore`

### After Deployment

- [ ] Verify TLS certificate is valid
- [ ] Test Azure AD login flow
- [ ] Test Google OAuth login flow (if configured)
- [ ] Verify admin access control
- [ ] Create initial categories
- [ ] Add initial users to allowlist (if ACCESS_MODE=allowlist)
- [ ] Assign super users to categories
- [ ] Subscribe regular users to categories
- [ ] Test file upload limits
- [ ] Check CORS settings

### Data Sources & Function APIs

- [ ] Ensure outbound network access is allowed for external API calls
- [ ] Store API credentials securely (encrypted in database)
- [ ] Review data source categories to ensure proper access control
- [ ] Test data source connectivity before assigning to categories
- [ ] Monitor data source usage via audit logs
- [ ] Configure firewall rules for specific external API domains if required

### Ongoing

- [ ] Monitor for unauthorized access attempts
- [ ] Review container logs weekly
- [ ] Update base images monthly
- [ ] Rotate secrets quarterly
- [ ] Review user allowlist regularly
- [ ] Monitor database storage size (`du -sh data/app/` or PostgreSQL `pg_database_size`)
- [ ] PostgreSQL: auto-vacuumed (no manual action needed)
- [ ] Monitor vector store data size (`du -sh data/qdrant/`)

---

## Troubleshooting

### Common Issues

#### TLS Certificate Not Issued

```bash
# Check Traefik logs
docker compose logs traefik

# Verify DNS propagation
dig policybot.abhirup.app

# Check Let's Encrypt rate limits
# https://letsencrypt.org/docs/rate-limits/
```

#### Qdrant Connection Failed

```bash
# Check if running (requires --profile qdrant)
docker compose --profile qdrant ps qdrant

# Check logs
docker compose --profile qdrant logs qdrant

# Test connection
docker exec policy-bot-qdrant curl http://localhost:6333/readyz
```

#### PostgreSQL Connection Failed

```bash
# Check if running (requires --profile postgres)
docker compose --profile postgres ps postgres

# Check logs
docker compose --profile postgres logs postgres

# Test connection
docker exec policy-bot-postgres pg_isready -U policybot

# Check schema was initialised (should show 49+ tables)
docker exec policy-bot-postgres psql -U policybot -c "\dt" | wc -l
```

#### Redis Connection Failed

```bash
# Check if running
docker compose ps redis

# Check logs
docker compose logs redis

# Test connection
docker exec policy-bot-redis redis-cli ping
```

#### Out of Memory

```bash
# Check memory usage
docker stats

# Increase swap if needed
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## Resource Requirements

### Development

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 8 GB | 16 GB |
| Disk | 10 GB | 20 GB |

### Pre-Production / Production

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB | 50 GB |
| Network | 10 Mbps | 100 Mbps |

### Storage Breakdown

| Component | Typical Size | Notes |
|-----------|--------------|-------|
| PostgreSQL data | 50–500 MB | `data/postgres/` |
| Global documents | 100 MB – 1 GB | `data/app/global-docs/` |
| Qdrant vectors | 100 MB – 2 GB | `data/qdrant/` |
| Redis cache | 10–100 MB | Sessions + RAG cache |
| Thread data | 50 MB – 500 MB | Uploads and outputs |

### Additional RAM by Provider

| Provider | Additional RAM |
|----------|---------------|
| Qdrant | ~512 MB (hard limit in docker-compose) |
| PostgreSQL | ~100–256 MB |

### Autonomous Agent (Beta)

When the Autonomous Agent feature is enabled, additional resources are consumed:

| Resource | Impact | Notes |
|----------|--------|-------|
| **CPU** | +50-100% during agent execution | Multiple concurrent LLM calls |
| **Memory** | +100-200 MB per active agent | Plan state, task results, streaming buffers |
| **API Tokens** | 3-10x normal per request | Planner + Executor + Checker + Summarizer |

**Recommendations for Agent Usage:**

- Enable agent mode only when needed (not default)
- Set conservative budget limits (tokens and cost)
- Use faster/cheaper models for checker (e.g., gpt-4.1-mini)
- Monitor token usage via Admin > Settings > Agent
- Consider rate limiting concurrent agent sessions

**Budget Limits (Defaults):**

| Limit | Default | Description |
|-------|---------|-------------|
| Max Tokens | 50,000 | Per agent execution |
| Max Cost | $1.00 | Per agent execution |
| Max Tasks | 10 | Per plan |
| Max Retries | 2 | Per task |

---

## Cost Estimation

### OpenAI API (Per Month, Estimated)

| Model | Usage | Cost |
|-------|-------|------|
| gpt-4.1-mini (default) | ~100K tokens/day | ~$15 |
| text-embedding-3-large | ~50K tokens/day | ~$1 |
| whisper-1 | ~1 hour audio/day | ~$18 |

**Total: ~$35/month** (for moderate usage)

### External APIs (Optional)

| API | Usage | Cost |
|-----|-------|------|
| Mistral OCR | ~100 pages/day | ~$5/month |
| Mistral LLM (mistral-small-3.2) | ~50K tokens/day | ~$3/month |
| Tavily Search | ~1000 queries/month | ~$10/month |
| Cohere Reranker | ~10K queries/month | ~$1/month |

### Infrastructure (Self-Hosted VM)

| Provider | Spec | Cost |
|----------|------|------|
| Azure B2ms | 2 vCPU, 8GB RAM | ~$60/month |
| DigitalOcean | 2 vCPU, 8GB RAM | ~$48/month |
| AWS t3.large | 2 vCPU, 8GB RAM | ~$60/month |

**Total Infrastructure: ~$50-65/month**
