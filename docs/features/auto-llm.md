# Auto LLM Selector

AI Assistant's automatic model selection system. When a user selects "Auto" from the model dropdown, the system deterministically picks the best available model based on the prompt context, tool routing matches, capability scores, real user feedback, and model requirements declared by matched tools.

> **Last updated:** July 2026 — Prompt classifier, feedback-to-selector closed loop, and tool capability profiles added.

---

## How It Works

The selector runs through a 5-step pipeline each time a chat message is sent with the "Auto" model:

### Step 1 — Candidate Pool

Filters to active, enabled models on healthy routes. Automatically excludes deprecated models (`gpt-4.1-mini`, `gpt-4.1-nano`).

### Step 2 — Vision Hard Filter

If the message includes images, narrows candidates to vision-capable models only.

### Step 3 — Context Length Hard Filter

If an estimated token count is available, filters to models that can fit the context.

### Step 4 — Tool Preference Override (Legacy)

If a tool preference exists in the legacy `auto-tool-model-map` (no longer admin-configurable via UI), returns that model directly (short-circuit). In practice, this map is empty and the step passes through.

### Step 4.5 — Tool-Aware Filtering

If tool routing matches any tools, collects their declared [`modelRequirements`](#tool-capability-profiles). Applies hard filters (requires tool calling, requires vision, minimum context tokens) and computes weight boosts (prefers large context, prefers instruction following, prefers code quality).

### Step 5 — Weighted Scoring

Ranks remaining candidates by:

```
score = capability × 0.40
      + contextFit × wf × contextBoost
      + cost × wo
      + latency × wl
      + satisfaction × 0.20
```

Where:
- **capability** — model's score on the task-specific dimension (see [Prompt Classification](#prompt-classification))
- **contextFit** — how well the model's context window fits estimated tokens, boosted for tools needing large context
- **cost** — inverse of input cost per 1M tokens (cheaper → higher)
- **latency** — inverse of P50 latency (faster → higher)
- **satisfaction** — real user feedback from 👍/👎 ratings (defaults to 0.5 neutral)

The dominant factor is shown in the UI (e.g., "Auto-selected Claude Sonnet 4.6 (best quality)").

---

## Prompt Classification

Before scoring, the user's message is classified into a semantic category using a two-tier approach:

### Tier 1 — Fast-Path Keyword Detection (13 rules)

| Rule | Keywords | Category | Dimension |
|------|----------|----------|-----------|
| Images present | (hasImages) | `visual` | `visual_reasoning` |
| Tool routing matched | (hasToolMatch) | `tools` | `function_calling` |
| Document/presentation gen | "generate a report", "create a pdf", "make slides" | `tools` | `function_calling` |
| Image/diagram gen | "create an image", "draw a diagram", "generate a chart" | `tools` | `function_calling` |
| Spreadsheet/presentation | ".xlsx", "powerpoint", "slide deck" | `tools` | `function_calling` |
| Code | "function", "class ", "import ", "sql ", "debug", "api" | `code` | `code_quality` |
| Translation | "translate", "traduire", "übersetzen" | `translate` | `reasoning` |
| Summarization | "summarize", "tldr", "key points" | `summarize` | `reasoning` |
| Data analysis | "analyze", "statistics", "trend", "metrics", "kpi" | `data` | `function_calling` |
| RAG / document Q&A | "policy", "procedure", "guideline", "according to", "per the" | `research` | `reasoning` |
| Web search / fact-finding | "search", "find", "what is", "latest", "news about" | `research` | `reasoning` |
| Research | "research", "investigate", "deep dive", "comprehensive" | `research` | `reasoning` |

### Tier 2 — Cheap LLM Classification

If no fast-path rule matches, a cheap LLM call (2s timeout) classifies the prompt. The classifier prompt includes descriptions of all 9 categories:

- **code** — programming, debugging, SQL, API design, refactoring
- **data** — analysis, statistics, metrics, trends, KPI review
- **creative** — writing, storytelling, poetry, brainstorming
- **translate** — language translation between languages
- **summarize** — condensing text, key points, TLDR, bullet summary
- **tools** — document generation, image creation, web search, spreadsheets, presentations, function calling
- **visual** — image input provided, photo analysis, diagram reading
- **chat** — casual conversation, advice, opinions, how-to questions
- **research** — in-depth investigation, fact-finding, policy lookup, comprehensive analysis

### Tier 3 — Default

If the LLM call fails or times out, defaults to `chat` → `reasoning`.

---

## Tool Capability Profiles

Each tool in the registry declares what model capabilities it requires. When tool routing matches a prompt to specific tools, these requirements inform model selection.

### Model Requirements

| Field | Type | Effect |
|-------|------|--------|
| `requiresToolCalling` | hard filter | Only tool-capable models |
| `requiresVision` | hard filter | Only vision-capable models |
| `minimumContextTokens` | hard filter | Minimum context window |
| `prefersLargeContext` | weight boost | contextFit × 1.5 |
| `prefersInstructionFollowing` | weight boost | reasoning capability × 1.3 |
| `prefersCodeQuality` | weight boost | code_quality capability × 1.3 |

### Tool Profiles

| Group | Tools | Requirements |
|-------|-------|-------------|
| **Generative** | doc_gen, pptx_gen, html_gen, file_to_html, image_gen, podcast_gen, diagram_gen | toolCapable + context/reasoning/code boosts |
| **Data & Code** | chart_gen, xlsx_gen, data_source, aggregate_data, code_analysis, function_api | toolCapable + code boost (32K min context for code_analysis) |
| **Search & Research** | web_search, web_extract, web_crawl, web_map, website_analysis, load_testing, youtube | toolCapable + context boost |
| **Utility** | translation, share_thread, send_email, compliance_checker | None |

---

## User Feedback Integration

The auto-selector learns from user ratings. When a user clicks 👍 or 👎 on a response, the rating is stored with the model that generated it.

- **Minimum 3 ratings** required before a model's satisfaction score is trusted (below this, defaults to neutral 0.5)
- **30-day rolling window** for feedback aggregation
- **20% weight** in the scoring formula
- Satisfaction scores are cached for 5 minutes and invalidated when models are added/removed/enabled/disabled

---

## Key Source Files

| File | Purpose |
|------|---------|
| [`src/lib/auto-model-selector.ts`](src/lib/auto-model-selector.ts) | Main selection pipeline — 5-step process |
| [`src/lib/classifier/prompt-category.ts`](src/lib/classifier/prompt-category.ts) | Two-tier prompt classifier (keywords + LLM) |
| [`src/lib/model-quality.ts`](src/lib/model-quality.ts) | Satisfaction scoring from feedback, TTL cache |
| [`src/lib/auto-model-scores.ts`](src/lib/auto-model-scores.ts) | Capability score derivation from model flags |
| [`src/lib/auto-model-constants.ts`](src/lib/auto-model-constants.ts) | `AUTO_MODEL_SENTINEL = 'auto'` |
| [`src/lib/tools.ts`](src/lib/tools.ts) | `ModelRequirements` type + tool registry profiles |
| [`src/lib/db/compat/evolved-kb.ts`](src/lib/db/compat/evolved-kb.ts) | `getModelFeedbackStats()` aggregation query |
| [`src/lib/db/compat/enabled-models.ts`](src/lib/db/compat/enabled-models.ts) | Model CRUD + quality cache invalidation |
| [`src/lib/db/compat/model-latency.ts`](src/lib/db/compat/model-latency.ts) | P50 latency tracking |
| [`src/lib/db/compat/config.ts`](src/lib/db/compat/config.ts) | Scoring weights settings |
| [`src/lib/services/model-discovery.ts`](src/lib/services/model-discovery.ts) | `DEPRECATED_MODELS` set |
| [`src/lib/agent/auto-role.ts`](src/lib/agent/auto-role.ts) | Per-agent-role Auto resolution |

## Admin Configuration

Admins can influence auto-selection through:

- **Model Leaderboard** (Admin → LLM Settings → Auto Model Leaderboard): Diagnostic view showing which model the auto-selector picks for each task type. Admins see the leading model per category and can adjust model attributes (capabilities, costs, enable/disable) based on what the leaderboard shows.
- **Scoring Weights** (`model-scoring-weights`): Customize capability/contextFit/cost/latency weight balance
- **Model Enable/Disable**: Only enabled models participate; deprecated models are auto-excluded
- **Capability Toggles**: Tool calling, vision, parallel tools, thinking, and forced tool flags per model affect capability scores
- **Cost Configuration**: Input/output costs per model affect the cost scoring component
