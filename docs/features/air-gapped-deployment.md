# Air-Gapped / Offline Deployment

Policy Bot supports fully air-gapped deployments where no external API calls leave the network. This document covers every offline-capable component and what is unavailable without internet.

---

## Route 3 — Local / Ollama

Route 3 is the dedicated offline route. It connects directly to a local Ollama server (`ollama:11434/v1`) using the OpenAI SDK, bypassing both LiteLLM and all cloud APIs.

```
Route 1: LiteLLM Proxy (:4000)  →  OpenAI, Gemini, Mistral, DeepSeek     (cloud)
Route 2: Direct SDKs             →  Anthropic, Fireworks AI                (cloud)
Route 3: Local / Ollama          →  Ollama (:11434/v1 direct)             (offline)
```

For a pure air-gapped deployment, enable only Route 3 and disable Routes 1 and 2.

See [routes.md](routes.md) for full routing architecture and admin configuration.

---

## Offline Capabilities Matrix

### LLM Chat — Ollama

Local LLM inference via Ollama. Models run on the host machine (CPU or GPU).

| Model | Params | Tool Calling | Notes |
|-------|--------|-------------|-------|
| `llama3.2:3b` | 3B | Yes | Default, good general purpose |
| `qwen3:4b` | 4B | Yes | Reasoning + tool calling |
| `qwen3:1.7b` | 1.7B | Yes | Smallest, fastest |
| `gpt-oss:20b` | 20B | Yes | Largest, best quality |

Admins can install additional models via `ollama pull <model>`. The admin UI discovers installed models via Ollama's `/api/tags` endpoint.

**Constraints for local models:**
- Tool whitelist: only 5 offline tools offered (doc_gen, xlsx_gen, pptx_gen, diagram_gen, chart_gen)
- Tool choice forced to `auto` (no forced function calling)
- No parallel tool execution
- Context window: 16384 tokens default (`OLLAMA_NUM_CTX`)
- Cold-start timeout: 180s (CPU model loading)
- Memory limit: 4GB Docker default

### Embeddings — Local (Transformers.js)

In-process embedding generation via `@xenova/transformers` (quantized ONNX runtime). No external service needed.

| Model | Dimensions | Download | Max Tokens | Languages |
|-------|-----------|----------|-----------|-----------|
| `mxbai-embed-large` | 1024 | ~670MB | 512 | English-focused |
| `bge-m3` | 1024 | ~1.2GB | 8192 | 100+ languages |

Models are lazy-loaded on first use and cached in `TRANSFORMERS_CACHE` (default `/tmp/transformers_cache`).

### Rerankers — Local (Transformers.js)

Cross-encoder rerankers for RAG result quality. Runs in-process alongside embeddings.

| Model | Type | Download | Accuracy |
|-------|------|----------|----------|
| `bge-reranker-large` | Cross-encoder | ~670MB | Best |
| `bge-reranker-base` | Cross-encoder | ~220MB | Good |
| `all-MiniLM-L6-v2` | Bi-encoder (legacy) | ~90MB | Fair |

Priority-based fallback: tries bge-large first, falls back to bge-base, then legacy bi-encoder. Results cached in Redis.

### Document Extraction — Local Parsers

| Format | Library | Notes |
|--------|---------|-------|
| PDF (text-based) | `pdf-parse` | Text extraction per page |
| DOCX | `mammoth` | Word document text |
| XLSX | `exceljs` | All sheets, cell values |
| PPTX | `officeparser` | Slide text extraction |
| TXT, MD, JSON | Built-in | Direct UTF-8 read |

### Tools — Offline

These tools work without any external API:

| Tool | Library | Output |
|------|---------|--------|
| `doc_gen` | pdfkit, docx | PDF / DOCX documents |
| `xlsx_gen` | ExcelJS | Excel spreadsheets |
| `pptx_gen` | pptxlib | PowerPoint presentations |
| `diagram_gen` | — | Mermaid syntax (client-rendered) |
| `chart_gen` | — | Chart config JSON (client-rendered) |

