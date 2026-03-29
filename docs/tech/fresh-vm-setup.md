# Fresh VM Setup Guide for Policy Bot

Complete step-by-step instructions for deploying Policy Bot on a fresh Ubuntu VM.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Preparation](#server-preparation)
3. [Docker Installation](#docker-installation)
4. [Clone Repository](#clone-repository)
5. [Environment Configuration](#environment-configuration)
6. [Initial Setup](#initial-setup)
7. [Start Services](#start-services)
8. [Post-Installation Configuration](#post-installation-configuration)
9. [Verification & Health Checks](#verification--health-checks)
10. [Troubleshooting](#troubleshooting)
11. [Maintenance](#maintenance)

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Storage | 20 GB | 50+ GB SSD |
| Network | 100 Mbps | 1 Gbps |

### Software Requirements

- Ubuntu 24.04 LTS or later (or Debian 12+)
- Docker 24.x or later
- Docker Compose v2.x
- Git

### Network Requirements

- Domain name pointing to server IP
- Ports 80 and 443 open for inbound traffic
- Outbound access to API endpoints (OpenAI, Anthropic, etc.)

### API Keys (obtain before starting)

At minimum, you need:
- **OpenAI API Key** - [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

Optional but recommended:
- **Anthropic API Key** - [console.anthropic.com](https://console.anthropic.com)
- **Azure AD credentials** - For enterprise SSO
- **Google OAuth credentials** - For Google login

---

## Server Preparation

### 1. Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Required Packages

```bash
sudo apt install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    htop \
    nano
```

### 3. Configure Firewall

```bash
# Allow SSH, HTTP, HTTPS
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 4. Set Timezone

```bash
sudo timedatectl set-timezone UTC
# Or your preferred timezone:
# sudo timedatectl set-timezone America/New_York
```

### 5. Configure Swap (if RAM < 8GB)

```bash
# Create 4GB swap file
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Docker Installation

### 1. Add Docker Repository

```bash
# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

### 2. Install Docker

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 3. Configure Docker for Non-Root User

```bash
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker compose version
```

### 4. Lock Docker Version (Recommended)

```bash
# Prevent automatic upgrades that might break things
sudo apt-mark hold docker-ce docker-ce-cli containerd.io
```

---

## Clone Repository

### 1. Clone the Repository

```bash
cd /opt
sudo git clone https://github.com/your-org/policy-bot.git
sudo chown -R $USER:$USER policy-bot
cd policy-bot
```

### 2. Run Initial Setup Script

**Important:** Run the setup script to create data directories with correct permissions:

```bash
./setup.sh
```

This script:
- Creates `./data/app` directory
- Creates `./data/transformers_cache` directory with proper permissions
- Sets permissions for BGE reranker model caching

> **Note:** The Docker entrypoint also handles permissions automatically, but running setup.sh ensures everything is ready before first start.

---

## Environment Configuration

### 1. Create Environment File

```bash
cp .env.example .env
nano .env
```

### 2. Required Environment Variables

Edit `.env` with the following minimum configuration:

```bash
# =============================================================================
# CORE SETTINGS (Required)
# =============================================================================

# Domain for your deployment
DOMAIN=policybot.example.com

# OpenAI API Key (required for LLM and embeddings)
OPENAI_API_KEY=sk-proj-...

# Admin email addresses (comma-separated)
ADMIN_EMAILS=admin@example.com,ops@example.com

# NextAuth secret (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET=your-32-character-random-string-here

# NextAuth URL (your full domain with https)
NEXTAUTH_URL=https://policybot.example.com

# Let's Encrypt email for SSL certificates
ACME_EMAIL=admin@example.com

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================

# PostgreSQL (required — SQLite removed March 2026)
POSTGRES_USER=policybot
POSTGRES_PASSWORD=your-strong-password-here
POSTGRES_DB=policybot

# =============================================================================
# VECTOR STORE CONFIGURATION
# =============================================================================

# Vector store provider
VECTOR_STORE_PROVIDER=qdrant

# Qdrant settings
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# =============================================================================
# AUTHENTICATION
# =============================================================================

# Credentials login is ENABLED by default for fresh deployments
# Set initial admin password (used on first run if admin has no password)
CREDENTIALS_ADMIN_PASSWORD=your-secure-initial-password

# Azure AD (Microsoft Entra ID) - Optional, configure after first login
# AZURE_AD_CLIENT_ID=
# AZURE_AD_CLIENT_SECRET=
# AZURE_AD_TENANT_ID=

# Google OAuth - Optional, configure after first login
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Access control mode: allowlist or domain
ACCESS_MODE=allowlist

# =============================================================================
# LITELLM PROXY
# =============================================================================

# Route API calls through LiteLLM for multi-provider support
OPENAI_BASE_URL=http://litellm:4000/v1

# LiteLLM authentication key (generate with: openssl rand -hex 16)
LITELLM_MASTER_KEY=sk-litellm-your-key-here

# =============================================================================
# REDIS
# =============================================================================

REDIS_URL=redis://redis:6379

# =============================================================================
# OPTIONAL API KEYS
# =============================================================================

# Additional LLM providers
# ANTHROPIC_API_KEY=          # Required for Claude models (uses direct SDK, not LiteLLM)
# DEEPSEEK_API_KEY=
# MISTRAL_API_KEY=
# GEMINI_API_KEY=

# Document processing enhancements
# AZURE_DI_ENDPOINT=https://your-instance.cognitiveservices.azure.com/
# AZURE_DI_KEY=

# RAG enhancements
# COHERE_API_KEY=           # For reranking
# TAVILY_API_KEY=           # For web search

# Data source encryption (generate with: openssl rand -hex 32)
# DATA_SOURCE_ENCRYPTION_KEY=

# Local Ollama (if using local models)
# OLLAMA_API_BASE=http://host.docker.internal:11434
```

### 3. Generate Secrets

```bash
# Generate NEXTAUTH_SECRET
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"

# Generate LITELLM_MASTER_KEY
echo "LITELLM_MASTER_KEY=sk-litellm-$(openssl rand -hex 16)"

# Generate DATA_SOURCE_ENCRYPTION_KEY (optional)
echo "DATA_SOURCE_ENCRYPTION_KEY=$(openssl rand -hex 32)"

# Generate strong PostgreSQL password (if using postgres)
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
```

---

## Initial Setup

### 1. Configure DNS

Before starting, ensure your domain points to the server:

```bash
# Verify DNS resolution
dig policybot.example.com +short
# Should return your server's IP address

# Or use host command
host policybot.example.com
```

> **Important:** DNS must propagate before Let's Encrypt can issue certificates. Allow 5-15 minutes after DNS changes.

### 2. Review Docker Compose Profiles

Policy Bot uses Docker Compose profiles to select services:

| Profile | Service | Use Case |
|---------|---------|----------|
| `qdrant` | Qdrant vector store | All deployments |
| `postgres` | PostgreSQL database | Required (all deployments) |
| `ollama` | Ollama local LLM | Optional, local inference |

> **Note:** PostgreSQL is required for all deployments. SQLite support was removed in March 2026.

**Deployment combinations:**

```bash
# Standard deployment (PostgreSQL + Qdrant)
docker compose --profile postgres --profile qdrant up -d

# With local LLM inference (optional)
docker compose --profile postgres --profile qdrant --profile ollama up -d
```

---

## Start Services

### 1. Build and Start

```bash
# Build and start (PostgreSQL + Qdrant)
docker compose --profile postgres --profile qdrant up -d --build
```

### 2. Monitor Startup

```bash
# Watch logs during startup
docker compose logs -f

# Check service status
docker compose ps
```

### 3. Wait for Services to be Healthy

All services should show "healthy" status:

```bash
docker compose ps
```

Expected output:
```
NAME                    STATUS                   PORTS
policy-bot-app          Up (healthy)             0.0.0.0:3000->3000/tcp
policy-bot-qdrant       Up (healthy)             6333/tcp
policy-bot-litellm      Up (healthy)             4000/tcp
policy-bot-redis        Up (healthy)             6379/tcp
policy-bot-traefik      Up                       0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

### 4. Verify SSL Certificate

```bash
# Check certificate issuance
docker compose logs traefik | grep -i certificate

# Test HTTPS
curl -I https://policybot.example.com
```

---

## Post-Installation Configuration

### 1. First Login (Before OAuth Setup)

Policy Bot supports email/password login by default, allowing initial access without OAuth:

1. Navigate to `https://policybot.example.com/auth/signin`
2. Enter the admin email from `ADMIN_EMAILS` (e.g., `admin@example.com`)
3. Enter the password from `CREDENTIALS_ADMIN_PASSWORD`
4. You're now logged in as admin

> **Tip:** After configuring OAuth providers, you can disable credentials login via Admin → Users → Credentials Authentication.

### 2. Access Admin Dashboard

1. Click your profile or the menu icon
2. Select **Admin** from the navigation
3. Or navigate directly to `/admin`

### 3. Initial Admin Tasks

#### Create Categories
1. Admin → Categories → Add Category
2. Create categories like: HR, Finance, IT, Legal, Operations
3. Each category creates a separate vector store collection

#### Upload Documents
1. Admin → Documents → Upload
2. Select category and upload policy documents
3. Supported formats: PDF, DOCX, XLSX, PPTX, TXT, MD

#### Configure Users
1. Admin → Users → Add User
2. Set role: `user`, `superuser`, or `admin`
3. Assign category subscriptions

#### Configure LLM Settings
1. Admin → Settings → LLM Configuration
2. Select default model (e.g., `gpt-4.1-mini`)
3. Adjust temperature, max tokens as needed

#### Configure System Prompt
1. Admin → Settings → Prompts
2. Customize the global system prompt
3. Add category-specific prompts if needed

### 4. Configure Reranker (Optional)

The reranker improves search result quality:

1. Admin → Settings → Reranker
2. Enable reranking
3. Configure provider priority:
   - **BGE Large** - Best accuracy, ~670MB download on first use
   - **Cohere** - Fast API-based (requires API key)
   - **BGE Base** - Smaller model, ~220MB
   - **Local** - Legacy bi-encoder

### 5. Configure OAuth & Disable Credentials (Optional)

After initial setup, you may want to switch to OAuth-only authentication:

#### Add OAuth Provider

1. Get credentials from Azure Portal or Google Cloud Console (see [Authentication Guide](auth.md))
2. Add to `.env`:
   ```bash
   # Azure AD
   AZURE_AD_CLIENT_ID=your-client-id
   AZURE_AD_CLIENT_SECRET=your-client-secret
   AZURE_AD_TENANT_ID=your-tenant-id

   # Or Google
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```
3. Restart the application:
   ```bash
   docker compose restart app
   ```
4. Verify OAuth login works

#### Disable Credentials Login (Optional)

Once OAuth is working, you can disable email/password login:

1. Admin → Users → expand **Credentials Authentication**
2. Toggle **Enable Credentials Login** to OFF
3. Click **Save Changes**
4. Restart the application

> **Warning:** Ensure OAuth is working before disabling credentials, or you may lock yourself out.

---

## Verification & Health Checks

### 1. Service Health Endpoints

```bash
# Application
curl -s https://policybot.example.com/api/health | jq

# LiteLLM
docker compose exec litellm curl -s http://localhost:4000/health

# Redis
docker compose exec redis redis-cli ping
# Expected: PONG

# Qdrant
docker compose exec qdrant curl -s http://localhost:6333/readyz

# PostgreSQL (if using)
docker compose exec postgres pg_isready -U policybot
```

### 2. Test LLM Connection

```bash
# Test via LiteLLM
docker compose exec litellm curl -s http://localhost:4000/v1/models | jq '.data[].id' | head -5
```

### 3. Test Chat Functionality

1. Log in to the application
2. Start a new chat
3. Ask a simple question
4. Verify response is generated

### 4. Monitor Resource Usage

```bash
# Container resource usage
docker stats

# Disk usage
df -h
du -sh ./data/*
```

---

## Troubleshooting

### SSL Certificate Issues

```bash
# Check Traefik logs for certificate errors
docker compose logs traefik | grep -i "certificate\|acme\|error"

# Verify DNS is correct
dig policybot.example.com +short

# Force certificate renewal (careful - rate limits apply)
docker compose restart traefik
```

### Database Connection Issues

```bash
# SQLite - check file exists and permissions
ls -la ./data/app/policybot.db

# PostgreSQL - check connection
docker compose exec postgres psql -U policybot -c "SELECT 1"

# Reinitialize database schema
docker compose exec app npm run db:setup
```

### LLM API Errors

```bash
# Check LiteLLM logs
docker compose logs litellm | tail -50

# Test OpenAI directly
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models | jq '.data[0].id'

# Test via LiteLLM
docker compose exec app curl -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  http://litellm:4000/v1/models | jq '.data[0].id'
```

### Out of Memory

```bash
# Check memory usage
free -h
docker stats --no-stream

# Add swap if needed
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Restart services
docker compose restart
```

### Container Won't Start

```bash
# Check logs for specific container
docker compose logs app

# Check for port conflicts
sudo lsof -i :80
sudo lsof -i :443
sudo lsof -i :3000

# Rebuild container
docker compose up -d --build app
```

### Vector Store Issues

```bash
# Qdrant reset (WARNING: deletes all vectors)
docker compose stop qdrant
sudo rm -rf ./data/qdrant/*
docker compose up -d qdrant

# Qdrant health check
docker compose exec qdrant curl http://localhost:6333/readyz
```

---

## Maintenance

### Daily Operations

```bash
# Check service status
docker compose ps

# View recent logs
docker compose logs --since 1h

# Monitor resources
docker stats --no-stream
```

### Backup

#### Via Admin UI
1. Admin → System Management → Backup
2. Click "Create Backup"
3. Download the backup file

#### Via Command Line
```bash
# SQLite backup
docker compose exec app sqlite3 /app/data/policybot.db ".backup '/app/data/backup.db'"
docker cp policy-bot-app:/app/data/backup.db ./backups/$(date +%Y%m%d).db

# PostgreSQL backup
docker compose exec postgres pg_dump -U policybot policybot > ./backups/$(date +%Y%m%d).sql
```

### Updates

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose --profile postgres --profile qdrant down
docker compose --profile postgres --profile qdrant up -d --build

# Check logs for issues
docker compose logs -f app
```

### Database Maintenance

#### SQLite
```bash
# Reclaim space (monthly)
docker compose exec app sqlite3 /app/data/policybot.db 'VACUUM;'

# Check integrity
docker compose exec app sqlite3 /app/data/policybot.db 'PRAGMA integrity_check;'
```

#### PostgreSQL
```bash
# Analyze tables (automatic, but can run manually)
docker compose exec postgres psql -U policybot -c "ANALYZE;"

# Check database size
docker compose exec postgres psql -U policybot -c "SELECT pg_size_pretty(pg_database_size('policybot'));"
```

### Log Rotation

Docker handles log rotation automatically. To configure:

```bash
# Edit Docker daemon config
sudo nano /etc/docker/daemon.json
```

Add:
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Restart Docker:
```bash
sudo systemctl restart docker
```

### SSL Certificate Renewal

Traefik automatically renews Let's Encrypt certificates. To verify:

```bash
# Check certificate expiry
echo | openssl s_client -servername policybot.example.com -connect policybot.example.com:443 2>/dev/null | openssl x509 -noout -dates
```

---

## Scaling Recommendations

| Users | Database | Vector Store | RAM | Command |
|-------|----------|--------------|-----|---------|
| 1-25 | PostgreSQL | Qdrant | 4GB | `--profile postgres --profile qdrant` |
| 26-100 | PostgreSQL | Qdrant | 8GB | `--profile postgres --profile qdrant` |
| 100-250 | PostgreSQL | Qdrant | 16GB | `--profile postgres --profile qdrant` |
| 250+ | External PostgreSQL | Qdrant Cluster | 32GB+ | Custom infrastructure |

---

## Quick Reference

### Common Commands

```bash
# Start services
docker compose --profile postgres --profile qdrant up -d

# Stop services
docker compose --profile postgres --profile qdrant down

# View logs
docker compose logs -f app

# Restart single service
docker compose restart app

# Rebuild after code changes
docker compose up -d --build app

# Shell into container
docker compose exec app sh

# Check service health
docker compose ps
```

### Important Paths

| Path | Description |
|------|-------------|
| `./data/app/` | Application data, uploads |
| `./data/transformers_cache/` | BGE reranker models (~670MB) |
| `./data/qdrant/` | Qdrant vectors |
| `./data/postgres/` | PostgreSQL data |
| `./data/redis/` | Redis persistence |
| `./litellm-proxy/litellm_config.yaml` | LLM model configuration |
| `./.env` | Environment variables |

### Support

- Check logs: `docker compose logs -f`
- GitHub Issues: [repository-url/issues]
- Documentation: See `./docs/` directory

---

## Changelog

- **2026-02**: Initial documentation
- **2026-02**: Added BGE reranker setup, Docker entrypoint permissions fix
