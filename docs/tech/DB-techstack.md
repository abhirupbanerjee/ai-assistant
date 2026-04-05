# Database Architecture: PostgreSQL via Kysely

## Overview

The application uses **PostgreSQL** as its sole database backend, accessed via the **Kysely ORM** for type-safe async queries.

> **Note:** SQLite support was removed in March 2026. All database access is now async via Kysely.

---

## Database Access Layers

| Layer | File | Purpose | Used By |
|-------|------|---------|---------|
| **Kysely ORM** | `src/lib/db/kysely.ts` | PostgreSQL connection pool + migrations | All database code |
| **Compat Layer** | `src/lib/db/compat/*.ts` | Unified async API (31 modules) | All API routes |
| **Pure Utilities** | `src/lib/db/utils.ts` | Constants, validators, slug generators (no DB access) | Compat modules |
| **Type Definitions** | `src/lib/db/db-types.ts` | Kysely TypeScript types for all tables | Compat modules |

---

## Complete Operations-to-Database Mapping

### User & Authentication

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Get all users | `users` | `compat/users.ts` |
| Create user | `users` | `compat/users.ts` |
| Update user role | `users` | `compat/users.ts` |
| Delete user | `users` | `compat/users.ts` |
| Assign superuser categories | `super_user_categories` | `compat/users.ts` |
| User subscriptions | `user_subscriptions` | `compat/users.ts` |

### Categories & Organization

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create category | `categories` | `compat/categories.ts` |
| List categories | `categories` | `compat/categories.ts` |
| Update category | `categories` | `compat/categories.ts` |
| Delete category | `categories` | `compat/categories.ts` |
| Category prompts | `category_prompts` | `compat/category-prompts.ts` |

### Document Management (RAG)

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Upload document | `documents`, `document_categories` | `compat/documents.ts` |
| List documents | `documents` | `compat/documents.ts` |
| Update document status | `documents` | `compat/documents.ts` |
| Delete document | `documents`, `document_categories` | `compat/documents.ts` |
| Folder sync tracking | `folder_syncs`, `folder_sync_files` | `compat/folder-syncs.ts` |

### Conversation/Chat

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create thread | `threads`, `thread_categories` | `compat/threads.ts` |
| Get thread context | `threads`, `messages` | `compat/threads.ts` |
| Add message | `messages` | `compat/threads.ts` |
| Update message | `messages` | `compat/threads.ts` |
| Delete thread | `threads`, `messages` | `compat/threads.ts` |
| Thread uploads | `thread_uploads` | `compat/threads.ts` |
| Thread outputs | `thread_outputs` | `compat/threads.ts` |
| Thread summarization | `thread_summaries`, `archived_messages` | `compat/summarization.ts` |

### User Memory System

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Store user memory | `user_memories` | `compat/memory.ts` |
| Get user memories | `user_memories` | `compat/memory.ts` |
| Delete memory | `user_memories` | `compat/memory.ts` |

### Settings & Configuration

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Get setting | `settings` | `compat/config.ts` |
| Set setting | `settings` | `compat/config.ts` |
| RAG settings | `settings` | `compat/config.ts` |
| LLM settings | `settings` | `compat/config.ts` |
| System prompt | `settings` | `compat/config.ts` |
| Upload limits | `settings` | `compat/config.ts` |
| Memory/summarization settings | `settings` | `compat/config.ts` |
| Agent budget settings | `settings` | `compat/config.ts` |

### LLM Provider Management

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| List providers | `llm_providers` | `compat/llm-providers.ts` |
| Add/update provider | `llm_providers` | `compat/llm-providers.ts` |
| List enabled models | `enabled_models` | `compat/enabled-models.ts` |
| Enable/disable model | `enabled_models` | `compat/enabled-models.ts` |
| Set default model | `enabled_models` | `compat/enabled-models.ts` |
| Check parallel tool capability | `enabled_models` | `compat/enabled-models.ts` (`isModelParallelToolCapable`) |
| Check thinking capability | `enabled_models` | `compat/enabled-models.ts` (`isModelThinkingCapable`) |
| Refresh model capabilities | `enabled_models` | `compat/enabled-models.ts` (`refreshModelCapabilities`) |

