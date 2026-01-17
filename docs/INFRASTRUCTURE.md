# Policy Bot - Infrastructure & Deployment

## Overview

Policy Bot uses Docker Compose for containerized deployment with three environments:
- **Local Development**: Local services with hot reload
- **Pre-Production**: Full stack with TLS (policybot.abhirup.app)
- **Production**: To be configured later

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
│  │   SQLITE    │ │  CHROMADB   │ │    REDIS    │ │   LITELLM   │        │
│  │  /app/data  │ │  Port 8000  │ │  Port 6379  │ │  Port 4000  │        │
│  │  /policy-   │ │  (internal) │ │  (internal) │ │  (internal) │        │
│  │  bot.db     │ └─────────────┘ └─────────────┘ └─────────────┘        │
│  └─────────────┘       │              │              │                   │
│         │              ▼              ▼              │                   │
│         │        ┌─────────────┐ ┌─────────────┐    │                   │
│         │        │ chroma_data │ │ redis_data  │    │                   │
│         │        │  (volume)   │ │  (volume)   │    │                   │
│         │        └─────────────┘ └─────────────┘    │                   │
│         │                                           │                   │
│         ▼                                           ▼                   │
│  ┌─────────────┐                     ┌────────────────────────────┐     │
│  │  app_data   │ ◄── SQLite DB +     │      EXTERNAL SERVICES     │     │
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

### SQLite Database

Policy Bot uses SQLite (via better-sqlite3) for all metadata storage:

| Data | Storage Location | Notes |
|------|------------------|-------|
| Users | `data/policy-bot.db` | users table |
| Categories | `data/policy-bot.db` | categories table |
| Documents metadata | `data/policy-bot.db` | documents, document_categories tables |
| Subscriptions | `data/policy-bot.db` | user_subscriptions table |
| Super user assignments | `data/policy-bot.db` | super_user_categories table |
| Threads | `data/policy-bot.db` | threads, thread_categories tables |
| Messages | `data/policy-bot.db` | messages table |
| Settings | `data/policy-bot.db` | settings table |

### ChromaDB Collections

Category-based vector storage:

| Collection Pattern | Purpose |
|-------------------|---------|
| `policy_hr` | HR category documents |
| `policy_finance` | Finance category documents |
| `policy_it` | IT category documents |
| `policy_{slug}` | Dynamic per category |

Global documents are indexed into ALL category collections.

### Filesystem

| Path | Purpose |
|------|---------|
| `data/policy-bot.db` | SQLite database |
| `data/global-docs/` | Admin-uploaded policy PDFs |
| `data/threads/{userId}/{threadId}/uploads/` | User-uploaded PDFs |
| `data/threads/{userId}/{threadId}/outputs/` | AI-generated files |

---

## Environment Files

### Local Development (.env.local)

```env
# OpenAI
OPENAI_API_KEY=sk-your-api-key-here

# Mistral (Optional - for advanced PDF OCR)
MISTRAL_API_KEY=your-mistral-api-key

# Tavily (Optional - for web search)
TAVILY_API_KEY=your-tavily-api-key

# Cohere (Optional - for reranking)
COHERE_API_KEY=your-cohere-api-key

# LiteLLM Proxy (Optional - for multi-provider support)
LITELLM_MASTER_KEY=sk-litellm-master-change-this
LITELLM_HOST=http://localhost:4000

# Embeddings (defaults shown)
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMENSIONS=3072

# Chroma
CHROMA_HOST=localhost
CHROMA_PORT=8000

# Redis
REDIS_URL=redis://localhost:6379

# Auth (disabled for local dev)
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=local-dev-secret-change-in-production
AUTH_DISABLED=true

# Admin
ADMIN_EMAILS=mailabhirupbanerjee@gmail.com

# Storage
DATA_DIR=./data
```

### Pre-Production (.env.preprod)

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
LITELLM_HOST=http://litellm:4000

# Embeddings
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMENSIONS=3072

# Chroma (internal Docker network)
CHROMA_HOST=chroma
CHROMA_PORT=8000

# Redis (internal Docker network)
REDIS_URL=redis://redis:6379

# Auth
NEXTAUTH_URL=https://policybot.abhirup.app
NEXTAUTH_SECRET=generate-32-char-random-string

