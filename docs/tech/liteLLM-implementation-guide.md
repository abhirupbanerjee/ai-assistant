# LiteLLM Implementation Guide

> Customized for multi-provider LLM abstraction with proxy approach, embeddings routing, function calling support, and audio transcription.

---

## LLM Service Routing Overview

Policy Bot uses a **hybrid architecture**: most chat services route through LiteLLM proxy for unified model management, while **Anthropic Claude models bypass LiteLLM entirely** using the `@anthropic-ai/sdk` for direct API access (eliminating tool-calling JSON assembly issues), and specialized services (images, audio, document processing) call provider APIs directly or use local parsers.

### Service Routing Table

| Service | Policy Bot Feature | Routes Through | Provider(s) | Notes |
|---------|-------------------|----------------|-------------|-------|
| **Chat Completions** | Main chat, RAG responses | ✅ LiteLLM / ⚡ Anthropic Direct | OpenAI, Gemini, Mistral, DeepSeek, Fireworks AI, Ollama via LiteLLM; **Anthropic Claude via direct SDK** | Claude uses `@anthropic-ai/sdk` for reliable tool calling |
| **Embeddings** | Document indexing, search | ✅ LiteLLM | OpenAI, Mistral, Gemini, Ollama, Fireworks | `text-embedding-3-large` default |
| **Diagram Generation** | `diagram_gen` tool | ✅ LiteLLM | OpenAI, Gemini, Mistral, Anthropic | Generates Mermaid syntax |
| **Summarization** | Message compression | ✅ LiteLLM | OpenAI, Gemini, Mistral, Anthropic, DeepSeek | Long conversation handling |
| **Memory Extraction** | User fact storage | ✅ LiteLLM | OpenAI, Gemini, Mistral, Anthropic | Per-category memory |
| **Prompt Optimization** | Query refinement | ✅ LiteLLM | OpenAI, Gemini, Mistral, Anthropic | Pre-RAG processing |
| **Compliance Checks** | HITL clarification | ✅ LiteLLM | OpenAI, Gemini, Mistral, Anthropic | Skill compliance |
| **Translation** | Multi-language support | ✅ LiteLLM / ❌ Direct | OpenAI (proxy), Gemini/Mistral (direct) | Provider-dependent |
| **Audio Transcription** | Voice input | ✅ LiteLLM | OpenAI Whisper, Mistral Voxtral | `transcribeAudio()` uses `getOpenAI()` client |
| **Image Generation** | `image_gen` tool | ❌ Direct | OpenAI DALL-E, Gemini Imagen | Specialized APIs |
| **Podcast Generation** | `podcast_gen` tool | ❌ Direct | OpenAI TTS, Gemini TTS | Multi-voice audio synthesis |
| **Document Processing** | Document text extraction | ❌ Direct | mammoth/exceljs/officeparser (local), Mistral OCR, Azure DI, pdf-parse | Tiered fallback: local parsers first, then API providers |
| **Reranking** | Search result scoring | ❌ Direct | Fireworks AI | Direct HTTP to `api.fireworks.ai/inference/v1/rerank` |
| **PPTX Generation** | `pptx_gen` tool | N/A | None | Template-based (no LLM) |
| **XLSX Generation** | `xlsx_gen` tool | N/A | None | ExcelJS-based (no LLM) |
| **Chart Generation** | `chart_gen` tool | N/A | None | Client-side rendering |

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ LiteLLM | Routes through LiteLLM proxy (port 4000) |
| ⚡ Anthropic Direct | Calls Anthropic API directly via `@anthropic-ai/sdk` (bypasses LiteLLM) |
| ❌ Direct | Calls provider API directly (bypasses LiteLLM) |
| N/A | No LLM calls required |

### Why Some Services Bypass LiteLLM

| Service | Reason |
|---------|--------|
| **Anthropic Claude** | LiteLLM's Anthropic→OpenAI streaming translation produces malformed tool-calling JSON. Direct `@anthropic-ai/sdk` provides native, reliable tool call parsing |
| **Image Generation** | DALL-E and Gemini Imagen APIs not supported by LiteLLM proxy |
| **Podcast TTS** | OpenAI TTS and Gemini TTS are audio generation APIs, not chat completions |
| **OCR** | Mistral OCR is a specialized document API with unique request format |
| **Reranking** | Fireworks reranker is a specialized search API (`/inference/v1/rerank`), not a chat model |

> **Note**: Audio transcription (Whisper, Voxtral) routes **through LiteLLM** — `transcribeAudio()` in `openai.ts` uses the same `getOpenAI()` client as chat completions. Both `whisper-1` and `voxtral-mini` are registered in `litellm_config.yaml`.

### Proxy Detection Logic

The actual detection in `openai.ts` checks for the `OPENAI_BASE_URL` environment variable:

