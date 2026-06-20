# RAG Pipeline — Complete Reference

> **Scope:** This document covers the entire Retrieval-Augmented Generation pipeline in Policy Bot, from document ingestion through vector search, graph-augmented retrieval, reranking, and response generation.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DOCUMENT INGESTION                            │
│  Upload → Extract → Chunk → Embed → Qdrant  +  Entity Extract →    │
│                                       FalkorDB                       │
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
│       │     ┌────────▼────────┐     ┌────────────────────┐          │
│       │     │  Graph-Augmented│────►│  FalkorDB PPR      │          │
│       │     │  Retrieval      │◄────│  Entity Expansion  │          │
│       │     └────────┬────────┘     └────────────────────┘          │
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

- **Model:** `text-embedding-3-large` (3072 dimensions) via LiteLLM, configurable in Admin > Settings > Embedding
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
  entityIds?: string[];     // Graph entity references (Phase 2)
}
```

**Key operations:**
- `addDocuments()` — Upsert chunks with embeddings
- `query()` — Dense vector search with optional score threshold
- `query()` with `hybridSearch=true` — Dense + BM25 sparse search with RRF merge
- `deleteDocuments()` — Delete by `originalId` payload filter
- `getDocumentChunksByDocId()` — Fetch all chunks for a document (used by backfill/reprocessing)

### 1.5 Background Ingestion

Documents are processed asynchronously via `processDocumentAsync()` in `src/lib/ingest.ts`:

1. Extract text → chunk → embed → upsert to Qdrant
2. If graph augmentation is enabled, extract entities → write to FalkorDB
3. Update document status in Postgres (`processing` → `completed` / `failed`)

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

## Phase 3: Graph-Augmented Retrieval

**Key files:**
- `src/lib/graph/falkordb-client.ts` — FalkorDB connection singleton
- `src/lib/graph/entity-extraction.ts` — Entity/relation extraction pipeline
- `src/lib/graph/retrieval.ts` — PPR-based retrieval with chunk expansion

### 3.1 FalkorDB Graph Database

FalkorDB is a Redis-compatible graph database running as a Docker service (`--profile falkordb`). It stores entity-relationship data as a property graph with Cypher query support.

**Connection:** `src/lib/graph/falkordb-client.ts`

| Env Var | Default | Purpose |
|---------|---------|---------|
| `FALKORDB_HOST` | `localhost` | FalkorDB host (Docker: `falkordb`) |
| `FALKORDB_PORT` | `6380` | FalkorDB port (avoids Redis 6379 conflict) |
| `FALKORDB_GRAPH_NAME` | `policybot` | Graph name for all operations |

**Health check:** `isGraphHealthy()` — verifies FalkorDB connection is live before any graph operation.

**Retry wrapper:** `retryGraphQuery()` — exponential backoff (100ms, 200ms, 400ms) for transient socket errors during heavy parallel writes.

### 3.2 Graph Schema

```
Nodes:
  (:Entity {id, name, type})              // Canonical entity (person, org, policy, etc.)
  (:Document {id, name, category, source}) // Document reference
  (:Chunk {qdrantId, documentId, pageNumber})  // Lightweight Qdrant reference

Edges:
  (:Entity)-[:MENTIONS]->(:Chunk)          // Entity appears in chunk
  (:Chunk)-[:PART_OF]->(:Document)         // Chunk belongs to document
  (:Entity)-[:RELATES_TO {type, confidence}]->(:Entity)  // Extracted relation
  (:Entity)-[:SAME_AS {score}]->(:Entity)  // Synonymy/canonicalization