### Infrastructure — Local Docker Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| PostgreSQL | postgres:16 | 5432 | Primary database |
| Qdrant | qdrant/qdrant:v1.17.0 | 6333 | Vector store (RAG) |
| Redis | redis:7-alpine | 6379 | Caching layer |
| Ollama | ollama/ollama:0.18.2 | 11434 | LLM inference |

LiteLLM is **not required** in a pure Route 3 deployment.

---

## What Does NOT Work Offline

| Capability | Requires | Why |
|-----------|----------|-----|
| Web search | Tavily API key | No local search engine |
| Image generation | DALL-E or Gemini API | No local image model |
| Podcast / TTS | OpenAI or Gemini TTS | No local speech synthesis |
| Translation | External LLM API | Could be done via Ollama but not implemented |
| YouTube transcripts | Supadata API | External service |
| PageSpeed analysis | Google Lighthouse API | External service |
| SSL / DNS / Security scans | SSL Labs, Google DNS, Mozilla | External services |
| Code analysis | SonarCloud API | External service |
| Email sending | SendGrid API | External service |
| Scanned PDF / Image OCR | Mistral or Azure DI API | No local OCR engine |
| Function API tools | Admin-configured REST APIs | By definition external |

---

## Docker Compose — Air-Gapped Profile

For a pure offline deployment:

```bash
# Start only local services (no LiteLLM needed)
docker compose --profile postgres --profile qdrant --profile ollama up -d
```

Required environment variables:

```env
# Ollama
OLLAMA_API_BASE=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_NUM_CTX=16384

# Embeddings (use local model)
# Set via Admin UI: Settings → Embedding → select "MixedBread Large (Local)"

# Reranker (local by default)
# BGE reranker models auto-download on first use

# No API keys needed for Routes 1/2 providers
# OPENAI_API_KEY, ANTHROPIC_API_KEY, etc. can be omitted
```

### Pre-loading Models for Air-Gap

In a true air-gapped environment, models must be pre-loaded before disconnecting from the internet:

1. **Ollama models**: `ollama pull llama3.2:3b` (entrypoint script does this automatically)
2. **Embedding models**: First embedding request triggers download of `mxbai-embed-large` (~670MB)
3. **Reranker models**: First rerank request triggers download of `bge-reranker-large` (~670MB)

To pre-warm all models:
```bash
# Ollama LLM (handled by entrypoint)
docker exec policy-bot-ollama ollama pull llama3.2:3b

# Embedding + reranker models download on first use via transformers.js
# Trigger by uploading a test document in the admin UI
```

---

## Admin Configuration for Air-Gap

1. **Routes**: Admin > Settings > Routes → Enable Route 3, disable Routes 1 and 2
2. **Default model**: Set to an Ollama model (e.g., `qwen3:4b`)
3. **Embedding model**: Admin > Settings > Embedding → Select "MixedBread Large (Local)" or "BGE-M3 (Local)"
4. **Reranker**: Admin > Settings > Reranker → Ensure BGE models are at top of priority list, disable Cohere and Fireworks
5. **Document processing**: Admin > Settings > Document Processing → Local parsers (pdf-parse, mammoth, exceljs, officeparser) are always active; disable Mistral OCR and Azure DI if not available
6. **Tools**: Disable tools requiring external APIs (web_search, image_gen, podcast_gen, etc.) via category/skill configuration

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/openai.ts` | Ollama client, routing decision, tool filtering |
| `src/lib/local-embeddings.ts` | Local embedding models (transformers.js) |
| `src/lib/reranker.ts` | Local reranker models (transformers.js) |
| `src/lib/document-extractor.ts` | Local document parsers |
| `src/lib/llm-fallback.ts` | Route classification, cross-route fallback |
| `src/lib/db/config.ts` | RoutesSettings interface |
| `docker-compose.yml` | Ollama service definition |
| `scripts/ollama-entrypoint.sh` | Model pull + warm-up on startup |