```typescript
// src/lib/openai.ts — getOpenAI()
async function getOpenAI(): Promise<OpenAI> {
  if (!openaiClient) {
    // When OPENAI_BASE_URL is set, route through LiteLLM proxy
    const apiKey = process.env.OPENAI_BASE_URL
      ? (process.env.LITELLM_MASTER_KEY || await getApiKey('openai'))
      : await getApiKey('openai');

    openaiClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: 300 * 1000,
    });
  }
  return openaiClient;
}
```

When `OPENAI_BASE_URL` points to the LiteLLM container (e.g. `http://litellm:4000/v1`), embeddings, transcription, and non-Claude chat completions are routed through a single OpenAI SDK client.

### Claude Direct SDK Detection

For Anthropic Claude models, `generateResponseWithTools()` bypasses LiteLLM entirely:

```typescript
// src/lib/openai.ts — isClaudeModel() + routing
function isClaudeModel(model: string): boolean {
  return model.startsWith('anthropic/') || model.startsWith('claude-');
}

// In generateResponseWithTools():
const useAnthropicDirect = isClaudeModel(effectiveModel);
const openai = useAnthropicDirect ? null : await getOpenAI();          // LiteLLM path
const anthropicClient = useAnthropicDirect ? await getAnthropicClient() : null;  // Direct path
```

**Why**: LiteLLM translates Anthropic's native streaming into OpenAI-compatible `delta.tool_calls` format, but the tool call JSON assembly is unreliable — producing malformed arguments that fail `executeTool()`. The direct `@anthropic-ai/sdk` receives pre-parsed tool inputs via `stream.finalMessage()`, eliminating this class of errors.

---

## Policy Bot Integration

This guide is configured for the Policy Bot RAG application. Default model preset:

| Setting | Value |
|---------|-------|
| Default Model | `gpt-4.1-mini` |
| Temperature | `0.2` |
| Max Tokens | `2000` |
| Embedding Model | `text-embedding-3-large` |
| Embedding Dimensions | `3072` |

Available model presets in Policy Bot (via `config/defaults.json`):
- **gpt-4.1** - High Performance (1M context)
- **gpt-4.1-mini** - Balanced (default)
- **gpt-4.1-nano** - Cost-Effective
- **mistral-large-3** - Mistral Flagship (256K context)
- **mistral-small-3.2** - Mistral Cost-Effective
- **ministral-8b** - Mistral Ultra Cost-Effective
- **gemini-2.5-pro** - Google Flagship Reasoning (1M context)
- **gemini-2.5-flash** - Google Balanced (1M context)
- **gemini-2.5-flash-lite** - Google Cost-Effective (1M context)
- **claude-opus-4-6** - Anthropic Flagship
- **claude-sonnet-4-6** - Anthropic Balanced
- **deepseek-chat** - DeepSeek V3 (cost-effective)
- **deepseek-reasoner** - DeepSeek R1 (thinking model)
- **fw/kimi-k2-instruct** - Fireworks Kimi K2 (dev/test)
- **ollama-llama3.2** - Local (no API cost)
- **ollama-qwen2.5** - Local with excellent reasoning

---

## Architecture Overview

PolicyBot uses a **four-tier hybrid architecture**. LiteLLM handles most chat, embeddings, and transcription. **Anthropic Claude models bypass LiteLLM** via the native `@anthropic-ai/sdk` for reliable tool calling. Specialized services use direct API calls.

```
┌───────────────────────────────────────────────────────────────────────┐
│                         PolicyBot Application                         │
│              (Next.js — openai.ts, tools, translation)                │
└──┬──────────────────┬──────────────────┬──────────────────┬───────────┘
   │                  │                  │                  │
 TIER 1            TIER 1b            TIER 2             TIER 3
 LiteLLM Proxy     Anthropic Direct   Direct Provider    Direct Google
 (Chat, Embed,     SDK (@anthropic-   APIs (Non-Chat)    GenAI SDK
  Transcription)    ai/sdk)                              (Image/TTS)
   │                  │                  │                  │
   ▼                  ▼                  ▼                  ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│  Port 4000     │ │ api.anthropic  │ │                │ │                │
│                │ │ .com           │ │ Fireworks AI   │ │ Gemini Imagen  │
│ ┌────────────┐ │ │                │ │  (reranking)   │ │  (image_gen)   │
│ │ OpenAI     │ │ │ Claude chat +  │ │                │ │  via REST API  │
│ │ Gemini     │ │ │ tool calling   │ │ Tavily         │ │                │
│ │ Mistral    │ │ │ via native     │ │  (web_search)  │ │ Gemini TTS     │
│ │ DeepSeek   │ │ │ streaming      │ │                │ │  (podcast_gen) │
│ │ Fireworks* │ │ │                │ │ Gemini/Mistral │ │  via @google/  │
│ │ Ollama*    │ │ │ Models:        │ │  (translation) │ │  genai SDK     │
│ └────────────┘ │ │ claude-opus-*  │ │                │ │                │
│                │ │ claude-sonnet-*│ │ OpenAI TTS     │ │ DALL-E 3       │
│ * YAML-only,   │ │ claude-haiku-* │ │  (podcast_gen) │ │  (image_gen)   │
│   not dynamic  │ │                │ │  hardcoded to  │ │  via OpenAI SDK│
│   sync         │ │ Why: LiteLLM   │ │  api.openai.com│ │  (no proxy)    │
│                │ │ breaks tool    │ │                │ │                │
│                │ │ call JSON      │ │                │ │                │
└────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘
```

