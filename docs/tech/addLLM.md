# Adding a New LLM Model

This guide explains how to add a new LLM model to the Policy Bot system.

## Prerequisites

- LiteLLM proxy running (`docker compose up litellm`)
- API key for the provider (OpenAI, Gemini, Mistral, etc.)
- Access to edit `litellm-proxy/litellm_config.yaml`

## Architecture Overview

Models are **auto-discovered** from the LiteLLM configuration at startup:

```
litellm_config.yaml (Single Source of Truth)
        │
        ├── model_name ──────────────► Model ID
        ├── litellm_params.model ────► Provider (gemini/, mistral/, ollama/)
        └── model_info ──────────────► Capabilities
                │
                ▼
        [App Startup - Auto Discovery]
                │
                ▼
        config-loader.ts
                │
                ├── getModelPresetsFromConfig() ► UI model list
                ├── getToolCapableModels() ─────► Tool support flags
                └── Fallback to hardcoded defaults if YAML unavailable
```

## Quick Start: Adding a New Model

### Step 1: Edit LiteLLM Config

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

### Step 2: Restart Application

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

## model_info Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `supports_function_calling` | boolean | `false` | Enables tool/function calling |
| `supports_vision` | boolean | `false` | Enables image input support |
| `max_input_tokens` | number | - | Context window size (informational) |

**Important:** If `model_info` is omitted entirely, the model defaults to no tool support and no vision.

## Auto-Generated Settings

### Display Names

Model IDs are automatically converted to human-friendly names:

| Model ID | Generated Name |
|----------|----------------|
| `gpt-5` | GPT-5 |
| `gpt-4.1-mini` | GPT-4.1 Mini |
| `gemini-2.5-flash` | Gemini 2.5 Flash |
| `ollama-llama3.2` | Ollama Llama 3.2 |
| `mistral-small-3.2` | Mistral Small 3.2 |

### Provider Detection

Providers are detected from the `litellm_params.model` prefix:

| Model Path | Detected Provider |
|------------|-------------------|
| `gemini/gemini-2.5-flash` | gemini |
| `mistral/mistral-large` | mistral |
| `ollama/llama3.2` | ollama |
| `azure/gpt-4` | azure |
| `gpt-4.1-mini` (no prefix) | openai |

### Tier-Based Defaults

Settings are automatically applied based on keywords in the model ID:

| Tier Keywords | Temperature | Max Output Tokens |
|---------------|-------------|-------------------|
| `pro`, `large` | 0.1 | 8000 |
| `mini`, `flash`, `small` | 0.2 | 3000 |
| `nano`, `lite` | 0.2 | 1000 |
| (none matched) | 0.2 | 2000 |

## Provider Examples

### OpenAI

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

### Google Gemini

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

### Mistral

```yaml
- model_name: mistral-next
  litellm_params:
    model: mistral/mistral-next
    api_key: os.environ/MISTRAL_API_KEY
  model_info:
    supports_function_calling: true
    supports_vision: true
```

### Ollama (Local)

```yaml
- model_name: ollama-llama4
  litellm_params:
    model: ollama/llama4
    api_base: os.environ/OLLAMA_API_BASE
  model_info:
    supports_function_calling: true
```

### Azure OpenAI

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

## Setting as Default Model

### Option 1: Admin UI (Recommended)

1. Go to Admin > Settings > LLM Settings
2. Select the new model from the dropdown
3. Save changes

### Option 2: Code Change

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

## Model Types

The system automatically filters models by type:

| Type | Detection | Used For |
|------|-----------|----------|
| **Chat** | Default | LLM conversations, tools |
| **Embedding** | Name contains `embed` | RAG vector search |
| **Transcription** | Name contains `whisper` or `voxtral` | Audio transcription |

Only **chat** models appear in the LLM selection dropdown. Embedding and transcription models are used by their respective subsystems.

## Verification Checklist

After adding a new model:

- [ ] Startup logs show: `[LiteLLM] Discovered N models from YAML config`
- [ ] Model appears in Admin > Settings > LLM dropdown
- [ ] Model shows in Admin > Providers status page
- [ ] Tool badge (wrench icon) appears if `supports_function_calling: true`
- [ ] Chat works with new model selected
- [ ] Translation tool shows model (for openai/gemini/mistral providers)

## Troubleshooting

### Model not appearing in UI

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

### Tools not working with model

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

### Model connection errors

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

### Fallback Behavior

If YAML parsing fails, the system uses hardcoded defaults from `config-loader.ts`. This ensures the app remains functional but new models won't appear until the YAML issue is resolved.

## Files Reference

| File | Purpose |
|------|---------|
| `litellm-proxy/litellm_config.yaml` | **Single source of truth** - model routing + capabilities |
| `src/lib/litellm-validator.ts` | YAML parsing, model discovery, display name generation |
| `src/lib/config-loader.ts` | Model presets API, fallback defaults |
| `src/lib/constants.ts` | Re-exports `isToolCapableModel()` |
| `src/app/api/admin/providers/route.ts` | Provider health check API |
| `src/lib/db/config.ts` | `getAvailableModels()` for admin UI |

## Migration from Manual Configuration

If you previously added models manually to `config-loader.ts`:

1. Ensure models are in `litellm_config.yaml` with full `model_info`
2. Remove custom entries from `modelPresets` in `config-loader.ts` (optional)
3. Remove entries from `models.toolCapable` array (now auto-detected)
4. Restart the app

The hardcoded defaults remain as fallback and won't cause conflicts with auto-discovered models.
