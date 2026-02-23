# Database Architecture: SQLite vs PostgreSQL Usage

## Overview

The application supports **dual database backends** controlled by `DATABASE_PROVIDER` environment variable:
- **SQLite** (default): `better-sqlite3` - Synchronous, file-based, ideal for development/small deployments
- **PostgreSQL**: `pg` + Kysely ORM - Async, connection-pooled, ideal for production/scale

**Key Insight**: Both backends support **identical operations** - the difference is in the access pattern (sync vs async), not capabilities.

---

## Database Access Layers

| Layer | File | Purpose | Used By |
|-------|------|---------|---------|
| **Sync SQLite** | `src/lib/db/index.ts` | Direct `better-sqlite3` access | Legacy code, startup |
| **Async Kysely** | `src/lib/db/kysely.ts` | ORM for both SQLite & PostgreSQL | New async code |
| **Compat Layer** | `src/lib/db/compat/*.ts` | Unified async API | All API routes |

---

## Complete Operations-to-Database Mapping

### User & Authentication

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Get all users | `users` | Sync | Async | `compat/users.ts` |
| Create user | `users` | Sync | Async | `compat/users.ts` |
| Update user role | `users` | Sync | Async | `compat/users.ts` |
| Delete user | `users` | Sync | Async | `compat/users.ts` |
| Assign superuser categories | `super_user_categories` | Sync | Async | `users.ts` |
| User subscriptions | `user_subscriptions` | Sync | Async | `users.ts` |

### Categories & Organization

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Create category | `categories` | Sync | Async | `compat/categories.ts` |
| List categories | `categories` | Sync | Async | `compat/categories.ts` |
| Update category | `categories` | Sync | Async | `compat/categories.ts` |
| Delete category | `categories` | Sync | Async | `compat/categories.ts` |
| Category prompts | `category_prompts` | Sync | Async | `category-prompts.ts` |

### Document Management (RAG)

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Upload document | `documents`, `document_categories` | Sync | Async | `compat/documents.ts` |
| List documents | `documents` | Sync | Async | `compat/documents.ts` |
| Update document status | `documents` | Sync | Async | `compat/documents.ts` |
| Delete document | `documents`, `document_categories` | Sync | Async | `compat/documents.ts` |
| Folder sync tracking | `folder_syncs`, `folder_sync_files` | Sync | Async | `folder-syncs.ts` |

### Conversation/Chat

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Create thread | `threads`, `thread_categories` | Sync | Async | `compat/threads.ts` |
| Get thread context | `threads`, `messages` | Sync | Async | `compat/threads.ts` |
| Add message | `messages` | Sync | Async | `compat/threads.ts` |
| Update message | `messages` | Sync | Async | `compat/threads.ts` |
| Delete thread | `threads`, `messages` | Sync | Async | `compat/threads.ts` |
| Thread uploads | `thread_uploads` | Sync | Async | `threads.ts` |
| Thread outputs (images, PDFs, audio) | `thread_outputs` | Sync | Async | `compat/threads.ts` |
| Thread summarization | `thread_summaries`, `archived_messages` | Sync | Async | `threads.ts` |

### User Memory System

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Store user memory | `user_memories` | Sync | Async | `user-memories.ts` |
| Get user memories | `user_memories` | Sync | Async | `user-memories.ts` |
| Delete memory | `user_memories` | Sync | Async | `user-memories.ts` |

### Settings & Configuration

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Get setting | `settings` | Sync | Async | `compat/config.ts` |
| Set setting | `settings` | Sync | Async | `compat/config.ts` |
| RAG settings | `settings` | Sync | Async | `config.ts` |
| LLM settings | `settings` | Sync | Async | `config.ts` |
| System prompt | `settings` | Sync | Async | `config.ts` |
| Upload limits | `settings` | Sync | Async | `config.ts` |
| Memory/summarization settings | `settings` | Sync | Async | `config.ts` |
| Agent budget settings | `settings` | Sync | Async | `config.ts` |

### LLM Provider Management

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| List providers | `llm_providers` | Sync | Async | `llm-providers.ts` |
| Add/update provider | `llm_providers` | Sync | Async | `llm-providers.ts` |
| List enabled models | `enabled_models` | Sync | Async | `enabled-models.ts` |
| Enable/disable model | `enabled_models` | Sync | Async | `enabled-models.ts` |
| Set default model | `enabled_models` | Sync | Async | `enabled-models.ts` |

