# SQLite to Postgres Migration — Issue Tracker (Postgres-Only Strategy)

> **Status:** ✅ **COMPLETED** — Migration executed 2026-03-03. This file is kept as historical reference.
> **Last audited:** 2026-03-03
> **Strategy:** Drop SQLite entirely. Postgres via Kysely is the only database.
> **Architecture:** `src/lib/db/compat/` is Kysely-only (no dual-path branching). Pure utilities in `src/lib/db/utils.ts`.

---

## Strategy Overview

**Previous approach (hybrid):** Compat layer routes every call to SQLite or Postgres based on `DATABASE_PROVIDER` env var — 574 branch points, ~16,000 lines of SQLite delegation code.

**New approach (Postgres-only):** Remove all SQLite code. Compat layer keeps only the Kysely path. Consumer files import from compat and use `await`.

### What this eliminates

| Artifact | Lines / Files | Action |
|----------|---------------|--------|
| 29 SQLite `db/*.ts` files | ~16,600 lines | DELETE |
| `db/index.ts` (SQLite singleton) | ~200 lines | DELETE |
| `db/setup.ts` (SQLite schema init) | ~lines | DELETE |
| `db/schema.sql` (SQLite schema) | ~500 lines | DELETE |
| 574 `if (getDatabaseProvider() === 'sqlite')` branches in compat | ~3,000 lines | STRIP from each compat file |
| `import * as sync from '../xxx'` in each compat file | 30 imports | DELETE |
| `better-sqlite3` + `@types/better-sqlite3` | 2 deps | REMOVE from package.json |
| `DATABASE_PROVIDER` env var | — | No longer needed (always Postgres) |
| **Total code removed** | **~20,000+ lines** | |

### What remains (same work either way)

The core work is **sync-to-async conversion** of 20+ consumer files. This is identical regardless of SQLite or Postgres-only — every consumer must:
1. Change import from `./db/xxx` → `./db/compat/xxx`
2. Add `await` to every call
3. Make containing functions `async` if not already

---

## Prerequisites

### P1: Data Migration Script

Before deploying Postgres-only, export all SQLite data to Postgres.

**Tables to migrate** (from `db/schema.sql`):
- `settings`, `users`, `allowed_users`, `threads`, `messages`, `documents`, `categories`,
  `category_subscriptions`, `thread_categories`, `document_categories`, `skills`,
  `tool_configs`, `tool_routing_rules`, `llm_providers`, `enabled_models`,
  `folder_syncs`, `folder_sync_files`, `function_api_configs`, `data_sources`,
  `agent_bots`, `agent_bot_versions`, `agent_bot_api_keys`, `agent_bot_jobs`,
  `task_plans`, `task_plan_tasks`, `workspaces`, `workspace_users`,
  `workspace_threads`, `workspace_messages`, `workspace_sessions`,
  `thread_uploads`, `thread_summaries`, `user_memories`, `rag_test_results`,
  `reindex_jobs`, `rate_limit_entries`, `compliance_events`, `shares`, `category_prompts`

**Approach:**
1. `sqlite3 data/policy-bot.db .dump > sqlite_dump.sql`
2. Convert SQLite INSERT syntax → Postgres-compatible (or use a CSV export + `\copy`)
3. Load into Postgres (schema already exists via `schema/postgres.sql` + Kysely migrations)
4. Verify row counts match
5. Deploy Postgres-only build

### P2: Verify Postgres Schema Parity

Confirm `schema/postgres.sql` + `kysely.ts` migrations cover every table/column in `db/schema.sql`. Any missing columns → add Kysely migration before cutover.

---

## Phase 0: Strip SQLite from Codebase

**Effort:** ~1 session
**Risk:** Low — mostly deletion. Compat functions already have working Kysely paths.

### 0a. Strip compat layer (30 files)

Every compat file follows this pattern:

```typescript
// BEFORE (dual-path)
import * as sync from '../config';  // ← DELETE this import

export async function getSetting<T>(key, defaultValue?) {
  if (getDatabaseProvider() === 'sqlite') {   // ← DELETE this branch
    return sync.getSetting(key, defaultValue); // ← DELETE
  }                                            // ← DELETE

  const db = await getDb();
  // ... Kysely code stays ...
}
```