### Model Capability Detection

Capabilities are auto-detected via regex patterns in `src/lib/services/model-discovery.ts` and stored in the `enabled_models` table. Admins can override via the LLM Settings UI.

| Capability | DB Column | Detection Function | Used By |
|------------|-----------|-------------------|---------|
| Tool calling | `tool_capable` | `isToolCapable(modelId)` | `openai.ts` — whether to send tool definitions |
| Vision/multimodal | `vision_capable` | `isVisionCapable(modelId)` | `config-capability-checker.ts` — image upload gating |
| Parallel tool calls | `parallel_tool_capable` | `isParallelToolCapable(modelId)` | `openai.ts` — sequential vs `Promise.allSettled` execution |
| Thinking/reasoning | `thinking_capable` | `isThinkingCapable(modelId)` | UI — thinking content display |

### Model Registration: Dynamic vs Static

PolicyBot uses **two registration paths** for LiteLLM models:

| Path | Providers | How |
|------|-----------|-----|
| **Dynamic** (via `/model/new` API) | OpenAI, Anthropic, Gemini, Mistral, DeepSeek | `litellm-sync.ts` reads `enabled_models` table and registers via API |
| **Static** (YAML only) | Fireworks, Ollama, Embeddings, Audio | Defined in `litellm_config.yaml`, skipped by sync service |
| **Direct SDK** (bypasses LiteLLM) | Anthropic Claude | `isClaudeModel()` in `openai.ts` detects `anthropic/` or `claude-` prefix → routes to `@anthropic-ai/sdk` |

> Dynamic models (5 providers) are NOT in the YAML — they are registered at startup by the app. Only Fireworks, Ollama, embedding, and audio models are declared in `litellm_config.yaml`.
>
> **Note**: Anthropic models are still registered dynamically with LiteLLM (for embeddings/non-chat use), but **chat completions with tool calling** bypass LiteLLM entirely via the Anthropic SDK. This is controlled by `isClaudeModel()` in `openai.ts`.

---

## Decision Summary

| Component | Decision |
|-----------|----------|
| **Approach** | LiteLLM Proxy (Docker Compose) + Anthropic Direct SDK |
| **Chat Completions** | Route through LiteLLM (except Claude → `@anthropic-ai/sdk` direct) |
| **Embeddings** | Route through LiteLLM (per-provider config) |
| **Function Calling** | Gated by `toolCapable` flag from `litellm_config.yaml` via DB sync |
| **Audio Transcription** | Route through LiteLLM (Whisper, Voxtral) |
| **Deployment** | Docker Compose |

---

## Project Structure

```
litellm-proxy/
├── docker-compose.yml
├── litellm_config.yaml
├── .env
└── README.md
```

---

## Step 1: Environment Variables

Create `.env` file:

```bash
# ===================
# LiteLLM Proxy Keys
# ===================
LITELLM_MASTER_KEY=sk-litellm-master-change-this
LITELLM_SALT_KEY=sk-litellm-salt-change-this

# ===================
# OpenAI
# ===================
OPENAI_API_KEY=sk-...

# ===================
# Azure OpenAI
# ===================
AZURE_API_KEY=...
AZURE_API_BASE=https://your-resource.openai.azure.com/
AZURE_API_VERSION=2024-02-15-preview
AZURE_CHAT_DEPLOYMENT=gpt-4-deployment
AZURE_EMBEDDING_DEPLOYMENT=text-embedding-ada-002

# ===================
# Mistral
# ===================
MISTRAL_API_KEY=...

# ===================
# Google Gemini
# ===================
GEMINI_API_KEY=...

# ===================
# Anthropic
# ===================
ANTHROPIC_API_KEY=...

# ===================
# DeepSeek
# ===================
DEEPSEEK_API_KEY=...

# ===================
# Fireworks AI (dev/test open-source models)
# ===================
FIREWORKS_AI_API_KEY=fw-...

# ===================
# Ollama (Local)
# ===================
OLLAMA_API_BASE=http://host.docker.internal:11434
# Use 'http://localhost:11434' if running outside Docker
```

---

## Step 2: LiteLLM Configuration

> **Important**: The reference YAML below is a **complete template** listing all models statically. In actual PolicyBot deployment, chat models for OpenAI, Anthropic, Gemini, Mistral, and DeepSeek are **registered dynamically** via `litellm-sync.ts` (see Architecture Overview above). Only Fireworks, Ollama, embedding, and audio models are declared in the YAML. See the actual config at `litellm-proxy/litellm_config.yaml`.

Create `litellm_config.yaml`:

