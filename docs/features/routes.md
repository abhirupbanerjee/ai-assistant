# Three-Route LLM Architecture

Policy Bot routes LLM requests through three independent paths, giving admins fine-grained control over which provider infrastructure is active.

---

## Overview

| Route | Path | Providers | Connection |
|-------|------|-----------|------------|
| **Route 1** | LiteLLM Proxy (port 4000) | OpenAI, Gemini, Mistral, DeepSeek | Via LiteLLM gateway |
| **Route 2** | Direct SDKs | Anthropic (Claude), Fireworks AI | Native SDK / direct API |
| **Route 3** | Local / Ollama | Ollama | OpenAI SDK → ollama:11434/v1 direct |

All three routes can run simultaneously for maximum availability, or any can be disabled independently. For air-gapped deployments, enable only Route 3. See [air-gapped-deployment.md](air-gapped-deployment.md) for the full offline capabilities reference.

### Why Three Routes?

- **Resilience** — if one route's infrastructure goes down, the others continue serving requests
- **Provider isolation** — Claude uses the Anthropic SDK directly (bypasses LiteLLM) because LiteLLM breaks tool-call JSON assembly for Anthropic streaming
- **Air-gap support** — Route 3 enables fully offline deployments with local LLM inference via Ollama
- **Cost control** — disable expensive cloud routes when not needed
- **Compliance** — restrict which provider APIs are reachable from your deployment

---

## Route Classification

Models and providers are classified by ID pattern matching:

### Provider Classification

| Provider ID | Route |
|-------------|-------|
| `openai` | Route 1 |
| `gemini` | Route 1 |
| `mistral` | Route 1 |
| `deepseek` | Route 1 |
| `anthropic` | Route 2 |
| `fireworks` | Route 2 |
| `ollama` | Route 3 |

### Model Classification

| Prefix | Route | Example |
|--------|-------|---------|
| `anthropic/` | Route 2 | `anthropic/claude-sonnet-4-5-20250514` |
| `claude-` | Route 2 | `claude-haiku-4-5-20251001` |
| `fireworks/` | Route 2 | `fireworks/minimax-m2p5` |
| `ollama-` | Route 3 | `ollama-llama3.2` |
| `ollama/` | Route 3 | `ollama/qwen3:4b` |
| All other | Route 1 | `gpt-4o`, `gemini-2.0-flash` |

---

## Configuration

### Settings Storage

Routes are configured via the admin UI and stored in the database as a JSON settings object:

```typescript
interface RoutesSettings {
  route1Enabled: boolean;                          // Route 1: LiteLLM proxy
  route2Enabled: boolean;                          // Route 2: Direct cloud providers
  route3Enabled: boolean;                          // Route 3: Local / Ollama direct
  primaryRoute: 'route1' | 'route2' | 'route3';   // Primary route (others are fallback)
}
```

**Defaults:** Route 1 enabled, Route 2 disabled, Route 3 disabled, primary = Route 1.

### Safety Constraints