```typescript
// AFTER (Postgres-only)
export async function getSetting<T>(key, defaultValue?) {
  const db = await getDb();
  // ... Kysely code stays ...
}
```

**For each of 30 compat files:**
1. Remove `import * as sync from '../xxx'`
2. Remove every `if (getDatabaseProvider() === 'sqlite') { return sync.xxx() }` block
3. Move type re-exports: if types were re-exported from sync modules (e.g., `export type { DbThread } from '../threads'`), move type definitions to `db-types.ts` or keep as local types
4. Remove `getDatabaseProvider` import if no longer used

### 0b. Delete SQLite files

```bash
# Delete all 29 sync SQLite db files
rm src/lib/db/index.ts          # SQLite singleton (getDatabase, queryOne, queryAll, execute, transaction)
rm src/lib/db/setup.ts          # SQLite schema init
rm src/lib/db/schema.sql        # SQLite schema
rm src/lib/db/config.ts         # 1,206 lines
rm src/lib/db/threads.ts        # 649 lines
rm src/lib/db/users.ts          # 569 lines
rm src/lib/db/categories.ts     # 485 lines
rm src/lib/db/documents.ts      # 364 lines
rm src/lib/db/compliance.ts     # 276 lines
rm src/lib/db/sharing.ts        # 365 lines
rm src/lib/db/tool-config.ts    # 670 lines
rm src/lib/db/tool-routing.ts   # 438 lines
rm src/lib/db/enabled-models.ts # 444 lines
rm src/lib/db/llm-providers.ts  # 305 lines
rm src/lib/db/skills.ts         # 698 lines
rm src/lib/db/folder-syncs.ts   # 513 lines
rm src/lib/db/data-sources.ts   # 705 lines
rm src/lib/db/agent-bots.ts     # 510 lines
rm src/lib/db/agent-bot-jobs.ts # 708 lines
rm src/lib/db/agent-bot-api-keys.ts  # 555 lines
rm src/lib/db/agent-bot-versions.ts  # 579 lines
rm src/lib/db/backup.ts         # 2,266 lines
rm src/lib/db/workspaces.ts     # 602 lines
rm src/lib/db/workspace-sessions.ts  # 402 lines
rm src/lib/db/workspace-messages.ts  # 377 lines
rm src/lib/db/workspace-threads.ts   # 375 lines
rm src/lib/db/workspace-users.ts     # 252 lines
rm src/lib/db/task-plans.ts     # 801 lines
rm src/lib/db/category-prompts.ts    # 468 lines
rm src/lib/db/category-tool-config.ts # 262 lines
rm src/lib/db/function-api-config.ts  # 452 lines
rm src/lib/db/rag-testing.ts    # 299 lines
```

### 0c. Clean up kysely.ts

- Remove `getDatabaseProvider()` function (or hardcode to `'postgres'`)
- Remove SQLite fallback connection logic
- Remove `import Database from 'better-sqlite3'`

### 0d. Remove dependencies

```bash
npm uninstall better-sqlite3 @types/better-sqlite3
```

### 0e. Clean up env

- Remove `DATABASE_PROVIDER` from `.env`, `.env.example`, docker-compose files
- Or simply ignore it (no code reads it anymore)

---

## Phase 1: Easy Consumer Fixes (swap import + add `await`)

**Effort:** ~1 session
**Items:** 11 files — all calling functions are already async

