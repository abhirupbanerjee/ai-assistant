# RAG Pipeline — Complete Reference

> **Scope:** This document covers the entire Retrieval-Augmented Generation pipeline in AI Assistant, from document ingestion through vector search, hybrid retrieval, reranking, and response generation.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DOCUMENT INGESTION                            │
│  Upload → Extract → Chunk → Embed → Qdrant                           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                          QUERY PIPELINE                              │
│                                                                      │
│  User Query ──► Cache Check ──► Query Expansion ──► Embedding       │
│       │                                              │               │
│       │              ┌───────────────────────────────┘               │
│       │              ▼                                               │
│       │     ┌─────────────────┐                                      │
│       │     │  Qdrant Search  │◄── Dense + Sparse (BM25) Hybrid     │
│       │     │  (RRF Merge)    │                                      │
│       │     └────────┬────────┘                                      │
│       │              │                                               │
│       │     ┌────────▼────────┐                                      │
│       │     │  Reranker        │◄── BGE Large / Cohere / BGE Base   │
│       │     │  (Priority Fallback)                                   │
│       │     └────────┬────────┘                                      │
│       │              │                                               │
│       │     ┌────────▼────────┐                                      │
│       └────►│  LLM Response   │◄── 4-Route Architecture              │
│             │  + Tool Calling │                                      │
│             └─────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Document Ingestion

**Entry point:** `src/lib/ingest.ts`

### 1.1 Document Extraction

Supported formats and their extractors:

| Format | Extractor | Notes |
|--------|-----------|-------|
| PDF | `pdf-parse` (local) or Azure Document Intelligence (optional) | Scanned PDFs need OCR provider |
| DOCX | `mammoth` | Paragraph-level extraction |
| XLSX | `exceljs` | Sheet-by-sheet with row data |
| PPTX | `officeparser` | Slide-by-slide extraction |
| Images | Azure DI / Mistral OCR (optional) | PNG, JPG, WEBP, GIF |
| Text | Direct paste | Bypasses OCR entirely |
| YouTube | YouTube Data API v3 | Transcript extraction |
| Web URLs | Cheerio + fetch | HTML content extraction |

**Key file:** `src/lib/document-extractor.ts`

### 1.2 Chunking Strategies

Two strategies, configurable per-category via Admin > Settings > RAG:

| Strategy | File | How it works |
|----------|------|-------------|
| **Recursive** | `src/lib/chunking/recursive-splitter.ts` | Splits on paragraph/line boundaries with configurable `chunkSize` (default 500) and `chunkOverlap` (default 50). Fast, deterministic. |
| **Semantic** | `src/lib/chunking/semantic-chunker.ts` | Embeds adjacent sentences, splits where cosine similarity drops below `semanticBreakpointThreshold` (default  0.5). Slower but preserves semantic coherence. |

**Heading enrichment:** `src/lib/chunking/heading-extractor.ts` — extracts Markdown headings from the document and prepends the nearest heading to each chunk for context.

### 1.3 Embedding

- **Model:** `text-embedding-3-large` (3072 dimensions) via direct native SDKs, configurable in Admin > Settings > Embedding
- **Quantization:** `int8` scalar quantization enabled by default in Qdrant (reduces storage ~4x, minimal accuracy loss)
- **Batch size:** Up to 2048 chunks per embedding API call
- **Key function:** `createEmbeddings()` in `src/lib/openai.ts`

### 1.4 Vector Store (Qdrant)

**Key files:** `src/lib/vector-store/qdrant.ts`, `src/lib/vector-store/index.ts`, `src/lib/vector-store/types.ts`

**Collection structure:**

| Collection | Name pattern | Purpose |
|-----------|-------------|---------|
| Global | `global_documents` | Documents not assigned to any category |
| Category | `policy_{slug}` | Per-category document isolation |

**Payload schema per point:**

```typescript
{
  documentId: string;       // DB document ID
  documentName: string;     // Original filename
  pageNumber: number;       // Source page (1-based)
  originalId: string;       // Unique chunk ID for dedup/delete
  text: string;             // Chunk text content
}
```

