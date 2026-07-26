# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-07-26

### Major: Agent System — Single-Agent Routing (Phase 1 + Phase 2.2)

This release introduces the foundation of the agent system architecture: a
DB-first agent registry and single-agent routing with three modes (solo,
return-result, handoff). Swarm multi-agent execution, controls enforcement,
and legacy deprecation are deferred to later phases (see
`plans/agent_system_architecture___implementation_plan.md`).

### Added

- **DB-first agent registry** — 5 role families (`planner`, `executor`,
  `critic`, `researcher`, `presenter`), category-scoped, model-bound, and
  tool-allowlisted via the `agent` table. Five global template agents (one
  per role family) are seeded automatically on first DB connection.
- **Three single-agent routing modes**:
  - `solo` — the model answers directly with no agent delegation.
  - `return_result` — agent-as-tool bridge (`agent__<id>` tools); the
    agent's contract envelope is surfaced to the client as a collapsible
    `AgentResponseCard` showing agent name, role family, confidence, and
    suggested-next.
  - `handoff` — `handoff_to_category` static tool transfers thread
    ownership to a different category, emits a `handoff` SSE event so the
    UI shows a category-change banner, and ends the current turn (the next
    user message continues in the new category's context).
- **Universal agent I/O contract** — every agent returns an `AgentResponse`
  envelope (`{ artifact, confidence, suggestedNext }` with `agentId` +
  `roleFamily`); `agentName` is injected at the tool-executor boundary.
- **Swarm kill switch + force-swarm role allowlist** — `swarm_control`
  table (category-keyed, `NULL` = global) and `force_swarm_role_allowlist`
  table seeded with defaults. Runtime enforcement is Phase 4; this release
  establishes the schema and seed data.
- **Model capability tiers** — `capability_tier` column on `enabled_models`
  (`swarm_full` / `swarm_limited` / `unclassified`), seeded for known
  platform models. Used for swarm-eligibility and role assignment.
- **Skills integration** — `invokeAgent` re-routed through
  `generateResponseWithTools`; the agent's `toolAllowlist` is enforced as
  an intersection via `excludeTools = AVAILABLE_TOOLS \ allowlist`.
  Category skills auto-resolve internally.
- **Routing eval harness** — `eval/routing.ts` with `:mock` (deterministic,
  CI-safe, regression-gated against `eval/baseline.json`) and `:live`
  (real model) modes; 30 labeled cases covering all three routing modes.
  npm scripts: `eval:routing`, `eval:routing:mock`, `eval:routing:live`,
  `eval:routing:update-baseline`.
- **`transferThreadCategory` compat function** — transactional category
  ownership transfer (delete source + idempotent insert target).
- **Admin UI** — `AgentRegistryTab` and `SwarmControlTab` components for
  managing agents and the swarm kill switch.

### Fixed

- **Handoff no longer triggers a spurious summary LLM call** — the
  `handoff_to_category` terminal branch previously set both
  `terminalToolSucceeded` and `terminalToolResult`, causing the post-loop
  summary block to fire an extra LLM completion ("explain what was
  created…") that streamed `chunk` text after the `handoff` SSE event,
  contradicting the "turn ends" semantics. Now only `terminalToolSucceeded`
  is set; `terminalToolResult` stays `null` so the summary guard is false.
- **`onHandoff` no longer silently skips transfer for category-less
  threads** — when a thread had zero attached categories, the transfer was
  skipped but the `handoff` SSE event still fired, so the UI claimed a
  handoff while the DB never moved ownership. Now always calls
  `transferThreadCategory` with a no-op-safe source id.
- **Agent artifact `type` preserves the full union** — the `table` and
  `file_ref` members of `AgentResponseInfo.artifact.type` were previously
  collapsed to `structured`; the narrowing now preserves
  `'text' | 'table' | 'file_ref' | 'structured' | 'error'` so
  `AgentResponseCard` can render them distinctly.
- **Circular-import TDZ in `compliance-checker` unblocked `next build`** —
  `tools.ts` statically imported `complianceCheckerTool` while
  `compliance-checker.ts` imported runtime helpers (`coerceNum`,
  `numInRange`) back from `../tools`, creating a cycle Turbopack's strict
  evaluation surfaced as `ReferenceError: Cannot access 'm' before
  initialization` at page-data collection. Fixed by making the back-import
  `type`-only and inlining the two trivial pure helpers. (This was
  pre-existing on `origin/main` and blocked all builds.)

### Migrations

All idempotent and auto-applied on first DB connection via
`runPostgresMigrations` in `src/lib/db/kysely.ts` — no manual SQL or
`db:setup` step is required:

- `CREATE TABLE IF NOT EXISTS agent` (+ 3 indexes on `category_id`,
  `role_family`, `enabled`)
- `CREATE TABLE IF NOT EXISTS swarm_control` (+ unique index on
  `category_id` + global kill-switch row)
- `CREATE TABLE IF NOT EXISTS force_swarm_role_allowlist` (+ 4 default
  role rows)
- `ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS capability_tier`
- Seed 5 global template agents (one per role family)
- Seed `capability_tier` for known platform models

### Deployment

```bash
git pull
docker compose down
docker compose up -d --build
```

Migrations auto-run on the first request after restart; no `db:setup`
needed (it cannot run inside the production container — multi-stage
standalone build excludes `node_modules`). Back up the DB first:

```bash
docker compose exec -T postgres pg_dump -U policybot policybot \
  > ./data/backup-pre-0.2.0-$(date +%Y%m%d-%H%M).sql
```

### Smoke tests

1. **Solo** — normal chat in a category → direct answer, no agent tool.
2. **Return-result** — trigger an `agent__*` tool call → `AgentResponseCard`
   renders with agent name + confidence.
3. **Handoff** — trigger `handoff_to_category` → category-change banner,
   thread moves to target category, no extra streamed text after the
   banner (verifies the summary-LLM-call fix), next message runs in the
   new category's context.

Verify the migration log lines:

```
docker compose logs app 2>&1 | grep -E '\[Kysely\] (Ensured agent table|Seeded 5 global template agents|Ensured swarm_control|PostgreSQL migrations completed)'
```

---

## 0.1.0 — initial rebranded release

First release under the `ai-assistant` package name (renamed from the
previous project name). See `docs/REBRANDING-2026-07.md` for details.
