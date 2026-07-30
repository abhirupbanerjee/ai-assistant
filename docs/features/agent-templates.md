# Agent Templates

## Overview

Agent templates are pre-seeded, category-agnostic agents in the Agent Registry that provide domain-specialized execution and review capabilities. They are exposed as OpenAI function tools via the `agent__<id>` naming convention, allowing the LLM to delegate tasks to specialized sub-agents.

## Template Catalog (12 templates)

| ID | Name | Role | Tools | Model |
|---|---|---|---|---|
| `tpl-planner` | Planner (template) | planner | — | default |
| `tpl-executor` | Executor (template) | executor | — | default |
| `tpl-critic` | Critic (template) | critic | — | default |
| `tpl-researcher` | Researcher (template) | researcher | web_search, web_extract, kb_summary, kb_search, kb_read, website_analysis, load_testing | default |
| `tpl-presenter` | Presenter (template) | presenter | diagram_gen | default |
| `tpl-code-executor` | Code Executor (template) | executor | code_analysis, diagram_gen | default |
| `tpl-code-critic` | Code Critic (template) | critic | — | default |
| `tpl-doc-executor` | Document Executor (template) | executor | doc_gen, chart_gen | default |
| `tpl-doc-critic` | Document Critic (template) | critic | — | default |
| `tpl-data-executor` | Data Analyst Executor (template) | executor | xlsx_gen, aggregate_data, chart_gen | default |
| `tpl-pptx-executor` | Presentation Executor (template) | executor | pptx_gen, image_gen, chart_gen | default |
| `tpl-site-executor` | Web Builder Executor (template) | executor | site_gen, html_gen, website_analysis | default |

## Best Practices

### 1. Allowlist = Intersection, Not Denylist

An empty `toolAllowlist` (`[]`) means the agent has **zero tools**. List only the tools the agent should autonomously invoke. The invoker enforces this as an intersection: every `AVAILABLE_TOOLS` key not in the allowlist is excluded. See [`invoker.ts:304`](../src/lib/agent-registry/invoker.ts:304).

### 2. Prefer Focused Executors (2–4 Tools)

More tools dilute LLM selection accuracy. Each executor should target a specific deliverable type:
- **Code Executor:** `code_analysis` + `diagram_gen`
- **Document Executor:** `doc_gen` + `chart_gen`
- **Data Executor:** `xlsx_gen` + `aggregate_data` + `chart_gen`

### 3. Pair Heavy Tools With a Bound Model

Tools marked `subagentSafe: false` (heavy artifact generators like `doc_gen`, `pptx_gen`, `site_gen`, `html_gen`, `xlsx_gen`, `image_gen`, `podcast_gen`) need a capable model. When adding these tools to an agent's allowlist:

- Bind a specific `model_id` that satisfies the tool's `modelRequirements` (large context window, instruction following, code quality).
- The admin UI shows warnings when heavy tools are selected without a bound model.
- Tools with `subagentSafe: null` (youtube, share_thread, send_email, compliance_checker) have no safety opinion — treat as neutral.

### 4. System Prompts: Name the Deliverable, Tools, and Quality Gate

The auto-generated tool description from [`buildToolDefinition()`](../src/lib/agent-registry/agent-tools.ts:117) handles LLM discovery. The system prompt handles execution quality. Each prompt should:

1. **Name the role and deliverable type** (e.g., "You are a Code Executor. You produce a code-quality analysis artifact.")
2. **List tool usage** (e.g., "Use code_analysis for SonarCloud metrics, diagram_gen for architecture visuals.")
3. **Set a quality gate** (e.g., "Confidence < 0.7 if metrics are stale.")
4. **Reference the output contract** — the JSON envelope enforced by [`invoker.ts:121`](../src/lib/agent-registry/invoker.ts:121).

### 5. Every Executor Gets a Paired Critic

Critics are domain-specific, not generic:
- **Code Critic** reviews security hotspots, false-positive severity, architecture context.
- **Document Critic** reviews structural completeness, unsupported claims, chart-text alignment.
- **Generic Critic** (`tpl-critic`) serves as fallback for uncategorized executors.

### 6. Global vs. Category-Scoped Templates