# Azure AD OAuth
AZURE_AD_CLIENT_ID=your-azure-client-id
AZURE_AD_CLIENT_SECRET=your-azure-client-secret
AZURE_AD_TENANT_ID=your-azure-tenant-id

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Access Control
ACCESS_MODE=allowlist
# ALLOWED_DOMAINS=example.com,company.org  # Only used when ACCESS_MODE=domain

AUTH_DISABLED=false

# Admin
ADMIN_EMAILS=mailabhirupbanerjee@gmail.com

# Storage
DATA_DIR=/app/data

# Domain
DOMAIN=policybot.abhirup.app
ACME_EMAIL=mailabhirupbanerjee@gmail.com
```

### Production (.env.prod)

```env
# To be configured later
```

---

## Docker Compose Files

### Development Stack (docker-compose.dev.yml)

For local development - runs only Chroma and Redis.

```yaml
version: '3.8'

services:
  chroma:
    image: chromadb/chroma:latest
    container_name: policy-bot-chroma
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - ANONYMIZED_TELEMETRY=false
      - ALLOW_RESET=true
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    container_name: policy-bot-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  chroma_data:
    name: policy-bot-chroma-data
  redis_data:
    name: policy-bot-redis-data
```

### Pre-Production/Production Stack (docker-compose.yml)

Full stack with Traefik for TLS.

```yaml
services:
  traefik:
    image: traefik:v3.6.1
    container_name: policy-bot-traefik
    command:
      - "--api.insecure=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
      - "--entrypoints.web.http.redirections.entryPoint.scheme=https"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt
    networks:
      - policy-bot-network
    restart: unless-stopped

  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: policy-bot-app
    environment:
      - NODE_ENV=production
      - CHROMA_HOST=chroma
      - CHROMA_PORT=8000
      - REDIS_URL=redis://redis:6379
      - DATA_DIR=/app/data
    env_file:
      - .env
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.app.entrypoints=websecure"
      - "traefik.http.routers.app.tls.certresolver=letsencrypt"
      - "traefik.http.services.app.loadbalancer.server.port=3000"
    volumes:
      - app_data:/app/data
    depends_on:
      chroma:
        condition: service_started
      redis:
        condition: service_healthy
    networks:
      - policy-bot-network
    restart: unless-stopped

  chroma:
    image: chromadb/chroma:latest
    container_name: policy-bot-chroma
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - ANONYMIZED_TELEMETRY=false
      - ALLOW_RESET=false
      - IS_PERSISTENT=TRUE
    networks:
      - policy-bot-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: policy-bot-redis
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - policy-bot-network
    restart: unless-stopped

  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: policy-bot-litellm
    volumes:
      - ./litellm_config.yaml:/app/config.yaml
    env_file:
      - .env
    environment:
      - LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
    command: --config /app/config.yaml --port 4000
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - policy-bot-network
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"

networks:
  policy-bot-network:
    name: policy-bot-network

volumes:
  letsencrypt:
    name: policy-bot-letsencrypt
  app_data:
    name: policy-bot-app-data
  chroma_data:
    name: policy-bot-chroma-data
  redis_data:
    name: policy-bot-redis-data
```

**Note**: ChromaDB no longer uses a healthcheck as the Python-based check was unreliable. The app uses `service_started` dependency instead.

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

# Create data directory for SQLite and files
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

**Note**: Uses `npm ci` (not `npm ci --only=production`) because TypeScript and other devDependencies are required during the build stage.

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
docker compose -f docker-compose.dev.yml up -d

# 5. Wait for services to be healthy
docker compose -f docker-compose.dev.yml ps

# 6. Start development server
npm run dev

# 7. Open browser
# http://localhost:3000
```

### Useful Commands

```bash
# View service logs
docker compose -f docker-compose.dev.yml logs -f chroma
docker compose -f docker-compose.dev.yml logs -f redis

# Restart services
docker compose -f docker-compose.dev.yml restart

# Stop services
docker compose -f docker-compose.dev.yml down

# Stop and remove volumes (clean slate)
docker compose -f docker-compose.dev.yml down -v
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
# Edit .env with production values

# Required values:
# - OPENAI_API_KEY
# - NEXTAUTH_SECRET (generate with: openssl rand -base64 32)
# - AZURE_AD_* credentials
# - DOMAIN=policybot.abhirup.app
# - ACME_EMAIL=mailabhirupbanerjee@gmail.com

# 4. Build and start
docker compose up -d --build

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

# SQLite database size
du -h data/policy-bot.db
```