**Key operations:**
- `addDocuments()` — Upsert chunks with embeddings
- `query()` — Dense vector search with optional score threshold
- `query()` with `hybridSearch=true` — Dense + BM25 sparse search with RRF merge
- `deleteDocuments()` — Delete by `originalId` payload filter
- `getDocumentChunksByDocId()` — Fetch all chunks for a document (used by reprocessing)

### 1.5 Background Ingestion

Documents are processed asynchronously via `processDocumentAsync()` in `src/lib/ingest.ts`:

1. Extract text → chunk → embed → upsert to Qdrant
2. Update document status in Postgres (`processing` → `completed` / `failed`)

The fire-and-forget pattern means the API returns immediately after upload while processing continues in the background.

---

## Phase 2: Hybrid Search (Dense + Sparse)

**Key file:** `src/lib/vector-store/qdrant.ts` — `query()` method with `hybridSearch=true`

### 2.1 Dense Vector Search

Standard cosine similarity search using the query embedding against stored vectors. Returns top-k results with scores.

### 2.2 Sparse Vector Search (BM25)

Qdrant supports sparse vectors natively. The pipeline:

1. **Tokenize** the query text using `tokenizeForSparseVector()` — splits on whitespace, lowercases, removes stopwords
2. **Build sparse vector** — token → (index, value) mapping where value = TF-IDF-like weight
3. **Search** Qdrant's sparse index with the query sparse vector

### 2.3 Reciprocal Rank Fusion (RRF)

Dense and sparse results are merged using RRF:

```
RRF_score(d) = Σ 1 / (k + rank_i(d))    where k = 60
```

This balances contributions from both search methods without requiring score normalization.

**Configuration:** `hybridSearchEnabled` toggle in Admin > Settings > RAG (default: enabled)

---

## Phase 3: Reranking

**File:** `src/lib/reranker.ts`

After vector search, chunks are reranked by a cross-encoder for higher precision.

### 3.1 Priority Fallback Chain

| Priority | Provider | Accuracy | Cost | Requirements |
|----------|----------|----------|------|-------------|
| 1 | **BGE Reranker Large** | Best | Free (local) | ONNX Runtime (~670MB download on first use) |
| 2 | **Fireworks AI Qwen3 Reranker** | High | Paid | `FIREWORKS_API_KEY` |
| 3 | **Cohere API** | Good | Paid | `COHERE_API_KEY` |
| 4 | **BGE Reranker Base** | Medium | Free (local) | ONNX Runtime (~220MB) |
| 5 | **Local bi-encoder** | Low | Free | None (fallback only) |

The system automatically selects the highest-priority provider that's available and healthy.

### 3.2 Reranking Process

1. **Input:** Merged chunk list, user query
2. **Score:** Each chunk receives a relevance score from the cross-encoder
3. **Filter:** Chunks below `minScore` threshold are dropped
4. **Boost:** Documents from prior conversation turns get a score multiplier (default 1.3x)
5. **Sort:** Final ranking by reranker score
6. **Redis cache:** Reranked results cached with 24h TTL

**Configuration:** Admin > Settings > Reranker

---

## Phase 4: Response Generation

**File:** `src/lib/openai.ts` (`generateResponseWithTools()`)

### 4.1 Context Assembly

`formatContext()` in `src/lib/rag.ts` assembles the final prompt:

1. **System prompt** — Resolved per-category with acronym expansion
2. **Source chunks** — Reranked chunks with citation markers `[Source N]`
3. **Conversation history** — Previous messages (configurable limit)
4. **User document chunks** — Uploaded file chunks (if any)
5. **Data source descriptions** — Available external API descriptions
6. **Skills** — Resolved skill instructions

### 4.2 LLM Routing (Four-Route Architecture)

All providers use direct native SDKs/APIs — no proxy intermediary.

| Route | Provider | Use Case |
|-------|----------|----------|
| **Route 1** | LiteLLM proxy | General chat, embeddings, transcription |
| **Route 2** | Direct SDKs | Anthropic Claude, Fireworks AI, DeepSeek, Moonshot |
| **Route 3** | Local Ollama | Air-gapped deployments |
| **Route 4** | Ollama Cloud | Hosted Ollama models via native API |

Model detection is prefix-based: `anthropic/`, `claude-`, `fireworks/`, `ollama-`, `deepseek-`, `moonshot/`, etc. See [`docs/features/LLM.md`](LLM.md) for the authoritative reference.