```yaml
# =============================================================================
# LITELLM PROXY CONFIGURATION
# Multi-provider setup: OpenAI, Azure, Mistral, Gemini, Anthropic, DeepSeek, Fireworks AI, Ollama
# Updated: March 2026
# =============================================================================

model_list:

  # ===========================================================================
  # CHAT COMPLETION MODELS
  # ===========================================================================

  # ---------------------------------------------------------------------------
  # OpenAI Models - GPT-4.1 Family (Latest - April 2025+)
  # ---------------------------------------------------------------------------
  - model_name: openai-gpt41
    litellm_params:
      model: gpt-4.1
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      supports_function_calling: true
      max_input_tokens: 1000000

  - model_name: openai-gpt41-mini
    litellm_params:
      model: gpt-4.1-mini
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      supports_function_calling: true
      max_input_tokens: 1000000

  - model_name: openai-gpt41-nano
    litellm_params:
      model: gpt-4.1-nano
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      supports_function_calling: true
      max_input_tokens: 1000000

  - model_name: openai-gpt35
    litellm_params:
      model: gpt-3.5-turbo
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      supports_function_calling: true

  # ---------------------------------------------------------------------------
  # Azure OpenAI Models - GPT-4.1 Family
  # ---------------------------------------------------------------------------
  - model_name: azure-gpt41
    litellm_params:
      model: azure/gpt-41-deployment  # Your deployment name
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY
      api_version: os.environ/AZURE_API_VERSION
    model_info:
      supports_function_calling: true
      max_input_tokens: 1000000

  - model_name: azure-gpt41-mini
    litellm_params:
      model: azure/gpt-41-mini-deployment
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY
      api_version: os.environ/AZURE_API_VERSION
    model_info:
      supports_function_calling: true

  # ---------------------------------------------------------------------------
  # Mistral AI Models - Mistral 3 Family (Latest - December 2025)
  # ---------------------------------------------------------------------------
  - model_name: mistral-large-3
    litellm_params:
      model: mistral/mistral-large-latest
      api_key: os.environ/MISTRAL_API_KEY
    model_info:
      supports_function_calling: true
      max_input_tokens: 256000

  - model_name: mistral-medium-31
    litellm_params:
      model: mistral/mistral-medium-2508
      api_key: os.environ/MISTRAL_API_KEY
    model_info:
      supports_function_calling: true
      supports_vision: true

  - model_name: mistral-small-32
    litellm_params:
      model: mistral/mistral-small-2506
      api_key: os.environ/MISTRAL_API_KEY
    model_info:
      supports_function_calling: true

  - model_name: ministral-8b
    litellm_params:
      model: mistral/ministral-8b-latest
      api_key: os.environ/MISTRAL_API_KEY
    model_info:
      supports_function_calling: true

  # ---------------------------------------------------------------------------
  # Ollama Models (Local) - With Full Tool Support
  # ---------------------------------------------------------------------------
  - model_name: ollama-llama32
    litellm_params:
      model: ollama/llama3.2
      api_base: os.environ/OLLAMA_API_BASE
    model_info:
      supports_function_calling: true  # Fine-tuned for function calling

  - model_name: ollama-llama31-8b
    litellm_params:
      model: ollama/llama3.1:8b
      api_base: os.environ/OLLAMA_API_BASE
    model_info:
      supports_function_calling: true

  - model_name: ollama-mistral
    litellm_params:
      model: ollama/mistral
      api_base: os.environ/OLLAMA_API_BASE
    model_info:
      supports_function_calling: true  # v0.3+ supports tools

  - model_name: ollama-qwen25
    litellm_params:
      model: ollama/qwen2.5
      api_base: os.environ/OLLAMA_API_BASE
    model_info:
      supports_function_calling: true

  - model_name: ollama-phi4
    litellm_params:
      model: ollama/phi4
      api_base: os.environ/OLLAMA_API_BASE
    model_info:
      supports_function_calling: false  # Limited support

  # ===========================================================================
  # EMBEDDING MODELS
  # ===========================================================================

  # ---------------------------------------------------------------------------
  # OpenAI Embeddings
  # ---------------------------------------------------------------------------
  - model_name: openai-embedding-large
    litellm_params:
      model: text-embedding-3-large
      api_key: os.environ/OPENAI_API_KEY

  - model_name: openai-embedding-small
    litellm_params:
      model: text-embedding-3-small
      api_key: os.environ/OPENAI_API_KEY

  # ---------------------------------------------------------------------------
  # Azure OpenAI Embeddings
  # ---------------------------------------------------------------------------
  - model_name: azure-embedding
    litellm_params:
      model: azure/text-embedding-ada-002
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY
      api_version: os.environ/AZURE_API_VERSION

  - model_name: azure-embedding-3-large
    litellm_params:
      model: azure/text-embedding-3-large-deployment
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY
      api_version: os.environ/AZURE_API_VERSION

  # ---------------------------------------------------------------------------
  # Mistral Embeddings
  # ---------------------------------------------------------------------------
  - model_name: mistral-embedding
    litellm_params:
      model: mistral/mistral-embed
      api_key: os.environ/MISTRAL_API_KEY

  - model_name: codestral-embed
    litellm_params:
      model: mistral/codestral-embed
      api_key: os.environ/MISTRAL_API_KEY

  # ---------------------------------------------------------------------------
  # Ollama Embeddings (Local)
  # ---------------------------------------------------------------------------
  - model_name: ollama-embedding
    litellm_params:
      model: ollama/nomic-embed-text
      api_base: os.environ/OLLAMA_API_BASE

  - model_name: ollama-mxbai-embed
    litellm_params:
      model: ollama/mxbai-embed-large
      api_base: os.environ/OLLAMA_API_BASE

  # ===========================================================================
  # AUDIO MODELS (Speech-to-Text / Transcription)
  # ===========================================================================

  # ---------------------------------------------------------------------------
  # OpenAI Whisper
  # ---------------------------------------------------------------------------
  - model_name: openai-whisper
    litellm_params:
      model: whisper-1
      api_key: os.environ/OPENAI_API_KEY

  # ---------------------------------------------------------------------------
  # Azure Whisper (if deployed)
  # ---------------------------------------------------------------------------
  - model_name: azure-whisper
    litellm_params:
      model: azure/whisper-deployment
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY
      api_version: os.environ/AZURE_API_VERSION

  # ---------------------------------------------------------------------------
  # Mistral Voxtral (Released July 2025 - Beats Whisper at half cost)
  # ---------------------------------------------------------------------------
  - model_name: voxtral-small
    litellm_params:
      model: mistral/voxtral-small-latest
      api_key: os.environ/MISTRAL_API_KEY

  - model_name: voxtral-mini
    litellm_params:
      model: mistral/voxtral-mini-latest
      api_key: os.environ/MISTRAL_API_KEY

# =============================================================================
# LITELLM SETTINGS
# =============================================================================

litellm_settings:
  # Drop unsupported params instead of erroring
  drop_params: true
  
  # Enable detailed logging
  set_verbose: false

  # Request timeout
  request_timeout: 120

# =============================================================================
# GENERAL SETTINGS
# =============================================================================

general_settings:
  # Master key for proxy authentication
  master_key: os.environ/LITELLM_MASTER_KEY
```