- At least one route must always be enabled
- If the primary route is disabled, the system automatically switches primary to the first available enabled route

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/settings/routes` | `GET` | Fetch current routes configuration |
| `/api/admin/settings/routes` | `PUT` | Update routes configuration |

---

## Architecture Diagram

```
                         ┌─────────────────────────────────┐
                         │         User sends message       │
                         └───────────────┬─────────────────┘
                                         │
                                         ▼
                         ┌─────────────────────────────────┐
                         │   POST /api/chat/stream          │
                         │   (SSE streaming endpoint)       │
                         └───────────────┬─────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                     │
                    ▼                    ▼                     ▼
           ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
           │ Auth + thread │   │  RAG retrieval   │   │ Model select │
           │ resolution    │   │  + skill routing │   │ + fallback   │
           └──────────────┘   └──────────────────┘   └──────┬───────┘
                                                            │
                              GET /api/models filters by     │
                              active routes (isRoute2/3Model)│
                                                            ▼
                         ┌─────────────────────────────────┐
                         │   generateResponseWithTools()    │
                         │   (src/lib/openai.ts)            │
                         │                                  │
                         │   effectiveModel = selected or   │
                         │   default from LLM settings      │
                         └───────────────┬─────────────────┘
                                         │
                              ┌──────────┴──────────┐
                              │  Route Decision      │
                              │                      │
                              │  isClaudeModel()?    │
                              │  isFireworksModel()? │
                              │  isOllamaModel()?    │
                              └───┬──────┬──────┬────┘
                                  │      │      │
              ┌───────────────────┘      │      └───────────────────┐
              │                          │                          │
   ┌──────── ▼ ─────────┐    ┌──────── ▼ ──────────┐   ┌──────── ▼ ─────────┐
   │     ROUTE 1        │    │      ROUTE 2         │   │     ROUTE 3        │
   │  LiteLLM Proxy     │    │  Direct Cloud        │   │  Local / Ollama    │
   └────────┬───────────┘    └──────┬───────┬───────┘   └────────┬───────────┘
            │                       │       │                     │
            ▼                       │       │                     ▼
  ┌──────────────────┐    ┌──────── ▼ ─┐ ┌ ▼ ────────┐ ┌──────────────────┐
  │ streamOneComple- │    │ streamAnth- │ │ streamOne- │ │ streamOneComple- │
  │ tion()           │    │ ropicCompl- │ │ Completion │ │ tion()           │
  │                  │    │ etion()     │ │ ()         │ │                  │
  │ OpenAI SDK →     │    │ Anthropic   │ │ OpenAI SDK │ │ OpenAI SDK →     │
  │ LiteLLM :4000    │    │ SDK →       │ │ → firework │ │ Ollama :11434    │
  └────────┬─────────┘    │ anthropic   │ │ s.ai       │ └────────┬─────────┘
           │              │ .com        │ └──────┬─────┘          │
           ▼              └──────┬──────┘        │                ▼
  ┌─────────────────┐           │                │       ┌─────────────────┐
  │  LiteLLM Proxy  │           ▼                ▼       │  Ollama Server  │
  │  (port 4000)    │    ┌───────────┐   ┌───────────┐   │  (port 11434)   │
  └──┬──┬──┬──┬─────┘    │  Claude   │   │ Fireworks │   └────────┬───────��┘
     │  │  │  │           │  Models   │   │  Models   │            │
     ▼  ▼  ▼  ▼           └───────────┘   └───────────┘            ▼
  ┌───┐┌───┐┌───┐┌────┐                                   ┌─────────────┐
  │O- ││Gem││Mis││Deep│                                   │ llama3.2    │
  │pen││ini││tra││Seek│                                   │ qwen3       │
  │AI ││   ││ l ││    │                                   │ gpt-oss ... │
  └───┘└───┘└───┘└────┘                                   └─────────────┘

  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

  After streaming completes, all routes return the same shape:

      { content, tool_calls (OpenAI format), thinkingContent, totalTokens }
                                         │
                                         ▼
                         ┌─────────────────────────────────┐
                         │   Unified Tool Execution Loop    │
                         │                                  │
                         │   executeTool() processes each   │
                         │   tool_call regardless of route  │
                         │                                  │
                         │   If tool_calls present:         │
                         │   → Execute tools                │
                         │   → Append results to history    │
                         │   → Call LLM again (same route)  │
                         │   → Repeat until no tool_calls   │
                         └───────────────┬─────────────────┘
                                         │
                                         ▼
                         ┌─────────────────────────────────┐
                         │   SSE stream → client            │
                         │   (text chunks + tool status)    │
                         └─────────────────────────────────┘
```

### Key Routing Logic (`src/lib/openai.ts`)

```typescript
// Detect direct-route models — bypass LiteLLM
const useAnthropicDirect = isClaudeModel(effectiveModel);   // anthropic/* or claude-*
const useFireworksDirect = isFireworksModel(effectiveModel); // fireworks/*
const useOllamaDirect   = isOllamaModel(effectiveModel);    // ollama-* or ollama/*

const openai = useAnthropicDirect ? null
  : useFireworksDirect ? await getFireworksClient()          // → api.fireworks.ai
  : useOllamaDirect    ? await getOllamaClient()             // → ollama:11434/v1
  : await getOpenAI();                                       // → LiteLLM :4000

const anthropicClient = useAnthropicDirect
  ? await getAnthropicClient()                               // → api.anthropic.com
  : null;
```

### Why Claude Bypasses LiteLLM

Route 2 exists primarily because **LiteLLM corrupts Anthropic tool-call JSON during streaming**. LiteLLM translates Anthropic's native `tool_use` content blocks into OpenAI-compatible `delta.tool_calls` format, but the chunked JSON reassembly is unreliable — producing malformed arguments that break `executeTool()`. The Anthropic SDK's `stream.finalMessage()` returns **pre-parsed `block.input` objects**, eliminating this class of error entirely. See [Issue #3 in known issues](../developer/issues-known-fix.md#3-litellm-breaks-anthropic-streaming-tool-call-json-assembly) for the full root-cause analysis.

### Why Ollama Bypasses LiteLLM

Route 3 exists to enable **air-gapped deployments** without LiteLLM as a dependency. Ollama exposes an OpenAI-compatible API at `/v1/chat/completions`, so the same OpenAI SDK client can be used with a custom `baseURL` — identical to the Fireworks pattern. See [air-gapped-deployment.md](air-gapped-deployment.md) for the full offline capabilities reference.

---

## How It Works

### Model Filtering (Chat)

When a user opens the model selector or sends a message, the API filters the available model list by active routes:

```
All enabled models
    │
    ├─ Route 3 model? → Include only if Route 3 is enabled
    ├─ Route 2 model? → Include only if Route 2 is enabled
    └─ Route 1 model? → Include only if Route 1 is enabled