### 4.3 Tool Calling

When the LLM decides to invoke a tool:
1. Tool call parsed from LLM response
2. Tool executed via `src/lib/tools/` dispatcher
3. Tool result injected back into conversation
4. LLM generates final response incorporating tool output

**23 built-in tools:** Web search, document generation (PDF, DOCX, HTML, PPTX, XLSX), chart/diagram generation, image generation, KB summary, translation, and more.

---

## Query Pipeline — Step by Step

The complete `ragQuery()` flow in `src/lib/rag.ts`:

```
1.  Validate input (max 10000 chars)
2.  Load RAG settings + category IDs (parallel)
3.  Check Redis cache (if enabled, no user docs)
4.  Expand queries (parallel with embedding):
    a. LLM query rewriting (if enabled)
    b. Acronym expansion
    c. Multi-query generation
5.  Create embeddings for all expanded queries
6.  Build context from Qdrant:
    a. Dense search (cosine similarity)
    b. Optional hybrid search (dense + BM25 sparse + RRF merge)
    c. Multi-collection search (category + global)
    d. User document search (if files attached)
7.  Rerank merged chunks (cross-encoder fallback chain)
8.  Format context with source citations
9.  Generate response with tools (4-route LLM)
10. Cache result in Redis (if enabled)
11. Return response with sources + metadata
```

---

## Admin Configuration

### RAG Settings (Admin > Settings > RAG)

| Setting | Default | Purpose |
|---------|---------|---------|
| `topKChunks` | 5 | Chunks retrieved per query |
| `maxContextChunks` | 10 | Max chunks in final context |
| `similarityThreshold` | 0.3 | Min Qdrant score for inclusion |
| `chunkSize` | 500 | Characters per chunk |
| `chunkOverlap` | 50 | Overlap between chunks |
| `chunkingStrategy` | `recursive` | `recursive` or `semantic` |
| `semanticBreakpointThreshold` | 0.5 | Similarity drop for semantic splits |
| `hybridSearchEnabled` | true | Dense + sparse (BM25) search |
| `queryExpansionEnabled` | true | Multi-query generation |
| `llmQueryRewritingEnabled` | false | LLM-based query rewriting |
| `cacheEnabled` | true | Redis query caching |
| `cacheTTLSeconds` | 86400 | Cache TTL (24h) |

### Reranker Settings (Admin > Settings > Reranker)

| Setting | Default | Purpose |
|---------|---------|---------|
| `provider` | `bge-large` | Active reranker provider |
| `minScore` | 0.1 | Min reranker score for inclusion |
| `cohereApiKey` | — | Cohere API key |
| `fireworksApiKey` | — | Fireworks AI key (for Qwen3 reranker) |

---

## API Endpoints

### Chat API
- `POST /api/chat` — Main RAG chat endpoint (SSE streaming)
- `GET /api/chat/slash-commands` — Available slash commands

### Settings API
- `GET /api/admin/settings` — All settings
- `PUT /api/admin/settings` — Update settings

---

## Database Tables

### Postgres Tables for RAG

| Table | Purpose |
|-------|---------|
| `documents` | Document metadata, status, category assignments |
| `document_summaries` | Pre-computed per-document LLM summaries for KB overview queries |
| `categories` | Category definitions with slugs |
| `document_categories` | Many-to-many document ↔ category |
| `settings` | Key-value store for all RAG/reranker settings |

### Qdrant Collections

| Collection | Dimensions | Quantization | Purpose |
|-----------|-----------|-------------|---------|
| `global_documents` | 3072 | int8 | Global (uncategorized) documents |
| `policy_{slug}` | 3072 | int8 | Per-category documents |

---

## Document Reindexing

### Reindex API

- `POST /api/admin/refresh?mode=vector` — Re-embed all documents in Qdrant
- `POST /api/admin/refresh?mode=all` — Full reprocess (extract → chunk → embed)
- `POST /api/admin/documents/[id]/reindex` — Reindex a single document

### Admin UI Operations

Available at **Admin > Documents**:

| Action | What it does |
|--------|-------------|
| **Reindex (single doc)** | Re-embeds a single document into Qdrant |
| **Refresh Vector** | Re-embeds all documents (mode=vector) |
| **Refresh All** | Full reprocess of all documents (mode=all) |