### Tool System

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Get tool config | `tool_configs` | Sync | Async | `tool-config.ts` |
| Update tool config | `tool_configs`, `tool_config_audit` | Sync | Async | `tool-config.ts` |
| Category tool overrides | `category_tool_configs` | Sync | Async | `category-tool-config.ts` |
| Tool routing rules | `tool_routing_rules` | Sync | Async | `tool-routing.ts` |

### Skills System

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Create skill | `skills` | Sync | Async | `skills.ts` |
| List skills | `skills`, `category_skills` | Sync | Async | `skills.ts` |
| Update skill | `skills` | Sync | Async | `skills.ts` |
| Delete skill | `skills`, `category_skills` | Sync | Async | `skills.ts` |
| Assign skill to category | `category_skills` | Sync | Async | `skills.ts` |

### Data Sources

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Create API config | `data_api_configs`, `data_api_categories` | Sync | Async | `data-sources.ts` |
| Create CSV config | `data_csv_configs`, `data_csv_categories` | Sync | Async | `data-sources.ts` |
| List data sources | `data_api_configs`, `data_csv_configs` | Sync | Async | `data-sources.ts` |
| Update data source | `data_*_configs` | Sync | Async | `data-sources.ts` |
| Data source audit | `data_source_audit` | Sync | Async | `data-sources.ts` |
| Function API configs | `function_api_configs`, `function_api_categories` | Sync | Async | `function-api-config.ts` |

### Task Planning (Autonomous Agent)

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Create task plan | `task_plans` | Sync | Async | `task-plans.ts` |
| Update task progress | `task_plans` | Sync | Async | `task-plans.ts` |
| Get active plan | `task_plans` | Sync | Async | `task-plans.ts` |
| Track budget usage | `task_plans` | Sync | Async | `task-plans.ts` |

### Thread Sharing

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Create share token | `thread_shares` | Sync | Async | `compat/sharing.ts` |
| Validate share token | `thread_shares` | Sync | Async | `compat/sharing.ts` |
| Log share access | `share_access_log` | Sync | Async | `sharing.ts` |
| Revoke share | `thread_shares` | Sync | Async | `sharing.ts` |

### Compliance System

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Store compliance result | `compliance_results` | Sync | Async | `compat/compliance.ts` |
| Get compliance history | `compliance_results` | Sync | Async | `compliance.ts` |
| HITL response | `compliance_results` | Sync | Async | `compliance.ts` |

### RAG Testing & Tuning

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Save test query | `rag_test_queries` | Sync | Async | `rag-testing.ts` |
| Run test & save result | `rag_test_results` | Sync | Async | `rag-testing.ts` |
| Get test history | `rag_test_results` | Sync | Async | `rag-testing.ts` |

### Workspace System (Embed & Standalone)

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Create workspace | `workspaces`, `workspace_categories` | Sync | Async | `workspaces.ts` |
| List workspaces | `workspaces` | Sync | Async | `workspaces.ts` |
| Update workspace | `workspaces` | Sync | Async | `workspaces.ts` |
| Workspace users | `workspace_users` | Sync | Async | `workspace-users.ts` |
| Create session | `workspace_sessions` | Sync | Async | `workspace-sessions.ts` |
| Workspace threads | `workspace_threads` | Sync | Async | `workspace-threads.ts` |
| Workspace messages | `workspace_messages` | Sync | Async | `workspace-messages.ts` |
| Workspace outputs | `workspace_outputs` | Sync | Async | `workspaces.ts` |
| Rate limiting | `workspace_rate_limits` | Sync | Async | `workspaces.ts` |
| Analytics rollup | `workspace_analytics` | Sync | Async | `workspace-sessions.ts` |

### Backup & Migration

| Operation | Table(s) | SQLite | PostgreSQL | Access Module |
|-----------|----------|--------|------------|---------------|
| Export all data | All 45+ tables | Supported | Supported | `backup-async.ts` |
| Import all data | All 45+ tables | Supported | Supported | `backup-async.ts` |
| Cross-provider migration | All tables | SQLite to PostgreSQL | PostgreSQL to SQLite | `backup-async.ts` |

---

## Complete Table Inventory (45 Tables)