| # | File | Change From → To | Call Sites to `await` |
|---|------|------------------|-----------------------|
| 1 | `src/lib/rag.ts:21` | `./db/config` → `./db/compat/config` | `getRagSettings()` ×2, `getAcronymMappings()` ×1 |
| 2 | `src/lib/rag.ts:23` | `./db/categories` → `./db/compat/categories` | `getCategoryIdsBySlugs()` ×1 |
| 3 | `src/lib/openai.ts:5` | `./db/config` → `./db/compat/config` | `getLlmSettings`, `getEmbeddingSettings`, `getLimitsSettings`, `getEffectiveMaxTokens`, `isToolCapableModelFromDb` — ~8 sites |
| 4 | `src/lib/streaming/rag-retrieval.ts:13` | `../db/config` → `../db/compat/config` | `getRagSettings()`, `getAcronymMappings()` — 2 sites |
| 5 | `src/lib/streaming/rag-retrieval.ts:15` | `../db/categories` → `../db/compat/categories` | `getCategoryIdsBySlugs()` ×1 |
| 6 | `src/lib/agent/executor.ts:23` | `../db/categories` → `../db/compat/categories` | `getCategoryBySlug()` ×1 |
| 7 | `src/lib/services/model-discovery.ts:7-8` | `../db/llm-providers`, `../db/enabled-models` → compat equivalents | ~10 call sites |
| 8 | `src/lib/reranker.ts:13` | `./db/config` → `./db/compat/config` | `getRerankerSettings()` ×1 |
| 9 | `src/lib/prompt-optimizer.ts:9` | `./db/config` → `./db/compat/config` | `getLlmSettings()` ×1 |
| 10 | `src/lib/skills/resolver.ts:12` | `../db/config` → `../db/compat/config` | `getSkillsSettings()` ×1 |
| 11 | `src/lib/document-extractor.ts:10` | `./db/config` → `./db/compat/config` | `getOcrSettings()` ×1 |

**Fix pattern:**
```diff
- import { getRagSettings } from './db/config';
+ import { getRagSettings } from './db/compat/config';
  // In the async function body:
- const settings = getRagSettings();
+ const settings = await getRagSettings();
```

---

## Phase 2: Moderate Consumer Fixes (make 1-2 functions async)

**Effort:** ~1 session
**Items:** 4 files — need to convert a sync function to async + update limited callers

| # | File | What Changes | Callers to Update | Route Impact |
|---|------|-------------|-------------------|--------------|
| 1 | `src/lib/ingest.ts:17` | `createSplitter()` sync → async; import from compat | `chunkText()` already async | 15 routes |
| 2 | `src/lib/threads.ts:21,42` | Import 15+ functions from `./db/compat/threads` + `./db/compat/config`; make all wrapper functions async | 11 API route files need `await` added | 11 routes |
| 3 | `src/lib/workspace/validator.ts:8-9` | Import from `../db/compat/workspaces` + `../db/compat/config`; make `isWorkspacesFeatureEnabled()` + `validateWorkspaceRequest()` async | 15 API route files need `await` added | 15 routes |
| 4 | `src/lib/agent/budget-tracker.ts:11` | Import from `../db/compat/config`; make `getGlobalBudgetSettings()` async | Limited callers in agent executor | Low |

---

## Phase 3: Hard Consumer Fixes (deep sync chains)

**Effort:** 2-3 sessions
**Items:** 8 files — sync functions used deep in call chains, many callers

**Fix order matters** — start with the most-imported files:

| # | File | What Changes | Why Hard | Route Impact |
|---|------|-------------|----------|--------------|
| 1 | `src/lib/provider-helpers.ts:31` | `getApiKey()`, `getApiBase()` → async from `./db/compat/llm-providers` | Used **everywhere** in provider pipeline; every downstream caller must become async | CRITICAL — every LLM call |
| 2 | `src/lib/llm-fallback.ts:9-10` | `buildModelsToTry()`, `markModelUnhealthy()` → async from compat | Critical fallback system, deeply embedded | 3 routes |
| 3 | `src/lib/tools.ts:20` | `isToolEnabled`, `ensureToolConfigsExist`, `getDescriptionOverride` → async from compat | Woven into tool pipeline | 13 routes |
| 4 | `src/lib/tool-routing.ts:8` | `resolveToolRouting()` → async from compat | Used in tool execution pipeline | 1 route (+ indirect) |
| 5 | `src/lib/vector-store/qdrant.ts:11` | `getVectorSize()` → async from compat | Sync init pattern — needs lazy async init | Indirect |
| 6 | `src/lib/reindex-job.ts:9` | `getEmbeddingSettings`, `setEmbeddingSettings` → async from compat | Also needs Phase 4 rewrite for raw SQL | 2 routes |
| 7 | `src/lib/memory.ts:9-10` | `getMemorySettings`, `getLlmSettings` → async from compat | Also needs Phase 4 rewrite for raw SQL | 4 routes |
| 8 | `src/lib/summarization.ts:9` | `getSummarizationSettings`, `getLlmSettings` → async from compat | Also needs Phase 4 rewrite for raw SQL | 6 routes |