### Tool System

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Get tool config | `tool_configs` | `compat/tool-config.ts` |
| Update tool config | `tool_configs`, `tool_config_audit` | `compat/tool-config.ts` |
| Category tool overrides | `category_tool_configs` | `compat/category-tool-config.ts` |
| Tool routing rules | `tool_routing_rules` | `compat/tool-routing.ts` |

### Skills System

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create skill | `skills` | `compat/skills.ts` |
| List skills | `skills`, `category_skills` | `compat/skills.ts` |
| Update skill | `skills` | `compat/skills.ts` |
| Delete skill | `skills`, `category_skills` | `compat/skills.ts` |
| Assign skill to category | `category_skills` | `compat/skills.ts` |

### Data Sources

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create API config | `data_api_configs`, `data_api_categories` | `compat/data-sources.ts` |
| Create CSV config | `data_csv_configs`, `data_csv_categories` | `compat/data-sources.ts` |
| List data sources | `data_api_configs`, `data_csv_configs` | `compat/data-sources.ts` |
| Update data source | `data_*_configs` | `compat/data-sources.ts` |
| Data source audit | `data_source_audit` | `compat/data-sources.ts` |
| Function API configs | `function_api_configs`, `function_api_categories` | `compat/function-api-config.ts` |

### Task Planning (Autonomous Agent)

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create task plan | `task_plans` | `compat/task-plans.ts` |
| Update task progress | `task_plans` | `compat/task-plans.ts` |
| Get active plan | `task_plans` | `compat/task-plans.ts` |
| Track budget usage | `task_plans` | `compat/task-plans.ts` |

### Thread Sharing

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create share token | `thread_shares` | `compat/sharing.ts` |
| Validate share token | `thread_shares` | `compat/sharing.ts` |
| Log share access | `share_access_log` | `compat/sharing.ts` |
| Revoke share | `thread_shares` | `compat/sharing.ts` |

### Compliance System

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Store compliance result | `compliance_results` | `compat/compliance.ts` |
| Get compliance history | `compliance_results` | `compat/compliance.ts` |
| HITL response | `compliance_results` | `compat/compliance.ts` |

### RAG Testing & Tuning

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Save test query | `rag_test_queries` | `compat/rag-testing.ts` |
| Run test & save result | `rag_test_results` | `compat/rag-testing.ts` |
| Get test history | `rag_test_results` | `compat/rag-testing.ts` |

### Workspace System (Embed & Standalone)

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create workspace | `workspaces`, `workspace_categories` | `compat/workspaces.ts` |
| List workspaces | `workspaces` | `compat/workspaces.ts` |
| Update workspace | `workspaces` | `compat/workspaces.ts` |
| Workspace users | `workspace_users` | `compat/workspace-users.ts` |
| Create session | `workspace_sessions` | `compat/workspace-sessions.ts` |
| Workspace threads | `workspace_threads` | `compat/workspace-threads.ts` |
| Workspace messages | `workspace_messages` | `compat/workspace-messages.ts` |
| Workspace outputs | `workspace_outputs` | `compat/workspaces.ts` |
| Rate limiting | `workspace_rate_limits` | `compat/workspaces.ts` |
| Analytics rollup | `workspace_analytics` | `compat/workspace-sessions.ts` |

### Agent Bots (Programmatic API)

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Create agent bot | `agent_bots` | `compat/agent-bots.ts` |
| Manage API keys | `agent_bot_api_keys` | `compat/agent-bots.ts` |
| Invoke bot / track jobs | `agent_bot_jobs`, `agent_bot_job_files`, `agent_bot_job_outputs` | `compat/agent-bots.ts` |
| Bot version history | `agent_bot_versions`, `agent_bot_version_categories`, `agent_bot_version_skills`, `agent_bot_version_tools` | `compat/agent-bots.ts` |
| Usage analytics | `agent_bot_usage` | `compat/agent-bots.ts` |
| Load test results | `load_test_results` | `compat/load-testing.ts` |