| Table | Category | Purpose |
|-------|----------|---------|
| `users` | Auth | User accounts |
| `super_user_categories` | Auth | Superuser permissions |
| `user_subscriptions` | Auth | User category subscriptions |
| `categories` | Content | Knowledge base categories |
| `category_prompts` | Content | Category-specific prompts |
| `documents` | RAG | Uploaded documents |
| `document_categories` | RAG | Document-category mapping |
| `folder_syncs` | RAG | Folder upload sessions |
| `folder_sync_files` | RAG | Files within folder uploads |
| `threads` | Chat | Conversation threads |
| `thread_categories` | Chat | Thread-category mapping |
| `messages` | Chat | Chat messages |
| `thread_uploads` | Chat | User uploads per thread |
| `thread_outputs` | Chat | Generated files (images, PDF, audio) |
| `thread_summaries` | Chat | Conversation summaries |
| `archived_messages` | Chat | Messages after summarization |
| `user_memories` | Memory | User fact storage |
| `settings` | Config | Key-value settings store |
| `storage_alerts` | Config | Storage threshold alerts |
| `llm_providers` | LLM | Provider configurations |
| `enabled_models` | LLM | Model catalog |
| `tool_configs` | Tools | Global tool settings |
| `tool_config_audit` | Tools | Tool config audit trail |
| `category_tool_configs` | Tools | Per-category tool overrides |
| `tool_routing_rules` | Tools | Keyword-based tool routing |
| `skills` | Skills | Skill definitions |
| `category_skills` | Skills | Skill-category mapping |
| `data_api_configs` | Data | REST API configurations |
| `data_api_categories` | Data | API-category mapping |
| `data_csv_configs` | Data | CSV data sources |
| `data_csv_categories` | Data | CSV-category mapping |
| `data_source_audit` | Data | Data source audit trail |
| `function_api_configs` | Data | Function calling APIs |
| `function_api_categories` | Data | Function API-category mapping |
| `task_plans` | Agent | Autonomous task plans |
| `thread_shares` | Sharing | Share tokens |
| `share_access_log` | Sharing | Share access audit |
| `compliance_results` | Compliance | Check results & HITL |
| `rag_test_queries` | Testing | RAG test queries |
| `rag_test_results` | Testing | RAG test results |
| `workspaces` | Workspace | Workspace configs |
| `workspace_categories` | Workspace | Workspace-category mapping |
| `workspace_users` | Workspace | User access |
| `workspace_sessions` | Workspace | Session tracking |
| `workspace_threads` | Workspace | Persistent threads |
| `workspace_messages` | Workspace | Session messages |
| `workspace_outputs` | Workspace | Generated files |
| `workspace_rate_limits` | Workspace | IP rate limiting |
| `workspace_analytics` | Workspace | Daily analytics |

---

## Key Architectural Decisions

### 1. Schema Parity
Both SQLite and PostgreSQL use **identical schemas** (with minor syntax differences):
- SQLite: `INTEGER PRIMARY KEY AUTOINCREMENT`
- PostgreSQL: `SERIAL PRIMARY KEY`

### 2. Compatibility Layer Pattern
```typescript
// src/lib/db/compat/users.ts
export async function getAllUsers(): Promise<DbUser[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.getAllUsers();  // Wraps sync in Promise
  }
  // PostgreSQL uses Kysely async
  const db = await getDb();
  return db.selectFrom('users').selectAll().execute();
}
```

### 3. Connection Handling
| Aspect | SQLite | PostgreSQL |
|--------|--------|------------|
| Connection Type | Single file handle | Pool (max 10) |
| Concurrency | WAL mode | Native |
| Timeout | N/A | 30s idle |
| Transaction | Immediate | Serializable |

### 4. Migration Strategy
- **SQLite**: `ALTER TABLE` in `index.ts` startup
- **PostgreSQL**: Idempotent DDL in `runPostgresMigrations()`

---

## Connection Pool Math with Query Times

### Real-World Query Duration Assumptions

| Query Type | Duration | Example |
|------------|----------|---------|
| Simple text query | 10 seconds | User asks a question, LLM responds |
| Simple tool (chart/web search) | 30 seconds | Single tool invocation |
| Complex tool (PPT with images) | 200 seconds | Multi-step generation with external calls |

### Pool Capacity Analysis (Default: 10 connections)

#### Scenario 1: All Simple Text Queries (10s each)

