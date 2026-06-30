# Three-Route LLM Architecture

Policy Bot routes all LLM requests through **three independent paths**, giving admins fine-grained control over which providers are active. Every provider connects directly via its native SDK or API — there is no LLM proxy intermediary.

> **Authoritative reference:** See [`docs/features/LLM.md`](LLM.md) for the complete provider table, SDK details, embeddings architecture, STT/TTS routing, and fallback chain order.

---

## Overview

| Route | Path | Providers | Connection |
|-------|------|-----------|------------|
| **Route 2** | Direct Providers | OpenAI, Anthropic Claude, Google Gemini, Mistral AI, DeepSeek, Moonshot | Native SDK / direct API |
| **Route 3** | Local / Ollama | Ollama (local inference) | OpenAI SDK → `ollama:11434/v1` |
| **Route 5** | Aggregator Gateways | Azure AI Foundry, Fireworks AI, Ollama Cloud | Native SDK / OpenAI-compatible API |

All three routes can run simultaneously for maximum availability, or any can be disabled independently. For air-gapped deployments, enable only Route 3. See [`air-gapped-deployment.md`](air-gapped-deployment.md) for the full offline capabilities reference.

### Why Three Routes?

- **Resilience** — cross-route fallback if one provider or gateway goes down
- **Provider isolation** — each provider uses its native SDK for reliable tool calling, thinking, and streaming. Anthropic via `@anthropic-ai/sdk`, Gemini via `@google/genai`, Mistral via `@mistralai/mistralai`
- **Air-gap support** — Route 3 enables fully offline deployments with local LLM inference via Ollama
- **Gateway aggregation** — Route 5 groups multi-model gateways (Azure Foundry, Fireworks, Ollama Cloud) for serverless catalog model access
- **Compliance** — restrict which provider APIs are reachable from your deployment

### Historical Note

- **Route 1 (LiteLLM proxy)** was removed in June 2026. OpenAI, Gemini, and Mistral previously routed through LiteLLM; they now use direct native SDKs.
- **Route 4 (Ollama Cloud)** was folded into Route 5 as an aggregator gateway alongside Fireworks AI and Azure AI Foundry.
- The system retains backward compatibility with older `RoutesSettings` DB rows; legacy `route1Enabled` fields are stripped on read.

---

## Route Classification

Models and providers are classified by ID pattern matching in [`src/lib/llm-fallback.ts`](../../src/lib/llm-fallback.ts):

### Provider Classification

| Provider ID | Route |
|-------------|-------|
| `openai` | Route 2 |
| `anthropic` | Route 2 |
| `gemini` | Route 2 |
| `mistral` | Route 2 |
| `deepseek` | Route 2 |
| `moonshot` | Route 2 |
| `ollama` | Route 3 |
| `azure-foundry` | Route 5 |
| `fireworks` | Route 5 |
| `ollama-cloud` | Route 5 |

### Model Classification

| Prefix | Route | Example |
|--------|-------|---------|
| `openai/`, `gpt-`, `o1`, `o3`, `o4` | Route 2 | `gpt-4.1-mini`, `o3-mini` |
| `anthropic/`, `claude-` | Route 2 | `anthropic/claude-sonnet-4-5-20250514` |
| `gemini/`, `gemini-` | Route 2 | `gemini-2.5-flash` |
| `mistral/`, `codestral/`, `pixtral/` | Route 2 | `mistral/mistral-large-latest` |
| `deepseek-`, `deepseek/` | Route 2 | `deepseek-v4-flash` |
| `moonshot/` | Route 2 | `moonshot/kimi-k2p5` |
| `ollama-`, `ollama/` | Route 3 | `ollama-llama3.2`, `ollama/qwen3:4b` |
| `azure-foundry/` | Route 5 | `azure-foundry/gpt-4.1` |
| `fireworks/` | Route 5 | `fireworks/minimax-m2p5` |
| `ollama-cloud/`, `*-cloud`, `*:cloud` | Route 5 | `ollama-cloud/llama4` |

> **Important:** Route 5 is checked **first** in model filtering because some models may match multiple route prefixes.

---

## Configuration

### Settings Storage

Routes are configured via the admin UI and stored in the database:

```typescript
interface RoutesSettings {
  route2Enabled: boolean;   // Route 2: Direct providers (OpenAI, Claude, Gemini, Mistral, DeepSeek, Moonshot)
  route3Enabled: boolean;   // Route 3: Local / Ollama direct (air-gapped capable)
  route5Enabled: boolean;   // Route 5: Aggregator gateways (Azure AI Foundry, Fireworks AI, Ollama Cloud)
  primaryRoute: 'route2' | 'route3' | 'route5';  // Which route is primary (others become fallback)
}
```