---

## Step 3: Docker Compose

> **Note**: In the actual PolicyBot deployment, LiteLLM runs as part of the full stack in `docker-compose.local.yml` alongside Postgres, Qdrant, and Redis. The standalone example below is for reference.

Create `docker-compose.yml`:

```yaml
version: "3.9"

services:
  litellm:
    image: ghcr.io/berriai/litellm:v1.82.3-stable.patch.2
    container_name: litellm-proxy
    ports:
      - "4000:4000"
    volumes:
      - ./litellm_config.yaml:/app/config.yaml
    env_file:
      - .env
    environment:
      - LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
      - LITELLM_SALT_KEY=${LITELLM_SALT_KEY}
    command: --config /app/config.yaml --port 4000 --detailed_debug
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Optional: Ollama service (if not running separately)
  # ollama:
  #   image: ollama/ollama:latest
  #   container_name: ollama
  #   ports:
  #     - "11434:11434"
  #   volumes:
  #     - ollama_data:/root/.ollama
  #   restart: unless-stopped

# volumes:
#   ollama_data:
```

---

## Step 4: Application Code Changes

### Minimal Change Required

PolicyBot is a Next.js (TypeScript) application. The proxy switch is controlled entirely by environment variables — no code changes needed:

**Environment (`.env`):**
```bash
# Set this to route all chat/embeddings/transcription through LiteLLM
OPENAI_BASE_URL=http://litellm:4000/v1
LITELLM_MASTER_KEY=sk-litellm-master-change-this
```

**How it works (`src/lib/openai.ts`):**
```typescript
// When OPENAI_BASE_URL is set → uses LiteLLM proxy with LITELLM_MASTER_KEY
// When OPENAI_BASE_URL is unset → calls OpenAI directly with OPENAI_API_KEY
const apiKey = process.env.OPENAI_BASE_URL
  ? (process.env.LITELLM_MASTER_KEY || await getApiKey('openai'))
  : await getApiKey('openai');

openaiClient = new OpenAI({
  apiKey: apiKey || undefined,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});
```

For non-Claude models, that's it — the OpenAI SDK handles the routing transparently.

**Claude models** are automatically detected and routed to the Anthropic SDK:
```typescript
// Automatic — no env var needed, just ANTHROPIC_API_KEY in DB or env
// isClaudeModel() detects 'anthropic/' or 'claude-' prefix
// Uses @anthropic-ai/sdk directly for chat + tool calling
// Embeddings/transcription still route through LiteLLM
```

---

## Step 5: Function Calling Handling

Since your `generateResponseWithTools()` uses function calling, here's how to handle provider capabilities:

```python
# Provider capability mapping (Updated December 2025)

# Full tool/function calling support
# Matches Policy Bot config/defaults.json toolCapable list
TOOL_CAPABLE_MODELS = [
    # OpenAI
    "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-3.5-turbo",
    # Mistral
    "mistral-large-3", "mistral-medium-3.1", "mistral-small-3.2",
    "ministral-8b", "ministral-3b",
    # Ollama (Now with full tool support!)
    "ollama-llama3.2", "ollama-llama3.1", "ollama-mistral", "ollama-qwen2.5",
]

# Limited or no tool support (show warning)
TOOL_LIMITED_MODELS = [
    "ollama-phi4",
]

def generate_response_with_tools(model: str, messages: list, tools: list):
    """
    Generate response with function calling support.
    Warns and disables tools for unsupported providers.
    """
    
    if model in TOOL_LIMITED_MODELS:
        print(f"⚠️  WARNING: Model '{model}' has limited function calling support.")
        print(f"   Tools will be disabled. Consider using: {', '.join(TOOL_CAPABLE_MODELS[:5])}")
        # Call without tools
        response = client.chat.completions.create(
            model=model,
            messages=messages
        )
    elif model not in TOOL_CAPABLE_MODELS:
        print(f"⚠️  WARNING: Model '{model}' tool support unknown. Attempting with tools...")
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools
        )
    else:
        # Full tool support
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools
        )
    
    return response
```

> **Good News (2025 Update)**: Ollama now officially supports tool/function calling for Llama 3.1, Llama 3.2, Mistral (v0.3+), and Qwen2.5. These models can reliably determine when to call functions and generate proper JSON arguments.

---

## Step 6: Embeddings Usage

```python
# Embeddings via LiteLLM Proxy

# OpenAI embeddings (recommended for RAG quality)
response = client.embeddings.create(
    model="openai-embedding-large",
    input="Your text here"
)

# Azure embeddings
response = client.embeddings.create(
    model="azure-embedding",
    input="Your text here"
)

# Mistral embeddings
response = client.embeddings.create(
    model="mistral-embedding",
    input="Your text here"
)

# Ollama embeddings (local)
response = client.embeddings.create(
    model="ollama-embedding",
    input="Your text here"
)

embedding = response.data[0].embedding
```

### Important: RAG Consistency

> ⚠️ **Warning**: Don't mix embedding providers for the same vector store. If your RAG was built with `text-embedding-3-large`, query with the same model.

```python
# Configuration approach
EMBEDDING_CONFIG = {
    "openai": "openai-embedding-large",
    "azure": "azure-embedding",
    "mistral": "mistral-embedding",
    "ollama": "ollama-embedding"
}

# Use consistently
current_provider = "openai"
embedding_model = EMBEDDING_CONFIG[current_provider]
```

---

## Step 7: Audio Transcription (Whisper)

```python
# Audio transcription via LiteLLM Proxy

audio_file = open("audio.mp3", "rb")

response = client.audio.transcriptions.create(
    model="openai-whisper",
    file=audio_file
)

print(response.text)
```

---

## Deployment Commands

```bash
# Start the proxy
docker compose up -d

# View logs
docker compose logs -f litellm

# Stop
docker compose down

# Restart after config changes
docker compose restart litellm
```

---

## Testing the Setup

### 1. Health Check

```bash
curl http://localhost:4000/health
```

### 2. List Available Models

```bash
curl http://localhost:4000/models \
  -H "Authorization: Bearer sk-litellm-master-change-this"
```

### 3. Test Chat Completion

```bash
curl -X POST http://localhost:4000/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-litellm-master-change-this" \
  -d '{
    "model": "openai-gpt35",
    "messages": [{"role": "user", "content": "Hello, test!"}]
  }'
```

### 4. Test Embeddings

```bash
curl -X POST http://localhost:4000/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-litellm-master-change-this" \
  -d '{
    "model": "openai-embedding-large",
    "input": "Test embedding"
  }'
```

---

## Model Quick Reference

*Updated: March 2026*

### OpenAI Models

| Model Name | API Model ID | Chat | Embeddings | Tools | Audio | Context | Notes |
|------------|--------------|------|------------|-------|-------|---------|-------|
| `openai-gpt41` | `gpt-4.1` | ✅ | - | ✅ | - | 1M | Latest flagship, best for coding |
| `openai-gpt41-mini` | `gpt-4.1-mini` | ✅ | - | ✅ | - | 1M | Faster, 83% cheaper than GPT-4o |
| `openai-gpt41-nano` | `gpt-4.1-nano` | ✅ | - | ✅ | - | 1M | Fastest, cheapest |
| `openai-gpt35` | `gpt-3.5-turbo` | ✅ | - | ✅ | - | 16K | Legacy, cost-effective |
| `openai-embedding-large` | `text-embedding-3-large` | - | ✅ | - | - | 8K | Best quality embeddings |
| `openai-embedding-small` | `text-embedding-3-small` | - | ✅ | - | - | 8K | Faster, cheaper |
| `openai-whisper` | `whisper-1` | - | - | - | ✅ | - | $0.006/min transcription |