---

## Phase 4: Raw SQLite Consumer Rewrites

**Effort:** 2-3 sessions
**Items:** 7 files that import `queryOne`/`queryAll`/`execute`/`getDatabase` directly

These files bypass the compat layer entirely. They need their raw SQL rewritten as Kysely queries, either inline or via new/existing compat functions.

**Priority order by blast radius:**

| # | File | Raw SQL Functions | What to Do | Route Impact |
|---|------|-------------------|-----------|--------------|
| 1 | `src/lib/users.ts` | `getDatabase()` for init + mutations via `db/users` | Rewrite to import all functions from `db/compat/users`; remove `ensureInitialized` (Kysely handles it) | **30 routes** |
| 2 | `src/lib/summarization.ts` | `execute`, `queryOne`, `queryAll`, `transaction` | Write Kysely queries in compat or rewrite inline; all functions async | 6 routes |
| 3 | `src/lib/memory.ts` | `execute`, `queryOne`, `queryAll` | Write Kysely queries in compat or rewrite inline | 4 routes |
| 4 | `src/lib/workspace/rate-limiter.ts` | `queryOne`, `execute`, `transaction` + sync imports from `db/workspaces`, `db/workspace-sessions` | Rewrite to use `db/compat/workspaces` + `db/compat/workspace-sessions` + Kysely for rate limit table | 3 routes |
| 5 | `src/lib/monitoring.ts` | `queryOne`, `queryAll` | Rewrite stat queries as Kysely; may need new `db/compat/monitoring.ts` | 1 route |
| 6 | `src/lib/reindex-job.ts` | `execute`, `queryOne`, `queryAll` | Rewrite job CRUD as Kysely; may need new `db/compat/reindex-jobs.ts` | 2 routes |
| 7 | `src/lib/agent/budget-tracker.ts` | `queryAll` | Rewrite budget queries as Kysely | Autonomous agent |

**For files needing new compat modules** (monitoring, reindex-job, budget-tracker): create Kysely query files in `db/compat/` following the existing pattern (now simpler — no dual-path branching needed).

---

## Phase 5: Compat Layer Bug Fixes

**Can be done in parallel with any phase.**

| # | File | Issue | Severity | Fix |
|---|------|-------|----------|-----|
| 1 | `db/compat/compliance.ts` | SQL LIKE injection: `'%${filters.skillId}%'` string interpolation | HIGH | Use `sql.lit` or parameterized LIKE |
| 2 | `db/compat/categories.ts` | `bulkSubscribeUsers` catch silences ALL errors | LOW | Only silence unique constraint violations |
| 3 | `db/compat/tool-routing.ts` | `JSON.parse()` without try-catch on DB fields | MEDIUM | Wrap in try-catch with fallback |
| 4 | `db/compat/tool-routing.ts` | `updated_at = new Date()` — verify Kysely handles Date for timestamptz | LOW | Test or use `.toISOString()` |
| 5 | 10+ compat files | `as unknown as <Type>` casts bypass TypeScript safety | MEDIUM | Replace with Kysely type inference |

---

## Revised Effort Estimate

| Phase | Effort | Hybrid (old) | Postgres-only (new) |
|-------|--------|-------------|---------------------|
| **Phase 0** (strip SQLite) | ~1 session | N/A | Delete ~20,000 lines, strip 574 branches |
| **Phase 1** (easy swaps) | ~1 session | Same | Same — but compat functions are simpler |
| **Phase 2** (moderate async) | ~1 session | Same | Same |
| **Phase 3** (hard async) | 2-3 sessions | Same | Same |
| **Phase 4** (raw SQL rewrites) | 2-3 sessions | Needed new compat with dual-path | **Easier** — Kysely-only, no SQLite path |
| **Phase 5** (bug fixes) | ~0.5 session | Same | Same |
| **Testing** | Per phase | Test both SQLite AND Postgres | **Test Postgres only** |
| **Total** | **7-10 sessions** | | ~30% less testing overhead |

