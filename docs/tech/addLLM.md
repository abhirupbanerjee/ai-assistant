# Adding a New LLM Model

This guide explains how to add a new LLM model to the Policy Bot system.

## Overview

There are **two methods** to add LLM models:

| Method | Best For | Requires |
|--------|----------|----------|
| **Admin UI** (Recommended) | Production, non-technical users | Web browser access |
| **YAML Config** (Alternative) | CI/CD, infrastructure-as-code | File system access |

---

## Architecture Overview

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

---

## Method 1: Admin UI (Recommended)

### Prerequisites

- Admin access to the Policy Bot application
- API key for the provider (OpenAI, Gemini, Mistral, etc.)

### UI Overview

Navigate to **Admin > Settings > Configure LLM**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Settings > Configure LLM                                                │
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

1. Go to **Admin > Settings > Configure LLM**
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
| **Edit** | Change display name |
| **Disable** | Hide from dropdown but keep config (can re-enable) |
| **Remove** | Permanently delete from enabled models |

### Advanced: Manual Capability Configuration

The Admin UI's **Edit** action only allows changing the display name. To manually configure **tool support**, **vision**, and **max tokens**, use the API directly.

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

**Set context window size:**

```bash
curl -X PUT http://localhost:3000/api/admin/llm/models/claude-4-opus \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION" \
  -d '{"maxInputTokens": 200000}'
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
    "maxInputTokens": 128000
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
    "isDefault": false,
    "enabled": true,
    "sortOrder": 5
  }
}
```

#### Capability Detection

When models are discovered via the **[+ Add Models]** dialog, capabilities are auto-detected using pattern matching on the model ID:

| Pattern | Detected As |
|---------|-------------|
| Contains `gpt-4`, `gpt-5`, `o1`, `o3` | Tool + Vision capable |
| Contains `gemini-2`, `gemini-3` | Tool + Vision capable |
| Contains `mistral-large`, `mistral-small` | Tool capable |
| Contains `llama3.2`, `llama4` | Tool capable |
| Contains `pixtral`, `vision` | Vision capable |

For models not matching these patterns, you'll need to manually set capabilities via API.

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

#### Ollama (Local)

```yaml
- model_name: ollama-llama4
  litellm_params:
    model: ollama/llama4
    api_base: os.environ/OLLAMA_API_BASE
  model_info:
    supports_function_calling: true
```

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

#### Provider Detection

Providers are detected from the `litellm_params.model` prefix:

| Model Path | Detected Provider |
|------------|-------------------|
| `gemini/gemini-2.5-flash` | gemini |
| `mistral/mistral-large` | mistral |
| `ollama/llama3.2` | ollama |
| `azure/gpt-4` | azure |
| `gpt-4.1-mini` (no prefix) | openai |

#### Tier-Based Defaults

Settings are automatically applied based on keywords in the model ID:

| Tier Keywords | Temperature | Max Output Tokens |
|---------------|-------------|-------------------|
| `pro`, `large` | 0.1 | 8000 |
| `mini`, `flash`, `small` | 0.2 | 3000 |
| `nano`, `lite` | 0.2 | 1000 |
| (none matched) | 0.2 | 2000 |

---

## Setting as Default Model

### Option 1: Admin UI (Recommended)

1. Go to **Admin > Settings > Configure LLM**
2. In the Enabled Models table, click **[⋯]** menu
3. Select **Set Default**

### Option 2: Admin > Settings > LLM

1. Go to **Admin > Settings > LLM**
2. Select the new model from the dropdown
3. Save changes

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

- [ ] Model appears in **Admin > Settings > Configure LLM** (if using Admin UI)
- [ ] OR startup logs show: `[LiteLLM] Discovered N models` (if using YAML)
- [ ] Model appears in chat model dropdown
- [ ] Tool badge (🔧) appears if tool-capable
- [ ] Vision badge appears if vision-capable (for models with image support)
- [ ] Chat works with new model selected
- [ ] Translation tool shows model (for openai/gemini/mistral providers)

### Capability Verification

If capabilities weren't auto-detected correctly:

1. Check model in Configure LLM - does it show 🔧 (tools) / Vision badges?
2. If not, update via API (see "Advanced: Manual Capability Configuration")
3. Verify tools work by asking the model to use a function (e.g., "search for X")
4. Verify vision works by uploading an image in chat
5. Check `/api/config/capabilities` returns expected strategy

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
- OCR settings from admin config (Mistral OCR or Azure DI)

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
1. Some models don't match auto-detection patterns
2. Use the API to manually set capabilities:
   ```bash
   curl -X PUT http://localhost:3000/api/admin/llm/models/MODEL_ID \
     -H "Content-Type: application/json" \
     -d '{"toolCapable": true, "visionCapable": true}'
   ```
3. Verify changes in Configure LLM page

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
2. Verify OCR is configured (Admin > Settings > OCR):
   - Mistral OCR requires `MISTRAL_API_KEY` or admin-configured key
   - Azure DI requires endpoint + key configured
3. Check `/api/config/capabilities` response:
   ```bash
   curl http://localhost:3000/api/config/capabilities
   ```
4. If strategy is `none`, either:
   - Enable OCR provider in admin settings
   - Switch to a vision-capable model (GPT-4o, Gemini 2.5, Pixtral)
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

### Admin UI Files (Phase 3)

| File | Purpose |
|------|---------|
| `src/lib/db/llm-providers.ts` | Provider CRUD operations |
| `src/lib/db/enabled-models.ts` | Enabled models CRUD |
| `src/lib/services/model-discovery.ts` | Provider API discovery (OpenAI, Gemini, Mistral, Ollama) |
| `src/components/admin/settings/LLMConfigSettings.tsx` | Main Configure LLM UI |
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
| `litellm-proxy/litellm_config.yaml` | LiteLLM model routing + capabilities |
| `src/lib/litellm-validator.ts` | YAML parsing, model discovery, display name generation |
| `src/lib/config-loader.ts` | Model presets API, fallback defaults |
| `src/lib/db/config.ts` | `getAvailableModels()` with DB-first priority |
| `src/lib/constants.ts` | Re-exports `isToolCapableModel()` |

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

Besides chat models, the system uses specialized models for various features. API keys configured in **Configure LLM** are shared across all features.

| Feature | Model(s) | Configure In | File |
|---------|----------|--------------|------|
| **Embeddings** | text-embedding-3-large | Settings → RAG | `src/lib/openai.ts` |
| **Transcription** | whisper-1 | Hardcoded | `src/lib/openai.ts` |
| **Image Generation** | DALL-E 3, Gemini Imagen | tool_config | `src/lib/image-gen/` |
| **Translation** | gpt-4.1-mini, gemini-2.5-flash | tool_config | `src/lib/translation/` |
| **Document OCR** | Mistral OCR, Azure DI | Settings → Doc Processing | `src/lib/document-extractor.ts` |
| **Reranker** | Cohere, Jina, Local | Settings → Reranker | `src/lib/reranker.ts` |

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