### Backup

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/policy-bot"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup SQLite database
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db '.backup /app/data/backup.db'"
docker cp policy-bot-app:/app/data/backup.db $BACKUP_DIR/policy-bot-$DATE.db
docker exec policy-bot-app rm /app/data/backup.db

# Backup app data (global-docs, threads)
docker run --rm \
  -v policy-bot-app-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czvf /backup/app-data-$DATE.tar.gz -C /data .

# Backup ChromaDB
docker run --rm \
  -v policy-bot-chroma-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czvf /backup/chroma-$DATE.tar.gz -C /data .

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

# Restore SQLite database
docker cp $BACKUP_DIR/policy-bot-$DATE.db policy-bot-app:/app/data/policy-bot.db

# Restore app data (includes global-docs and threads)
docker run --rm \
  -v policy-bot-app-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine sh -c "rm -rf /data/* && tar xzvf /backup/app-data-$DATE.tar.gz -C /data"

# Restore ChromaDB
docker run --rm \
  -v policy-bot-chroma-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine sh -c "rm -rf /data/* && tar xzvf /backup/chroma-$DATE.tar.gz -C /data"

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

```bash
# Vacuum SQLite database (reclaim space)
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'VACUUM;'"

# Check database integrity
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'PRAGMA integrity_check;'"

# View database statistics
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'SELECT * FROM sqlite_master WHERE type=\"table\";'"

# Count records
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'SELECT COUNT(*) FROM users;'"
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'SELECT COUNT(*) FROM categories;'"
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'SELECT COUNT(*) FROM documents;'"
```

### Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose up -d --build

# Verify
docker compose ps
docker compose logs -f app
```

### Rollback

```bash
# If update fails, rollback to previous image
docker compose down
git checkout <previous-commit>
docker compose up -d --build
```

---

## Health Checks

### Endpoints

| Service | URL | Expected |
|---------|-----|----------|
| App | `/api/auth/session` | 200 OK |
| Chroma | `http://chroma:8000/api/v1/heartbeat` | 200 OK |
| Redis | `redis-cli ping` | PONG |
| LiteLLM | `http://litellm:4000/health` | 200 OK |

### Health Check Script

```bash
#!/bin/bash
# healthcheck.sh

APP_URL="https://policybot.abhirup.app"

# Check app
if curl -sf "$APP_URL/api/auth/session" > /dev/null; then
  echo "✓ App: healthy"
else
  echo "✗ App: unhealthy"
fi

# Check Chroma
if docker exec policy-bot-chroma curl -sf http://localhost:8000/api/v1/heartbeat > /dev/null; then
  echo "✓ Chroma: healthy"
else
  echo "✗ Chroma: unhealthy"
fi

# Check Redis
if docker exec policy-bot-redis redis-cli ping | grep -q PONG; then
  echo "✓ Redis: healthy"
else
  echo "✗ Redis: unhealthy"
fi

# Check LiteLLM
if docker exec policy-bot-litellm curl -sf http://localhost:4000/health > /dev/null; then
  echo "✓ LiteLLM: healthy"
else
  echo "✗ LiteLLM: unhealthy"
fi

# Check SQLite database
if docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'SELECT 1;'" | grep -q 1; then
  echo "✓ SQLite: healthy"
else
  echo "✗ SQLite: unhealthy"
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
- [ ] Monitor SQLite database size
- [ ] Run database VACUUM monthly

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

#### ChromaDB Connection Failed

```bash
# Check if running
docker compose ps chroma

# Check logs
docker compose logs chroma

# Test connection from app container
docker exec policy-bot-app curl http://chroma:8000/api/v1/heartbeat
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

#### SQLite Database Issues

```bash
# Check database file exists
docker exec policy-bot-app ls -la /app/data/policy-bot.db

# Check permissions
docker exec policy-bot-app stat /app/data/policy-bot.db

# Check integrity
docker exec policy-bot-app sh -c "sqlite3 /app/data/policy-bot.db 'PRAGMA integrity_check;'"

# If corrupted, restore from backup
./restore.sh YYYYMMDD_HHMMSS
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

| Component | Typical Size |
|-----------|--------------|
| SQLite database | 10-100 MB |
| Global documents | 100 MB - 1 GB |
| ChromaDB vectors | 50-500 MB |
| Redis cache | 10-100 MB |
| Thread data | 50 MB - 500 MB |

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