---

## Verification Checklist

After each phase, verify:

- [ ] `npx tsc --noEmit` passes clean
- [ ] No remaining `import ... from '../db/index'` or `from './db'` outside `src/lib/db/`
- [ ] No remaining `import ... from './db/config'` (should all be `./db/compat/config`)
- [ ] No remaining `import ... from './db/categories'`, `./db/llm-providers`, etc. (should be compat)
- [ ] No remaining `queryOne`/`queryAll`/`execute`/`getDatabase` imports anywhere
- [ ] No remaining `getDatabaseProvider()` calls or `DATABASE_PROVIDER` env reads
- [ ] No `better-sqlite3` in `node_modules` or `package.json`
- [ ] App starts and functions with Postgres connection only

### Grep commands to check progress

```bash
# Any SQLite remnants
grep -rn "better-sqlite3" src/ --include="*.ts"
grep -rn "getDatabase\(\)" src/ --include="*.ts"
grep -rn "getDatabaseProvider" src/ --include="*.ts"
grep -rn "queryOne\|queryAll\|execute" src/lib/ --include="*.ts" | grep "from ['\"]" | grep -v "db/compat" | grep -v "db/kysely" | grep -v "node_modules"

# Sync db imports that should be compat
grep -rn "from ['\"]\.\.*/db/config['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
grep -rn "from ['\"]\.\.*/db/categories['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
grep -rn "from ['\"]\.\.*/db/threads['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
grep -rn "from ['\"]\.\.*/db/users['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
grep -rn "from ['\"]\.\.*/db/llm-providers['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
grep -rn "from ['\"]\.\.*/db/enabled-models['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
grep -rn "from ['\"]\.\.*/db/tool-config['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
grep -rn "from ['\"]\.\.*/db/tool-routing['\"]" src/lib/ --include="*.ts" | grep -v "src/lib/db/"
```

---

## TIER 4: API Routes Affected by SQLite Dependencies

These API routes don't import SQLite directly — they import library files from Phases 1-4 that use SQLite internally. Every route listed here will **read stale SQLite data or fail** until its upstream library is migrated.

### Routes depending on `@/lib/users` (Phase 4, #1) — 30 routes

All admin/superuser auth checks call `getUserRole()` or `getUserId()` which flows through SQLite.

| Route | Functions Used |
|-------|---------------|
| `src/app/api/admin/stats/route.ts` | `getUserId` |
| `src/app/api/admin/users/route.ts` | `getAllowedUsers`, `addAllowedUser`, `removeAllowedUser`, `updateUserRole`, `getUserId` |
| `src/app/api/admin/rag-testing/run/route.ts` | `getUserRole` |
| `src/app/api/admin/rag-testing/results/route.ts` | `getUserRole` |
| `src/app/api/admin/documents/[docId]/download/route.ts` | `getUserRole` |
| `src/app/api/admin/tools/dependencies/route.ts` | `getUserRole` |
| `src/app/api/admin/reindex/route.ts` | via `provider-helpers` |
| `src/app/api/superuser/categories/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/backup/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/stats/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/users/route.ts` | `getUserRole`, `getUserId`, `addAllowedUser` |
| `src/app/api/superuser/tools/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/tools/[toolName]/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/agent-bots/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/workspaces/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/workspaces/[id]/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/workspaces/[id]/script/route.ts` | `getUserRole` |
| `src/app/api/superuser/data-sources/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/data-sources/[id]/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/data-sources/[id]/test/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/data-sources/upload-csv/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/data-sources/parse-openapi/route.ts` | `getUserRole` |
| `src/app/api/superuser/documents/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/documents/url/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/documents/text/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/documents/folder/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/documents/folders/route.ts` | `getUserRole` |
| `src/app/api/superuser/documents/folders/[syncId]/route.ts` | `getUserRole` |
| `src/app/api/superuser/documents/[docId]/route.ts` | `getUserRole`, `getUserId` |
| `src/app/api/superuser/documents/[docId]/download/route.ts` | `getUserRole`, `getUserId` |