```

**Design decisions:**
- `Chunk` nodes store only `qdrantId` — no text. Text is fetched from Qdrant on demand.
- `QueryLog` nodes are **not** in the graph. Query telemetry goes to Postgres (`query_logs` + `retrieval_traces` tables) to avoid graph bloat and PPR pollution.
- `SAME_AS` edges link synonym entities (e.g., "PTO" ↔ "paid time off") to bridge phrasings during PPR traversal.

### 3.3 Entity Extraction Pipeline

**File:** `src/lib/graph/entity-extraction.ts`

Runs during background ingestion (`processDocumentAsync`), never on the query path.

**Flow:**

1. **Per-chunk LLM call** — `createInternalCompletion()` routes through the four-route LLM architecture to a configurable extraction model (default: the system's primary model; recommended: cheap local model like `llama3.1:8b`)
2. **Extraction prompt** returns JSON: `{ entities: [{name, type}], relations: [{head, relation, tail}] }`
3. **Robust JSON extraction** — greedy `{` → `}` matching (same pattern as `rag.ts`)
4. **Entity resolution** — canonical ID from `entity:{name_lowercase_underscore}`; FalkorDB `MERGE` handles exact duplicates; future: embedding-based `SAME_AS` for near-duplicates
5. **Batch Cypher writes** — `UNWIND` queries for entities, chunks, MENTIONS, RELATES_TO (5-10x faster than individual queries)
6. **Idempotency** — keyed by chunk `qdrantId`; in-memory `processedChunks` set prevents re-extraction within a session

**Prompt safeguards:**
- Explicitly excludes filenames, headers, footers, page numbers, generic terms
- Returns `{"entities": [], "relations": []}` for chunks with no real-world entities
- System message reinforces JSON-only output

**Configurable settings** (Admin > Settings > Graph RAG):

| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| `extractionModel` | (system default) | Any route-compatible model | LLM for entity extraction |
| `maxTokens` | 1024 | 128–4096 | Max tokens for extraction response |
| `concurrency` | 5 | 1–10 | Parallel chunk processing limit |

**Failure persistence:** Extraction failures are logged to `extraction_failures` table in Postgres, visible in Admin > Settings > Graph RAG > Failures tab. Supports one-click reprocessing.

### 3.4 HippoRAG-Style Retrieval with In-Process PPR

**File:** `src/lib/graph/retrieval.ts`

This is the query-time graph augmentation step, inserted between Qdrant search and reranking.

**Flow:**

```
Qdrant top chunks
       │
       ▼
