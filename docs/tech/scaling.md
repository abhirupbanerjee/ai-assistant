# Scaling Guide: User Capacity & Configuration

This document provides configuration recommendations for different concurrent user loads, from small teams to enterprise deployments.

---

## Current Setup (Baseline Reference)

The current production configuration supports **~100-150 concurrent users** with the following settings:

### Database Layer

| Parameter | Value | Environment Variable |
|-----------|-------|---------------------|
| Provider | PostgreSQL | `DATABASE_URL=postgresql://...` |
| Pool Max | 20 | `DATABASE_POOL_MAX` |
| Pool Idle Timeout | 30,000ms | `DATABASE_POOL_IDLE_TIMEOUT` |
| Pool Connection Timeout | 10,000ms | `DATABASE_POOL_CONNECTION_TIMEOUT` |
| Connection URL | PostgreSQL URL | `DATABASE_URL` |

**Source:** `src/lib/db/kysely.ts` (lines 56-68)

```typescript
const poolMax = parseInt(process.env.DATABASE_POOL_MAX || '20', 10);
const poolIdleTimeout = parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT || '30000', 10);
const poolConnectionTimeout = parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT || '10000', 10);
```

### Application Layer

| Component | Value | Environment Variable |
|-----------|-------|---------------------|
| Vector Store | Qdrant | `VECTOR_STORE_PROVIDER=qdrant` |
| Redis | Enabled | `REDIS_URL` |
| Max Upload Size | 500MB | `MAX_UPLOAD_SIZE` |
| Instances | 1 | N/A (Docker Compose) |

### Current Capacity

With PostgreSQL (pool=20) and single instance:

```
Available: 20 connections × 60s = 1,200 connection-seconds/min
Supports: ~100-150 concurrent users with mixed workload
```

### Current Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Single VM Instance                      │
│                                                              │
│  ┌─────────────┐                                             │
│  │   Traefik   │  (reverse proxy, SSL termination)           │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │   Next.js   │  (application server)                       │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ├────────────────┬────────────────┐                  │
│         ▼                ▼                ▼                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │ PostgreSQL  │  │    Redis    │  │   Qdrant    │           │
│  │ Pool: 20    │  │   (cache)   │  │  (vectors)  │           │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Scaling Tiers

### Tier 1: 1-25 Concurrent Users (Small Team/Personal)

**Use Case:** Development, personal use, small teams

> **Note:** SQLite was removed in March 2026. PostgreSQL is required for all deployments. For small teams, a pool of 10 connections has negligible overhead.

| Dimension | Options | Recommended |
|-----------|---------|-------------|
| Database | PostgreSQL | **PostgreSQL** (pool=10) |
| Pool Size | 5-15 | **10** |
| Instances | 1 | **1** |
| Redis | Optional | **Optional** |
| Vector Store | Qdrant | **Qdrant** |
| Infrastructure | Single server | **Single Docker Compose** |

**Configuration:**

```bash
# .env
DATABASE_URL=postgresql://policybot:password@localhost:5432/policybot
DATABASE_POOL_MAX=10
VECTOR_STORE_PROVIDER=qdrant
# Redis optional - omit REDIS_URL for in-process caching
```

**Docker Compose:**

```bash
docker compose --profile postgres --profile qdrant up -d
```

**Architecture:**

```
┌──────────────────────────────────────────────────────────────┐
│                      Single VM Instance                      │
│                                                              │
│  ┌─────────────┐                                             │
│  │   Traefik   │  (reverse proxy, SSL termination)           │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │   Next.js   │  (application server)                       │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ├────────────────┐                                   │
│         ▼                ▼                                   │
│  ┌─────────────┐  ┌─────────────┐                            │
│  │ PostgreSQL  │  │   Qdrant    │                            │
│  │ (pool=10)   │  │  (vectors)  │                            │
│  └─────────────┘  └─────────────┘                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Estimated Infrastructure:** $20-50/month

---

### Tier 2: 26-100 Concurrent Users (Medium Team/Department)

**Use Case:** Department-level deployment, medium-sized organizations

| Dimension | Options | Recommended |
|-----------|---------|-------------|
| Database | PostgreSQL | **PostgreSQL** |
| Pool Size | 15-30 | **20-25** |
| Instances | 1-2 | **1** (2 for HA) |
| Redis | Optional, Recommended | **Yes** |
| Vector Store | Qdrant | **Qdrant** |
| Infrastructure | Single server + managed DB | **Single server** |

**Configuration:**

```bash
# .env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://policybot:password@localhost:5432/policybot
DATABASE_POOL_MAX=25
DATABASE_POOL_IDLE_TIMEOUT=30000
DATABASE_POOL_CONNECTION_TIMEOUT=10000
REDIS_URL=redis://localhost:6379
VECTOR_STORE_PROVIDER=qdrant
```

**Docker Compose:**

```bash
docker compose --profile postgres --profile qdrant up -d
```

**Why PostgreSQL at this tier:**
- Proper concurrent write access
- Connection pooling for efficiency
- External database enables independent scaling
- Better backup/restore options (pg_dump)

**Architecture:**

```
┌──────────────────────────────────────────────────────────────┐
│                      Single VM Instance                      │
│                                                              │
│  ┌─────────────┐                                             │
│  │   Traefik   │  (reverse proxy, SSL termination)          │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │   Next.js   │  (application server)                      │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ├────────────────┬────────────────┐                  │
│         ▼                ▼                ▼                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ PostgreSQL  │  │    Redis    │  │   Qdrant    │          │
│  │ Pool: 25    │  │   (cache)   │  │  (vectors)  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Estimated Infrastructure:** $100-200/month