### Routes depending on `@/lib/threads` (Phase 2, #2) — 11 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/chat/route.ts` | `getThread`, `addMessage`, `getMessages`, `getUploadPaths`, `getThreadCategorySlugsForQuery` |
| `src/app/api/chat/stream/route.ts` | `getThread`, `addMessage`, `getMessages`, `getUploadDetails`, `getThreadCategorySlugsForQuery` |
| `src/app/api/threads/route.ts` | `createThread`, `listThreads` |
| `src/app/api/threads/[threadId]/route.ts` | `getThread`, `deleteThread`, `updateThreadTitle`, `setThreadCategories` |
| `src/app/api/threads/[threadId]/model/route.ts` | `getThread` |
| `src/app/api/threads/[threadId]/pin/route.ts` | `toggleThreadPin` |
| `src/app/api/threads/[threadId]/upload/route.ts` | `saveUpload`, `deleteUpload`, `getThread`, `getThreadUploadCount` |
| `src/app/api/threads/[threadId]/export/route.ts` | `getThread` |
| `src/app/api/threads/[threadId]/summary/route.ts` | via summarization |
| `src/app/api/threads/[threadId]/archived/route.ts` | via summarization |
| `src/app/api/threads/[threadId]/share/route.ts` | via tools |

### Routes depending on `@/lib/memory` (Phase 4, #3) — 4 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/user/memory/route.ts` | `getMemoryForUser`, `updateMemory`, `clearMemory`, `getAllMemoriesForUser` |
| `src/app/api/chat/route.ts` | `getMemoryContext`, `processConversationForMemory`, `extractMemoryFromConversation` |
| `src/app/api/chat/stream/route.ts` | `getMemoryContext`, `processConversationForMemory` |
| `src/app/api/admin/memory/stats/route.ts` | `getMemoryStats` |

### Routes depending on `@/lib/summarization` (Phase 4, #2) — 6 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/chat/route.ts` | `countTokens`, `updateThreadTokenCount`, `shouldSummarize`, `summarizeThread`, `getThreadSummary`, `formatSummaryForContext` |
| `src/app/api/chat/stream/route.ts` | `countTokens`, `updateThreadTokenCount`, `shouldSummarize`, `summarizeThread`, `getThreadSummary`, `formatSummaryForContext` |
| `src/app/api/admin/summarization/stats/route.ts` | `getSummarizationStats` |
| `src/app/api/threads/[threadId]/summary/route.ts` | `getThreadSummary`, `getThreadSummaryHistory` |
| `src/app/api/threads/[threadId]/archived/route.ts` | `getArchivedMessages` |
| `src/app/api/w/[slug]/chat/stream/route.ts` | `countTokens` |

### Routes depending on `@/lib/monitoring` (Phase 4, #5) — 1 route

| Route | Functions Used |
|-------|---------------|
| `src/app/api/admin/stats/route.ts` | `getDatabaseStats`, `getDocumentStats`, `getThreadStats`, `getUserStats`, `getMessageStats`, `getModelUsageStats` |

### Routes depending on `@/lib/reindex-job` (Phase 4, #6) — 2 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/admin/reindex/route.ts` | `createReindexJob`, `getActiveReindexJob`, `getAllReindexJobs`, `processReindexJob` |
| `src/app/api/admin/reindex/[jobId]/route.ts` | `getReindexJob`, `cancelReindexJob` |

### Routes depending on `@/lib/workspace/rate-limiter` (Phase 4, #4) — 3 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/w/[slug]/chat/stream/route.ts` | `checkRateLimit`, `getRateLimitHeaders`, `recordMessage` |
| `src/app/api/w/[slug]/init/route.ts` | `checkRateLimit`, `getRateLimitHeaders` |
| `src/app/api/w/[slug]/upload/route.ts` | `checkRateLimit`, `getRateLimitHeaders` |