### Azure OpenAI Models

| Model Name | API Model ID | Chat | Embeddings | Tools | Audio | Context | Notes |
|------------|--------------|------|------------|-------|-------|---------|-------|
| `azure-gpt41` | `gpt-4.1` | ✅ | - | ✅ | - | 1M | Available April 2025+ |
| `azure-gpt41-mini` | `gpt-4.1-mini` | ✅ | - | ✅ | - | 1M | Available April 2025+ |
| `azure-gpt41-nano` | `gpt-4.1-nano` | ✅ | - | ✅ | - | 1M | Available April 2025+ |
| `azure-embedding` | `text-embedding-ada-002` | - | ✅ | - | - | 8K | Standard embedding |
| `azure-embedding-3-large` | `text-embedding-3-large` | - | ✅ | - | - | 8K | Best quality |
| `azure-whisper` | `whisper` | - | - | - | ✅ | - | Speech-to-text |

### Mistral AI Models

| Model Name | API Model ID | Chat | Embeddings | Tools | Audio | Context | Notes |
|------------|--------------|------|------------|-------|-------|---------|-------|
| `mistral-large-3` | `mistral-large-latest` | ✅ | - | ✅ | - | 256K | Flagship MoE (675B total params) |
| `mistral-medium-31` | `mistral-medium-2508` | ✅ | - | ✅ | - | 128K | Frontier multimodal |
| `mistral-small-32` | `mistral-small-2506` | ✅ | - | ✅ | - | 128K | Fast, efficient |
| `ministral-14b` | `ministral-3-14b` | ✅ | - | ✅ | - | 128K | Best small model |
| `ministral-8b` | `ministral-3-8b` | ✅ | - | ✅ | - | 128K | Edge deployment |
| `ministral-3b` | `ministral-3-3b` | ✅ | - | ✅ | - | 128K | Ultra-light |
| `mistral-embedding` | `mistral-embed` | - | ✅ | - | - | 8K | Text embeddings |
| `codestral-embed` | `codestral-embed` | - | ✅ | - | - | - | Code embeddings |
| `voxtral-small` | `voxtral-small-latest` | - | - | - | ✅ | 32K | 24B, best accuracy, $0.001/min |
| `voxtral-mini` | `voxtral-mini-latest` | - | - | - | ✅ | 32K | 3B, edge/local deployment |
| `voxtral-transcribe` | `voxtral-mini-latest` (via /audio/transcriptions) | - | - | - | ✅ | - | Transcription-only, beats Whisper |

> **Note**: Voxtral (released July 2025) outperforms OpenAI Whisper at half the cost ($0.001/min vs $0.006/min). Supports up to 30 min audio for transcription, 40 min for understanding.

### Google Gemini Models

| Model Name | API Model ID | Chat | Tools | Context | Notes |
|------------|--------------|------|-------|---------|-------|
| `gemini-2.5-pro` | `gemini/gemini-2.5-pro` | ✅ | ✅ | 1M | Flagship reasoning model |
| `gemini-2.5-flash` | `gemini/gemini-2.5-flash` | ✅ | ✅ | 1M | Fast, balanced performance |
| `gemini-2.5-flash-lite` | `gemini/gemini-2.5-flash-lite` | ✅ | ✅ | 1M | Lowest cost option |

**Pricing (per 1M tokens):**
- Gemini 2.5 Pro: $1.25 input / $10.00 output (≤200k context)
- Gemini 2.5 Flash: $0.30 input / $2.50 output
- Gemini 2.5 Flash-Lite: $0.10 input / $0.40 output

**Features:**
- All models support function calling
- Built-in "thinking" capabilities with controllable budgets
- Free tier available for development/testing
- Native multimodal support (text, image, audio, video)

### Ollama Local Models

| Model Name | Ollama Model | Chat | Embeddings | Tools | Audio | Context | Notes |
|------------|--------------|------|------------|-------|-------|---------|-------|
| `ollama-llama32` | `llama3.2` | ✅ | - | ✅ | - | 128K | **Full tool support** (fine-tuned for function calling) |
| `ollama-llama31-8b` | `llama3.1:8b` | ✅ | - | ✅ | - | 128K | **Full tool support**, best overall |
| `ollama-llama31-70b` | `llama3.1:70b` | ✅ | - | ✅ | - | 128K | **Full tool support**, highest accuracy |
| `ollama-mistral` | `mistral` | ✅ | - | ✅ | - | 32K | **Supports tools** (v0.3+) |
| `ollama-mixtral` | `mixtral:8x7b` | ✅ | - | ✅ | - | 32K | MoE, good multi-domain |
| `ollama-qwen25` | `qwen2.5` | ✅ | - | ✅ | - | 128K | Strong tool support |
| `ollama-phi4` | `phi4` | ✅ | - | ⚠️ | - | 16K | Limited tool support |
| `ollama-embedding` | `nomic-embed-text` | - | ✅ | - | - | 8K | Best local embedding |
| `ollama-mxbai-embed` | `mxbai-embed-large` | - | ✅ | - | - | 512 | Alternative embedding |

