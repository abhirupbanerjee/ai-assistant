# Autonomous Mode — Multi-Agent Task Orchestration

> **Audience:** Administrators, power users, developers integrating with Policy Bot  
> **Scope:** Complete guide to autonomous mode configuration, operation, and integration

---

## Table of Contents

1. [Objective](#1-objective)
2. [Sample Use Cases](#2-sample-use-cases)
3. [How to Configure Autonomous Mode](#3-how-to-configure-autonomous-mode)
4. [Autonomous Mode Operation](#4-autonomous-mode-operation)
5. [Streaming Events & External Integration](#5-streaming-events--external-integration)
6. [Plan States & Error Handling](#6-plan-states--error-handling)
7. [Known Issues and Fixes](#7-known-issues-and-fixes)

---

## 1. Objective

**Autonomous Mode** transforms Policy Bot from a single-turn chat assistant into a **multi-agent task orchestration system**. Instead of answering one question at a time, the autonomous agent decomposes complex user requests into structured task plans, executes them iteratively with quality checks, and synthesizes a comprehensive final response.

### Why Autonomous Mode?

| Problem | Autonomous Mode Solution |
|---------|-------------------------|
| User needs a 20-page research report with charts, web search, and document citations | Planner breaks it into 8 tasks; Executor runs them in parallel waves; Summarizer compiles everything |
| LLM forgets earlier context in long conversations | Working memory persists cross-wave summaries into the executor prompt |
| Single tool call is insufficient for complex analysis | Subagent ReAct loops run multi-turn reasoning with up to 15 tool invocations per task |
| Expensive generative tools run without oversight | HITL (Human-in-the-Loop) pauses before doc_gen, image_gen, and other costly operations |
| Unbounded token consumption | Budget tracker enforces hard limits on LLM calls, tokens, web searches, and duration |

### Normal Mode vs Autonomous Mode

| Aspect | Normal Mode | Autonomous Mode |
|--------|-------------|-----------------|
| **Interaction** | Single-turn Q&A | Multi-step plan with progress streaming |
| **Tool calling** | LLM decides tools in one response | Planner pre-assigns tools; Executor runs them with retry logic |
| **Quality control** | None (single shot) | Checker scores confidence (0–100%); retries if < threshold |
| **Budget** | Unbounded per request | Hard caps on calls, tokens, searches, time |
| **Human oversight** | None | Plan-level HITL + tool-level HITL for unsafe operations |
| **Context management** | Thread history only | Working memory injection across waves |
| **Output synthesis** | Direct LLM output | Summarizer compiles all task results into coherent narrative |

### Key Capabilities

- **Plan-and-Execute pipeline** — Planner decomposes requests into DAG-structured tasks
- **Parallel wave execution** — Independent tasks run concurrently; dependent tasks wait
- **Subagent ReAct loops** — Per-task multi-turn reasoning with tool calling
- **Quality checking** — Confidence scoring with automatic retry
- **Budget enforcement** — Global and per-plan limits with live cost tracking
- **Human-in-the-Loop** — Plan approval and unsafe tool approval checkpoints
- **Progressive streaming** — Live SSE updates show task status, confidence, and budget
- **Working memory (beta)** — Cross-wave context persistence without LLM overhead

---

## 2. Sample Use Cases

### Use Case A: Comprehensive Policy Impact Assessment

**Scenario:** A policy analyst needs to assess the economic, environmental, and social impact of a proposed new regulation across multiple jurisdictions.

**User Request:**
> "Assess the impact of proposed carbon pricing legislation on SMEs in Grenada, Barbados, and Trinidad. Include economic modelling, compliance burden analysis, and a comparison with regional best practices. Produce a formal report with charts."

**What Autonomous Mode Does:**

1. **Planner** decomposes into ~10 tasks:
   - Task 1: Research carbon pricing frameworks in target countries
   - Task 2: Research regional best practices (Caricom)
   - Task 3: Identify SME sector composition in each jurisdiction
   - Task 4: Economic modelling — cost pass-through analysis
   - Task 5: Compliance burden assessment
   - Task 6: Comparative analysis matrix
   - Task 7: Generate charts (cost curves, sector impact)
   - Task 8: Synthesize findings into formal report structure
   - Task 9: Generate final DOCX report
   - Task 10: Executive summary

2. **Executor** runs tasks in parallel waves:
   - Wave 1: Tasks 1, 2, 3 (independent research) → `web_search`
   - Wave 2: Tasks 4, 5, 6 (depend on research) → `data_source` + LLM analysis
   - Wave 3: Task 7 (depends on analysis) → `chart_gen`
   - Wave 4: Tasks 8, 9, 10 (depend on all above) → `doc_gen` + summarizer

3. **Checker** validates each task output (confidence scores)
4. **Summarizer** streams incremental sections as they complete
5. **Final output:** Branded DOCX report with embedded charts, source citations, and executive summary

**Estimated Budget:** ~8,000–15,000 tokens, 12–20 LLM calls, 6–10 web searches, 8–15 minutes

---

### Use Case B: IT Systems Consolidation Roadmap

**Scenario:** A government's Digital Transformation Office needs a ranked roadmap for consolidating legacy IT systems across ministries.

**User Request:**
> "Analyse the IT systems portfolio for Ministry of Finance, Ministry of Health, and Ministry of Education. Identify duplication, assess cloud readiness, estimate consolidation cost savings, and produce a PowerPoint presentation with a Gantt chart timeline."

**Planner Tasks:**
- Research each ministry's documented systems (RAG from Enterprise Architecture category)
- Cloud readiness assessment against framework criteria
- Duplication analysis matrix
- Cost-benefit modelling
- Risk assessment per consolidation option
- Generate Gantt chart timeline
- Generate PPTX presentation

**Note:** Tasks referencing `doc_gen`, `image_gen`, `pptx_gen` trigger **tool-level HITL** if subagent mode is enabled, giving the admin a chance to approve before burning budget on generative outputs.

---

### Use Case C: Autonomous Regulatory Monitoring

**Scenario:** A compliance team sets up a scheduled trigger (via external cron + API) to monitor regulatory changes.

**Integration Pattern:**

```bash
# External system triggers autonomous plan via chat API
curl -X POST "https://policybot.gov/api/chat/stream" \
  -H "Cookie: next-auth.session-token=..." \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Monitor this week\u0027s regulatory changes in data protection law across Caricom states. Summarize changes, flag compliance gaps against our current policy, and generate a briefing document.",
    "threadId": "...",
    "mode": "autonomous"
  }'
```

The autonomous agent:
1. Plans 5–6 research and analysis tasks
2. Executes web searches for each jurisdiction
3. Compares findings against uploaded policy documents (RAG)
4. Generates a Markdown briefing
5. Streams progress to the compliance dashboard via SSE

---

## 3. How to Configure Autonomous Mode

### Prerequisites

- **Role:** Admin (full control) or Superuser (read-only settings)
- **Models:** At least one thinking-capable model recommended for Planner (Claude, Gemini 2.5 Pro, DeepSeek-R1, o1/o3)
- **Tools:** Configure desired tools in **Admin → Tools** before the agent can use them

### Master Toggle

1. Navigate to **Admin → Settings → Agent**
2. Toggle **Enable Autonomous Mode**
3. When disabled, the autonomous toggle disappears from the chat UI

### Agent Model Configuration

Configure a dedicated model for each agent role, or set any role to **⚡ Auto** for intelligent per-invocation selection. The fallback chain is: **role-specific model → global default → universal fallback**.

| Role | Recommended Model Type | Purpose |
|------|----------------------|---------|
| **Planner** | Thinking-capable (Claude Sonnet, Gemini 2.5 Pro, o1) or **⚡ Auto** | Task decomposition, reasoning, self-reflection |
| **Executor** | Fast tool-capable model (GPT-4.1, Claude Haiku) or **⚡ Auto** | Tool execution, code generation, subagent loops |
| **Checker** | Fast validation model (GPT-4.1 Mini, Gemini Flash) or **⚡ Auto** | Confidence scoring, quality validation |
| **Summarizer** | Strong synthesis model (GPT-4.1, Claude Sonnet) or **⚡ Auto** | Final output compilation |

> **Auto Model Selection:** When a role is set to **⚡ Auto**, the system picks the best model for that role's specific workload using role-specific scoring dimensions (Planner/Checker/Summarizer → reasoning; Executor → function calling). Auto is disabled for the `local_private` executor profile (air-gapped deployments must stay on Ollama). If Auto selection fails, the global default model is used.

**Executor Profiles:**

The planner can route specific tasks to specialized executor profiles:

| Profile | Use Case |
|---------|----------|
| `fast_low_cost` | Simple lookups, web searches, fact retrieval |
| `deep_reasoning` | Complex analysis, multi-factor evaluation |
| `long_context` | Large document analysis, synthesis across many sources |
| `artifact_generation` | Chart, diagram, document generation tasks |

Configure profiles in **Admin → Settings → Agent → Executor Model Profiles**.

### Budget Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Max LLM Calls** | 500 | Total LLM calls across all active plans |
| **Max Tokens** | 2,000,000 | Total tokens across all active plans |
| **Max Web Searches** | 100 | Total Tavily searches |
| **Max Duration** | 30 min | Wall-clock time limit per plan |
| **Task Timeout** | 5 min | Per-task execution limit |
| **Retry Reserve (calls)** | 10 | Headroom reserved for retries |
| **Retry Reserve (tokens)** | 50,000 | Token headroom for retries |

**Budget Behavior:**
- When budget reaches **50%** → warning logged
- When budget reaches **75%** → high-priority warning; executor may downgrade to `fast_low_cost`
- When budget reaches **100%** → hard stop; pending tasks skipped; partial results returned
- Budget is **global** across all concurrent autonomous plans

### Confidence Threshold

| Setting | Default | Description |
|---------|---------|-------------|
| **Global Threshold** | 80% | Checker auto-approves tasks with confidence ≥ this value |
| **Per-Profile Thresholds** | Optional | Override per executor profile (e.g., `artifact_generation` → 75%) |

Tasks scoring below the threshold are retried once (2 total attempts). If still below threshold, they are marked `needs_review` and execution continues with remaining tasks.

### HITL (Human-in-the-Loop) Configuration

**Plan-Level HITL:**

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable HITL** | `true` | Require user approval before executing planned tasks |
| **Min Tasks for HITL** | 5 | Plans with fewer tasks skip approval automatically |
| **Timeout** | 300 sec | Auto-reject if user does not respond |

When triggered, the user sees a card with:
- Plan title and estimated task count
- Task list with assigned tools
- **Approve**, **Reject**, or **Provide Feedback** options

**Tool-Level HITL (Subagent):**

When subagent mode is enabled, unsafe tools trigger an approval pause within the ReAct loop:

| Safe Tools (auto-approved) | Unsafe Tools (HITL pause) |
|---------------------------|--------------------------|
| `web_search`, `web_extract`, `web_crawl`, `web_map`, `code_analysis`, `data_source` | `doc_gen`, `image_gen`, `chart_gen`, `xlsx_gen`, `pptx_gen`, `podcast_gen`, `diagram_gen` |

Users can **Approve**, **Deny**, or **Modify Arguments** before the tool executes.

### Subagent Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Subagent Mode** | `false` | Master toggle for ReAct subagent loops |
| **Default Tasks to Subagent** | `false` | Planner marks tasks as `subagent_enabled` by default |
| **Max Iterations** | 15 | ReAct loop ceiling (1–30) |
| **Budget Allocation** | 25% | Percentage of plan budget per subagent task |
| **Require HITL for Unsafe Tools** | `true` | Pause before generative/costly tools in subagent loop |

**When to enable subagent mode:**
- Tasks requiring iterative reasoning ("search for X, then analyse Y, then compare with Z")
- Multi-step data extraction and transformation
- Complex research where the LLM needs to refine queries based on intermediate findings

### Working Memory (Beta)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Working Memory** | `false` | Cross-wave context persistence |

When enabled:
1. After each wave, a deterministic summary (≤500 chars) of completed tasks is saved to the `plan_memories` table
2. Before the next wave, the last 2 waves of summaries (≤1500 chars) are injected into the executor prompt as `[Previous Waves Summary]`
3. Keyword extraction is heuristic (frequency-based regex) — no LLM or embeddings overhead

**When to enable:** Long-running plans (>5 waves) where context from earlier waves is critical.

### System Prompt Overrides

Each agent role has an overridable system prompt in **Admin → Settings → Agent**:

| Prompt | Purpose |
|--------|---------|
| **Planner System Prompt** | How to decompose tasks, reasoning style, output format |
| **Executor System Prompt** | Tool execution guidelines, error handling, output expectations |
| **Checker System Prompt** | Quality criteria, confidence scoring methodology |
| **Summarizer System Prompt** | Output formatting, narrative style, citation requirements |

**Best practice:** Only override if the default behavior does not match your domain. The defaults are tuned for general-purpose task orchestration.

---

## 4. Autonomous Mode Operation

### The Pipeline

```
User Request
     │
     ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   PLANNER   │────►│  EXECUTOR   │────►│   CHECKER   │
│             │     │             │     │             │
│ • Decompose │     │ • Run tasks │     │ • Score     │
│ • Build DAG │     │ • Call tools│     │ • Retry?    │
│ • Self-check│     │ • Subagent  │     │             │
└─────────────┘     └─────────────┘     └──────┬──────┘
     │                                          │
     │         ┌──────────────────┐             │
     │         │   ORCHESTRATOR   │             │
     │         │                  │◄────────────┘
     │         │ • Load plan      │
     │         │ • Track budget   │
     │         │ • Manage waves   │
     │         │ • Stream progress│
     │         └────────┬─────────┘
     │                  │
     └──────────────────┘
                        │
                        ▼
               ┌─────────────┐
               │  SUMMARIZER │
               │             │
               │ • Compile   │
               │ • Format    │
               │ • Stream    │
               └──────┬──────┘
                      │
                      ▼
               Final Output
```

### Task Lifecycle

```
pending ──► running ──► completed
               │
               ├──► retry_after ──► running (max 2 retries)
               │
               └──► failed ──► needs_review
```

### Plan States

| State | Description |
|-------|-------------|
| `planning` | Planner is decomposing the user request |
| `awaiting_approval` | Plan-level HITL paused, waiting for user |
| `approved` | User approved the plan, ready to execute |
| `active` | Execution in progress |
| `paused` | User paused execution (completes current wave, then stops) |
| `stopped` | User stopped execution (pending tasks skipped) |
| `completed` | All tasks finished successfully |
| `failed` | Critical failure or budget exhausted |

### Wave Execution

The orchestrator executes tasks in **waves** — all tasks whose dependencies are satisfied run in parallel within a wave.

**Example DAG:**

```
Task 1: Research          Task 2: Data collection
     │                         │
     └──────────┬──────────────┘
                ▼
          Task 3: Analysis
                │
                ▼
          Task 4: Report generation
```

- **Wave 1:** Task 1 + Task 2 (no dependencies)
- **Wave 2:** Task 3 (depends on 1 and 2)
- **Wave 3:** Task 4 (depends on 3)

**Safety limits:**
- Max **200 waves** per plan
- Empty-wave backoff: if all pending tasks are in `retry_after`, the orchestrator sleeps without burning a wave count

### Streaming Progress

During execution, the chat UI receives SSE events:

| Event | Description |
|-------|-------------|
| `plan_intro` | Plan title and task count |
| `task_update` | Task status change (pending → running → completed/failed) |
| `task_result` | Task output snippet |
| `confidence_score` | Checker confidence (0–100) |
| `retry` | Task failed, retrying with strategy |
| `budget_warning` | Budget threshold crossed (50%, 75%, 100%) |
| `agent_cost_update` | Live cumulative cost in USD |
| `subagent_telemetry` | Subagent iteration count, tokens, tools used |
| `subagent_approval` | HITL pause for unsafe tool |
| `incremental_summary` | Partial output from summarizer |
| `conclusion` | Final synthesized response |

---

## 5. Streaming Events & External Integration

### Triggering Autonomous Mode

Autonomous mode is triggered via the chat streaming API:

```bash
curl -X POST "https://policybot.gov/api/chat/stream" \
  -H "Cookie: next-auth.session-token=..." \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Generate a comprehensive report on...",
    "threadId": "550e8400-e29b-41d4-a716-446655440000",
    "mode": "autonomous"
  }'
```

**Response:** `text/event-stream` with autonomous-specific events.

### SSE Event Reference

```
event: plan_intro
data: {"title": "Regulatory Impact Assessment", "taskCount": 8}

event: task_update
data: {"taskId": 1, "status": "running", "type": "web_search", "description": "Research carbon pricing frameworks"}

event: task_update
data: {"taskId": 2, "status": "running", "type": "web_search", "description": "Research SME sector composition"}

event: task_update
data: {"taskId": 1, "status": "completed", "confidence": 92}

event: agent_cost_update
data: {"cost": 0.0234, "currency": "USD"}

event: subagent_telemetry
data: {"taskId": 3, "iterations": 4, "tokens": 3200, "tools": ["web_search", "data_source"]}

event: incremental_summary
data: {"section": "Economic Impact", "content": "..."}

event: conclusion
data: {"finalOutput": "..."}
```

### Plan Control API

Once a plan is created, external systems can control it:

#### `POST /api/autonomous/{planId}/pause`

Pauses execution after the current wave completes.

```bash
curl -X POST "https://policybot.gov/api/autonomous/plan_123/pause" \
  -H "Cookie: next-auth.session-token=..."
```

**Response:** `{ "success": true, "status": "paused" }`

---

#### `POST /api/autonomous/{planId}/resume`

Resumes a paused plan.

```bash
curl -X POST "https://policybot.gov/api/autonomous/plan_123/resume" \
  -H "Cookie: next-auth.session-token=..."
```

---

#### `POST /api/autonomous/{planId}/stop`

Stops execution immediately. Pending tasks are marked `skipped`.

```bash
curl -X POST "https://policybot.gov/api/autonomous/plan_123/stop" \
  -H "Cookie: next-auth.session-token=..."
```

---

#### `POST /api/autonomous/{planId}/approve`

Resolves a plan-level HITL approval request.

```bash
curl -X POST "https://policybot.gov/api/autonomous/plan_123/approve" \
  -H "Cookie: next-auth.session-token=..." \
  -H "Content-Type: application/json" \
  -d '{
    "approved": true,
    "feedback": "Add a section on compliance deadlines"
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `approved` | boolean | Yes | `true` to approve, `false` to reject |
| `feedback` | string | No | Optional feedback passed to the planner for replanning |

---

#### `POST /api/autonomous/{planId}/tasks/{taskId}/skip`

Skips a specific pending task.

```bash
curl -X POST "https://policybot.gov/api/autonomous/plan_123/tasks/5/skip" \
  -H "Cookie: next-auth.session-token=..."
```

---

### Subagent HITL Approval API

When a subagent encounters an unsafe tool, it emits a `subagent_approval` SSE event. The user (or external system) must approve via:

```bash
curl -X POST "https://policybot.gov/api/agent/subagent/approve" \
  -H "Cookie: next-auth.session-token=..." \
  -H "Content-Type: application/json" \
  -d '{
    "toolCallId": "tc_abc123",
    "approved": true,
    "modifiedArgs": { "title": "Modified Report Title" }
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `toolCallId` | string | Yes | ID from the `subagent_approval` event |
| `approved` | boolean | Yes | `true` to approve, `false` to deny |
| `modifiedArgs` | object | No | Override tool arguments before execution |

---

## 6. Plan States & Error Handling

### State Machine

```
              ┌─────────────┐
              │   planning  │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
    ┌────────►│awaiting_    │◄────┐
    │         │  approval   │     │
    │         └──────┬──────┘     │
    │                │ approved    │ timeout
    │         ┌──────▼──────┐     │
    │         │   active    │─────┘
    │         └──────┬──────┘
    │    ┌───────────┼───────────┐
    │    │           │           │
    │    ▼           ▼           ▼
    │ paused      stopped     completed
    │    │           │           │
    │    └──────►    │           │
    │     resume     │           │
    └────────────────┘           │
                                 │
                            ┌────▼────┐
                            │  failed │
                            └─────────┘
```

### Error Classification

| Error Type | Examples | Behavior |
|------------|----------|----------|
| **Recoverable** | Rate limit, timeout, API unavailable | Retry with exponential backoff (`min(2^retry × 1s, 30s)`), max 2 retries |
| **Fatal** | Bad request, content filter, invalid arguments | No retry; mark task `failed`; continue with other tasks |
| **Budget** | Max calls/tokens/searches/time exceeded | Hard stop; skip pending tasks; return partial results |
| **HITL Timeout** | User did not respond within configured timeout | Auto-reject plan; stop execution |

### Partial Results

If a plan is stopped, paused, or fails due to budget exhaustion, the Summarizer still compiles **all completed task results** into a partial response. The user sees:

> "The plan was stopped after 6 of 10 tasks. Here is what was completed: ..."

---

## 7. Known Issues and Fixes

### Subagent Context Trimming Drops Useful History

**Status:** By design — configurable via model selection  
**Affected:** Long subagent ReAct loops (>10 iterations)

#### Problem

When a subagent loop approaches the model's context limit, the system drops the oldest `assistant + tool` pairs. In very long loops, this may remove early reasoning steps that are still relevant.

#### Mitigation

- Use `long_context` executor profile for subagent-heavy tasks
- Enable **Working Memory** so cross-wave summaries preserve key findings outside the subagent context
- Limit `max_iterations` to what is genuinely needed (default 15 is usually sufficient)

---

### Type Compatibility in Orchestrator

**Status:** Active technical debt  
**Affected files:** `src/lib/agent/orchestrator.ts`, `src/lib/agent/streaming-executor.ts`

#### Problem

There is a property naming mismatch between `AgentPlan` (camelCase) and `TaskPlan` (snake_case) types. Both files have `// @ts-nocheck` comments to suppress TypeScript errors.

#### Impact

No runtime impact — the code works correctly. The mismatch is purely a type-system inconsistency.

#### Future Fix

Normalize all agent code to use camelCase internally and map at the database boundary.

---

### No Automated Tests

**Status:** Active limitation  
**Affected:** All autonomous agent code

#### Problem

The project has no test suite. Changes to the planner, executor, or orchestrator must be verified manually.

#### Recommended Manual Testing

1. **Simple plan test:** "Summarize the HR policy document" (2–3 tasks)
2. **Complex plan test:** "Research, analyse, and report on X" (8+ tasks with dependencies)
3. **Subagent test:** Enable subagent mode, ask a question requiring iterative search
4. **HITL test:** Trigger plan-level and tool-level approvals
5. **Budget test:** Set very low budget limits and verify graceful degradation
6. **Pause/resume test:** Pause mid-execution, verify state persistence, resume

---

### WhatsApp RAG is Minimal

**Status:** MVP limitation  
**Affected:** WhatsApp channel responses for workspace-linked autonomous plans

#### Problem

The WhatsApp processor uses a simplified LLM call without the full RAG retrieval pipeline. Sources, uploaded documents, and advanced tool calling are not used in WhatsApp responses.

#### Workaround

For now, WhatsApp is best used for simple Q&A. For complex autonomous tasks, direct users to the web chat interface.

---

### Working Memory is Deterministic (Not Semantic)

**Status:** By design (beta feature)  
**Affected:** `src/lib/agent/memory.ts`

#### Problem

Working memory uses heuristic keyword extraction (regex frequency) rather than LLM summarization or embeddings. This means:
- Summaries may miss nuanced relationships between tasks
- No semantic retrieval — keywords must exactly match

#### Why This Design

- Zero LLM overhead for memory operations
- No embedding model dependency
- Feature-gated; can be disabled without schema changes

#### Future Enhancement

Optional LLM-based summarization toggle for higher-quality working memory.

---

### Model Escalation on Retry May Use Expensive Models

**Status:** Configurable behavior  
**Affected:** Budget-sensitive deployments

#### Problem

On retry, the executor escalates to the global default model (retry 1) and then the universal fallback model (retry 2). If these are expensive models, retrying burns budget faster.

#### Mitigation

- Set the universal fallback to a cost-effective model
- Use per-profile confidence thresholds to reduce retry frequency
- Monitor `agent_cost_update` SSE events in real time

---

## Quick Reference Card

```
┌────────────────────────────────────────────────────────────┐
│                AUTONOMOUS MODE QUICK REF                    │
├────────────────────────────────────────────────────────────┤
│ ENABLE                                                     │
│   Admin → Settings → Agent → Enable Autonomous Mode       │
│                                                            │
│ CONFIGURE MODELS                                           │
│   Planner: thinking-capable (Claude, Gemini Pro, o1)      │
│   Executor: fast tool-capable (GPT-4.1, Claude Haiku)     │
│   Checker: fast validation (GPT-4.1 Mini)                 │
│   Summarizer: strong synthesis (GPT-4.1, Claude Sonnet)   │
│                                                            │
│ SET BUDGET                                                 │
│   Calls: 500 | Tokens: 2M | Searches: 100 | Time: 30min   │
│                                                            │
│ ENABLE SUBAGENT (optional)                                 │
│   Admin → Settings → Agent → Subagent Configuration       │
│   Max iterations: 15 | Budget allocation: 25%             │
│                                                            │
│ TRIGGER                                                    │
│   Chat → Toggle "+- autonomous mode" → Send message       │
│                                                            │
│ CONTROL PLAN                                               │
│   POST /api/autonomous/{planId}/pause                     │
│   POST /api/autonomous/{planId}/resume                    │
│   POST /api/autonomous/{planId}/stop                      │
│   POST /api/autonomous/{planId}/tasks/{taskId}/skip       │
│                                                            │
│ HITL APPROVAL                                              │
│   Plan-level: Chat UI card with Approve/Reject            │
│   Tool-level: SubagentApprovalCard in chat stream         │
│                                                            │
│ WATCH FOR                                                  │
│   524 timeout → Not applicable (streaming, not HTTP req)  │
│   Budget warning → Reduce task count or use cheaper model │
│   Low confidence → Tweak checker threshold or prompts     │
└────────────────────────────────────────────────────────────┘
```

---

*Last updated: May 2026*