---

### Tier 3: 100-250 Concurrent Users (Organization)

**Use Case:** Organization-wide deployment, multiple departments

| Dimension | Options | Recommended |
|-----------|---------|-------------|
| Database | PostgreSQL | **PostgreSQL (managed)** |
| Pool Size | 25-50 | **30-40** |
| Instances | 2-3 | **2-3** |
| Redis | Required | **Yes (dedicated)** |
| Vector Store | Qdrant | **Qdrant** |
| Infrastructure | Cluster | **Docker Swarm or K8s** |
| Load Balancer | Traefik, nginx | **Traefik** |

**Configuration:**

```bash
# .env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://policybot:password@pg-host:5432/policybot
DATABASE_POOL_MAX=40
DATABASE_POOL_IDLE_TIMEOUT=20000
DATABASE_POOL_CONNECTION_TIMEOUT=5000
REDIS_URL=redis://redis-host:6379
VECTOR_STORE_PROVIDER=qdrant
QDRANT_HOST=qdrant-host
QDRANT_PORT=6333
```

**Capacity Math:**

```
3 instances × 40 pool = 120 total connections
120 connections × 60 seconds = 7,200 connection-seconds/min
Typical demand at 200 users: ~4,000 connection-seconds/min
Result: Comfortable headroom
```

**Why Qdrant at this tier:**
- Better performance with large document volumes (10K+ documents)
- More efficient vector search algorithms
- Built for horizontal scaling

**Architecture:**

```
                    ┌─────────────┐
                    │   Traefik   │
                    │     LB      │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
    ┌─────────┐       ┌─────────┐       ┌─────────┐
    │ Next.js │       │ Next.js │       │ Next.js │
    │ Inst 1  │       │ Inst 2  │       │ Inst 3  │
    │ Pool:40 │       │ Pool:40 │       │ Pool:40 │
    └────┬────┘       └────┬────┘       └────┬────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
      ┌────────────────────┼────────────────────┐
      ▼                    ▼                    ▼
┌───────────┐        ┌───────────┐        ┌───────────┐
│PostgreSQL │        │   Redis   │        │  Qdrant   │
│ (Managed) │        │(Dedicated)│        │           │
└───────────┘        └───────────┘        └───────────┘
```

**Estimated Infrastructure:** $300-600/month

---

### Tier 4: 250-500 Concurrent Users (Large Organization)

**Use Case:** Enterprise deployment, high availability required

| Dimension | Options | Recommended |
|-----------|---------|-------------|
| Database | PostgreSQL + read replicas | **PostgreSQL (managed, HA)** |
| Pool Size | 40-60 | **50** |
| Instances | 4-6 | **4-5** |
| Redis | Cluster mode | **Redis Cluster or Managed** |
| Vector Store | Qdrant (clustered) | **Qdrant (distributed)** |
| Infrastructure | Kubernetes | **Kubernetes** |
| LLM Proxy | Optional | **LiteLLM** |

**Configuration:**

```bash
# .env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://policybot:password@pg-primary:5432/policybot
DATABASE_POOL_MAX=50
DATABASE_POOL_IDLE_TIMEOUT=15000
DATABASE_POOL_CONNECTION_TIMEOUT=5000
REDIS_URL=redis://redis-cluster:6379
VECTOR_STORE_PROVIDER=qdrant
QDRANT_HOST=qdrant-lb
QDRANT_PORT=6333

# LiteLLM for provider load balancing
OPENAI_BASE_URL=http://litellm:4000/v1
LITELLM_MASTER_KEY=sk-your-litellm-key
```

**Infrastructure Requirements:**