```

This filtering applies to:
- **`GET /api/models`** — global model list for the chat model selector
- **`GET /api/threads/[id]/model`** — thread-specific effective model validation

### Fallback Chain

When multiple routes are enabled, the fallback chain can cross routes for resilience:

1. **Selected model** (primary route)
2. **Same-route fallbacks** (other models on the same route)
3. **Cross-route fallbacks** (models on other enabled routes)
4. **Universal fallback** (admin-configured fallback model)

If a model's route is disabled, it is excluded from the fallback chain entirely.

### Model Readiness

The chat submit button is gated by model readiness:
- On page load, `modelReady` starts as `false`
- The `ModelSelector` component queries the API and confirms a valid model exists for the active routes
- Only then is `modelReady` set to `true` and the submit button enabled

This prevents users from sending messages when no models are available (e.g., all routes disabled or all models removed).

---

## Admin UI

### Routes Settings Page

**Location:** Admin > Settings > Routes

| Control | Description |
|---------|-------------|
| **Route 1 toggle** | Enable/disable LiteLLM proxy route |
| **Route 2 toggle** | Enable/disable direct cloud provider route |
| **Route 3 toggle** | Enable/disable local / Ollama route |
| **Primary route selector** | Which route is preferred (affects fallback ordering) |

#### Conflict Warnings

The Routes page shows real-time warnings when route toggles would create issues:

| Warning | Trigger | Message |
|---------|---------|---------|
| **No fallback** | Only one route enabled | "Enable additional routes for automatic failover" |
| **Default model conflict** | Default model belongs to a disabled route | "Default model (X) belongs to Route N, which is disabled" |
| **Fallback model conflict** | Fallback model belongs to a disabled route | "Fallback model (X) belongs to Route N, which is disabled" |

Warnings update in real-time as the admin toggles routes (uses edited state, not saved state). At least one route must remain enabled — the UI prevents disabling all three.

### LLM Settings Page (Route-Aware Gating)

**Location:** Admin > Settings > LLM

When any route is disabled, the LLM settings page applies view-only gating to that route's providers and models:

| Element | Behavior when route is disabled |
|---------|--------------------------------|
| **Info banner** | Blue banner: "Route N is disabled. Providers and models for the disabled route are view-only." |
| **Provider cards** | Greyed out (`opacity-50`, `pointer-events-none`) |
| **Model rows** | Greyed out (`opacity-40`), "Route Off" status badge |
| **Capability toggles** | Disabled (tools, vision, parallel, thinking) |
| **Token editors** | Disabled (max input/output tokens) |
| **"Set as Default"** | Non-clickable with `cursor-not-allowed` |
| **"Set as Fallback"** | Non-clickable with `cursor-not-allowed` |
| **"Remove Fallback"** | Always available (safe to remove) |

This is purely UI-level gating — disabled-route models are still stored in the database but excluded from runtime model lists.

---

## Environment Variables

No new environment variables are required. Routes use existing provider API keys:

| Route | Required Keys |
|-------|--------------|
| Route 1 | `OPENAI_API_KEY` or `LITELLM_MASTER_KEY` + `OPENAI_BASE_URL` (LiteLLM proxy) |
| Route 2 | `ANTHROPIC_API_KEY` and/or `FIREWORKS_AI_API_KEY` |
| Route 3 | None (Ollama runs locally). Optional: `OLLAMA_BASE_URL` to override default `http://localhost:11434` |

If a route is enabled but its provider API keys are not configured, models from that provider will show as unconfigured in the admin UI.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/db/config.ts` | `RoutesSettings` interface, defaults |
| `src/lib/db/compat/config.ts` | `getRoutesSettings()`, `setRoutesSettings()` |
| `src/app/api/admin/settings/routes/route.ts` | Routes settings API endpoint |
| `src/app/api/models/route.ts` | Route-aware model filtering (chat) |
| `src/app/api/threads/[threadId]/model/route.ts` | Route-aware thread model validation |
| `src/components/admin/settings/RoutesSettings.tsx` | Routes admin UI with conflict warnings |
| `src/components/admin/settings/UnifiedLLMSettings.tsx` | LLM settings with route-aware gating |
| `src/components/admin/settings/ApiKeysSettings.tsx` | API key management with route grouping |
| `src/components/chat/ChatWindow.tsx` | Model readiness gating for submit button |
| `src/lib/llm-fallback.ts` | Cross-route fallback chain |
| `src/lib/llm-client.ts` | Internal LLM client with multi-route fallback |
| `docs/features/air-gapped-deployment.md` | Comprehensive offline capabilities reference |