- **Global templates** (`category_id = NULL`) are available in all categories.
- **Category-scoped agents** (`category_id` set) only appear in their assigned category.
- Both coexist via [`getAgentsForCategory()`](../src/lib/db/compat/agents.ts:128), which returns category agents first, then global templates.

### 7. MAX_AGENT_TOOLS Cap

[`MAX_AGENT_TOOLS = 12`](../src/lib/agent-registry/agent-tools.ts:41) caps how many agent-tools appear in a single request. With 12 global templates, we're at the limit. Use category scoping for domain specialists to avoid exceeding the cap per-request.

### 8. Idempotent Seeds

All template seeds use `ON CONFLICT (id) DO NOTHING` (Postgres) or `INSERT OR IGNORE` (SQLite). Additive backfills use containment checks (`@>` for Postgres, `LIKE` for SQLite) to avoid duplicate entries. Pattern: [`kysely.ts:1151`](../src/lib/db/kysely.ts:1151).

### 9. Output JSON Envelope

The invoker enforces a JSON contract envelope at [`invoker.ts:121`](../src/lib/agent-registry/invoker.ts:121). System prompts should reference it ("Return an artifact, a confidence score (0-1), and a suggested_next action") but not redefine it.

### 10. Verification

- `npm run type-check && npm run lint` (no automated test suite exists per [`AGENTS.md`](../AGENTS.md)).
- Manual smoke tests: Admin UI → Agent Registry → verify templates load with correct allowlists; chat → verify `agent__tpl-*` tools appear.

## Tool Allowlist Composition Guide

| Tool | subagentSafe | Best Paired With | Model Needs |
|---|---|---|---|
| `web_search` | ✅ safe | Researcher | large context |
| `web_extract` | ✅ safe | Researcher | large context |
| `web_crawl` | ✅ safe | Researcher | large context |
| `web_map` | ✅ safe | Researcher | — |
| `website_analysis` | ✅ safe | Researcher, Site Executor | large context |
| `load_testing` | ✅ safe | Researcher, Perf Executor | — |
| `kb_summary` | ✅ safe | Researcher | — |
| `kb_search` | ✅ safe | Researcher | large context |
| `kb_read` | ✅ safe | Researcher | large context |
| `code_analysis` | ✅ safe | Code Executor | 32k context, code-quality |
| `diagram_gen` | ✅ safe | Code Executor | code-quality |
| `chart_gen` | ✅ safe | Data/Doc/PPTX Executor | — |
| `doc_gen` | ❌ heavy | Doc Executor | large context, instr-following |
| `pptx_gen` | ❌ heavy | PPTX Executor | large context, instr-following |
| `html_gen` | ❌ heavy | Site Executor | large context, code-quality |
| `site_gen` | ❌ heavy | Site Executor | large context, code-quality |
| `xlsx_gen` | ❌ heavy | Data Executor | code-quality |
| `aggregate_data` | ❌ heavy | Data Executor | — |
| `image_gen` | ❌ heavy | PPTX Executor | — |
| `podcast_gen` | ❌ heavy | Podcast Executor | — |
| `file_to_html` | ❌ heavy | — | large context |
| `data_source` | ❌ heavy | — | — |
| `function_api` | ❌ heavy | — | — |
| `translation` | ✅ safe | Translation Executor | — |
| `youtube` | — (unset) | — | — |
| `share_thread` | — (unset) | — | — |
| `send_email` | — (unset) | — | — |
| `compliance_checker` | — (unset) | Compliance Executor | — |
| `handoff_to_category` | ✅ safe | — | — |

## Model Binding Guidance

When creating or editing an agent:

1. **Heavy tools** (`subagentSafe: false`) — bind a specific model with sufficient context window and instruction-following capability.
2. **32k context tools** (`code_analysis`) — bind a model with `max_input_tokens >= 32000`.
3. **Code-quality tools** (`code_analysis`, `diagram_gen`, `xlsx_gen`, `html_gen`, `site_gen`) — bind a model with strong code generation capability.
4. **Instruction-following tools** (`doc_gen`, `pptx_gen`) — bind a model that reliably follows complex formatting instructions.

The admin UI and API both provide soft warnings when tool requirements may exceed the bound model's capabilities. These are guidance, not hard blocks.