┌──────────────────┐
│ 1. Seed Selection │  Top-N chunks → MENTIONS → Entity nodes
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 2. Subgraph Fetch │  2-3 hop neighborhood via Cypher
│    (bounded)      │  RELATES_TO | SAME_AS *1..3
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 3. In-Process PPR │  Personalized PageRank (TypeScript)
│    (power iter.)  │  damping=0.85, converge Δ<1e-6
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 4. Chunk Expansion│  Top-K PPR entities → MENTIONS → Chunk IDs
│                    │  → Qdrant batch retrieve
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 5. Merge & Rerank │  Combine with original Qdrant chunks
│                    │  → rerankChunks() (Cohere/BGE)
└──────────────────┘
```

**Step 1 — Seed Selection:**
- Takes top-N Qdrant chunks (configurable: `seedChunkCount`, default 10)
- Looks up their `Entity` nodes in FalkorDB via `MENTIONS` edges
- Returns seed entity IDs

**Step 2 — Subgraph Fetch:**
- Cypher query with bounded variable-length path: `RELATES_TO|SAME_AS*1..3`
- Path-explosion guard: `SUBGRAPH_RESULT_CAP = 1000`
- Returns entities and edges for the local neighborhood

**Step 3 — In-Process Personalized PageRank:**
- ~60-80 lines of TypeScript power iteration
- Damping factor: 0.85
- Seed mass concentrated on seed nodes (uniform over seed set)
- Convergence: Δ < 1e-6 or 50 iterations max
- Returns ranked entity list, truncated to `pprTopK` (configurable, default 20)

> **Why in-process?** FalkorDB's built-in `algo.pageRank` lacks seed-node personalization. In-process PPR gives full control over the seed vector, which is the core of HippoRAG's retrieval mechanism.

**Step 4 — Chunk Expansion:**
- For top PPR entities, fetch `MENTIONS → Chunk` qdrantIds
- Deduplicate against original Qdrant chunks
- Retrieve chunk text from Qdrant (currently via zero-vector + ID filter; future: batch retrieve API)

**Step 5 — Merge & Rerank:**
- Combine PPR-expanded chunks with original Qdrant top chunks
- Pass through `rerankChunks()` (unchanged from Phase 1)
- Feed into `formatContext()` → `generateResponseWithTools()` (unchanged)

**Conditional execution:**
- Graph step is **skipped** when the top Qdrant chunk score exceeds `skipThreshold` (default 0.85) — indicates a clear single-document answer that doesn't need graph expansion
- Falls back to pure RAG when graph returns empty/low-confidence results or FalkorDB is unhealthy

**Latency budget:**
- Graph step: ~15-35ms typical
- End-to-end: ~450-650ms (graph) vs ~300-500ms (pure RAG)

**Configurable settings** (Admin > Settings > Graph RAG):

| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| `graphAugmentationEnabled` | false | boolean | Master toggle |
| `skipThreshold` | 0.85 | 0.5–0.99 | Qdrant score above which graph is skipped |
| `pprTopK` | 20 | 3–100 | Top PPR entities to expand |
| `seedChunkCount` | 10 | 3–50 | Qdrant chunks used for seeding |

---

## Phase 4: Reranking

**File:** `src/lib/reranker.ts`

After vector search (and optional graph expansion), chunks are reranked by a cross-encoder for higher precision.

### 4.1 Priority Fallback Chain

| Priority | Provider | Accuracy | Cost | Requirements |
|----------|----------|----------|------|-------------|
| 1 | **BGE Reranker Large** | Best | Free (local) | ONNX Runtime (~670MB download on first use) |
| 2 | **Fireworks AI Qwen3 Reranker** | High | Paid | `FIREWORKS_API_KEY` |
| 3 | **Cohere API** | Good | Paid | `COHERE_API_KEY` |
| 4 | **BGE Reranker Base** | Medium | Free (local) | ONNX Runtime (~220MB) |
| 5 | **Local bi-encoder** | Low | Free | None (fallback only) |

The system automatically selects the highest-priority provider that's available and healthy.

### 4.2 Reranking Process

1. **Input:** Merged chunk list (Qdrant + graph-expanded), user query
2. **Score:** Each chunk receives a relevance score from the cross-encoder
3. **Filter:** Chunks below `minScore` threshold are dropped
4. **Boost:** Documents from prior conversation turns get a score multiplier (default 1.3x)
5. **Sort:** Final ranking by reranker score
6. **Redis cache:** Reranked results cached with 24h TTL

**Configuration:** Admin > Settings > Reranker

---

## Phase 5: Response Generation

**File:** `src/lib/openai.ts` (`generateResponseWithTools()`)

### 5.1 Context Assembly

`formatContext()` in `src/lib/rag.ts` assembles the final prompt:

1. **System prompt** — Resolved per-category with acronym expansion
2. **Source chunks** — Reranked chunks with citation markers `[Source N]`
3. **Conversation history** — Previous messages (configurable limit)
4. **User document chunks** — Uploaded file chunks (if any)
5. **Data source descriptions** — Available external API descriptions
6. **Skills** — Resolved skill instructions

### 5.2 LLM Routing (Four-Route Architecture)

| Route | Provider | Use Case |
|-------|----------|----------|
| **Route 1** | LiteLLM proxy | General chat, embeddings, transcription |
| **Route 2** | Direct SDKs | Anthropic Claude, Fireworks, DeepSeek, Moonshot |
| **Route 3** | Local Ollama | Air-gapped deployments |
| **Route 4** | Ollama Cloud | Hosted Ollama models |

Model detection is prefix-based: `anthropic/`, `claude-`, `fireworks/`, `ollama-`, `deepseek-`, etc.

### 5.3 Tool Calling

When the LLM decides to invoke a tool:
1. Tool call parsed from LLM response
2. Tool executed via `src/lib/tools/` dispatcher
3. Tool result injected back into conversation
4. LLM generates final response incorporating tool output

**22 built-in tools:** Web search, document generation (PDF, DOCX, HTML, PPTX, XLSX), chart/diagram generation, image generation, translation, and more.

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
7.  Graph-augmented retrieval (if enabled):
    a. Check skip threshold (high-confidence shortcut)
    b. Seed selection from Qdrant top chunks
    c. Subgraph fetch (bounded 2-3 hop)
    d. In-process PPR (power iteration)
    e. Chunk expansion from PPR entities
    f. Merge with original chunks
    g. Log to query_logs + retrieval_traces
8.  Rerank merged chunks (cross-encoder fallback chain)
9.  Format context with source citations
10. Generate response with tools (4-route LLM)
11. Cache result in Redis (if enabled)
12. Return response with sources + metadata
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

### Graph Settings (Admin > Settings > Graph RAG)

| Setting | Default | Purpose |
|---------|---------|---------|
| `graphAugmentationEnabled` | false | Master toggle for graph-augmented RAG |
| `skipThreshold` | 0.85 | Qdrant score above which graph is skipped |
| `pprTopK` | 20 | Top PPR entities to expand |
| `seedChunkCount` | 10 | Qdrant chunks used for seeding PPR |
| `resolutionThreshold` | 0.92 | Entity similarity for SAME_AS linking |
| `extractionModel` | (system default) | LLM model for entity extraction |
| `maxTokens` | 1024 | Max tokens for extraction response |
| `concurrency` | 5 | Parallel chunk extraction limit |

### Reranker Settings (Admin > Settings > Reranker)

| Setting | Default | Purpose |
|---------|---------|---------|
| `provider` | `bge-large` | Active reranker provider |
| `minScore` | 0.1 | Min reranker score for inclusion |
| `cohereApiKey` | — | Cohere API key |
| `fireworksApiKey` | — | Fireworks API key (for Qwen3 reranker) |

---

## API Endpoints

### Chat API
- `POST /api/chat` — Main RAG chat endpoint (SSE streaming)
- `GET /api/chat/slash-commands` — Available slash commands

### Graph Admin API
- `GET /api/admin/graph/status` — FalkorDB health + graph stats
- `POST /api/admin/graph/backfill` — Backfill graph from existing Qdrant data
- `GET /api/admin/graph/failures` — List extraction failures
- `POST /api/admin/graph/failures` — Reprocess failed extractions
- `DELETE /api/admin/graph/clear` — Clear entire graph
- `GET /api/admin/graph/performance` — Performance metrics (hit rate, latency, trend)

### Settings API
- `GET /api/admin/settings` — All settings including graph config
- `PUT /api/admin/settings` — Update settings (`{ type: 'graph', settings: {...} }`)

---

## Database Tables

### Postgres Tables for RAG

| Table | Purpose |
|-------|---------|
| `documents` | Document metadata, status, category assignments |
| `categories` | Category definitions with slugs |
| `document_categories` | Many-to-many document ↔ category |
| `settings` | Key-value store for all RAG/graph/reranker settings |
| `query_logs` | Query telemetry (query, graph enabled/skipped, latency) |
| `retrieval_traces` | Graph retrieval details (seed entities, PPR results, chunk IDs) |
| `extraction_failures` | Failed entity extractions for admin reprocessing |

### Qdrant Collections

| Collection | Dimensions | Quantization | Purpose |
|-----------|-----------|-------------|---------|
| `global_documents` | 3072 | int8 | Global (uncategorized) documents |
| `policy_{slug}` | 3072 | int8 | Per-category documents |

### FalkorDB Graph

| Label | Properties | Purpose |
|-------|-----------|---------|
| `Entity` | id, name, type | Canonical entity node |
| `Document` | id, name, category, source | Document reference |
| `Chunk` | qdrantId, documentId, pageNumber | Qdrant chunk reference |

---

## Backfill & Maintenance

### Backfill Script

`src/scripts/backfill-graph.ts` — Processes all existing Qdrant documents through entity extraction:

```bash
npx tsx src/scripts/backfill-graph.ts
```

- Idempotent: re-running produces no duplicate nodes/edges
- Processes documents in batches with configurable concurrency
- Skips chunks already in the `processedChunks` set

### Admin UI Operations

Available at **Admin > Settings > Graph RAG > Maintenance**:

| Action | What it does |
|--------|-------------|
| **Backfill All** | Runs backfill for all documents in Qdrant |
| **Reprocess Failed** | Re-attempts failed extractions from `extraction_failures` table |
| **Clear Graph** | Deletes all nodes and edges from FalkorDB |

### Performance Monitoring

**Admin > Settings > Graph RAG > Performance** panel shows:

- **Hit rate** — % of graph-enabled queries that used graph expansion
- **Skip rate** — % of queries skipped due to high Qdrant confidence
- **Avg chunk expansion** — Average additional chunks retrieved via graph
- **Avg latency** — Graph step latency in ms
- **Daily trend** — Hit rate, skip rate, latency over time
- **Top expanded entities** — Most frequently expanded entities via PPR

---

## Phase 3: Self-Evolving Knowledge Base (Future — Not Yet Started)

> **Status:** Foundations are in place (see table below), but no Phase 3 code has been written yet. This section describes the planned capabilities and the specific pending implementation items.

### What Phase 3 Will Do

Phase 3 transforms the graph from a static index into a **self-evolving knowledge base** that continuously improves its own retrieval quality based on query feedback.

### Pending Implementation Items

| # | Item | Description | Depends On |
|---|------|-------------|------------|
| 1 | **Query Observer** | Background service that reads `query_logs`/`retrieval_traces` to identify knowledge gaps — queries where graph augmentation was skipped, returned empty, or PPR scores were low | `query_logs` + `retrieval_traces` tables (✅ exist) |
| 2 | **Connection Miner** | Discovers implicit relationships between entities by re-running `entity-extraction.ts` with a "relationship discovery" prompt on entity pairs that co-occur in queries but lack `RELATES_TO` edges | Modular extraction service (✅ exists) |
| 3 | **Embedding-based SAME_AS** | Replace the current pass-through entity resolution with actual embedding similarity: embed entity names, query Qdrant for near-duplicates above `resolutionThreshold`, create `SAME_AS` edges automatically | `createEmbeddings()` (✅ exists), entity resolution hook in `entity-extraction.ts` |
| 4 | **Auto-Enrichment Pipeline** | Scheduled job that runs the connection miner + SAME_AS linker on new documents as they arrive, adding nodes/edges without full graph rebuild | Idempotent extraction (✅ exists), `processDocumentAsync` hook (✅ exists) |
| 5 | **Feedback Loop** | Compare PPR score deltas before/after enrichment to evaluate whether new edges improved retrieval. Surface metrics in the admin performance panel. | PPR scores in traces (✅ logged), performance API (✅ exists) |
| 6 | **Batch Retrieve API** | Add a `retrieveByIDs()` method to `VectorStoreClient` for efficient chunk text lookup by Qdrant point IDs, replacing the current zero-vector + filter workaround in `retrieval.ts` | Qdrant client (✅ exists) |
| 7 | **Working Memory (beta)** | `plan_memories` table with heuristic keyword extraction and deterministic wave summary injection for the autonomous agent. Feature flag: `agent_working_memory_enabled` (default false). | Agent planner/executor (✅ exists) |

### Foundations Already In Place

| Foundation | Status | Location |
|-----------|--------|----------|
| Postgres `query_logs` + `retrieval_traces` | ✅ Created | `src/lib/db/compat/query-logs.ts` |
| Modular entity extraction service | ✅ Complete | `src/lib/graph/entity-extraction.ts` |
| `SAME_AS` synonymy edges | ✅ Schema supports | FalkorDB schema |
| Bidirectional Qdrant↔FalkorDB refs | ✅ Via qdrantId | Both modules |
| Interpretable PPR scores in traces | ✅ Logged | `src/lib/rag.ts` |
| Idempotent incremental updates | ✅ MERGE + processedChunks | `src/lib/graph/entity-extraction.ts` |
| Admin performance panel | ✅ Live | `src/components/admin/settings/GraphSettings.tsx` |
| Extraction failure tracking | ✅ Live | `extraction_failures` table + reprocessing API |
