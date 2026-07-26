# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## 0.2.1 — 2026-07-26

### Major: Terminal-tool multi-artifact summary fix (collapsible-card UX)

Replaces the per-terminal-turn LLM summary call with a deterministic one-line
status marker and collapsible artifact cards. Eliminates a redundant LLM
completion per terminal turn — a cost that compounds across nested agent loops
(0.2.0 return-result routing) and the future Phase 3 swarm Executor pool, since
they all reuse [`generateResponseWithTools`](src/lib/openai.ts).

### Added

- **`CollapsibleArtifactCard`** ([`src/components/chat/CollapsibleArtifactCard.tsx`](src/components/chat/CollapsibleArtifactCard.tsx)) — reusable collapsible wrapper mirroring the `AgentResponseCard` pattern (chevron toggle, per-kind icon + accent, title/subtitle, `i / N` position badge). Wraps document, image, podcast, diagram, and visualization artifacts in [`MessageBubble.tsx`](src/components/chat/MessageBubble.tsx).
- **`pptx_gen` and `xlsx_gen` added to `TERMINAL_TOOLS`** ([`src/lib/openai.ts`](src/lib/openai.ts:189)) — closes a doc/code drift where the set listed only 8 of the 10 terminal tools.
- **Status marker persistence** — the one-line marker (`Tool run completed — N artifacts generated below.`) is streamed via `onChunk` and persisted into `responseMessage.content`, so shared threads, history, and the embed client always show a textual anchor and the assistant bubble is never empty.

### Changed

- **Terminal-turn summary LLM call removed** ([`src/lib/openai.ts`](src/lib/openai.ts:2841)) — the post-loop block no longer dispatches a follow-up completion (Anthropic/Mistral/Gemini/OpenAI branches all deleted). Instead it streams a deterministic status line and lets the artifact cards carry metadata. Mirrors the `handoff_to_category` "terminal-stop without summary" precedent.
- **`terminalToolResult` scalar → `terminalToolResults` array** ([`src/lib/openai.ts`](src/lib/openai.ts:2216)) — the scalar was overwritten on each success, so the old summary named only the last artifact. The array retains every successful terminal tool result; the status line reports the correct count.
- **Translation and compliance guards on empty content** ([`src/app/api/chat/stream/route.ts`](src/app/api/chat/stream/route.ts:810)) — both blocks now skip when `fullContent.trim()` is empty, so pure-artifact turns don't trigger spurious translation/compliance LLM calls.
- **Agent contract preamble strengthened** ([`src/lib/agent-registry/invoker.ts`](src/lib/agent-registry/invoker.ts:117)) — agents are now instructed to always return the JSON contract envelope even when tools produced artifacts, using the `file_ref` artifact type with a human-readable description. Keeps return-result routing consistent with the no-summary flow.
- **Collapsible cards: collapsed for 2+ artifacts, expanded for 1** — per approved UX default.

### Fixed

- **Multi-artifact summary named only the last artifact** — root cause was the scalar `terminalToolResult` overwrite; now fixed by the array and the count-based status marker.
- **Empty assistant bubble on pure-artifact turns** — solved by the persisted status line plus a `suppressEmptyProse` guard in [`MessageBubble.tsx`](src/components/chat/MessageBubble.tsx) that hides the empty markdown container when artifacts are present.

### Docs

- **[`docs/features/Tools.md`](docs/features/Tools.md)** — reconciled the terminal-tool table (added `html_gen`, `site_gen`, `file_to_html`), the behavior list, and the implementation snippet; replaced the "Summary Prompt" section with a "Status Marker" section; updated "Step 4: Terminal Tool Setup" in the tool-authoring guide.

### Verification

- `npm run type-check` — exit 0
- `npm run lint` — exit 0
- `npm run build` — compiled successfully, 126 static pages generated
- `npm run eval:routing:mock` — 30/30 passed (solo 10/10, return_result 10/10, handoff 10/10)

### Deployment

No DB migrations required. No environment variable changes. The change is
purely in the tool-loop control flow and frontend rendering. Existing terminal
tools continue to work unchanged; the only observable difference is that
assistant turns ending in a terminal tool now show a one-line status marker
plus collapsible artifact cards instead of a generated summary paragraph.

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