**Defaults:** Route 2 enabled, Route 3 disabled, Route 5 disabled, primary = Route 2.

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
                              active routes (isRoute2/3/5)   │
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
                              │  isOpenAIModel?      │
                              │  isClaudeModel?      │
                              │  isGeminiModel?      │
                              │  isMistralModel?     │
                              │  isDeepSeekModel?    │
                              │  isOllamaModel?      │
                              │  isAzureFoundry?     │
                              │  isFireworksModel?   │
                              │  isOllamaCloud?      │
                              └───┬──────┬──────┬────┘
                                  │      │      │
              ┌───────────────────┘      │      └───────────────────┐
              │                          │                          │
   ┌──────── ▼ ─────────┐   ┌──────── ▼ ──────────┐  ┌──────── ▼ ─────────┐
   │     ROUTE 2        │   │      ROUTE 3         │  │     ROUTE 5        │
   │  Direct Providers  │   │  Local / Ollama      │  │  Aggregator        │
   └────────┬───────────┘   └────────┬─────────────┘  │  Gateways          │
            │                        │                 └────────┬───────────┘
            │                        │                          │
            ▼                        ▼                          ▼
   ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────────────┐
   │ OpenAI           │   │ Ollama           │   │ Azure AI Foundry        │
   │ → api.openai.com │   │ → ollama:11434   │   │ → @azure/ai-projects    │
   │                   │   │                  │   │ Fireworks AI            │
   │ Anthropic         │   │                  │   │ → api.fireworks.ai      │
   │ → @anthropic-ai   │   │                  │   │ Ollama Cloud            │
   │                   │   │                  │   │ → ollama.com/api        │
   │ Gemini            │   │                  │   │                         │
   │ → @google/genai   │   │                  │   │                         │
   │                   │   │                  │   │                         │
   │ Mistral           │   │                  │   │                         │
   │ → @mistralai      │   │                  │   │                         │
   │                   │   │                  │   │                         │
   │ DeepSeek          │   │                  │   │                         │
   │ → api.deepseek.com│   │                  │   │                         │
   │                   │   │                  │   │                         │
   │ Moonshot          │   │                  │   │                         │
   │ → api.moonshot.cn │   │                  │   │                         │
   └────────┬──────────┘   └────────┬─────────┘   └────────┬────────────────┘
            │                        │                       │
            └────────────────────────┼───────────────────────┘
                                     │
                                     ▼
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

### Key Routing Logic ([`src/lib/openai.ts`](../../src/lib/openai.ts))

```typescript
// Detect direct-route models — all use native SDKs/APIs
const useOpenAIDirect     = isOpenAIModel(effectiveModel);       // openai/, gpt-, o1, o3, o4
const useAnthropicDirect  = isClaudeModel(effectiveModel);       // anthropic/, claude-
const useGeminiDirect     = isGeminiModel(effectiveModel);       // gemini/, gemini-
const useMistralDirect    = isMistralModel(effectiveModel);      // mistral/, codestral/, pixtral/
const useDeepSeekDirect   = isDeepSeekModel(effectiveModel);     // deepseek-, deepseek/
const useOllamaDirect     = isOllamaModel(effectiveModel);       // ollama-, ollama/
const useAzureFoundry     = isAzureFoundryModel(effectiveModel); // azure-foundry/
const useOllamaCloud      = isOllamaCloudModel(effectiveModel);  // ollama-cloud/

// Each branch dispatches to the appropriate native client:
// OpenAI   → getOpenAIDirectClient()          → api.openai.com/v1
// Claude   → getAnthropicClient()            → api.anthropic.com
// Gemini   → streamGeminiCompletion()        → @google/genai SDK
// Mistral  → streamMistralCompletion()       → @mistralai/mistralai SDK
// DeepSeek → getDeepSeekClient()             → api.deepseek.com/v1
// Moonshot → getMoonshotClient()             → api.moonshot.cn/v1
// Ollama   → getOllamaClient()               → ollama:11434/v1
// Azure    → getAzureFoundryClient()         → @azure/ai-projects SDK
// Fireworks→ getFireworksClient()            → api.fireworks.ai/inference/v1
// OllamaC  → callOllamaCloud()               → ollama.com/api (native)
```

### Why Direct SDKs (No LiteLLM)

All providers use direct native SDKs/APIs for three reasons:

1. **Tool calling reliability** — LiteLLM's streaming format translation corrupted tool-call JSON for Anthropic Claude (and later Gemini, Mistral). Direct SDKs return pre-parsed tool inputs, eliminating JSON assembly errors.
2. **Native features** — Gemini's `@google/genai` SDK provides `thinkingConfig`, `systemInstruction`, `responseSchema`, and proper function call ID round-tripping that LiteLLM's OpenAI-compat layer cannot express.
3. **Operational simplicity** — Eliminates an entire infrastructure service (LiteLLM proxy on port 4000), its configuration, sync logic, and failure mode. One fewer moving part in production.

