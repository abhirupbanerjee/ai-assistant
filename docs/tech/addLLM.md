# Adding a New LLM Model

> **Last updated:** June 2026 — Post-migration: LiteLLM removed. All providers use direct native SDKs/APIs across Routes 2 (Direct), 3 (Ollama), and 5 (Aggregators). Models are enabled via Admin UI → DB; no proxy or YAML configuration needed. See [`docs/features/LLM.md`](../../features/LLM.md) for the authoritative LLM architecture reference.

This guide explains how to add a new LLM model to the Policy Bot system.

## Table of Contents

- [Overview](#overview)
- [Auto-Discovery vs Code Changes](#auto-discovery-vs-code-changes)
- [Route Awareness](#route-awareness)
- [Quick Reference: What to Update](#quick-reference-what-to-update)
- [Method 1: Admin UI (Recommended)](#method-1-admin-ui-recommended)
- [Adding a Fireworks AI Model](#adding-a-fireworks-model)
- [Adding a New Provider](#adding-a-new-provider)
- [Capability Detection Patterns](#capability-detection-patterns)
- [Per-Model Token Settings](#per-model-token-settings)
- [Verification Checklist](#verification-checklist)
- [Troubleshooting](#troubleshooting)
- [Files Reference](#files-reference)

---

## Overview

Models are discovered and enabled through the Admin UI, stored in the `enabled_models` database table. All providers use **direct native SDKs/APIs** — no LiteLLM proxy, no YAML configuration, no sync services.

### Architecture Overview

```
Model Configuration Priority:

        ┌─────────────────────────────────────┐
        │  Admin UI → Database                │  ◄── PRIMARY
        │  (llm_providers, enabled_models)    │
        └─────────────────────────────────────┘
                        │
                        ▼ (fallback if no DB models)
        ┌─────────────────────────────────────┐
        │  Hardcoded defaults                 │  ◄── FALLBACK
        │  (config-loader.ts)                 │
        └─────────────────────────────────────┘
```

Models added via Admin UI are saved directly to the database and available immediately — no restart, no proxy registration, no YAML edits.

---

## Auto-Discovery vs Code Changes

### Automatic Discovery (No Code Changes)

For most providers, new models are **automatically discovered** when you click "Add Models" in the Admin UI. The model's ID is fetched from the provider API, matched against capability patterns, and inserted into the `enabled_models` table.

| Provider | API Endpoint | New Models Auto-Discovered |
|----------|--------------|---------------------------|
| **OpenAI** | `api.openai.com/v1/models` | ✅ Yes — models appear immediately |
| **Anthropic** | `api.anthropic.com/v1/models` | ✅ Yes |
| **Gemini** | `generativelanguage.googleapis.com/v1beta/models` | ✅ Yes |
| **Mistral** | `api.mistral.ai/v1/models` | ✅ Yes |
| **DeepSeek** | `api.deepseek.com/models` | ✅ Yes |
| **Ollama** | `{apiBase}/api/tags` | ✅ Yes |
| **Ollama Cloud** | `ollama.com/api/tags` | ✅ Yes |
| **Fireworks AI** | Curated list (`FIREWORKS_MODELS` array) | ⚠️ Code change required for new models |

### When Code Changes ARE Required

| Scenario | What to Update | Example |
|----------|---------------|---------|
| **New model family** (different naming pattern) | Add capability detection patterns | GPT-6.x, Gemini 3.x, o5-series |
| **Model has different capabilities than pattern suggests** | Override via Admin UI API or add specific pattern | A mini model that supports vision |
| **New Fireworks model** | Add to `FIREWORKS_MODELS` curated list | New Fireworks-hosted model |

### Capability Detection for New Model Families

When a provider releases a new model **family** (e.g., GPT-6, Gemini 3, o5), the model will be auto-discovered from the API but **capability flags will be incorrect** until patterns are added:

> **Example — GPT-6 series:** The current patterns have `/^gpt-5/` but NOT `/^gpt-6/`. When OpenAI releases GPT-6 models, they will appear in the "Add Models" dialog but will NOT be flagged as tool-capable, vision-capable, or parallel-tool-capable. An admin must add the patterns below.

```typescript
// In TOOL_CAPABLE_PATTERNS - add:
/^gpt-6/,

// In VISION_CAPABLE_PATTERNS - add if the family supports vision:
/^gpt-6/,

// In PARALLEL_TOOL_CAPABLE_PATTERNS - add if the model reliably handles multiple tool calls:
/^gpt-6/,
```

Without these patterns, auto-discovered models will appear but may not have correct capability flags (tool, vision, parallel, thinking).

---

## Route Awareness

New models are automatically classified into one of three routes based on their ID prefix:

| Route | Model ID Prefixes | Provider IDs |
|-------|------------------|--------------|
| **Route 2** (Direct) | `openai/`, `gpt-`, `o1`, `o3`, `o4`, `anthropic/`, `claude-`, `gemini/`, `gemini-`, `mistral/`, `codestral/`, `pixtral/`, `deepseek-`, `deepseek/`, `moonshot/` | `openai`, `anthropic`, `gemini`, `mistral`, `deepseek`, `moonshot` |
| **Route 3** (Local / Ollama) | `ollama-`, `ollama/` | `ollama` |
| **Route 5** (Aggregators) | `azure-foundry/`, `fireworks/`, `ollama-cloud/`, `*-cloud`, `*:cloud` | `azure-foundry`, `fireworks`, `ollama-cloud` |

Route 5 is checked **first** in model filtering. Classification is handled by [`src/lib/llm-fallback.ts`](../../src/lib/llm-fallback.ts) — no manual route mapping needed when adding models.

---

## Quick Reference: What to Update

Use this table to determine what files need updating based on your scenario:

### Scenario 1: Adding a Model from an Existing Provider (e.g., GPT-5.3)

| What | File | Required? |
|------|------|-----------|
| Enable via Admin UI | Web browser | **Yes** (easiest) |
| Update capability patterns | `src/lib/services/model-discovery.ts` | Only if auto-detection fails |

The model is enabled immediately via Admin UI → database — no restart, no proxy, no YAML.

### Scenario 2: Adding a New Model Family (e.g., GPT-6.x)

| What | File | Required? |
|------|------|-----------|
| Enable via Admin UI | Web browser | **Yes** |
| Add capability patterns | `src/lib/services/model-discovery.ts` | **Yes** — without patterns, tool/vision/parallel/thinking flags will be wrong |
| Add context windows | `src/lib/services/model-discovery.ts` | Recommended |

### Scenario 3: Adding a New Provider (e.g., Cohere, xAI)

| What | File | Required? |
|------|------|-----------|
| Add provider constants | `src/lib/db/llm-providers.ts` | **Yes** |
| Add discovery function | `src/lib/services/model-discovery.ts` | **Yes** |
| Add capability patterns | `src/lib/services/model-discovery.ts` | **Yes** |
| Add route classification | `src/lib/llm-fallback.ts` | **Yes** — add to `isRoute2/3/5Model()` |

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

**Done!** The model is immediately available in the chat dropdown — no restart, no proxy registration, no YAML edits.

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

#### Development Mode (AUTH_DISABLED=true)

When running with `AUTH_DISABLED=true` in `.env.local`, you can skip the session cookie:

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/gpt-5 \
  -H "Content-Type: application/json" \
  -d '{"toolCapable": true, "visionCapable": true}'
```

#### Verifying Changes

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

---

## Adding a Fireworks AI Model

Fireworks AI uses a **curated list** (not API discovery). New Fireworks models require code changes to appear in the "Add Models" dialog:

| What | File | Required? |
|------|------|-----------|
| Add to curated model list | `src/lib/services/model-discovery.ts` — `FIREWORKS_MODELS` array | **Yes** — drives "Discover" in Admin UI |
| Seed DB row (for existing deployments) | `src/lib/db/kysely.ts` — `runPostgresMigrations()` | **Yes** — makes model appear without requiring Discover flow |

**Step 1** — `src/lib/services/model-discovery.ts`:
```typescript
{
  id: 'fireworks/your-model-slug',
  name: 'Display Name',
  toolCapable: true,
  visionCapable: false,
  maxInputTokens: 131072,
  maxOutputTokens: 16384,
},
```

**Step 2** — `src/lib/db/kysely.ts` (inside `runPostgresMigrations`, before the final log):
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

After both edits: restart the stack. The model appears in **Admin → Settings → LLMs → Manage Models** (disabled). Enable it, and it shows in the chat model selector.

> Fireworks models connect via Route 5 (Aggregator Gateways) using direct OpenAI-compatible API calls — no proxy or YAML configuration needed.

---

## Adding a New Provider

If you need to add support for a completely new LLM provider (e.g., Cohere, xAI, Together AI), follow these steps:

### Step 1: Add Provider Constants

Edit `src/lib/db/llm-providers.ts`:

```typescript
// Add to DEFAULT_PROVIDERS array
export const DEFAULT_PROVIDERS: Omit<LLMProvider, 'createdAt' | 'updatedAt'>[] = [
  { id: 'openai', name: 'OpenAI', apiKey: null, apiBase: null, enabled: true },
  // ... existing providers ...
  { id: 'cohere', name: 'Cohere', apiKey: null, apiBase: null, enabled: true },
];

// Add to PROVIDER_ENV_KEYS
const PROVIDER_ENV_KEYS: Record<string, { apiKey?: string; apiBase?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY' },
  // ... existing providers ...
  cohere: { apiKey: 'COHERE_API_KEY' },
};
```

### Step 2: Add Discovery Function

Edit `src/lib/services/model-discovery.ts`:

```typescript
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

In the same file, add case to `discoverModels()` function:

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

### Step 4: Add Route Classification

Edit `src/lib/llm-fallback.ts` and add the new provider's model ID prefixes to the appropriate route detection function. For example, if Cohere uses a `cohere/` prefix on Route 2:

```typescript
// In isRoute2Model():
export function isRoute2Model(model: string): boolean {
  return isOpenAIModel(model) || isClaudeModel(model) || isGeminiModel(model)
    || isMistralModel(model) || isDeepSeekModel(model) || isMoonshotModel(model)
    || /^cohere\//.test(model);  // ADD THIS
}
```

### Step 5: Add Capability Patterns

Add patterns for the new provider's models in `src/lib/services/model-discovery.ts` (see [Capability Detection Patterns](#capability-detection-patterns)).

### Step 6: Add Default Output Tokens

In `src/lib/services/model-discovery.ts`, add to `DEFAULT_OUTPUT_TOKENS`:

```typescript
const DEFAULT_OUTPUT_TOKENS: Record<string, number> = {
  deepseek: 8000,
  ollama: 2000,
  openai: 16000,
  anthropic: 16000,
  gemini: 16000,
  mistral: 16000,
  cohere: 4000,  // Check provider docs for actual limit
};
```

### Step 7: Update discoverAllModels

Add to the providers list in `discoverAllModels()`:

```typescript
export async function discoverAllModels(): Promise<{...}> {
  const providers = ['openai', 'gemini', 'mistral', 'ollama', 'anthropic', 'deepseek', 'cohere'];
  // ...
}
```

### Step 8: Test

1. Add API key to `.env.local`: `COHERE_API_KEY=your-key`
2. Restart the application
3. Go to **Admin > Settings > LLM** and verify provider appears
4. Click **Test** to verify connection
5. Click **Add Models** to discover available models

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

**Location:** `src/lib/services/model-discovery.ts`

Models matching these patterns will have **function/tool calling** enabled:

```typescript
const TOOL_CAPABLE_PATTERNS = [
  // OpenAI
  /^gpt-4/,
  /^gpt-5/,  // GPT-5 family
  /^gpt-3\.5-turbo/,
  /^o1/,
  /^o3/,
  /^o4/,  // Future-proofing
  // Gemini
  /^gemini/,
  // Mistral
  /^mistral-large/,
  /^mistral-small/,
  /^mistral-medium/,
  /^codestral/,
  // Anthropic Claude
  /^claude/,
  // DeepSeek V4
  /^deepseek-v4-(flash|pro)/,
  /^fireworks\/deepseek-v4-(flash|pro)/,
  /^accounts\/fireworks\/models\/deepseek-v4-(flash|pro)/,
  // Moonshot / Kimi
  /^kimi/,
  /^moonshot/,
  /^fireworks\/kimi/,
  /^accounts\/fireworks\/models\/kimi/,
  // MiniMax
  /^fireworks\/minimax/,
  /^accounts\/fireworks\/models\/minimax/,
  // Fireworks-hosted chat models
  /^fireworks\//,
  /^accounts\/fireworks\//,
  // Azure AI Foundry (Route 5)
  /^azure-foundry\//,
  // Ollama
  /^llama3/,
  /^llama4/,
  /^qwen/,
  /^mistral$/,
];
```

> **⚠️ GPT-6 Note:** When OpenAI releases GPT-6 models, add `/^gpt-6/` to this list. Without it, GPT-6 models will appear in the "Add Models" dialog but will show as `toolCapable: false`.

### VISION_CAPABLE_PATTERNS

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

> **⚠️ GPT-6 Note:** If GPT-6 supports vision, add `/^gpt-6/` to this list.

### PARALLEL_TOOL_CAPABLE_PATTERNS

Models matching these patterns will execute **multiple tool calls concurrently** (via `Promise.allSettled`):

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

## Per-Model Token Settings

### Understanding Token Limits

| Setting | Description | Where Set |
|---------|-------------|-----------|
| **Max Input Tokens** | Context window size | Auto-detected or set via API |
| **Max Output Tokens** | Maximum response length | Per-model in Admin UI or via API |

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

| Provider | Default Max Output | Notes |
|----------|-------------------|-------|
| OpenAI | 16,000 | GPT-4.1+ support higher limits |
| Anthropic | 16,000 | Claude 4.5 supports up to 64K |
| Gemini | 16,000 | Gemini 2.5 supports up to 65K |
| Mistral | 16,000 | - |
| DeepSeek | 8,000 | Reasoning model may need more |
| Ollama | 2,000 | Local models vary significantly |

---

## Verification Checklist

After adding a new model:

- [ ] Model appears in **Admin > Settings > LLM**
- [ ] Model appears in chat model dropdown
- [ ] Tool badge (🔧) appears if tool-capable
- [ ] Vision badge appears if vision-capable
- [ ] Chat works with new model selected
- [ ] Max output tokens displays correctly in model info

### Capability Verification

If capabilities weren't auto-detected correctly:

1. Check model in LLM — does it show 🔧 (tools) / Vision badges?
2. If not, check if model ID matches patterns in `model-discovery.ts`
3. Update via API if needed (see "Advanced: Manual Capability Configuration")
4. Verify tools work by asking the model to use a function (e.g., "search for X")
5. Verify vision works by uploading an image in chat

---

## Troubleshooting

### Provider test fails
1. Verify API key is correct and has not expired
2. Check provider's status page for outages
3. Ensure firewall allows outbound HTTPS

### Models not showing after discovery
1. Check if provider has API key configured
2. Try clicking refresh/discover again
3. Check browser console for errors

### Database fallback not working
1. Verify `hasEnabledModels()` returns true
2. Check database connection in startup logs
3. Restart application to reinitialize

### Model capabilities not detected correctly
1. Check if model ID matches patterns in `src/lib/services/model-discovery.ts`
2. Add new pattern if needed (see [Capability Detection Patterns](#capability-detection-patterns))
3. Or use the API to manually set capabilities:
   ```bash
   curl -X PUT http://localhost:3000/api/admin/llm/models/MODEL_ID \
     -H "Content-Type: application/json" \
     -d '{"toolCapable": true, "visionCapable": true}'
   ```

### Vision/image upload not working

1. Check model has `visionCapable: true` in database
2. Verify OCR is configured (Admin > Settings > Document Processing)
3. Check `/api/config/capabilities` response
4. If strategy is `none`, either enable OCR or switch to a vision-capable model

### Tools not working with model

1. Verify the model supports function calling (check provider docs)
2. Check `toolCapable` flag in database
3. Ensure the model is enabled in Admin > Settings > LLM
4. Test by asking the model to use a tool

---

## Files Reference

### Quick Reference by Task

| Task | Primary File(s) |
|------|-----------------|
| Add model via UI | Admin UI (no code changes — DB-only) |
| Fix capability detection | `src/lib/services/model-discovery.ts` |
| Add new provider | `src/lib/db/llm-providers.ts` + `src/lib/services/model-discovery.ts` + `src/lib/llm-fallback.ts` |
| Add route classification | `src/lib/llm-fallback.ts` |
| Change default model | Admin UI or `src/lib/config-loader.ts` |
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
| `src/lib/services/model-discovery.ts` | Provider API discovery, capability pattern matching, context windows |
| `src/lib/llm-fallback.ts` | Route classification (`isRoute2/3/5Model`), fallback chain, health cache |
| `src/lib/openai.ts` | Main chat dispatch — per-provider routing to native SDKs |
| `src/lib/llm-client.ts` | Internal services dispatch (`createInternalCompletion`) |
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
| **Transcription** | whisper-1, voxtral-mini, gemini-2.5-flash | Settings → Speech | `src/lib/stt.ts` |
| **Image Generation** | Gemini Nano Banana, Imagen 4 | tool_config | `src/lib/image-gen/` |
| **Translation** | gpt-4.1-mini, gemini-2.5-flash | tool_config | `src/lib/translation/` |
| **Document Processing** | mammoth, exceljs, officeparser (local); Mistral OCR, Azure DI (API) | Settings → Doc Processing | `src/lib/document-extractor.ts` |
| **Reranker** | BGE Large/Base, Fireworks Qwen3, Cohere, Local | Settings → Reranker | `src/lib/reranker.ts` |

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
2. **No DB models:** Falls back to hardcoded defaults in `config-loader.ts`
3. **Cross-route fallback:** If a model's route is disabled or the provider fails, the system falls back through Routes 2 → 5 → 3

This ensures the app remains functional even if configuration sources or specific providers are unavailable.
