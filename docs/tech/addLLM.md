# Adding a New LLM Model

This guide explains how to add a new LLM model to the Policy Bot system.

## Table of Contents

- [Overview](#overview)
- [Quick Reference: What to Update](#quick-reference-what-to-update)
  - [Adding a Fireworks AI Model](#adding-a-fireworks-model)
- [Method 1: Admin UI (Recommended)](#method-1-admin-ui-recommended)
- [Method 2: YAML Configuration](#method-2-yaml-configuration-alternative)
- [Adding a New Provider](#adding-a-new-provider)
- [Capability Detection Patterns](#capability-detection-patterns)
- [Per-Model Token Settings](#per-model-token-settings)
- [Setting as Default Model](#setting-as-default-model)
- [Verification Checklist](#verification-checklist)
- [Troubleshooting](#troubleshooting)
- [Files Reference](#files-reference)

---

## When Providers Release New Models

Understanding when new models are automatically discovered vs when code changes are required:

### Automatic Discovery (No Code Changes)

For most providers, new models are **automatically discovered** when you click "Add Models" in the Admin UI:

| Provider | API Endpoint | New Models Auto-Discovered |
|----------|--------------|---------------------------|
| **OpenAI** | `api.openai.com/v1/models` | ✅ Yes |
| **Gemini** | `generativelanguage.googleapis.com/v1beta/models` | ✅ Yes |
| **Mistral** | `api.mistral.ai/v1/models` | ✅ Yes |
| **DeepSeek** | `api.deepseek.com/models` | ✅ Yes |
| **Ollama** | `{apiBase}/api/tags` | ✅ Yes |
| **Anthropic** | `api.anthropic.com/v1/models` | ✅ Yes |

### When Code Changes ARE Required

| Scenario | What to Update | Example |
|----------|---------------|---------|
| **New model family** (different naming pattern) | Add capability detection patterns | GPT-6.x, Gemini 3.x, o5-series |
| **Model has different capabilities than pattern suggests** | Override via Admin UI API or add specific pattern | A mini model that supports vision |

### Capability Detection for New Model Families

When a provider releases a new model **family** (e.g., GPT-6, Gemini 3, o5), you may need to add capability patterns even though the model is auto-discovered:

```typescript
// In TOOL_CAPABLE_PATTERNS - add:
/^gpt-6/,
/^o5/,
/^gemini-3/,

// In VISION_CAPABLE_PATTERNS - add if the family supports vision:
/^gpt-6/,
/^gemini-3/,

// In PARALLEL_TOOL_CAPABLE_PATTERNS - add if the model reliably handles multiple tool calls in one response:
/^gpt-6/,
/^gemini-3/,

// In THINKING_CAPABLE_PATTERNS - add if the model outputs reasoning/thinking content:
/^o5/,
```

Without these patterns, auto-discovered models will appear but may not have correct capability flags (tool, vision, parallel, thinking).

---

## Provider Selection Guidelines

Before adding models, choose the provider tier based on data sensitivity and task complexity:

| Provider Tier | Use Case | Data Classification |
|---|---|---|
| **Ollama** (Local) | Simple RAG, document lookup, basic Q&A, non-complex queries | ✅ Government-sensitive / classified — data never leaves the network |
| **Cloud LLMs** — OpenAI, Claude, Gemini, Mistral, DeepSeek | Complex reasoning, tool calls, multi-step workflows, coding | Public / non-sensitive data only — requests route through external APIs |
| **Fireworks AI** | Open-source model testing: MiniMax M2.5, Kimi K2.5, GPT-OSS 20B/120B, Qwen3 4B/8B, Llama 4 Scout | Development / test environments only — not for production sensitive data |

> **Rule:** Never route government-sensitive or classified data through Cloud LLM or Fireworks AI providers. Use Ollama for all sensitive workloads.

### Route Awareness

New models are automatically classified into one of two routes based on their ID prefix:

| Route | Model ID Prefixes | Provider IDs |
|-------|------------------|--------------|
| **Route 1** (LiteLLM) | All others | `openai`, `gemini`, `mistral`, `deepseek`, `ollama` |
| **Route 2** (Direct) | `anthropic/`, `claude-`, `fireworks/` | `anthropic`, `fireworks` |

If you add a new provider, update the route classification in `UnifiedLLMSettings.tsx` (`ROUTE_2_PROVIDERS`, `isRoute2Model`) and the chat API model filters. See [features/routes.md](../features/routes.md) for architecture details.

---

## Overview

There are **two methods** to add LLM models:

| Method | Best For | Requires | Code Changes |
|--------|----------|----------|--------------|
| **Admin UI** (Recommended) | Production, non-technical users | Web browser access | None |
| **YAML Config** (Alternative) | CI/CD, infrastructure-as-code | File system access | Optional |

### Architecture Overview

Models are loaded with the following priority:

```
Model Configuration Priority:

        ┌─────────────────────────────────────┐
        │  Admin UI → Database                │  ◄── PRIMARY
        │  (llm_providers, enabled_models)    │
        └─────────────────────────────────────┘
                        │
                        ▼ (fallback if no DB models)
        ┌─────────────────────────────────────┐
        │  litellm_config.yaml → Auto-parse   │  ◄── SECONDARY
        └─────────────────────────────────────┘
                        │
                        ▼ (fallback if YAML unavailable)
        ┌─────────────────────────────────────┐
        │  Hardcoded defaults                 │  ◄── FALLBACK
        │  (config-loader.ts)                 │
        └─────────────────────────────────────┘
```

### LiteLLM Auto-Sync

Models enabled via the Admin UI are **automatically registered with the LiteLLM proxy** — no YAML edits or LiteLLM restarts required.

> **Anthropic Claude Note**: Claude models are still registered with LiteLLM (for non-chat services like embeddings), but **chat completions with tool calling bypass LiteLLM entirely** via the `@anthropic-ai/sdk`. This is automatic — `isClaudeModel()` in `openai.ts` detects models with `anthropic/` or `claude-` prefix and routes them to the Anthropic SDK directly. No additional configuration needed beyond having `ANTHROPIC_API_KEY` set.

```
Auto-Sync Flow:

  Admin UI "Add Models"                    App Startup
         │                                      │
         ▼                                      ▼
  POST /api/admin/llm/models          DB migrations complete
         │                                      │
         ▼                                      ▼
  Save to enabled_models DB           syncAllModelsToLiteLLM()
         │                              (re-registers all active
         ▼                               models from DB)
  syncModelToLiteLLM()                          │
         │                                      │
         ▼                                      ▼
  POST litellm:4000/model/new ◄─────── POST litellm:4000/model/new
         │
         ▼
  Model available immediately
  (no restart needed)
```

**How it works:**
- `src/lib/services/litellm-sync.ts` maps each provider ID to the correct LiteLLM prefix and API key env var
- Uses LiteLLM's `/model/new` API with `LITELLM_MASTER_KEY` for auth
- On **model add**: each new model is registered immediately (fire-and-forget)
- On **app startup**: all active models from DB are re-registered (since LiteLLM's in-memory store is lost on restart when `store_model_in_db: false`)
- Models already in YAML are unaffected — `/model/new` returns "already exists" which is silently accepted

**Sync Exceptions — Fireworks AI and Ollama:**

Two providers are intentionally **skipped** from auto-sync and must be defined manually in `litellm_config.yaml`:

| Provider | Reason | DB model ID | LiteLLM format needed |
|----------|--------|------------|----------------------|
| **Fireworks AI** | ID format mismatch — auto-sync can't reconstruct the full path | `fireworks/minimax-m2p5` | `fireworks_ai/accounts/fireworks/models/minimax-m2p5` |
| **Ollama** | No API key — uses `api_base` instead; DB model IDs match actual Ollama model names | `qwen3:4b` | `ollama/qwen3:4b` + `api_base` |

For both providers the sync function returns `true` (treated as success) since the models are already registered via YAML. Auto-syncing them would create broken duplicate entries with incorrect model paths.

**Requirements:**
- `LITELLM_MASTER_KEY` env var must be set
- `OPENAI_BASE_URL` must point to LiteLLM proxy (e.g., `http://litellm:4000/v1`)
- `LITELLM_ADMIN_URL` (optional but recommended) — set to direct LiteLLM URL (e.g., `http://litellm:4000`) to bypass reverse proxy for the `/model/new` management API. If unset, the admin URL is derived by stripping `/v1` from `OPENAI_BASE_URL`, which fails when routed through nginx.

**Startup logs:**
```
[LiteLLM Sync] Startup: synced 17 models (0 failed)
```

### Supported Providers

The system currently supports these LLM providers out of the box:

| Provider | ID | Models Examples | Vision | Auto-Discovery |
|----------|-----|-----------------|--------|----------------|
| **OpenAI** | `openai` | GPT-4.1, GPT-5.x, o1, o3 | Yes | ✅ API |
| **Anthropic** | `anthropic` | Claude Sonnet/Haiku/Opus 4.5/4.6 | Yes | ✅ API |
| **Google** | `gemini` | Gemini 2.5 Pro/Flash | Yes | ✅ API |
| **Mistral** | `mistral` | Mistral Large 3, Small 3.2 | Yes | ✅ API |
| **DeepSeek** | `deepseek` | DeepSeek Chat, Reasoner | No | ✅ API |
| **Ollama** | `ollama` | Llama 3.2, Qwen 2.5, Phi4 | Varies | ✅ API |
| **Fireworks AI** | `fireworks` | MiniMax M2.5, Kimi K2.5, Llama 4 Scout, Qwen3 4B/8B | Some | ⚠️ Curated list (code change required) |

> **Fireworks exception:** New Fireworks models are NOT auto-discovered from the API. They must be added to the `FIREWORKS_MODELS` curated list in `src/lib/services/model-discovery.ts` and to `litellm_config.yaml`. See [Adding a Fireworks Model](#adding-a-fireworks-model).

---

## Quick Reference: What to Update

Use this table to determine what files need updating based on your scenario:

### Scenario 1: Adding a Model from an Existing Provider (e.g., GPT-5.3)

| What | File | Required? |
|------|------|-----------|
| Enable via Admin UI | Web browser | **Yes** (easiest) |
| Update capability patterns | `src/lib/services/model-discovery.ts` | Only if auto-detection fails |

The model is auto-synced to LiteLLM proxy on add — no YAML edit or restart needed.

### Scenario 2: Adding a New Model Family (e.g., GPT-6.x)

| What | File | Required? |
|------|------|-----------|
| Enable via Admin UI | Web browser | **Yes** |
| Add capability patterns | `src/lib/services/model-discovery.ts` | **Yes** |
| Add context windows | `src/lib/services/model-discovery.ts` | Recommended |

YAML is optional — auto-sync registers the model with LiteLLM. But adding capability patterns ensures correct tool/vision flags during discovery.

### Scenario 3: Adding a New Provider (e.g., Cohere, xAI)

| What | File | Required? |
|------|------|-----------|
| Add provider constants | `src/lib/db/llm-providers.ts` | **Yes** |
| Add discovery function | `src/lib/services/model-discovery.ts` | **Yes** |
| Add capability patterns | `src/lib/services/model-discovery.ts` | **Yes** |
| Add to LiteLLM sync map | `src/lib/services/litellm-sync.ts` | **Yes** |

### Scenario 4: Adding a Fireworks AI Model {#adding-a-fireworks-model}

Fireworks uses a **curated list** (not API discovery) and requires **manual YAML** (not auto-sync). All three files must be updated:

| What | File | Required? |
|------|------|-----------|
| Add to curated model list | `src/lib/services/model-discovery.ts` — `FIREWORKS_MODELS` array | **Yes** — drives "Discover" in Admin UI |
| Add to LiteLLM config | `litellm-proxy/litellm_config.yaml` — Fireworks section | **Yes** — LiteLLM routing |
| Seed DB row (for existing deployments) | `src/lib/db/kysely.ts` — `runPostgresMigrations()` | **Yes** — makes model appear in Manage Models without requiring Discover flow |

**Step 1** — `src/lib/services/model-discovery.ts`:
```typescript
{
  id: 'fireworks/your-model-slug',
  name: 'Display Name',
  toolCapable: true,   // check fireworks.ai/models/fireworks/your-model-slug
  visionCapable: false,
  maxInputTokens: 131072,
  maxOutputTokens: 16384,
},
```

**Step 2** — `litellm-proxy/litellm_config.yaml` (under the Fireworks AI section):
```yaml
- model_name: fireworks/your-model-slug
  litellm_params:
    model: fireworks_ai/accounts/fireworks/models/your-model-slug
    api_key: os.environ/FIREWORKS_AI_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: false
    max_input_tokens: 131072
    max_output_tokens: 16384
```

**Step 3** — `src/lib/db/kysely.ts` (inside `runPostgresMigrations`, before the final log):
```typescript
await database
  .insertInto('enabled_models')
  .values({
    id: 'fireworks/your-model-slug',
    provider_id: 'fireworks',
    display_name: 'Display Name',
    tool_capable: 1,
    vision_capable: 0,
    parallel_tool_capable: 1,
    thinking_capable: 0,
    max_input_tokens: 131072,
    max_output_tokens: 16384,
    is_default: 0,
    enabled: 0,
    sort_order: 9900,
  })
  .onConflict(oc => oc.column('id').doNothing())
  .execute();
```

After all three edits: restart the stack. The model appears immediately in **Admin → Settings → LLMs → Manage Models** (disabled). Enable it, and it shows in the chat model selector. The "Discover Fireworks" flow also works as an alternative to the migration step.

---

## Method 1: Admin UI (Recommended)

### Prerequisites

- Admin access to the Policy Bot application
- API key for the provider (OpenAI, Gemini, Mistral, etc.)

### UI Overview

Navigate to **Admin > Settings > LLM**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Settings > LLM                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ┌─── Providers ─────────────────────────────────────────────────────┐   │
│ │                                                                    │   │
│ │  ✓ OpenAI       [••••••••••sk-abc]  [Test] [Edit] [Delete]       │   │
│ │  ✓ Google       [••••••••••AIza...]  [Test] [Edit] [Delete]       │   │
│ │  ○ Mistral      Not configured       [+ Add Key]                  │   │
│ │  ✓ Ollama       http://localhost:11434  [Test] [Edit]             │   │
│ │                                                                    │   │
│ └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│ ┌─── Enabled Models ────────────────────────────────────────────────┐   │
│ │                                                                    │   │
│ │  Provider      Model               Capabilities       [Actions]   │   │
│ │  ─────────────────────────────────────────────────────────────────│   │
│ │  OpenAI        GPT-4.1 Mini ★      🔧 Vision          [⋯]        │   │
│ │  OpenAI        GPT-4.1             🔧 Vision          [⋯]        │   │
│ │  Google        Gemini 2.5 Flash    🔧 Vision          [⋯]        │   │
│ │  Ollama        Llama 3.2           🔧                 [⋯]        │   │
│ │                                                                    │   │
│ │  ★ = Default model   🔧 = Tool support                            │   │
│ │  [⋯] menu: Set Default | Edit | Disable | Remove                  │   │
│ │                                                                    │   │
│ │  [+ Add Models]                    [Manage Deprecated Models]     │   │
│ └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Quick Start: Adding a New Model

#### Step 1: Configure Provider (if needed)

1. Go to **Admin > Settings > LLM**
2. Find the provider (OpenAI, Google, Mistral, Ollama)
3. If showing "Not configured", click **[+ Add Key]**
4. Enter your API key
5. Click **[Test]** to verify the connection
6. Click **[Save]**

#### Step 2: Discover and Enable Models

1. Click **[+ Add Models]** button
2. Select the provider tab (OpenAI, Google, etc.)
3. Browse or search for the model you want

```
┌─────────────────────────────────────────────────────────────────┐
│ Add Models                                                  [X] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Provider:  [OpenAI ▼] [Google] [Mistral] [Ollama]             │
│                                                                 │
│  🔍 Search: [gpt                                    ]          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ gpt-4.1           1M tokens    🔧 Vision   (enabled)  │   │
│  │ ☐ gpt-4.1-mini      1M tokens    🔧 Vision   (enabled)  │   │
│  │ ☑ gpt-4.1-nano      1M tokens    🔧 Vision              │   │
│  │ ☑ gpt-5             2M tokens    🔧 Vision   [NEW]      │   │
│  │ ☑ o3-mini           200K tokens  🔧          [NEW]      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Selected: 3 models                                            │
│                                                                 │
│                              [Cancel]  [Add Selected]          │
└─────────────────────────────────────────────────────────────────┘
```

4. Check the boxes for models you want to enable
5. Click **[Add Selected]**

**Done!** The model is immediately available in the chat dropdown.

#### Step 3: Set as Default (Optional)

1. In the Enabled Models table, find the model
2. Click the **[⋯]** menu
3. Select **Set Default**

### Managing Models

#### Model Actions Menu [⋯]

| Action | Description |
|--------|-------------|
| **Set Default** | Make this the default model for new chats |
| **Edit** | Change display name and max output tokens |
| **Disable** | Hide from dropdown but keep config (can re-enable) |
| **Remove** | Permanently delete from enabled models |

### Advanced: Manual Capability Configuration

The Admin UI's **Edit** action allows changing display name and max output tokens. To manually configure **tool support**, **vision**, and **max input tokens**, use the API directly.

#### API Endpoint

```
PUT /api/admin/llm/models/{model-id}
```

#### Available Fields

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | Human-readable name shown in dropdowns |
| `toolCapable` | boolean | Enable function/tool calling for this model |
| `visionCapable` | boolean | Enable image input support |
| `maxInputTokens` | number | Context window size (informational) |
| `maxOutputTokens` | number | Maximum tokens the model can output per response |
| `isDefault` | boolean | Set as default model for new chats |
| `enabled` | boolean | Show/hide in model dropdown |
| `sortOrder` | number | Position in model list |

#### Examples

**Enable tool support for a model:**

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/gpt-5 \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION" \
  -d '{"toolCapable": true}'
```

**Enable vision support:**

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/gemini-3-pro \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION" \
  -d '{"visionCapable": true}'
```

**Set context window and output token limit:**

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/claude-4-opus \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION" \
  -d '{"maxInputTokens": 200000, "maxOutputTokens": 8000}'
```

**Update multiple capabilities at once:**

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/mistral-next \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION" \
  -d '{
    "displayName": "Mistral Next (Custom)",
    "toolCapable": true,
    "visionCapable": true,
    "maxInputTokens": 128000,
    "maxOutputTokens": 8000
  }'
```

#### Development Mode (AUTH_DISABLED=true)

When running with `AUTH_DISABLED=true` in `.env.local`, you can skip the session cookie:

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/gpt-5 \
  -H "Content-Type: application/json" \
  -d '{"toolCapable": true, "visionCapable": true}'
```

#### Verifying Changes

After updating, verify the model shows correct capabilities:

```bash
curl http://localhost:3000/api/admin/llm/models/gpt-5 \
  -H "Cookie: next-auth.session-token=YOUR_SESSION"
```

Response:

```json
{
  "model": {
    "id": "gpt-5",
    "providerId": "openai",
    "displayName": "GPT-5",
    "toolCapable": true,
    "visionCapable": true,
    "maxInputTokens": 2000000,
    "maxOutputTokens": 16000,
    "isDefault": false,
    "enabled": true,
    "sortOrder": 5
  }
}
```

---

#### Managing Deprecated Models

When providers retire models, they'll appear in the deprecated models manager:

```
┌─────────────────────────────────────────────────────────────────┐
│ Manage Deprecated Models                                    [X] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  These models are no longer available from the provider but    │
│  exist in your enabled models list.                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☑ gpt-4-turbo       OpenAI    (deprecated Jan 2025)     │   │
│  │ ☑ gemini-1.5-pro    Google    (deprecated Dec 2024)     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                    [Cancel]  [Remove Selected (2)]             │
└─────────────────────────────────────────────────────────────────┘
```

1. Click **[Manage Deprecated Models]**
2. Select models to remove
3. Click **[Remove Selected]**

---

## Method 2: YAML Configuration (Alternative)

Use this method for infrastructure-as-code deployments or when Admin UI is not available.

### Prerequisites

- LiteLLM proxy running (`docker compose up litellm`)
- API key for the provider
- Access to edit `litellm-proxy/litellm_config.yaml`

### Quick Start

#### Step 1: Edit LiteLLM Config

Edit `litellm-proxy/litellm_config.yaml` and add your model:

```yaml
model_list:
  # ... existing models ...

  - model_name: gpt-5
    litellm_params:
      model: gpt-5
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      supports_function_calling: true
      supports_vision: true
      max_input_tokens: 2000000
```

#### Step 2: Restart Application

```bash
# Production
npm run build && npm start

# Development
npm run dev
```

**Done!** The model will be auto-discovered with:
- Display name: `GPT-5` (auto-generated)
- Provider: `openai` (auto-detected)
- Tool support: enabled (from `model_info`)
- Default settings: based on model tier

Check startup logs for confirmation:
```
[LiteLLM] Discovered 12 models from YAML config
```

### model_info Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `supports_function_calling` | boolean | `false` | Enables tool/function calling |
| `supports_vision` | boolean | `false` | Enables image input support |
| `max_input_tokens` | number | - | Context window size (informational) |

**Important:** If `model_info` is omitted entirely, the model defaults to no tool support and no vision.

### Provider Examples

#### OpenAI

```yaml
- model_name: gpt-5
  litellm_params:
    model: gpt-5
    api_key: os.environ/OPENAI_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: true
    max_input_tokens: 2000000
```

#### Anthropic Claude

```yaml
- model_name: claude-sonnet-4-5
  litellm_params:
    model: anthropic/claude-sonnet-4-5-20250929
    api_key: os.environ/ANTHROPIC_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: true
    max_input_tokens: 1000000
```

#### Google Gemini

```yaml
- model_name: gemini-3-pro
  litellm_params:
    model: gemini/gemini-3-pro
    api_key: os.environ/GEMINI_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: true
    max_input_tokens: 2000000
```

#### Mistral

```yaml
- model_name: mistral-next
  litellm_params:
    model: mistral/mistral-next
    api_key: os.environ/MISTRAL_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: true
```

#### DeepSeek

```yaml
- model_name: deepseek-chat
  litellm_params:
    model: deepseek/deepseek-chat
    api_key: os.environ/DEEPSEEK_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: false  # DeepSeek does NOT support vision
    max_input_tokens: 128000
```

#### Ollama (Local)

```yaml
- model_name: ollama-llama4
  litellm_params:
    model: ollama/llama4
    api_base: os.environ/OLLAMA_API_BASE
  model_info:
    supports_function_calling: true
```

#### Fireworks AI

> **Important:** Fireworks models are **not** auto-synced to LiteLLM. Every Fireworks model must be added here manually. The DB model ID (`fireworks/model-name`) does not match the LiteLLM path format (`fireworks_ai/accounts/fireworks/models/model-name`).
>
> You must also add the model to the `FIREWORKS_MODELS` curated list in `src/lib/services/model-discovery.ts` so it appears in the Admin UI discovery flow.

```yaml
- model_name: fireworks/minimax-m2p5       # Must match the ID in FIREWORKS_MODELS
  litellm_params:
    model: fireworks_ai/accounts/fireworks/models/minimax-m2p5  # Full Fireworks API path
    api_key: os.environ/FIREWORKS_AI_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: true
    max_input_tokens: 1000000
    max_output_tokens: 16384

- model_name: fireworks/llama4-scout-instruct-basic
  litellm_params:
    model: fireworks_ai/accounts/fireworks/models/llama4-scout-instruct-basic
    api_key: os.environ/FIREWORKS_AI_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: true
    max_input_tokens: 1048576
    max_output_tokens: 16384
```

**Pattern:** the `model_name` is always `fireworks/{model-slug}` and the `litellm_params.model` is always `fireworks_ai/accounts/fireworks/models/{model-slug}`.

#### Azure OpenAI

```yaml
- model_name: azure-gpt4
  litellm_params:
    model: azure/gpt-4-deployment
    api_key: os.environ/AZURE_API_KEY
    api_base: os.environ/AZURE_API_BASE
    api_version: "2024-02-01"
  model_info:
    supports_function_calling: true
    supports_vision: true
```

### Auto-Generated Settings

#### Display Names

Model IDs are automatically converted to human-friendly names:

| Model ID | Generated Name |
|----------|----------------|
| `gpt-5` | GPT-5 |
| `gpt-4.1-mini` | GPT-4.1 Mini |
| `gemini-2.5-flash` | Gemini 2.5 Flash |
| `ollama-llama3.2` | Ollama Llama 3.2 |
| `mistral-small-3.2` | Mistral Small 3.2 |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 |
| `deepseek-reasoner` | DeepSeek Reasoner |

#### Provider Detection

Providers are detected from the `litellm_params.model` prefix:

| Model Path | Detected Provider |
|------------|-------------------|
| `gemini/gemini-2.5-flash` | gemini |
| `mistral/mistral-large` | mistral |
| `ollama/llama3.2` | ollama |
| `azure/gpt-4` | azure |
| `anthropic/claude-...` | anthropic |
| `deepseek/deepseek-...` | deepseek |
| `gpt-4.1-mini` (no prefix) | openai |

#### Tier-Based Defaults

Settings are automatically applied based on keywords in the model ID:

| Tier Keywords | Temperature | Max Output Tokens |
|---------------|-------------|-------------------|
| `pro`, `large`, `opus` | 0.1 | 8000 |
| `mini`, `flash`, `small`, `haiku` | 0.2 | 3000 |
| `nano`, `lite` | 0.2 | 1000 |
| (none matched) | 0.2 | 2000 |

---

## Adding a New Provider

If you need to add support for a completely new LLM provider (e.g., Cohere, xAI, Together AI), follow these steps:

### Step 1: Add Provider Constants

Edit `src/lib/db/llm-providers.ts`:

```typescript
// Add to DEFAULT_PROVIDERS array (around line 48-55)
export const DEFAULT_PROVIDERS: Omit<LLMProvider, 'createdAt' | 'updatedAt'>[] = [
  { id: 'openai', name: 'OpenAI', apiKey: null, apiBase: null, enabled: true },
  // ... existing providers ...
  { id: 'cohere', name: 'Cohere', apiKey: null, apiBase: null, enabled: true },  // ADD THIS
];

// Add to PROVIDER_ENV_KEYS (around line 58-65)
const PROVIDER_ENV_KEYS: Record<string, { apiKey?: string; apiBase?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY' },
  // ... existing providers ...
  cohere: { apiKey: 'COHERE_API_KEY' },  // ADD THIS
};
```

### Step 2: Add Discovery Function

Edit `src/lib/services/model-discovery.ts`:

```typescript
// Add discovery function (after other discover functions, around line 460)
/**
 * Discover models from Cohere API
 */
async function discoverCohereModels(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch('https://api.cohere.ai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Cohere API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { models: Array<{ name: string; endpoints: string[] }> };

  return data.models
    .filter(m => m.endpoints?.includes('chat') && isChatModel(m.name))
    .map(m => ({
      id: m.name,
      name: generateDisplayName(m.name),
      provider: 'cohere',
      toolCapable: isToolCapable(m.name),
      visionCapable: isVisionCapable(m.name),
      maxInputTokens: getContextWindow(m.name),
      maxOutputTokens: getDefaultOutputTokens('cohere'),
      isEnabled: !!getEnabledModel(m.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

### Step 3: Add to Discovery Switch

In the same file, add case to `discoverModels()` function (around line 470-530):

```typescript
export async function discoverModels(provider: string): Promise<DiscoveryResult> {
  try {
    let models: DiscoveredModel[];

    switch (provider) {
      // ... existing cases ...

      case 'cohere': {
        const apiKey = getProviderApiKey('cohere');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverCohereModels(apiKey);
        break;
      }

      default:
        return { success: false, provider, models: [], error: `Unknown provider: ${provider}` };
    }

    return { success: true, provider, models };
  } catch (error) {
    // ... error handling ...
  }
}
```

### Step 4: Add Default Output Tokens

In `src/lib/services/model-discovery.ts`, add to `DEFAULT_OUTPUT_TOKENS` (around line 127-134):

```typescript
const DEFAULT_OUTPUT_TOKENS: Record<string, number> = {
  deepseek: 8000,
  ollama: 2000,
  openai: 16000,
  anthropic: 16000,
  gemini: 16000,
  mistral: 16000,
  cohere: 4000,  // ADD THIS - check provider docs for actual limit
};
```

### Step 5: Update discoverAllModels

Add to the providers list in `discoverAllModels()` function (around line 570):

```typescript
export async function discoverAllModels(): Promise<{...}> {
  const providers = ['openai', 'gemini', 'mistral', 'ollama', 'anthropic', 'deepseek', 'cohere'];  // ADD 'cohere'
  // ...
}
```

### Step 6: Add Capability Patterns

See [Capability Detection Patterns](#capability-detection-patterns) section below.

### Step 7: Add to LiteLLM Sync Map

Edit `src/lib/services/litellm-sync.ts` and add the provider to `PROVIDER_MAP`:

```typescript
const PROVIDER_MAP: Record<string, { prefix: string; envKey: string }> = {
  openai:    { prefix: 'openai/',    envKey: 'OPENAI_API_KEY' },
  anthropic: { prefix: 'anthropic/', envKey: 'ANTHROPIC_API_KEY' },
  gemini:    { prefix: 'gemini/',    envKey: 'GEMINI_API_KEY' },
  mistral:   { prefix: 'mistral/',   envKey: 'MISTRAL_API_KEY' },
  deepseek:  { prefix: 'deepseek/',  envKey: 'DEEPSEEK_API_KEY' },
  ollama:    { prefix: 'ollama/',    envKey: '' },
  cohere:    { prefix: 'cohere/',    envKey: 'COHERE_API_KEY' },  // ADD THIS
};
```

This ensures models from the new provider are auto-registered with LiteLLM when added via Admin UI.

### Step 8: Test

1. Add API key to `.env.local`: `COHERE_API_KEY=your-key`
2. Restart the application
3. Go to **Admin > Settings > LLM** and verify provider appears
4. Click **Test** to verify connection
5. Click **Add Models** to discover available models
6. Check server logs for: `[LiteLLM Sync] Startup: synced N models`

---

## Capability Detection Patterns

When models are discovered via the Admin UI, capabilities are auto-detected using regex patterns. These patterns are defined in `src/lib/services/model-discovery.ts`.

### Understanding the Pattern System

The system checks model IDs against these pattern arrays to determine capabilities:

```
Model ID: "gpt-4.1-mini"
           ↓
    Check TOOL_CAPABLE_PATTERNS → matches /^gpt-4/ → toolCapable: true
           ↓
    Check VISION_CAPABLE_PATTERNS → matches /^gpt-4\.1/ → visionCapable: true
           ↓
    Check PARALLEL_TOOL_CAPABLE_PATTERNS → matches /^gpt-4\.1/ → parallelToolCapable: true
           ↓
    Check THINKING_CAPABLE_PATTERNS → no match → thinkingCapable: false
           ↓
    Check CONTEXT_WINDOWS → matches 'gpt-4.1-mini' → maxInputTokens: 1000000
```

### TOOL_CAPABLE_PATTERNS

**Location:** `src/lib/services/model-discovery.ts` (lines 34-59)

Models matching these patterns will have **function/tool calling** enabled:

```typescript
const TOOL_CAPABLE_PATTERNS = [
  // OpenAI
  /^gpt-4/,
  /^gpt-5/,
  /^gpt-3\.5-turbo/,
  /^o1/,
  /^o3/,
  /^o4/,
  // Gemini
  /^gemini/,
  // Mistral
  /^mistral-large/,
  /^mistral-small/,
  /^mistral-medium/,
  /^codestral/,
  /^pixtral/,
  // Anthropic Claude
  /^claude/,
  // DeepSeek
  /^deepseek/,
  // Ollama (some models)
  /^llama3/,
  /^llama4/,
  /^qwen/,
  /^mistral$/,
];
```

**To add a new model family:** Add a regex pattern that matches the model ID prefix.

Example - Adding support for "gpt-6" models:
```typescript
/^gpt-6/,  // Add this line
```

### VISION_CAPABLE_PATTERNS

**Location:** `src/lib/services/model-discovery.ts` (lines 62-81)

Models matching these patterns will have **image/vision input** enabled:

```typescript
const VISION_CAPABLE_PATTERNS = [
  // OpenAI
  /^gpt-4o/,
  /^gpt-4-turbo/,
  /^gpt-4\.1/,
  /^gpt-5/,
  /^o1/,
  /^o3/,
  /^o4/,
  // Gemini
  /^gemini-2/,
  /^gemini-1\.5/,
  // Mistral
  /^pixtral/,
  /^mistral-large/,
  /^mistral-small-3/,
  // Anthropic Claude (all Claude 3+ models support vision)
  /^claude/,
  // Note: DeepSeek does NOT support vision - intentionally excluded
];
```

**Important:** Some providers (like DeepSeek) do not support vision. Do NOT add them to this list.

### PARALLEL_TOOL_CAPABLE_PATTERNS

**Location:** `src/lib/services/model-discovery.ts`

Models matching these patterns will execute **multiple tool calls concurrently** (via `Promise.allSettled`) instead of sequentially:

```typescript
const PARALLEL_TOOL_CAPABLE_PATTERNS = [
  /^claude/,              // Anthropic — excellent multi-tool support
  /^gemini/,              // Google Gemini — full parallel + compositional
  /^mistral-large/,       // Mistral Large — trained for parallel and sequential
  /^gpt-4\.1/,            // OpenAI GPT-4.1 family
  /^gpt-5-nano/,          // GPT-5 Nano
  /^gpt-5\.2/,            // GPT-5.2+ fixed parallel regression
  /^gpt-5\.3/,
  /^gpt-5\.4/,
  /^fireworks\//,          // Fireworks-hosted models
  /^accounts\/fireworks/,
];
```

**NOT parallel capable (default=false):** GPT-5 (base, ~90% failure rate on parallel calls), DeepSeek-chat, Ollama models, o1/o3/o4 reasoning models.

### THINKING_CAPABLE_PATTERNS

**Location:** `src/lib/services/model-discovery.ts`

Models matching these patterns output **reasoning/thinking content** (native thinking blocks or `<think>` tags):

```typescript
const THINKING_CAPABLE_PATTERNS = [
  /^claude/,       // Anthropic native thinking blocks
  /^qwen3/,        // Qwen3 — <think> tags
  /^qwq/,          // QwQ — <think> tags
  /^deepseek-r/,   // DeepSeek-R1 — <think> tags
  /^o1/,           // OpenAI o1
  /^o3/,           // OpenAI o3
  /^o4/,           // OpenAI o4
];
```

### CONTEXT_WINDOWS

**Location:** `src/lib/services/model-discovery.ts` (lines 84-124)

Known context window sizes (max input tokens) for specific models:

```typescript
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI - GPT-5 family
  'gpt-5': 1000000,
  'gpt-5.1': 1000000,
  'gpt-5.2': 1000000,
  'gpt-5.4': 1000000,
  'gpt-5-mini': 1000000,
  'gpt-5-nano': 1000000,
  // OpenAI - GPT-4 family
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  'gpt-4.1-nano': 1000000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4o-mini-transcribe': 128000,
  // ... more models ...
  // Gemini
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
  'gemini-pro-latest': 1049000,
  'gemini-flash-latest': 1049000,
  'gemini-flash-lite-latest': 1049000,
  // Anthropic Claude
  'claude-sonnet-4-6': 1000000,
  'claude-opus-4-6': 1000000,
  'claude-sonnet-4-5': 1000000,
  'claude-haiku-4-5': 1000000,
  'claude-opus-4-5': 1000000,
  // DeepSeek
  'deepseek-reasoner': 64000,
  'deepseek-chat': 128000,
};
```

**To add a new model:** Add the exact model ID as key and token count as value.

### DEFAULT_OUTPUT_TOKENS

**Location:** `src/lib/services/model-discovery.ts` (lines 127-134)

Default maximum output tokens when a model is discovered (provider-level defaults):

```typescript
const DEFAULT_OUTPUT_TOKENS: Record<string, number> = {
  deepseek: 8000,
  ollama: 2000,
  openai: 16000,
  anthropic: 16000,
  gemini: 16000,
  mistral: 16000,
};
```

These defaults are used when:
1. A model is first discovered via Admin UI
2. No per-model output limit is set

---

## Per-Model Token Settings

### Understanding Token Limits

Each model has two token-related settings:

| Setting | Description | Where Set |
|---------|-------------|-----------|
| **Max Input Tokens** | Context window size - how much text the model can read | Auto-detected or YAML `max_input_tokens` |
| **Max Output Tokens** | Maximum response length - how much text the model can generate | Per-model in Admin UI or via API |

### Setting Max Output Tokens

#### Via Admin UI

1. Go to **Admin > Settings > LLM**
2. Find the model in the Enabled Models table
3. Click **[⋯]** menu → **Edit**
4. Update the **Max Output Tokens** field
5. Click **Save**

#### Via API

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/gpt-4.1-mini \
  -H "Content-Type: application/json" \
  -d '{"maxOutputTokens": 4000}'
```

### Provider Default Output Tokens

When models are discovered, they inherit default output token limits based on provider:

| Provider | Default Max Output | Notes |
|----------|-------------------|-------|
| OpenAI | 16,000 | GPT-4.1+ support higher limits |
| Anthropic | 16,000 | Claude 4.5 supports up to 64K |
| Gemini | 16,000 | Gemini 2.5 supports up to 65K |
| Mistral | 16,000 | - |
| DeepSeek | 8,000 | Reasoning model may need more |
| Ollama | 2,000 | Local models vary significantly |

### Database Storage

Token settings are stored in the `enabled_models` table:

```sql
CREATE TABLE enabled_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  tool_capable INTEGER DEFAULT 0,
  vision_capable INTEGER DEFAULT 0,
  parallel_tool_capable INTEGER DEFAULT 0,
  thinking_capable INTEGER DEFAULT 0,
  max_input_tokens INTEGER,   -- Context window (nullable)
  max_output_tokens INTEGER,  -- Per-model output limit (nullable)
  -- ... other fields
);
```

If `max_output_tokens` is NULL, the system uses the provider default from `DEFAULT_OUTPUT_TOKENS`.

---

## Setting as Default Model

### Option 1: Admin UI (Recommended)

1. Go to **Admin > Settings > LLM**
2. In the Enabled Models table, click **[⋯]** menu
3. Select **Set Default**

### Option 3: Code Change

Edit `src/lib/config-loader.ts`:

```typescript
// In getHardcodedDefaults()
llm: {
  model: 'gpt-5',  // Change to new model ID
  // ...
},
defaultPreset: 'gpt-5',
```

This affects:
- Default model for new chats
- Fallback model for utility functions
- Agent executor default

---

## Verification Checklist

After adding a new model:

- [ ] Model appears in **Admin > Settings > LLM** (if using Admin UI)
- [ ] Startup logs show: `[LiteLLM Sync] Startup: synced N models` (auto-sync)
- [ ] OR startup logs show: `[LiteLLM] Discovered N models` (if using YAML only)
- [ ] Model appears in chat model dropdown
- [ ] Tool badge (🔧) appears if tool-capable
- [ ] Vision badge appears if vision-capable (for models with image support)
- [ ] Chat works with new model selected
- [ ] Translation tool shows model (for openai/gemini/mistral providers)
- [ ] Max output tokens displays correctly in model info

### Capability Verification

If capabilities weren't auto-detected correctly:

1. Check model in LLM - does it show 🔧 (tools) / Vision badges?
2. If not, check if model ID matches patterns in `model-discovery.ts`
3. Update via API if needed (see "Advanced: Manual Capability Configuration")
4. Verify tools work by asking the model to use a function (e.g., "search for X")
5. Verify vision works by uploading an image in chat
6. Check `/api/config/capabilities` returns expected strategy

### Vision Capability Runtime Behavior

When images are uploaded, the system checks capabilities at runtime:

| Model Vision | OCR Configured | Strategy | User Experience |
|--------------|---------------|----------|-----------------|
| ✅ Yes | ✅ Yes | `vision-and-ocr` | Full visual analysis + OCR text extraction |
| ✅ Yes | ❌ No | `vision-only` | Visual analysis only |
| ❌ No | ✅ Yes | `ocr-only` | Text extracted via OCR, yellow warning shown |
| ❌ No | ❌ No | `none` | Upload blocked, red error shown |

The capability checker (`src/lib/config-capability-checker.ts`) uses:
- `enabled_models.vision_capable` from database (authoritative source)
- OCR settings from admin config (Mistral OCR or Azure DI for images)

---

## Troubleshooting

### Admin UI Issues

#### Provider test fails
1. Verify API key is correct and has not expired
2. Check provider's status page for outages
3. Ensure firewall allows outbound HTTPS

#### Models not showing after discovery
1. Check if provider has API key configured
2. Try clicking refresh/discover again
3. Check browser console for errors

#### Database fallback not working
1. Verify `hasEnabledModels()` returns true
2. Check database connection in startup logs
3. Restart application to reinitialize

#### Model capabilities not detected correctly
1. Check if model ID matches patterns in `src/lib/services/model-discovery.ts`
2. Add new pattern if needed (see [Capability Detection Patterns](#capability-detection-patterns))
3. Or use the API to manually set capabilities:
   ```bash
   curl -X PUT http://localhost:3000/api/admin/llm/models/MODEL_ID \
     -H "Content-Type: application/json" \
     -d '{"toolCapable": true, "visionCapable": true}'
   ```
4. Verify changes in LLM page

### Auto-Sync Issues

#### Models added via UI but not working in chat

1. **Check `LITELLM_MASTER_KEY` is set** — required for auto-sync to authenticate with LiteLLM
2. **Check server logs** for sync errors:
   - `[LiteLLM Sync] LITELLM_MASTER_KEY not set, skipping sync` — set the env var
   - `[LiteLLM Sync] Unknown provider: xxx` — add provider to `PROVIDER_MAP` in `litellm-sync.ts`
   - `[LiteLLM Sync] Failed to register xxx: 400` — check LiteLLM proxy logs
3. **Verify LiteLLM proxy is reachable** from the app container:
   ```bash
   # From within the app container
   curl http://litellm:4000/health/liveliness
   ```
4. **Check LiteLLM `DATABASE_URL` is cleared** — if LiteLLM inherits the app's `DATABASE_URL`, it returns `400 No connected db` errors. Ensure `docker-compose.yml` has `- DATABASE_URL=` in the LiteLLM environment.

#### Models disappear after LiteLLM restart

This is expected. With `store_model_in_db: false`, LiteLLM's in-memory store is cleared on restart. Models from YAML are reloaded, and the app's startup sync re-registers DB models. If the app doesn't restart, wait for the next request — models are re-synced on next app startup.

### YAML Configuration Issues

#### Model not appearing in UI

1. **Check YAML syntax:**
   ```bash
   npx yaml-lint litellm-proxy/litellm_config.yaml
   ```

2. **Verify LiteLLM proxy is running:**
   ```bash
   docker ps | grep litellm
   ```

3. **Check startup logs:**
   - `[LiteLLM] Discovered N models` - success
   - `[Config] Using hardcoded defaults` - YAML not found
   - `[LiteLLM] Failed to parse config` - YAML error

4. **Rebuild application:**
   ```bash
   npm run build
   ```

#### Vision/image upload not working

1. Check model has `visionCapable: true` in database
2. Verify OCR is configured (Admin > Settings > Document Processing):
   - Mistral OCR requires `MISTRAL_API_KEY` or admin-configured key
   - Azure DI requires endpoint + key configured
3. Check `/api/config/capabilities` response:
   ```bash
   curl http://localhost:3000/api/config/capabilities
   ```
4. If strategy is `none`, either:
   - Enable OCR provider in admin settings
   - Switch to a vision-capable model (GPT-4.1/5.x, Claude 4.5, Gemini 2.5, Pixtral)
5. If strategy is `ocr-only`, images are processed but only text is extracted

#### Tools not working with model

1. Verify `model_info.supports_function_calling: true` is set
2. Check provider documentation to confirm model supports function calling
3. Test model directly:
   ```bash
   curl -X POST http://localhost:4000/v1/chat/completions \
     -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gpt-5",
       "messages": [{"role": "user", "content": "test"}],
       "tools": [{"type": "function", "function": {"name": "test", "parameters": {}}}]
     }'
   ```

#### Model connection errors

1. **Check API key:**
   ```bash
   echo $OPENAI_API_KEY  # or relevant provider key
   ```

2. **Check LiteLLM proxy logs:**
   ```bash
   docker logs litellm-proxy --tail 50
   ```

3. **Test model via proxy:**
   ```bash
   curl -X POST http://localhost:4000/v1/chat/completions \
     -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "gpt-5", "messages": [{"role": "user", "content": "test"}]}'
   ```

---

## Files Reference

### Quick Reference by Task

| Task | Primary File(s) |
|------|-----------------|
| Add model via UI | Admin UI (no code changes — auto-synced to LiteLLM) |
| Add model via YAML | `litellm-proxy/litellm_config.yaml` |
| Fix capability detection | `src/lib/services/model-discovery.ts` |
| Add new provider | `src/lib/db/llm-providers.ts` + `src/lib/services/model-discovery.ts` + `src/lib/services/litellm-sync.ts` |
| Change default model | `src/lib/config-loader.ts` |
| Debug model issues | Check `enabled_models` table in database |

### Admin UI Files

| File | Purpose |
|------|---------|
| `src/lib/db/llm-providers.ts` | Provider CRUD operations, `DEFAULT_PROVIDERS` |
| `src/lib/db/enabled-models.ts` | Enabled models CRUD, capability helpers |
| `src/lib/services/model-discovery.ts` | Provider API discovery, capability patterns |
| `src/components/admin/settings/UnifiedLLMSettings.tsx` | Main LLM settings UI |
| `src/components/admin/settings/ProviderCard.tsx` | Provider configuration cards |
| `src/components/admin/settings/ModelDiscoveryModal.tsx` | Model browser/selector modal |
| `src/app/api/admin/llm/providers/route.ts` | Provider list/create API |
| `src/app/api/admin/llm/providers/[id]/route.ts` | Provider update/delete API |
| `src/app/api/admin/llm/providers/[id]/test/route.ts` | Test provider connection API |
| `src/app/api/admin/llm/models/route.ts` | Enabled models list/batch-create API |
| `src/app/api/admin/llm/models/[id]/route.ts` | Model update/delete API |
| `src/app/api/admin/llm/discover/route.ts` | Model discovery API |

### Core Configuration Files

| File | Purpose |
|------|---------|
| `litellm-proxy/litellm_config.yaml` | LiteLLM model routing + capabilities (bootstrap config) |
| `src/lib/services/litellm-sync.ts` | Auto-registers enabled models with LiteLLM proxy via `/model/new` API; clears YAML cache after sync |
| `src/lib/openai.ts` | `isClaudeModel()` detection, `getAnthropicClient()`, `streamAnthropicCompletion()` — Claude direct SDK path |
| `src/lib/litellm-validator.ts` | YAML parsing, model discovery, display name generation |
| `src/lib/config-loader.ts` | Model presets API, fallback defaults |
| `src/lib/db/config.ts` | `getAvailableModels()` with DB-first priority |
| `src/lib/constants.ts` | Re-exports `isToolCapableModel()` |

### Database Schema

| Table | Purpose |
|-------|---------|
| `llm_providers` | Provider configurations (id, name, api_key, api_base, enabled) |
| `enabled_models` | Model configurations (id, provider_id, display_name, tool_capable, vision_capable, parallel_tool_capable, thinking_capable, max_input_tokens, max_output_tokens, is_default, enabled, sort_order) |

---

## Model Types

The system automatically filters models by type:

| Type | Detection | Used For |
|------|-----------|----------|
| **Chat** | Default | LLM conversations, tools |
| **Embedding** | Name contains `embed` | RAG vector search |
| **Transcription** | Name contains `whisper` or `voxtral` | Audio transcription |

Only **chat** models appear in the LLM selection dropdown. Embedding and transcription models are used by their respective subsystems.

---

## Specialized Model Settings

Besides chat models, the system uses specialized models for various features. API keys configured in **LLM** are shared across all features.

| Feature | Model(s) | Configure In | File |
|---------|----------|--------------|------|
| **Embeddings** | text-embedding-3-large | Settings → RAG | `src/lib/openai.ts` |
| **Transcription** | whisper-1 | Hardcoded | `src/lib/openai.ts` |
| **Image Generation** | DALL-E 3, Gemini Imagen | tool_config | `src/lib/image-gen/` |
| **Translation** | gpt-4.1-mini, gemini-2.5-flash | tool_config | `src/lib/translation/` |
| **Document Processing** | mammoth, exceljs, officeparser (local); Mistral OCR, Azure DI (API); pdf-parse (local) | Settings → Doc Processing | `src/lib/document-extractor.ts` |
| **Reranker** | BGE Large/Base, Cohere, Local | Settings → Reranker | `src/lib/reranker.ts` |

### Using Centralized API Keys

Tools should use the provider helpers instead of reading environment variables directly:

```typescript
import { getApiKey, getApiBase, isProviderConfigured } from '@/lib/provider-helpers';

// Get API key (checks Admin UI config first, then env var)
const openaiKey = getApiKey('openai');
const geminiKey = getApiKey('gemini');
const mistralKey = getApiKey('mistral');

// Get API base URL (for Ollama or custom endpoints)
const ollamaBase = getApiBase('ollama');

// Check if provider is configured
if (isProviderConfigured('openai')) {
  // Provider has API key available
}
```

This ensures:
1. API keys configured via Admin UI take precedence
2. Falls back to environment variables if not in Admin UI
3. Single source of truth for provider configuration

---

## Fallback Behavior

The system has built-in fallback for resilience:

1. **Database available:** Models from Admin UI take precedence
2. **No DB models:** Falls back to YAML parsing
3. **YAML unavailable:** Falls back to hardcoded defaults in `config-loader.ts`

This ensures the app remains functional even if configuration sources are unavailable.