```
Pool capacity: 10 connections
Query duration: 10 seconds
Queries per connection per minute: 60s / 10s = 6
Total queries per minute: 10 × 6 = 60 queries/min

Concurrent users supported: 60 queries/min means 60 users can each
make 1 query per minute, or 30 users can make 2 queries per minute.
```

**Result**: 10 connections can handle ~30-60 concurrent light users comfortably.

#### Scenario 2: Mixed Simple Tools (30s each)

```
Pool capacity: 10 connections
Query duration: 30 seconds
Queries per connection per minute: 60s / 30s = 2
Total queries per minute: 10 × 2 = 20 queries/min
```

**Result**: 10 connections can handle ~20 tool-using queries per minute.

#### Scenario 3: Complex Tools (200s each)

```
Pool capacity: 10 connections
Query duration: 200 seconds (~3.3 minutes)
Queries per connection per minute: 60s / 200s = 0.3
Total queries per minute: 10 × 0.3 = 3 queries/min
```

**Result**: Only 3 complex operations can run simultaneously. The 4th user must wait.

### Real-World Mixed Load Example

Assume typical usage pattern:
- 60% simple text (10s)
- 30% simple tools (30s)
- 10% complex tools (200s)

With 10 connections and 50 queries arriving per minute:
```
Simple text:  30 queries × 10s = 300 connection-seconds
Simple tools: 15 queries × 30s = 450 connection-seconds
Complex:       5 queries × 200s = 1000 connection-seconds
                                  ─────────────────────────
Total:                            1750 connection-seconds needed

Available: 10 connections × 60 seconds = 600 connection-seconds

Deficit: 1750 - 600 = 1150 connection-seconds
```

**This means**: At peak load with complex tools, queries will queue up significantly.

### Recommended Pool Sizes

| Deployment Size | Users | Recommended Pool | Rationale |
|-----------------|-------|------------------|-----------|
| Small team | 5-10 | 10-15 | Default works, minor buffer |
| Medium org | 50-100 | 20-30 | Handle peak hours |
| Large org | 100-500 | 30-50 | Complex tool headroom |
| Enterprise | 500+ | 50-100 | Peak + buffer |

### Configuration

Pool settings are configurable via environment variables in `src/lib/db/kysely.ts`:

```bash
# .env - PostgreSQL pool settings (ignored for SQLite)
DATABASE_POOL_MAX=20                      # Max connections (default: 20)
DATABASE_POOL_IDLE_TIMEOUT=30000          # Idle timeout in ms (default: 30000)
DATABASE_POOL_CONNECTION_TIMEOUT=10000    # Connection timeout in ms (default: 10000)
```

**Note:** Changes require application restart to take effect.

### Important Considerations

1. **Database Connection != HTTP Request Duration**
   - DB operations are typically <100ms
   - The 10-200s durations are LLM processing time
   - Connection is released after each DB query

2. **Actual Bottleneck**
   - The pool handles rapid DB reads/writes
   - LLM API calls don't hold DB connections
   - Real concern is memory and API rate limits

3. **When Pool Size Matters**
   - High-frequency DB operations (logging, state updates)
   - Batch operations (exports, migrations)
   - Concurrent admin operations

---

## Environment Configuration

```bash
# SQLite (default)
DATABASE_PROVIDER=sqlite
SQLITE_DB_PATH=./data/policybot.db

# PostgreSQL
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/db/index.ts` | SQLite initialization, sync operations |
| `src/lib/db/kysely.ts` | Kysely ORM factory for both backends |
| `src/lib/db/async.ts` | Async query helpers |
| `src/lib/db/compat/*.ts` | Unified async API layer |
| `src/lib/db/schema/postgres.sql` | PostgreSQL schema (33KB) |
| `src/lib/db/db-types.ts` | TypeScript type definitions |
| `src/lib/db/setup.ts` | Database setup script |
| `src/lib/db/backup-async.ts` | Cross-provider backup/migration |

---

## When to Use Which Backend

| Scenario | Recommended | Reason |
|----------|-------------|--------|
| Local development | SQLite | Zero setup, fast |
| Single-user deployment | SQLite | Simple, sufficient |
| Multi-user production | PostgreSQL | Concurrent access |
| Docker/Kubernetes | PostgreSQL | External DB, scaling |
| High availability | PostgreSQL | Replication support |
| Backup/migration | Either | `backup-async.ts` works with both |