### Routes depending on `@/lib/workspace/validator` (Phase 2, #3) — 15 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/w/[slug]/chat/stream/route.ts` | `validateWorkspaceRequest`, `extractOrigin`, `isWorkspacesFeatureEnabled` |
| `src/app/api/w/[slug]/init/route.ts` | `validateWorkspaceRequest`, `extractOrigin`, `isWorkspacesFeatureEnabled` |
| `src/app/api/w/[slug]/upload/route.ts` | `validateWorkspaceRequest`, `extractOrigin` |
| `src/app/api/w/[slug]/session/export/route.ts` | `validateWorkspaceRequest`, `extractOrigin` |
| `src/app/api/w/[slug]/threads/route.ts` | `validateWorkspaceRequest`, `extractOrigin`, `isWorkspacesFeatureEnabled` |
| `src/app/api/w/[slug]/threads/[threadId]/route.ts` | `validateWorkspaceRequest`, `extractOrigin` |
| `src/app/api/w/[slug]/threads/[threadId]/export/route.ts` | `validateWorkspaceRequest`, `extractOrigin` |
| `src/app/api/admin/workspaces/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/admin/workspaces/[id]/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/admin/workspaces/[id]/analytics/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/admin/workspaces/[id]/script/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/admin/workspaces/[id]/users/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/admin/workspaces/[id]/users/[userId]/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/superuser/workspaces/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/superuser/workspaces/[id]/route.ts` | `isWorkspacesFeatureEnabled` |
| `src/app/api/superuser/workspaces/[id]/script/route.ts` | `isWorkspacesFeatureEnabled` |

### Routes depending on `@/lib/tools` (Phase 3, #3) — 13 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/chat/stream/route.ts` | `isToolEnabled` |
| `src/app/api/chat/export/route.ts` | `executeTool`, `isToolEnabled`, `initializeTools` |
| `src/app/api/chat/languages/route.ts` | `isToolEnabled` |
| `src/app/api/shares/[shareId]/route.ts` | `isToolEnabled` |
| `src/app/api/shared/[token]/route.ts` | `isToolEnabled` |
| `src/app/api/shared/[token]/download/[type]/[id]/route.ts` | `isToolEnabled` |
| `src/app/api/threads/[threadId]/share/route.ts` | `isToolEnabled` |
| `src/app/api/tools/status/route.ts` | `isToolEnabled` |
| `src/app/api/admin/tools/route.ts` | `getAllTools`, `initializeTools` |
| `src/app/api/admin/tools/[toolName]/route.ts` | `getTool`, `validateToolConfig`, `initializeTools` |
| `src/app/api/admin/tools/[toolName]/test/route.ts` | `getTool`, `initializeTools` |
| `src/app/api/superuser/tools/route.ts` | `getAllTools`, `initializeTools` |
| `src/app/api/superuser/tools/[toolName]/route.ts` | `getTool`, `initializeTools` |

### Routes depending on `@/lib/openai` (Phase 1, #3) — 7 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/chat/stream/route.ts` | `generateResponseWithTools` |
| `src/app/api/w/[slug]/chat/stream/route.ts` | `generateResponseWithTools` |
| `src/app/api/transcribe/route.ts` | `transcribeAudio` |
| `src/app/api/admin/rag-testing/run/route.ts` | `createEmbedding` |
| `src/app/api/admin/settings/route.ts` | `wasFallbackUsedRecently`, `clearFallbackEvents` |
| `src/app/api/superuser/tools/route.ts` | `TERMINAL_TOOLS` |
| `src/app/api/admin/tools/route.ts` | `TERMINAL_TOOLS` |

### Routes depending on `@/lib/llm-fallback` (Phase 3, #2) — 3 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/chat/route.ts` | `buildModelsToTry`, `markModelUnhealthy`, `handleModelFallback` |
| `src/app/api/chat/stream/route.ts` | `buildModelsToTry`, `markModelUnhealthy`, `handleModelFallback` |
| `src/app/api/admin/settings/llm-fallback/route.ts` | `getFallbackConfig`, `updateFallbackConfig`, `clearFallbackEvents` |

### Routes depending on `@/lib/provider-helpers` (Phase 3, #1) — 2 routes (+ indirect)