### Backup & Migration

| Operation | Table(s) | Access Module |
|-----------|----------|---------------|
| Export all data | All 60 tables | `compat/backup-async.ts` |
| Import all data | All 60 tables | `compat/backup-async.ts` |

---

## Complete Table Inventory (60 Tables)

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
| `enabled_models` | LLM | Model catalog (tool_capable, vision_capable, parallel_tool_capable, thinking_capable, tokens) |
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
| `agent_bots` | Agent Bots | Bot definitions and config |
| `agent_bot_api_keys` | Agent Bots | API keys for bot access |
| `agent_bot_jobs` | Agent Bots | Invocation job tracking |
| `agent_bot_job_files` | Agent Bots | Files attached to jobs |
| `agent_bot_job_outputs` | Agent Bots | Output files from jobs |
| `agent_bot_versions` | Agent Bots | Bot version snapshots |
| `agent_bot_version_categories` | Agent Bots | Version-category mapping |
| `agent_bot_version_skills` | Agent Bots | Version-skill mapping |
| `agent_bot_version_tools` | Agent Bots | Version-tool mapping |
| `agent_bot_usage` | Agent Bots | Usage analytics per bot |
| `load_test_results` | Testing | k6 load test result records |

---

## Key Architectural Decisions

### 1. Compat Layer Pattern
```typescript
// src/lib/db/compat/users.ts — all modules follow this pattern
export async function getAllUsers(): Promise<DbUser[]> {
  const db = await getDb();
  return db.selectFrom('users').selectAll().execute();
}
```

### 2. Pure Utility Extraction
Pure functions (validators, slug generators, constants) live in `src/lib/db/utils.ts` — imported by compat modules without triggering any DB connection.

### 3. Connection Handling

| Aspect | PostgreSQL |
|--------|------------|
| Connection Type | Pool (max 20, configurable) |
| Concurrency | Native |
| Idle Timeout | 30s (configurable) |
| Connection Timeout | 10s (configurable) |

### 4. Migration Strategy
Kysely runs idempotent DDL migrations in `runPostgresMigrations()` on startup.

---

## Connection Pool Math with Query Times

### Real-World Query Duration Assumptions

| Query Type | Duration | Example |
|------------|----------|---------|
| Simple text query | 10 seconds | User asks a question, LLM responds |
| Simple tool (chart/web search) | 30 seconds | Single tool invocation |
| Complex tool (PPT with images) | 200 seconds | Multi-step generation with external calls |

### Pool Capacity Analysis (Default: 20 connections)

#### Scenario 1: All Simple Text Queries (10s each)

```
Pool capacity: 20 connections
Query duration: 10 seconds
Queries per connection per minute: 60s / 10s = 6
Total queries per minute: 20 × 6 = 120 queries/min
```

**Result**: 20 connections can handle ~60-120 concurrent light users comfortably.

#### Scenario 2: Mixed Simple Tools (30s each)

```
Pool capacity: 20 connections
Query duration: 30 seconds
Queries per connection per minute: 60s / 30s = 2
Total queries per minute: 20 × 2 = 40 queries/min
```

**Result**: 20 connections can handle ~40 tool-using queries per minute.

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
# .env - PostgreSQL pool settings
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
# PostgreSQL (required)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
# Or individual vars:
POSTGRES_USER=policybot
POSTGRES_PASSWORD=your-strong-password
POSTGRES_DB=policybot
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/db/kysely.ts` | Kysely ORM factory, PostgreSQL connection pool, migrations |
| `src/lib/db/compat/*.ts` | Unified async API layer (31 modules) |
| `src/lib/db/utils.ts` | Pure utility functions (validators, constants, slug generators) |
| `src/lib/db/db-types.ts` | TypeScript type definitions for all tables |
| `src/lib/db/schema/postgres.sql` | PostgreSQL schema |
| `src/lib/db/compat/backup-async.ts` | Backup/restore operations |