| Component | Specification |
|-----------|---------------|
| App instances | 4-5 × 2 vCPU, 4GB RAM |
| PostgreSQL | 4 vCPU, 16GB RAM, SSD |
| Redis | 2 vCPU, 8GB RAM |
| Qdrant | 4 vCPU, 16GB RAM |
| LiteLLM | 2 × 1 vCPU, 2GB RAM |

**Why LiteLLM at this tier:**
- Load balance across multiple API keys
- Distribute requests across providers (OpenAI, Azure, Anthropic)
- Rate limit management per provider
- Spend tracking and virtual keys

**Architecture:**

```
                         ┌─────────────┐
                         │   Traefik   │
                         │   Cluster   │
                         └──────┬──────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼           ▼           ▼           ▼           ▼
   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
   │Next.js │  │Next.js │  │Next.js │  │Next.js │  │Next.js │
   │ Pod 1  │  │ Pod 2  │  │ Pod 3  │  │ Pod 4  │  │ Pod 5  │
   └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘
       │           │           │           │           │
       └───────────┴─────┬─────┴───────────┴───────────┘
                         │
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
┌──────────┐       ┌───────────┐        ┌───────────┐
│PostgreSQL│       │  Redis    │        │  Qdrant   │
│   HA     │       │  Cluster  │        │ Cluster   │
│Pool:50×5 │       │  (3 node) │        │ (3 node)  │
└──────────┘       └───────────┘        └───────────┘
                         │
                   ┌─────┴─────┐
                   │  LiteLLM  │
                   │  (2 pod)  │
                   └───────────┘
```

**Estimated Infrastructure:** $800-1500/month

---

### Tier 5: 500+ Concurrent Users (Enterprise)

**Use Case:** Large enterprise, global deployment, strict SLAs

| Dimension | Options | Recommended |
|-----------|---------|-------------|
| Database | PostgreSQL + PgBouncer | **PostgreSQL HA + PgBouncer** |
| Pool Size | 50-100 (per instance) | **50** + PgBouncer multiplexing |
| Instances | 8+ | **8-12** (auto-scale) |
| Redis | Redis Cluster | **Redis Cluster (3+ nodes)** |
| Vector Store | Qdrant distributed | **Qdrant Cluster (3+ nodes)** |
| Infrastructure | K8s with HPA | **Kubernetes + HPA** |
| LLM Proxy | Required | **LiteLLM (multiple instances)** |
| CDN | Recommended | **CloudFront/Cloudflare** |

**Configuration:**

```bash
# .env
DATABASE_PROVIDER=postgres
# Connect via PgBouncer, not directly to PostgreSQL
DATABASE_URL=postgresql://policybot:password@pgbouncer:6432/policybot
DATABASE_POOL_MAX=50  # Per instance; PgBouncer handles multiplexing

REDIS_URL=redis://redis-cluster:6379
VECTOR_STORE_PROVIDER=qdrant
QDRANT_HOST=qdrant-lb
QDRANT_PORT=6333

OPENAI_BASE_URL=http://litellm-lb:4000/v1
LITELLM_MASTER_KEY=sk-your-litellm-key
```

**PgBouncer Configuration:**

```ini
# pgbouncer.ini
[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 100
min_pool_size = 10
reserve_pool_size = 25
```

**Why PgBouncer at this tier:**
- Connection multiplexing: 1000 app connections → 100 DB connections
- Prevents PostgreSQL `max_connections` exhaustion
- Enables more app instances without DB bottleneck
- Transaction-level pooling for stateless queries

**Infrastructure Requirements:**

| Component | Specification | Count |
|-----------|---------------|-------|
| App pods | 2 vCPU, 4GB RAM | 8-12 (HPA) |
| PostgreSQL | 8 vCPU, 32GB RAM, SSD | 1 primary + 2 replicas |
| PgBouncer | 1 vCPU, 1GB RAM | 2 (HA) |
| Redis | 2 vCPU, 8GB RAM | 3 (cluster) |
| Qdrant | 4 vCPU, 16GB RAM | 3 (cluster) |
| LiteLLM | 1 vCPU, 2GB RAM | 2+ |

**Kubernetes HPA Example:**

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: policybot-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: policybot
  minReplicas: 8
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

**Architecture:**