### Why Ollama Bypasses LiteLLM (Route 3)

Route 3 enables **air-gapped deployments** without any external dependencies. Ollama exposes an OpenAI-compatible API at `/v1/chat/completions`, so the same OpenAI SDK client can be used with a custom `baseURL`. See [`air-gapped-deployment.md`](air-gapped-deployment.md) for the full offline capabilities reference.

---

## How It Works

### Model Filtering (Chat)

When a user opens the model selector or sends a message, the API filters the available model list by active routes:

```
All enabled models
    │
    ├─ Route 5 model? → Include only if Route 5 is enabled  (checked first)
    ├─ Route 3 model? → Include only if Route 3 is enabled
    └─ Route 2 model? → Include only if Route 2 is enabled
```

This filtering applies to:
- **`GET /api/models`** — global model list for the chat model selector
- **`GET /api/threads/[id]/model`** — thread-specific effective model validation

### Fallback Chain

When multiple routes are enabled, the fallback chain can cross routes for resilience:

1. **Selected model** (primary route)
2. **Universal fallback** — admin-configured fallback model
3. **Cross-route fallbacks** — models from other enabled routes:
   - Route 2 fallbacks: `fireworks/minimax-m2p5`, `deepseek-v4-flash`, `moonshot/kimi-k2p5`, `claude-haiku-4-5-20251001`
   - Route 3 fallbacks: first available enabled Ollama model
4. **All models exhausted** → `LlmFallbackError`

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
| **Route 2 toggle** | Enable/disable direct provider route |
| **Route 3 toggle** | Enable/disable local / Ollama route |
| **Route 5 toggle** | Enable/disable aggregator gateway route |
| **Primary route selector** | Which route is preferred (affects fallback ordering) |

#### Conflict Warnings

The Routes page shows real-time warnings when route toggles would create issues:

| Warning | Trigger | Message |
|---------|---------|---------|
| **No fallback** | Only one route enabled | "Enable additional routes for automatic failover" |
| **Default model conflict** | Default model belongs to a disabled route | "Default model (X) belongs to Route N, which is disabled" |
| **Fallback model conflict** | Fallback model belongs to a disabled route | "Fallback model (X) belongs to Route N, which is disabled" |

Warnings update in real-time as the admin toggles routes. At least one route must remain enabled — the UI prevents disabling all three.

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
| Route 2 | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY` |
| Route 3 | None (Ollama runs locally). Optional: `OLLAMA_BASE_URL` to override default `http://localhost:11434` |
| Route 5 | `FIREWORKS_AI_API_KEY`, `AZURE_FOUNDRY_ENDPOINT` + (`AZURE_FOUNDRY_API_KEY` or Entra ID env vars), `OLLAMA_CLOUD_API_KEY` |

All API keys can also be configured via Admin UI (Settings > LLM > Providers), which takes precedence over environment variables.

---

## Key Files

| File | Purpose |
|------|---------|
| [`src/lib/llm-fallback.ts`](../../src/lib/llm-fallback.ts) | Route classification (`isRoute2/3/5Model`), health cache, fallback chain, `withModelFallback()` |
| [`src/lib/db/config.ts`](../../src/lib/db/config.ts) | `RoutesSettings` interface, defaults |
| [`src/lib/db/compat/config.ts`](../../src/lib/db/compat/config.ts) | `getRoutesSettings()`, `setRoutesSettings()` with back-compat |
| [`src/app/api/admin/settings/routes/route.ts`](../../src/app/api/admin/settings/routes/route.ts) | Routes settings API endpoint |
| [`src/app/api/models/route.ts`](../../src/app/api/models/route.ts) | Route-aware model filtering (chat) |
| [`src/app/api/threads/[threadId]/model/route.ts`](../../src/app/api/threads/[threadId]/model/route.ts) | Route-aware thread model validation |
| [`src/lib/openai.ts`](../../src/lib/openai.ts) | Main chat dispatch with per-provider routing |
| [`src/lib/llm-client.ts`](../../src/lib/llm-client.ts) | Internal services dispatch with per-provider routing |
| [`src/lib/auto-model-selector.ts`](../../src/lib/auto-model-selector.ts) | Auto model selection with route-aware filtering |
| [`docs/features/LLM.md`](LLM.md) | **Authoritative reference** — full provider table, SDKs, embeddings, STT/TTS, fallback |
| [`docs/features/air-gapped-deployment.md`](air-gapped-deployment.md) | Comprehensive offline capabilities reference |