> **Tool Calling Update (2025)**: Ollama now officially supports tool/function calling for Llama 3.1, Llama 3.2, Mistral (v0.3+), Mixtral, and Qwen2.5. These models can reliably determine when to call functions and generate proper JSON arguments.

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully Supported |
| ⚠️ | Limited/Experimental (may need prompt adjustments) |
| - | Not applicable |

### Recommendations by Use Case

| Use Case | Recommended Model | Why |
|----------|-------------------|-----|
| **Production Chat** | `gpt-4.1` or `gemini-2.5-pro` | Best instruction following, 1M context |
| **Balanced (Default)** | `gpt-4.1-mini` or `gemini-2.5-flash` | Good quality at lower cost (Policy Bot default) |
| **Budget Chat** | `gpt-4.1-nano` or `gemini-2.5-flash-lite` | Cost-effective for simple queries |
| **Deep Reasoning** | `gemini-2.5-pro` | Built-in thinking capabilities |
| **Local/Offline Chat** | `ollama-llama3.2` or `ollama-qwen2.5` | Full tool support, runs locally |
| **RAG Embeddings** | `text-embedding-3-large` | Best quality for retrieval (Policy Bot default) |
| **Local Embeddings** | `ollama-embedding` (nomic) | Good quality, no API cost |
| **Audio Transcription** | `voxtral-transcribe` | Beats Whisper, half the cost |
| **Budget Transcription** | `whisper-1` | Well-established, $0.006/min |
| **Function Calling** | `gpt-4.1-mini`, `gemini-2.5-flash`, `mistral-large-3` | Reliable tool use |

---

## Switching Providers

To switch your entire application from OpenAI to Ollama:

1. **No code changes needed**
2. Update model name in your application config:

```python
# Before (OpenAI)
MODEL = "openai-gpt41"
EMBEDDING_MODEL = "openai-embedding-large"
AUDIO_MODEL = "openai-whisper"

# After (Ollama + Mistral Voxtral for audio)
MODEL = "ollama-llama32"
EMBEDDING_MODEL = "ollama-embedding"
AUDIO_MODEL = "voxtral-mini"  # Or keep openai-whisper

# Or fully Mistral
MODEL = "mistral-large-3"
EMBEDDING_MODEL = "mistral-embedding"
AUDIO_MODEL = "voxtral-small"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Check if Docker is running, verify port 4000 |
| Ollama not reachable | Use `host.docker.internal` in Docker, check Ollama is running |
| API key errors | Verify `.env` file is loaded, check key format |
| Model not found | Run `/models` endpoint to list available models |
| Timeout errors | Increase `request_timeout` in config |

---

## Known Limitations

| # | Limitation | Impact | Status | File |
|---|-----------|--------|--------|------|
| 1 | ~~Static YAML cache never invalidated~~ | ~~Runtime model additions invisible until restart~~ | **FIXED** — `clearLiteLLMCache()` now called after `syncAllModelsToLiteLLM()` completes | `litellm-sync.ts` |
| 2 | ~~Claude tool-calling streaming mismatch~~ | ~~Anthropic models routed through LiteLLM fail tool calling~~ | **FIXED** — Claude models now bypass LiteLLM via `@anthropic-ai/sdk` direct. `isClaudeModel()` routes to `streamAnthropicCompletion()` which receives pre-parsed tool inputs. | `openai.ts` |
| 3 | **No circuit breaker for chat completions** | If LiteLLM proxy is unreachable, non-Claude chat completions fail. Claude models are unaffected (direct SDK). Embeddings have a fallback model path, but chat/transcription do not. | Open | `openai.ts` |
| 4 | **Prefix-based provider detection only** | `getProviderFromModelPath()` defaults to `openai` for unrecognized prefixes. Custom/vLLM models without a prefix will be misidentified. No `deepseek/` prefix exists — DeepSeek models are synced dynamically with prefix by `litellm-sync.ts`. | Open | `litellm-validator.ts:282-294` |
| 5 | **No TTS or image generation via proxy** | `podcast_gen` and `image_gen` must bypass LiteLLM entirely | By design | `podcast-gen.ts`, `image-gen/` |

---

## Resources

- **LiteLLM Docs**: https://docs.litellm.ai/docs/
- **Supported Providers**: https://docs.litellm.ai/docs/providers
- **GitHub**: https://github.com/BerriAI/litellm
- **Ollama Models**: https://ollama.ai/library

---

*Last updated: March 2026 — Added Anthropic Direct SDK (Tier 1b) for Claude chat + tool calling, bypassing LiteLLM. Updated architecture to four-tier hybrid. Fixed Known Limitations #1 (cache invalidation) and #2 (Claude tool-calling). Added `isClaudeModel()` detection logic documentation.*