| Route | Functions Used |
|-------|---------------|
| `src/app/api/admin/settings/route.ts` | `isProviderConfigured` |
| `src/app/api/admin/reindex/route.ts` | `isProviderConfigured` |

### Routes depending on `@/lib/tool-routing` (Phase 3, #4) — 1 route

| Route | Functions Used |
|-------|---------------|
| `src/app/api/admin/tool-routing/test/route.ts` | `testToolRouting` |

### Routes depending on `@/lib/ingest` (Phase 2, #1) — 15 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/admin/documents/route.ts` | `listGlobalDocuments`, `ingestDocument` |
| `src/app/api/admin/documents/text/route.ts` | `listGlobalDocuments`, `ingestTextContent` |
| `src/app/api/admin/documents/url/route.ts` | `ingestUrls`, `ingestYouTubeUrl`, `getUrlIngestionStatus`, `ingestCrawledSite` |
| `src/app/api/admin/documents/folder/route.ts` | `ingestDocument` |
| `src/app/api/admin/documents/folders/[syncId]/route.ts` | `ingestDocument` |
| `src/app/api/admin/documents/[docId]/route.ts` | `deleteDocument`, `reindexDocument`, `updateDocumentCategories`, `toggleDocumentGlobal` |
| `src/app/api/admin/refresh/route.ts` | `listGlobalDocuments`, `reindexDocument` |
| `src/app/api/admin/categories/[id]/route.ts` | `deleteDocument` |
| `src/app/api/superuser/categories/route.ts` | `deleteDocument` |
| `src/app/api/superuser/documents/route.ts` | `ingestDocument` |
| `src/app/api/superuser/documents/url/route.ts` | `ingestUrls`, `ingestYouTubeUrl`, `getUrlIngestionStatus`, `ingestCrawledSite` |
| `src/app/api/superuser/documents/text/route.ts` | `ingestTextContent` |
| `src/app/api/superuser/documents/folder/route.ts` | `ingestDocument` |
| `src/app/api/superuser/documents/folders/[syncId]/route.ts` | `ingestDocument` |
| `src/app/api/superuser/documents/[docId]/route.ts` | `deleteDocument` |

### Routes depending on `@/lib/services/model-discovery` (Phase 1, #7) — 2 routes

| Route | Functions Used |
|-------|---------------|
| `src/app/api/admin/llm/discover/route.ts` | `discoverModels`, `discoverAllModels` |
| `src/app/api/admin/llm/providers/[id]/test/route.ts` | `testProviderConnection` |

---

## Impact Summary

| Library File (Phase) | API Routes Affected | Blast Radius |
|----------------------|---------------------|--------------|
| `users.ts` (P4 #1) | **30** | CRITICAL — every admin/superuser route |
| `workspace/validator.ts` (P2 #3) | **15** | HIGH — all workspace routes |
| `ingest.ts` (P2 #1) | **15** | HIGH — all document operations |
| `tools.ts` (P3 #3) | **13** | HIGH — tool enable/disable checks |
| `threads.ts` (P2 #2) | **11** | HIGH — all chat & thread routes |
| `openai.ts` (P1 #3) | **7** | HIGH — core LLM generation |
| `summarization.ts` (P4 #2) | **6** | MEDIUM — summarization features |
| `memory.ts` (P4 #3) | **4** | MEDIUM — memory features |
| `llm-fallback.ts` (P3 #2) | **3** | HIGH — core fallback system |
| `workspace/rate-limiter.ts` (P4 #4) | **3** | MEDIUM — workspace embed mode |
| `provider-helpers.ts` (P3 #1) | **2** (+ indirect) | CRITICAL — every LLM call |
| `reindex-job.ts` (P4 #6) | **2** | LOW — reindex operations |
| `model-discovery.ts` (P1 #7) | **2** | LOW — admin model discovery |
| `monitoring.ts` (P4 #5) | **1** | LOW — admin stats only |
| `tool-routing.ts` (P3 #4) | **1** | LOW — routing test only |
| `rag.ts` (P1 #1-2) | **1** (+ indirect) | HIGH — core RAG pipeline |

**Total unique API routes affected: ~70+ routes** (some routes depend on multiple SQLite-backed libraries)