```
                              ┌─────────────┐
                              │     CDN     │
                              │ (Static)    │
                              └──────┬──────┘
                                     │
                              ┌──────┴──────┐
                              │   Traefik   │
                              │   Cluster   │
                              └──────┬──────┘
                                     │
    ┌────────────────────────────────┼────────────────────────────────┐
    ▼        ▼        ▼        ▼     ▼     ▼        ▼        ▼        ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│Pod 1 │ │Pod 2 │ │Pod 3 │ │Pod 4 │ ... │Pod 9 │ │Pod10 │ │Pod11 │ │Pod12 │
└──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘     └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘
   │        │        │        │             │        │        │        │
   └────────┴────────┴────────┴──────┬──────┴────────┴────────┴────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
   ┌───────────┐              ┌───────────┐              ┌───────────┐
   │ PgBouncer │              │   Redis   │              │  Qdrant   │
   │   (HA)    │              │  Cluster  │              │  Cluster  │
   └─────┬─────┘              │  (3 node) │              │  (3 node) │
         │                    └───────────┘              └───────────┘
   ┌─────┴─────┐                    │
   │PostgreSQL │              ┌─────┴─────┐
   │    HA     │              │  LiteLLM  │
   │ (1P + 2R) │              │  Cluster  │
   └───────────┘              └───────────┘
```

**Estimated Infrastructure:** $2000+/month (varies by cloud provider)

---

## Summary Table

| Tier | Users | Database | Pool | Instances | Redis | Vector Store | Est. Cost |
|------|-------|----------|------|-----------|-------|--------------|-----------|
| 1 | 1-25 | PostgreSQL | 10 | 1 | No | Qdrant | $20-50 |
| 2 | 26-100 | PostgreSQL | 25 | 1-2 | Yes | Qdrant | $100-200 |
| 3 | 100-250 | PostgreSQL | 40 | 2-3 | Dedicated | Qdrant | $300-600 |
| 4 | 250-500 | PostgreSQL HA | 50 | 4-5 | Cluster | Qdrant Cluster | $800-1500 |
| 5 | 500+ | PgBouncer+PG | 50×N | 8+ | Cluster | Qdrant Cluster | $2000+ |

---

## Migration Decision Points

### When to Upgrade

| From | To | Trigger Signs |
|------|----|---------------|
| Tier 1 | Tier 2 | >20 users, need multi-user writes, want external DB |
| Tier 2 | Tier 3 | >80 users, response times increasing, need HA |
| Tier 3 | Tier 4 | >200 users, LLM rate limits hit, need provider diversity |
| Tier 4 | Tier 5 | >400 users, connection exhaustion, need auto-scaling |

### Key Migration Steps

**SQLite → PostgreSQL:**

1. Create PostgreSQL database
2. Use built-in backup/restore: Admin > System > Backup
3. Update environment variables
4. Restart application

**Single Instance → Multi-Instance:**

1. Externalize PostgreSQL and Redis
2. Update connection strings to use service names
3. Deploy additional instances behind load balancer
4. Configure sticky sessions for SSE (if needed)

**Add PgBouncer:**

1. Deploy PgBouncer between app and PostgreSQL
2. Update `DATABASE_URL` to point to PgBouncer
3. Configure `pool_mode = transaction`
4. Reduce per-app `DATABASE_POOL_MAX` (PgBouncer handles pooling)

---

## Connection Pool Sizing Formula

From `docs/tech/DB-techstack.md`:

```
Available capacity = Pool Size × 60 seconds
Demand = (simple_queries × 10s) + (tool_queries × 30s) + (complex_queries × 200s)

Target: Available capacity > Demand × 1.5 (50% headroom)
```

**Example for 100 users with mixed workload:**

```
Queries per minute: ~100
- 60% simple (10s): 60 × 10s = 600 conn-seconds
- 30% tools (30s):  30 × 30s = 900 conn-seconds
- 10% complex (200s): 10 × 200s = 2000 conn-seconds
Total demand: 3500 conn-seconds/min

Required pool: 3500 / 60 × 1.5 = ~88 connections
With 3 instances: 88 / 3 = ~30 per instance
```

---

## Environment Variable Reference

| Variable | Default | Description | Tier |
|----------|---------|-------------|------|
| `DATABASE_PROVIDER` | `sqlite` | Database backend | All |
| `DATABASE_POOL_MAX` | `20` | Max connections per instance | 2+ |
| `DATABASE_POOL_IDLE_TIMEOUT` | `30000` | Idle connection timeout (ms) | 2+ |
| `DATABASE_POOL_CONNECTION_TIMEOUT` | `10000` | Connection acquire timeout (ms) | 2+ |
| `REDIS_URL` | - | Redis connection string | 2+ |
| `VECTOR_STORE_PROVIDER` | `qdrant` | Vector store backend | All |
| `QDRANT_HOST` | `localhost` | Qdrant server host | 3+ |
| `LITELLM_MASTER_KEY` | - | LiteLLM authentication | 4+ |

---

## Related Documentation

- [DB-techstack.md](DB-techstack.md) - Database architecture details
- [DATABASE.md](DATABASE.md) - Schema reference
- `.env.example` - Full environment variable reference
