# Policy Bot - Solution Architecture

Comprehensive architecture documentation for Policy Bot - an enterprise RAG platform for policy document management.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USERS                                      │
│              (Admin / Super User / Regular User)                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    TRAEFIK REVERSE PROXY                                │
│              (TLS Termination, Let's Encrypt SSL)                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS 16 APPLICATION                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Chat UI   │  │  Admin UI   │  │ Super User  │  │    Auth     │     │
│  │  (React)    │  │  (React)    │  │     UI      │  │ (NextAuth)  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         API ROUTES                              │    │
│  │  /api/chat  │ /api/threads │ /api/admin │ /api/superuser       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      CORE LIBRARIES                             │    │
│  │  RAG Pipeline │ Ingest │ DB Layer │ OpenAI │ Auth │ Storage    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
           │            │            │            │
           ▼            ▼            ▼            ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    DATABASE     │ │  VECTOR STORE   │ │     REDIS       │ │   FILESYSTEM    │
│  PostgreSQL     │ │     Qdrant      │ │  Cache/Session  │ │  Threads/Docs   │
│  (Kysely ORM)   │ │                 │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       LITELLM PROXY                                     │
│           (Multi-Provider LLM Gateway - OpenAI Compatible)              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Model Routing: openai/*, mistral/*, gemini/*, ollama/*, fw/*    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
           │
           ├──────────────┬──────────────┬──────────────┬──────────────┬────────────┐
           ▼              ▼              ▼              ▼              ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────┐
│  OPENAI API  │ │  ANTHROPIC   │ │  MISTRAL AI  │ │GOOGLE GEMINI │ │ DEEPSEEK │ │FIREWORKS AI  │
│ gpt-4.1 (V)  │ │ Claude (V)   │ │ large-3 (V)  │ │gemini-2.5(V) │ │ R1 (🧠)  │ │ MiniMax M2.5 │
│ gpt-4.1-mini │ │ Sonnet 4.5   │ │ small-3.2(V) │ │ 2.5-flash(V) │ │ chat     │ │ Kimi K2.5    │
│ gpt-4.1-nano │ │ Haiku 4.5    │ │ Mistral OCR  │ │ gemini embed │ │          │ │ Qwen3        │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────┘ └──────────────┘

┌─────────────────┐
│  OLLAMA (Local) │
│   llama3.2      │
│   qwen2.5       │
│   phi4          │
└─────────────────┘
(V) = Vision/Multimodal  (🧠) = Thinking/Extended reasoning
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │ text-embedding- │  │  Tavily API     │  │   whisper-1     │          │
│  │ 3-large (3072d) │  │  (Web Search)   │  │  (Transcribe)   │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
│  ┌─────────────────┐  ┌─────────────────┐                               │
│  │  BGE Reranker   │  │   Cohere API    │                               │
│  │ (Transformers.js│  │   (Reranking)   │                               │
│  └─────────────────┘  └─────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Next.js 16, React 19, Tailwind CSS | UI Framework |
| Backend | Next.js API Routes | REST API |
| Database | PostgreSQL (Kysely ORM) | Metadata storage — SQLite removed March 2026 |
| LLM Gateway | LiteLLM Proxy | Multi-provider LLM abstraction (OpenAI-compatible API) |
| LLM - OpenAI | GPT-4.1, GPT-4.1-mini, GPT-4.1-nano | Chat completions with function calling + vision |
| LLM - Anthropic | Claude Sonnet 4.5, Haiku 4.5, Opus 4.5 | 1M context, vision, tool calling |
| LLM - Gemini | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite | Fast inference with vision + thinking support |
| LLM - Mistral | mistral-large-3, mistral-small-3.2 | Alternative LLM provider with vision + OCR |
| LLM - DeepSeek | deepseek-reasoner, deepseek-chat | Reasoning models with `<think>` token support |
| LLM - Fireworks | MiniMax M2.5, Kimi K2.5, GPT-OSS, Qwen3 | Open-source models (dev/test environments) |
| LLM - Local | Ollama (llama3.2, qwen2.5, phi4) | Self-hosted models, no API cost, air-gapped deployments |
| Thinking Models | DeepSeek R1, Claude 3.7+, Gemini Thinking | Native `<think>` token processing for extended reasoning |
| Embeddings | OpenAI text-embedding-3-large (3072d), Mistral Embed (1024d), BGE-M3 (local) | Vector embeddings |
| Transcription | OpenAI whisper-1 | Voice-to-text |
| Document Processing | mammoth, exceljs, officeparser (local); Azure DI, Mistral OCR (API); pdf-parse (local) | Text extraction from documents and images |
| Web Search | Tavily API (optional) | Real-time web search via function calling |
| Data Sources | API + CSV integration | External data querying with visualization |
| Function APIs | OpenAI-format schemas | Dynamic function calling to external services |
| Reranking | Cohere API, Transformers.js (BGE) | Chunk reranking for improved relevance |
| Vector DB | Qdrant | Category-based document embeddings storage |
| Cache | Redis 7 | Query caching (RAG + Tavily), sessions |
| Auth | NextAuth.js v4 + Azure AD + Google + Credentials | Multi-provider SSO + email/password |
| Storage | Local Filesystem | Thread messages, uploaded PDFs |
| Reverse Proxy | Traefik v3.6.1 | TLS termination, Let's Encrypt SSL |
| Deployment | Docker Compose | Container orchestration |

---

## Core Components

### 1. Category System

Documents are organized into categories, each with its own Qdrant collection:

```
┌────────────────────────────────────────────────────────────┐
│                    CATEGORY STRUCTURE                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐│
│  │   HR Category   │  │ Finance Category│  │ IT Category  ││
│  │  ─────────────  │  │  ─────────────  │  │ ──────────── ││
│  │ Qdrant:         │  │ Qdrant:         │  │ Qdrant:      ││
│  │ policy_hr       │  │ policy_finance  │  │ policy_it    ││
│  │                 │  │                 │  │              ││
│  │ Docs:           │  │ Docs:           │  │ Docs:        ││
│  │ - Leave Policy  │  │ - Budget Guide  │  │ - IT Security││
│  │ - HR Handbook   │  │ - Expenses      │  │ - VPN Guide  ││
│  └─────────────────┘  └─────────────────┘  └──────────────┘│
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              GLOBAL DOCUMENTS                         │  │
│  │  Indexed into ALL category collections                │  │
│  │  - Company Policies                                   │  │
│  │  - Code of Conduct                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 2. RAG Pipeline

The Retrieval-Augmented Generation pipeline now includes category awareness:

```
User Query
    │
    ▼
┌─────────────────┐
│ Get Thread      │──── Load category context from thread
│ Categories      │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Check Cache     │──── Cache Hit ────▶ Return Cached Response
└─────────────────┘
    │ Cache Miss
    ▼
┌─────────────────┐
│ Create Query    │
│ Embedding       │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Query Category  │──── Search only relevant category collections
│ Collections     │     + Global documents
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Rerank Chunks   │──── If reranker enabled (Cohere or local)
│ (Optional)      │     Re-score chunks by query relevance
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Build Context   │◀──── Include user-uploaded doc (if any)
│ + Last 5 msgs   │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ Generate with OpenAI (function calling)     │
│ - GPT decides if web search needed          │
│ - Calls Tavily tool if enabled              │
│ - Combines RAG + Web sources                │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ Cache Response  │
│ Return + Sources│  ◀── Sources tagged with [WEB] if from Tavily
└─────────────────┘
```

**Web Search Integration**: If Tavily is enabled in admin settings, the LLM can automatically trigger web searches using OpenAI function calling. Results are cached separately in Redis with configurable TTL (60 seconds to 1 month).

**Reranker Integration**: When enabled, retrieved chunks are re-scored using priority-based fallback:
- **BGE Reranker Large** (`Xenova/bge-reranker-large`): Best accuracy cross-encoder (~670MB)
- **Cohere API** (`rerank-english-v3.0`): Fast, API-based reranking
- **BGE Reranker Base** (`Xenova/bge-reranker-base`): Smaller cross-encoder (~220MB)
- **Local Bi-encoder** (`Xenova/all-MiniLM-L6-v2`): Legacy, less accurate (~90MB)

Reranking improves result quality by using cross-encoder models to jointly score query+document pairs, then filtering by minimum score threshold. Providers are tried in priority order with automatic fallback.

### 2.1 Multimodal/Vision Support

When using a vision-capable model, users can upload images alongside their questions for visual analysis:

```
User uploads image + question
    │
    ▼
┌─────────────────┐
│ Read image as   │
│ base64 data     │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Build multimodal│──── Combines text context + image content
│ message content │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ Generate with Vision Model                   │
│ - GPT-4.1, Gemini 2.5, Mistral Large 3      │
│ - Image passed as base64 data URL           │
│ - Detail level: high for better analysis    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ Return Response │
│ + Sources       │
└─────────────────┘
```

**Vision-Capable Models**:
| Provider | Models | Image Format |
|----------|--------|--------------|
| OpenAI | gpt-4.1, gpt-4.1-mini, gpt-4.1-nano | Base64 data URL |
| Google | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite | Base64 (auto-converted by LiteLLM) |
| Mistral | mistral-large-3, mistral-small-3.2 | Base64 data URL |

**Implementation**: Images are passed as `ImageContent` objects with base64 encoding, MIME type, and filename. The `generateResponseWithTools()` function builds multimodal content parts when images are present.

### 2.2 Vision Capability Checking

The system performs runtime capability checks to determine how images should be processed based on model and OCR availability:

```
Image Upload Request
    │
    ▼
┌─────────────────────────┐
│ getImageCapabilities()  │
│ Check model + OCR config│
└─────────────────────────┘
    │
    ├─── Vision + OCR ──────► Strategy: 'vision-and-ocr'
    │                         Send images to LLM + OCR text in RAG
    │
    ├─── Vision only ───────► Strategy: 'vision-only'
    │                         Send images to LLM (no OCR text)
    │
    ├─── OCR only ──────────► Strategy: 'ocr-only'
    │                         Extract text via OCR, no visual analysis
    │                         User notified of limitation
    │
    └─── Neither ───────────► Strategy: 'none'
                              Block processing, show error message
```

**Capability Detection** (`src/lib/config-capability-checker.ts`):

| Function | Purpose |
|----------|---------|
| `isVisionCapableModel(modelId)` | Check if model supports vision via `enabled_models` DB |
| `isImageOcrAvailable()` | Check if Mistral or Azure DI OCR is configured |
| `getImageCapabilities(modelId)` | Return full `ImageCapabilities` object with strategy |

**ImageCapabilities Interface**:
```typescript
interface ImageCapabilities {
  canProcessImages: boolean;    // Can system handle images at all?
  hasVisionSupport: boolean;    // Can LLM analyze images visually?
  hasOcrSupport: boolean;       // Can extract text from images?
  strategy: 'vision-and-ocr' | 'vision-only' | 'ocr-only' | 'none';
  message: string;              // User-facing explanation
  modelId: string;              // Model used for check
}
```

**Frontend Integration**: The FileUpload component fetches capabilities via `/api/config/capabilities` and displays:
- Yellow warning banner for `ocr-only` mode
- Red error banner for `none` mode (no image processing available)

**Backend Enforcement**: Chat stream routes (`/api/chat/stream`, `/api/w/[slug]/chat/stream`) check capabilities before loading images and pass the strategy to `generateResponseWithTools()` for appropriate handling.

### 3. Document Ingestion

Documents are ingested with category assignments. Two ingestion paths are supported:

#### File Upload (PDF, DOCX, XLSX, PPTX, Images)
```
File Upload
    │
    ▼
┌──────────────────────────────────────────┐
│ Extract Text (tiered fallback):          │
│  Tier 0:   Plain text → direct read      │
│  Tier 0.5: Office → mammoth/exceljs/     │
│            officeparser (local, no API)   │
│  Tier 1+:  Mistral OCR, Azure DI,       │
│            pdf-parse (configurable order) │
└──────────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ Track Pages     │
│ Boundaries      │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Chunk Text      │
│ (Configurable   │
│  size/overlap)  │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Batch Embed     │
│ All Chunks      │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Store in Vector Store               │
│ (Qdrant)                            │
│ - Global: ALL category collections  │
│ - Category: Specific collections    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ Update Database │
│ Document record │
└─────────────────┘
```

#### Text Content Upload (Direct Text)
```
Text Content
    │
    ▼
┌─────────────────┐
│ Save as .txt    │
│ file to         │
│ global-docs/    │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Chunk Text      │  ◀── Bypasses OCR/extraction
│ (Configurable   │      (text is already plain)
│  size/overlap)  │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Batch Embed     │
│ All Chunks      │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Store in Vector Store               │
│ (Qdrant)                            │
│ - Global: ALL category collections  │
│ - Category: Specific collections    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ Update Database │
│ Document record │
└─────────────────┘
```

**Note**: Text content upload is more efficient than file upload as it skips the OCR/document extraction step, directly chunking the provided text.

### 4. Thread Management

Threads provide conversation isolation and category-based document access:

- Each user has their own threads
- Threads can be assigned to specific categories
- Category assignment determines which documents are searchable
- User-uploaded content (files, web pages, YouTube) attached to threads
- Deleting a thread removes all associated data

#### Thread Upload Options

Users can add content to threads via three methods:

| Method | Description | Requirements |
|--------|-------------|--------------|
| **File Upload** | PDF, TXT, PNG, JPG, JPEG, WebP (max 10MB) | None |
| **Web URL** | Extract text content from web pages | Tavily API key |
| **YouTube** | Extract video transcripts | Supadata API key |

```
User clicks 📎 Attachment button
    │
    ├── File Tab ──────▶ Upload local files (drag & drop or browse)
    │
    ├── Web URL Tab ───▶ Enter URL ──▶ Tavily extracts content
    │
    └── YouTube Tab ───▶ Enter URL ──▶ Supadata extracts transcript
    │
    ▼
Queue items ──▶ Upload All ──▶ Save to thread folder
    │
    ▼
Artifacts Panel updates with new items
```

### 5. Data Tools

Policy Bot includes tools for querying external data sources and executing dynamic functions:

#### Data Sources
- **API Data Sources**: Connect to external REST APIs with authentication
- **CSV Data Sources**: Upload and query CSV files with automatic column inference
- **Category-Based Access**: Data sources linked to categories for access control
- **Server-Side Aggregation**: Group, count, sum, avg operations for large datasets
- **Auto-Visualization**: Automatic chart type selection based on data patterns

```
User Query
    │
    ▼
┌─────────────────┐
│ LLM decides to  │
│ call data_source│
│ tool            │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Fetch from API  │──── or ────┐
│ or CSV source   │            │
└─────────────────┘            │
    │                          │
    ▼                          ▼
┌─────────────────┐    ┌─────────────────┐
│ Apply filters,  │    │ Return cached   │
│ aggregations    │    │ response        │
└─────────────────┘    └─────────────────┘
    │
    ▼
┌─────────────────┐
│ Return data +   │
│ visualization   │
│ hints           │
└─────────────────┘
```

#### Function APIs
- **Dynamic Functions**: Admin-configured API endpoints with OpenAI-format schemas
- **Automatic Injection**: Functions added to LLM tools based on category context
- **Flexible Operations**: Support GET, POST, PUT, DELETE methods
- **Use Cases**: Submit feedback, retrieve analytics, trigger workflows

#### Tool Routing
- **Keyword/Regex Patterns**: Match user messages to force specific tools
- **Force Modes**: `required` (force specific tool), `preferred` (force tool use), `suggested` (hint)
- **Category Scoping**: Rules can apply globally or to specific categories
- **Priority System**: Lower priority values are evaluated first

```
User Message
    │
    ▼
┌─────────────────┐
│ Match against   │
│ routing rules   │
└─────────────────┘
    │
    ├── No Match ──────────────▶ tool_choice = 'auto'
    │
    ├── Single Required ───────▶ tool_choice = {function: {name: '...'}}
    │
    ├── Multiple Required ─────▶ tool_choice = 'required' (LLM picks one)
    │
    └── Preferred/Suggested ───▶ tool_choice = 'required' or 'auto'
```

### 6. Artifacts Panel

The Artifacts Panel is a collapsible right sidebar that displays all content associated with a thread:

```
┌──────────────────────────────────────────────────────────────────────┐
│                           ARTIFACTS PANEL                             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  📎 Artifacts (count)                              [Collapse]  │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │  ▼ AI Generated (purple)                                       │  │
│  │    - Generated documents (PDF, DOCX)                           │  │
│  │    - Generated images                                          │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │  ▼ User Uploads (blue)                                         │  │
│  │    - PDF, TXT, PNG, JPG, JPEG, WebP files                      │  │
│  │    - Removable via ✕ button                                    │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │  ▼ Web Sources (green)                                         │  │
│  │    - Extracted web page content via Tavily                     │  │
│  │    - Shows title and URL                                       │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │  ▼ YouTube (red)                                               │  │
│  │    - Extracted video transcripts via Supadata                  │  │
│  │    - Shows video title and URL                                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Collapsible Sections**: Each category can be expanded/collapsed
- **Persist State**: Panel collapse state saved to localStorage
- **Remove Items**: Users can remove uploads and URL sources
- **Download Links**: AI-generated content is downloadable
- **Count Badges**: Shows total items per section

**Implementation**: `src/components/chat/ArtifactsPanel.tsx`

### 7. Thread Sharing

Thread sharing allows users to share conversations via secure, expiring links:

```
User clicks Share button
    │
    ▼
┌─────────────────┐
│ Open Share      │
│ Modal           │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Configure       │──── • Expiry (1/7/30/90 days or never)
│ Share Options   │     • Allow downloads (on/off)
│                 │     • Email notification (optional)
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Generate Token  │──── Cryptographically secure 256-bit token
│ (base64url)     │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Store in DB     │──── thread_shares table
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Return URL      │──── /shared/{token}
└─────────────────┘
```

**Share Features:**
| Feature | Description |
|---------|-------------|
| **Secure Tokens** | 256-bit cryptographic tokens (base64url) |
| **Configurable Expiry** | 1, 7, 30, 90 days or never expires |
| **Download Control** | Enable/disable file downloads per share |
| **Email Notification** | Optional SendGrid integration |
| **Access Logging** | Track views and downloads |
| **Revocation** | Shares can be revoked at any time |
| **Authentication Required** | Recipients must sign in to view |

**Implementation**: `src/lib/db/sharing.ts`, `src/components/sharing/ShareModal.tsx`

### 8. User Memory System

The memory system extracts and persists key facts about users across conversations:

```
Conversation ends
    │
    ▼
┌─────────────────┐
│ Check if memory │──── Memory extraction enabled?
│ enabled         │
└─────────────────┘
    │ Yes
    ▼
┌─────────────────┐
│ Get existing    │──── Load from user_memories table
│ facts           │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ LLM extracts    │──── Analyze conversation for:
│ new facts       │     • User's role/department
│                 │     • Projects they work on
│                 │     • Response preferences
│                 │     • Frequent topics
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Merge & dedupe  │──── Limit to max facts (default 10)
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Store in DB     │──── Per user, optionally per category
└─────────────────┘
```

**Memory Features:**
- **Per-Category Context**: Facts can be stored globally or per category
- **Automatic Extraction**: LLM-based extraction at configurable intervals
- **Context Injection**: Facts injected into prompts for personalization
- **User Access**: Users can view/edit their memory via "Your Memory" sidebar
- **Admin Control**: Enable/disable via Admin > Settings > Memory

**Implementation**: `src/lib/memory.ts`

### 9. Thread Summarization

Automatic conversation compression to reduce token usage:

```
Check before chat
    │
    ▼
┌─────────────────┐
│ Count thread    │──── Compare to threshold (default 20)
│ messages        │
└─────────────────┘
    │ Above threshold
    ▼
┌─────────────────┐
│ Estimate tokens │──── Character-based heuristics
└─────────────────┘
    │ Above token limit
    ▼
┌─────────────────┐
│ LLM summarizes  │──── Preserves: questions, answers,
│ old messages    │     decisions, action items, sources
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Archive         │──── Move messages to archived_messages
│ messages        │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Store summary   │──── thread_summaries table
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Inject summary  │──── Summary replaces archived messages
│ into context    │     in future prompts
└─────────────────┘
```

**Summarization Settings:**
| Setting | Default | Description |
|---------|---------|-------------|
| enabled | false | Master switch |
| messageThreshold | 20 | Messages before summarization triggers |
| maxTokens | 8000 | Token limit before summarization |
| keepRecentMessages | 5 | Messages to keep unsummarized |
| model | (inherit) | LLM for summarization |

**Implementation**: `src/lib/summarization.ts`

### 10. Skills System

Modular prompt injection system for contextual behavior modification:

```
User sends message
    │
    ▼
┌─────────────────┐
│ Resolve active  │
│ skills          │
└─────────────────┘
    │
    ├── "Always" skills ───────────▶ Core behavior (citations, etc.)
    │
    ├── "Category" skills ─────────▶ Match thread categories
    │
    └── "Keyword" skills ──────────▶ Match message patterns
    │
    ▼
┌─────────────────┐
│ Sort by         │──── Lower priority = higher precedence
│ priority        │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Combine prompts │──── Respect max token limit
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Inject into     │──── After system prompt
│ context         │
└─────────────────┘
```

**Skill Types:**
| Type | Trigger | Example Use Case |
|------|---------|------------------|
| **Always** | Every message | Core behavior, citation formatting |
| **Category** | Thread category | HR-specific tone, Finance compliance |
| **Keyword** | Regex/keyword match | Legal disclaimer on "contract" topics |

**Skill Properties:**
- **priority**: Lower values processed first (core: 1-9, high: 10-99, medium: 100-499, low: 500+)
- **is_core**: Protected skills can't be deleted
- **is_index**: Used for RAG index optimization
- **category_restricted**: Only applies to linked categories
- **token_estimate**: Budget tracking for prompt size

**Tool Association (Keyword Skills):**

Keyword-triggered skills can optionally force a specific tool when matched:

| Field | Description |
|-------|-------------|
| **tool_name** | Tool to invoke (web_search, chart_gen, doc_gen, data_source, etc.) |
| **force_mode** | How strongly to enforce: `required`, `preferred`, `suggested` |
| **tool_config_override** | Tool-specific JSON config (e.g., chart type, data source filter) |

Example: A "sales report" keyword skill can force `chart_gen` with `{"chartType": "bar"}` config.

**Role Permissions:**
- **Admins**: Can create skills at any priority level
- **Superusers**: Can create skills with priority 100+ (medium/low priority only)

**Implementation**: `src/lib/skills/`, `src/lib/db/skills.ts`

### 11. Welcome Screen

Role-based onboarding shown when no thread is selected:

```
User lands on chat (no thread selected)
    │
    ▼
┌─────────────────┐
│ Check user role │
└─────────────────┘
    │
    ├── User ──────────▶ Base cards + "Your Memory"
    │
    ├── Superuser ─────▶ Base cards + "Manage Your Categories"
    │
    └── Admin ─────────▶ Base cards + "Admin Dashboard"
    │
    ▼
Display welcome message + topic cards
```

**Welcome Screen Cards:**
| Card | Description | All Roles |
|------|-------------|-----------|
| Start Conversation | Create new thread with category selection | ✓ |
| Continue Threads | Resume previous conversations | ✓ |
| Chat Features | Upload PDFs, voice input, web URLs | ✓ |
| Artifacts Panel | View uploads and AI-generated content | ✓ |
| Your Memory | Access stored user facts | ✓ |
| Manage Categories | SuperUser dashboard access | SuperUser |
| Admin Dashboard | Full system control | Admin |

**Implementation**: `src/components/chat/WelcomeScreen.tsx`

### 12. Authentication Flow

```
User Access
    │
    ▼
┌─────────────────┐
│ Check Session   │──── Valid Session ────▶ Allow Access
└─────────────────┘
    │ No Session
    ▼
┌─────────────────┐
│ Show Sign-In    │
│ (Azure AD,      │
│  Google OAuth,  │
│  or Credentials)│
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Access Check    │──── Not Allowed ────▶ Deny Access
│                 │
│ Allowlist Mode: │
│  Check user in  │
│  DB users table │
│                 │
│ Domain Mode:    │
│  Check email    │
│  domain         │
└─────────────────┘
    │ Allowed
    ▼
┌─────────────────┐
│ Create Session  │
│ Assign Role     │
│ (admin/super/   │
│  user)          │
└─────────────────┘
```

### Access Control Modes

| Mode | Configuration | Description |
|------|---------------|-------------|
| **Allowlist** | `ACCESS_MODE=allowlist` | Only users explicitly added to the database can sign in |
| **Domain** | `ACCESS_MODE=domain` | Any user from allowed email domains can sign in |

---

### 13. Tool Routing System

Tool Routing provides deterministic tool invocation by forcing the LLM to call specific tools when user messages match predefined patterns. This overcomes the non-deterministic nature of LLM function calling.

> **📖 Full Documentation:** [docs/features/SKILLS.md](../../features/SKILLS.md) (see Tool Association section)

#### Architecture

```
User Message
    │
    ▼
┌─────────────────────┐
│ Tool Routing Engine │
│                     │
│ 1. Load all active  │
│    routing rules    │
│ 2. Filter by        │
│    categories       │
│ 3. Match patterns   │
│    (keyword/regex)  │
│ 4. Sort by priority │
└─────────────────────┘
    │
    ├──── No Match ────▶ Standard LLM Function Calling
    │
    └──── Match Found
          │
          ▼
    ┌─────────────────────┐
    │ Apply Force Mode    │
    │                     │
    │ Required:  tool_choice = {type: "function", function: {name: "chart_gen"}}
    │ Preferred: tool_choice = "required" (any tool)
    │ Suggested: tool_choice = {type: "function", function: {name: "chart_gen"}} (hint)
    └─────────────────────┘
          │
          ▼
    Pass to OpenAI API with tool_choice parameter
```

#### Database Schema

**Routing Rules Table:**
```sql
CREATE TABLE tool_routing_rules (
  id INTEGER PRIMARY KEY,
  tool_name TEXT NOT NULL,           -- Target tool (e.g., "chart_gen")
  rule_name TEXT NOT NULL,           -- Descriptive name
  rule_type TEXT NOT NULL,           -- "keyword" or "regex"
  patterns TEXT NOT NULL,            -- JSON array of patterns
  force_mode TEXT NOT NULL,          -- "required", "preferred", "suggested"
  priority INTEGER DEFAULT 100,     -- Lower = higher priority
  categories TEXT,                   -- JSON array (null = all categories)
  active BOOLEAN DEFAULT 1,          -- Enable/disable
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### Pattern Matching

**Keyword Mode:**
- Uses word boundary matching: `\b(pattern1|pattern2|pattern3)\b`
- Case-insensitive
- Example: Pattern `chart` matches "create a chart" but not "merchant"

**Regex Mode:**
- Full JavaScript regex syntax supported
- Case-sensitive by default (use `(?i)` for case-insensitive)
- Example: `\binitiate\b.*assessment` matches "initiate SOE assessment"

#### Force Modes

| Mode | Behavior | OpenAI API Mapping |
|------|----------|-------------------|
| **required** | Forces the specific tool to be called | `{type: "function", function: {name: "tool"}}` |
| **preferred** | Forces the LLM to use some tool (LLM chooses which) | `"required"` |
| **suggested** | Hints at the tool but LLM can ignore | Same as required (implementation detail) |

#### Multi-Match Resolution

When multiple rules match:
1. Rules sorted by **priority** (lower number = higher priority)
2. If multiple `required` rules → LLM must pick one of those tools
3. If single `required` rule → That specific tool is forced
4. `preferred` rules processed after `required`
5. `suggested` rules only apply if no higher modes match

#### Default Rules

On first access, these default rules are created:

| Tool | Patterns | Force Mode |
|------|----------|------------|
| `chart_gen` | chart, graph, plot, visualize, visualization, bar chart, pie chart, line graph | required |
| `task_planner` | initiate, assessment, evaluate all, step by step, create a plan | required |
| `doc_gen` | generate report, create pdf, export to pdf, formal document | required |
| `web_search` | search the web, look up online, latest news, current information | required |

#### Implementation Files

- **Routing Logic:** `src/lib/toolRouting.ts`
- **Database Layer:** `src/lib/db/toolRouting.ts`
- **Admin UI:** `src/app/admin/tools/routing/page.tsx`
- **API Routes:** `src/app/api/admin/tool-routing/*`

---

### 14. Progressive Web App (PWA)

Policy Bot implements PWA capabilities, allowing users to install the application as a standalone app on desktop and mobile devices.

> **📖 Full Documentation:** [docs/features/PWA.md](../../features/PWA.md)

#### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PWA COMPONENTS                          │
│                                                                 │
│  ┌───────────────────┐  ┌───────────────────┐                   │
│  │  Web App Manifest │  │  Service Worker   │                   │
│  │  (Dynamic JSON)   │  │  (sw.js)          │                   │
│  └───────────────────┘  └───────────────────┘                   │
│           │                      │                              │
│           │                      │                              │
│           ▼                      ▼                              │
│  ┌────────────────────────────────────────────────────┐         │
│  │        PWA Features                                │         │
│  │  ✅ Installable (desktop + mobile)                 │         │
│  │  ✅ Standalone mode (no browser UI)                │         │
│  │  ✅ Custom app icon and name                       │         │
│  │  ✅ Auto-updates via service worker                │         │
│  │  ✅ Splash screen with branding                    │         │
│  │  ❌ Offline mode (requires online connection)      │         │
│  │  ❌ Push notifications (not implemented)           │         │
│  │  ❌ Background sync (not implemented)              │         │
│  └────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

#### Components

**1. Web App Manifest**
- **Route:** `src/app/manifest.webmanifest/route.ts`
- **Dynamic generation** based on admin settings (app name, icon, colors)
- **Content-Type:** `application/manifest+json`
- **Caching:** Served with cache headers to reduce latency

```typescript
// Example manifest structure
{
  "name": "Policy Bot",
  "short_name": "Policy",
  "description": "Enterprise RAG platform for policy documents",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6366f1",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

**2. Service Worker**
- **File:** `public/sw.js`
- **Responsibilities:**
  - Cache static assets (HTML, CSS, JS)
  - Implement update strategy (stale-while-revalidate)
  - Show offline page when network unavailable
  - Handle background updates
- **Registration:** Automatic via Next.js script in app layout

**3. Install Banner**
- **Component:** `src/components/pwa/InstallBanner.tsx`
- **Behavior:**
  - Detects if app is installable
  - Shows prompt banner for desktop/mobile
  - Hides after installation
  - Respects user dismissal (localStorage)

**4. Icon Generation**
- **Admin upload:** Square PNG icon (512x512px recommended)
- **Fallback:** Uses Application Logo if no PWA icon configured
- **Sizes:** Manifest auto-generates icon entries for 192x192 and 512x512

#### Database Configuration

**Settings Table (PWA fields):**
```sql
pwa_enabled BOOLEAN DEFAULT 1,
pwa_app_name TEXT,                -- Default: app_name
pwa_short_name TEXT,              -- Default: first 12 chars of app_name
pwa_app_icon TEXT,                -- Icon URL
pwa_theme_color TEXT DEFAULT '#6366f1',
pwa_background_color TEXT DEFAULT '#ffffff'
```

#### Browser Support

| Browser | Desktop | Mobile | Install Method |
|---------|---------|--------|----------------|
| Chrome | ✅ | ✅ | Install icon in address bar |
| Edge | ✅ | ✅ | Install icon in address bar |
| Safari | ✅ | ✅ | Share → Add to Home Screen (iOS) |
| Firefox | ✅ | ✅ | Address bar prompt |

#### Limitations

**No Offline Support:**
- Policy Bot requires network connectivity for:
  - Document search (vector database queries)
  - LLM API calls (chat completions)
  - Authentication validation
- Offline page shown when disconnected
- **Reason:** Full offline mode would require:
  - Local embedding generation
  - Local LLM inference
  - Sync mechanism for documents and threads

**No Push Notifications:**
- Not implemented in current version
- Could be added for:
  - Document upload completion
  - Thread share notifications
  - System announcements

#### Implementation Files

- **Manifest Route:** `src/app/manifest.webmanifest/route.ts`
- **Service Worker:** `public/sw.js`
- **Install Banner:** `src/components/pwa/InstallBanner.tsx`
- **Offline Page:** `src/app/offline/page.tsx`
- **Settings UI:** Admin dashboard PWA section

---

### 15. Thinking Models

Policy Bot natively processes extended reasoning tokens (`<think>`) emitted by reasoning-capable models:

```
LLM Response Stream
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    THINKING TOKEN PIPELINE                       │
│                                                                 │
│  Streaming chunk arrives                                        │
│          │                                                       │
│          ├── Contains <think>...</think> ─────▶ Strip & hide   │
│          │   (reasoning process)                from user UI   │
│          │                                                       │
│          └── Regular content ─────────────────▶ Stream to UI  │
│                                                                 │
│  Final response: clean text without reasoning tokens            │
└─────────────────────────────────────────────────────────────────┘
```

**Supported Models:**
| Provider | Models | Thinking Token Format |
|----------|--------|----------------------|
| DeepSeek | deepseek-reasoner (R1) | `<think>...</think>` |
| Anthropic | claude-3-7-sonnet (extended thinking) | `<think>...</think>` |
| Google | gemini-2.5-pro/flash (thinking) | `<think>...</think>` |

**Behavior:**
- Reasoning tokens are stripped before display but may be logged for debugging
- Users see clean final answers without the internal chain-of-thought
- Enable by selecting a thinking-capable model in Admin > Settings > LLM

---

### 17. Autonomous Agent System (Beta)

The Autonomous Agent enables multi-step task execution with planning, execution, quality checking, and summarization. This feature is currently in **beta**.

> **⚠️ Beta Feature:** Enable via Admin > Settings > Agent. Resource-intensive.

#### Architecture

```
User Request (complex task)
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS AGENT PIPELINE                     │
│                                                                 │
│  ┌─────────────────┐                                            │
│  │    PLANNER      │──── Decomposes request into task plan     │
│  │  (LLM Model)    │     Creates ordered task list              │
│  └─────────────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     EXECUTOR LOOP                        │    │
│  │                                                          │    │
│  │    ┌─────────────┐     ┌─────────────┐                   │    │
│  │    │  Execute    │────▶│   Check     │                   │    │
│  │    │  Task N     │     │  Quality    │                   │    │
│  │    └─────────────┘     └─────────────┘                   │    │
│  │           │                   │                          │    │
│  │           │    ◀───Pass───────┤                          │    │
│  │           │                   │                          │    │
│  │           │    ◀───Retry──────┤ (if below threshold)     │    │
│  │           ▼                   │                          │    │
│  │    Next Task ─────────────────┘                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                            │
│  │   SUMMARIZER    │──── Combines task results                 │
│  │                 │     Generates final response               │
│  └─────────────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  Budget Tracking: Token count + cost limit enforcement          │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
Final Response with sources
```

#### Components

| Component | Purpose | LLM Model |
|-----------|---------|-----------|
| **Planner** | Decompose complex requests into ordered tasks | Configurable (default: main model) |
| **Executor** | Execute individual tasks with tool access | Configurable (default: main model) |
| **Checker** | Validate response quality and completeness | Configurable (often faster model) |
| **Summarizer** | Combine task outputs into coherent response | Configurable (default: main model) |

#### Budget Tracking

The agent enforces resource limits per execution:

| Budget Type | Description | Configuration |
|-------------|-------------|---------------|
| **Token Limit** | Maximum tokens across all agent calls | Admin > Settings > Agent |
| **Cost Limit** | Maximum cost in dollars | Admin > Settings > Agent |
| **Task Limit** | Maximum tasks per plan | Default: 10 |
| **Retry Limit** | Max retries per task on quality failure | Default: 2 |

#### Quality Checking

Each task result is validated:

```
Task Result
    │
    ▼
┌─────────────────┐
│ Quality Checker │──── Evaluates: completeness, accuracy, relevance
└─────────────────┘
    │
    ├── Score ≥ Threshold ──────▶ Accept, proceed to next task
    │
    └── Score < Threshold ──────▶ Retry (up to limit) or flag issue
```

**Threshold**: Configurable confidence score (0.0 - 1.0, default: 0.7)

#### Streaming Events

The agent streams progress updates to the UI:

| Event Type | Description |
|------------|-------------|
| `plan_created` | Task plan generated |
| `task_started` | Individual task execution began |
| `task_completed` | Task finished with result |
| `task_failed` | Task failed after retries |
| `quality_check` | Quality score for task |
| `budget_warning` | Approaching limit |
| `budget_exceeded` | Execution stopped |
| `summary_started` | Final summarization began |
| `complete` | Agent finished |

#### User Controls

| Control | Description |
|---------|-------------|
| **Pause** | Temporarily halt execution |
| **Resume** | Continue paused execution |
| **Stop** | Cancel and return partial results |

#### Implementation Files

- **Agent Core:** `src/lib/agent/index.ts`
- **Planner:** `src/lib/agent/planner.ts`
- **Executor:** `src/lib/agent/executor.ts`
- **Checker:** `src/lib/agent/checker.ts`
- **Summarizer:** `src/lib/agent/summarizer.ts`
- **Budget Tracker:** `src/lib/agent/budget.ts`
- **Types:** `src/lib/agent/types.ts`
- **Streaming:** `src/lib/agent/streaming.ts`
- **UI Component:** `src/components/chat/AgentProgress.tsx`
- **Settings UI:** `src/components/admin/settings/AgentSettings.tsx`

---

### 18. Content Generation

Policy Bot includes tools for generating images, diagrams, and translations.

#### 16.1 Image Generation

Generate images using AI providers (DALL-E 3, Gemini Imagen):

```
User Request ("create an image of...")
    │
    ▼
┌─────────────────┐
│ LLM decides to  │
│ call image_gen  │
│ tool            │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    IMAGE GENERATION PIPELINE                     │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ Provider Factory│────▶│ Generate Image  │                   │
│  │ (DALL-E/Gemini) │     │                 │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                 │                               │
│                                 ▼                               │
│                          ┌─────────────────┐                   │
│                          │ Save to Thread  │                   │
│                          │ Artifacts       │                   │
│                          └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
Image displayed in Artifacts Panel
```

**Supported Providers:**

| Provider | Model | Sizes | Notes |
|----------|-------|-------|-------|
| **OpenAI** | DALL-E 3 | 1024x1024, 1024x1792, 1792x1024 | High quality, style options |
| **Google** | Gemini Imagen | Various | Fast generation |

**Implementation:** `src/lib/image-gen/`

#### 16.2 Diagram Generation

Generate diagrams using Mermaid syntax:

```
User Request ("create a flowchart...")
    │
    ▼
┌─────────────────┐
│ LLM decides to  │
│ call diagram_gen│
│ tool            │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DIAGRAM GENERATION PIPELINE                   │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ LLM generates   │────▶│ Validate Mermaid│                   │
│  │ Mermaid code    │     │ syntax          │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                 │                               │
│                                 ▼                               │
│                          ┌─────────────────┐                   │
│                          │ Render to SVG/  │                   │
│                          │ PNG (client)    │                   │
│                          └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
Diagram rendered in chat message
```

**Supported Diagram Types:**

| Type | Mermaid Keyword | Use Case |
|------|-----------------|----------|
| **Flowchart** | `flowchart` | Process flows, decision trees |
| **Sequence** | `sequenceDiagram` | API calls, interactions |
| **Class** | `classDiagram` | Object relationships |
| **State** | `stateDiagram-v2` | State machines |
| **Entity-Relationship** | `erDiagram` | Database schemas |
| **Gantt** | `gantt` | Project timelines |
| **Pie Chart** | `pie` | Data distribution |
| **Mindmap** | `mindmap` | Concept mapping |

**Implementation:** `src/lib/diagram-gen/`

#### 16.3 Translation

Multi-provider translation with automatic language detection:

```
User Request ("translate to French...")
    │
    ▼
┌─────────────────┐
│ LLM decides to  │
│ call translation│
│ tool            │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TRANSLATION PIPELINE                          │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ Provider Select │────▶│ Translate Text  │                   │
│  │ (OpenAI/Gemini/ │     │                 │                   │
│  │  Mistral)       │     │                 │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                 │                               │
│                                 ▼                               │
│                          ┌─────────────────┐                   │
│                          │ Return with     │                   │
│                          │ source language │                   │
│                          └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

**Supported Providers:**

| Provider | Model | Notes |
|----------|-------|-------|
| **OpenAI** | GPT-4.1/5.x | High quality, many languages |
| **Anthropic** | Claude 4.5 | High quality, nuanced translations |
| **Google** | Gemini 2.5 | Fast, good multilingual |
| **Mistral** | Mistral Large 3 | European languages |

**Implementation:** `src/lib/translation/`

#### 16.4 Content Generation & Database Context

Image generation (`image_gen`) and document generation (`doc_gen`) both save output files to disk and record them in the `thread_outputs` table. Before saving, they call `getThreadContext(threadId)` to confirm the thread exists:

```
getThreadContext(threadId)
    │
    ├── Query PostgreSQL threads table
    ├── Query PostgreSQL workspace_threads
    ├── Query PostgreSQL workspace_sessions
    │
    └── Return thread context or null
```

**Implementation:** `src/lib/image-gen/provider-factory.ts`, `src/lib/docgen/document-generator.ts`, `src/lib/db/compat/threads.ts`

---

## Agent Bots (Programmatic API)

Agent Bots expose Policy Bot capabilities as a REST API for external systems, CI/CD pipelines, and third-party integrations.

### Architecture

```
External System
    │
    ▼ POST /api/agent-bots/{slug}/invoke
    │   Headers: Authorization: Bearer {api-key}
    │   Body: { message, files[] }
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT BOT PIPELINE                            │
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐   │
│  │ API Key Auth  │───▶│  Job Queue    │───▶│  Executor     │   │
│  │ + Rate Limit  │    │  (async)      │    │  (RAG + Tools)│   │
│  └───────────────┘    └───────────────┘    └───────────────┘   │
│                                │                │              │
│                                ▼                ▼              │
│                       ┌───────────────┐  ┌───────────────┐    │
│                       │ Job Status    │  │ Output Files  │    │
│                       │ (poll/check)  │  │ (download URL)│    │
│                       └───────────────┘  └───────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **API Keys** | Per-bot keys with scoped permissions |
| **Async Jobs** | Submit and poll — no blocking waits |
| **File Attachments** | Upload files with job submission |
| **Output Downloads** | Download generated files via signed URL |
| **Version History** | Snapshot bot config, rollback on demand |
| **Analytics** | Per-bot usage, tokens, success rates |

### API Flow

```
1. POST /api/agent-bots/{slug}/invoke
   → Returns { jobId, status: 'pending' }

2. GET /api/agent-bots/{slug}/jobs/{jobId}
   → Poll until status = 'completed' | 'failed'

3. GET /api/agent-bots/{slug}/jobs/{jobId}/outputs/{outputId}/download
   → Download generated file
```

### Configuration

Manage agent bots via Admin → Agent Bots:
- Create bot with slug, system prompt, category access, and tool set
- Generate API keys for external callers
- View job history and analytics
- Manage bot versions

### Database Tables

| Table | Purpose |
|-------|---------|
| `agent_bots` | Bot configuration (slug, prompt, categories) |
| `agent_bot_api_keys` | API key management |
| `agent_bot_jobs` | Async job queue and status |
| `agent_bot_versions` | Config version snapshots |

---

## User Roles & Permissions

### Admin Users
- Full system access
- Can access `/admin` dashboard
- Manage all categories, documents, users
- Assign categories to super users
- Manage user subscriptions
- Configure system settings
- All standard user capabilities

### Super Users
- Can access `/superuser` dashboard
- Manage users subscribed to their assigned categories
- Add/remove user subscriptions for assigned categories
- Upload documents (PDF files or text content) to assigned categories only
- Cannot upload global documents
- Cannot manage other super users or admins
- All standard user capabilities

### Regular Users
- Query documents from subscribed categories
- Create/delete their own threads
- Upload PDFs for compliance checking (max 3 per thread, 5MB each)
- Voice input for queries
- View conversation history

---

## Data Flow Diagrams

### Query Flow (Category-Aware)

```
1. User types question or uses voice input
2. Frontend sends POST /api/chat with message + threadId
3. Backend retrieves thread and its category subscriptions
4. Backend retrieves conversation history (last 5 messages)
5. Backend checks if thread has uploaded document
6. RAG pipeline:
   a. Embed query using text-embedding-3-large
   b. Search Qdrant collections for subscribed categories
   c. Include global documents from all category searches
   d. If reranker enabled, re-score chunks with BGE/Cohere (priority fallback)
   e. If user doc exists, extract and include relevant text
   f. Build context with conversation history
   g. Generate response with LLM via LiteLLM (function calling enabled)
   h. If needed, call Tavily for web search
7. Cache response
8. Save message to thread
9. Return response with source citations
```

### Document Upload Flow (Admin)

Admin can upload documents via two methods: file upload or text content paste.

#### File Upload
```
1. Admin accesses /admin page - Documents tab
2. Admin clicks Upload, selects "File Upload" tab
3. Admin selects file (PDF, DOCX, XLSX, PPTX, or images)
4. Category selection modal appears
   - Select one or more categories
   - Or mark as "Global" for all categories
5. Admin submits upload
6. Backend validates file type and size (≤ 50MB)
7. Saves to global-docs folder
8. Creates database document record
9. Triggers ingestion pipeline:
   a. Extract text (tiered: local parsers first, then API providers)
   b. Chunk text with current settings
   c. Create embeddings
   d. Store in appropriate Qdrant collections
10. Update document status to "ready"
```

#### Text Content Upload
```
1. Admin accesses /admin page - Documents tab
2. Admin clicks Upload, selects "Text Content" tab
3. Admin enters:
   - Document name (required, max 255 chars)
   - Text content (required, min 10 chars, max 10MB)
4. Category selection available
   - Select one or more categories
   - Or mark as "Global" for all categories
5. Admin submits
6. Backend validates name and content
7. Saves content as .txt file to global-docs folder
8. Creates database document record
9. Triggers direct text ingestion (bypasses OCR):
   a. Chunk text directly
   b. Create embeddings
   c. Store in appropriate Qdrant collections
10. Update document status to "ready"
```

### User Subscription Management

```
Admin/Super User manages subscriptions:

1. Open user management modal
2. For regular users:
   - Select categories to subscribe
   - User gets access to those category documents
3. For super users (admin only):
   - Assign categories to manage
   - Super user can then manage users in those categories
4. Changes update database relationships
5. User's threads now search new category collections
```

---

## Key Design Decisions

### 1. PostgreSQL for Metadata
- **Benefits**:
  - ACID transactions for data integrity
  - Efficient queries with indexes
  - Connection pooling for high concurrency
  - Relationships between entities (users, categories, subscriptions)
  - Accessed via Kysely ORM for type-safe async queries
- **Tables**: users, categories, documents, user_subscriptions, super_user_categories, document_categories, settings

### 2. Category-Based Vector Store Collections
- Each category gets its own collection in Qdrant
- Collection naming: `policy_{category_slug}`
- Global documents indexed into all category collections
- Enables fine-grained access control

### 3. Three-Tier Role System
- **Admin**: Full system access
- **Super User**: Delegated user management for specific categories
- **User**: Access to subscribed categories only
- Enables organizational hierarchy for large deployments

### 4. Storage Strategy
- **PostgreSQL**: Primary store for all structured metadata — users, categories, documents, settings, threads
- **Qdrant**: Vector embeddings for semantic search
- **Redis**: Fast caching and session management
- **Filesystem**: Generated files (images, PDFs, DOCX) and thread uploads

### 5. Multi-Turn Context (5 Messages)
- Enables follow-up questions like "what about section 3?"
- Balances context window usage with coherent conversation
- Stored locally, not in expensive token-based storage

### 6. Thread-Based Document Isolation
- User documents are scoped to threads
- Prevents cross-contamination between compliance checks
- Simple cleanup: delete thread = delete everything

### 7. Native Browser APIs for Voice
- MediaRecorder API for voice capture
- No additional dependencies
- Works across modern browsers
- Graceful fallback for unsupported browsers

### 8. Dynamic Branding System
- **Sidebar branding**: Admin-configurable bot name and icon stored in database settings
- **Chat header**: Dynamic based on user's category subscriptions:
  - Single subscription: "[Category] Assistant"
  - Multiple subscriptions: "GEA Global Assistant"
  - No subscriptions (admin): Falls back to configured branding
- **Preset icons**: 11 industry-specific icons (government, operations, finance, etc.)
- **Rationale**: Allows deployment customization for different organizations while providing context-aware naming for users

### 9. Secure Thread Sharing
- **Cryptographic Tokens**: 256-bit secure tokens (base64url encoding)
- **Configurable Expiry**: Shares can be time-limited or permanent
- **Authentication Required**: Recipients must sign in to view shared threads
- **Access Logging**: All views and downloads are tracked for auditing
- **Revocation Support**: Shares can be instantly revoked by the owner
- **Rationale**: Enables collaboration while maintaining security and audit trails

### 10. User Memory Persistence
- **Per-Category Context**: Facts stored per category or globally
- **LLM-Based Extraction**: Automatic extraction using configured models
- **User Control**: Users can view and edit their stored facts
- **Rationale**: Improves personalization without requiring users to repeat context

### 11. Conversation Summarization
- **Token Cost Reduction**: Compresses long conversations to reduce API costs
- **Context Preservation**: Maintains key decisions, questions, and sources
- **Archived Message Storage**: Original messages preserved for audit
- **Rationale**: Enables long-running conversations without token limits

### 12. Modular Skills System
- **Trigger-Based Activation**: Always, category, or keyword-based
- **Priority Ordering**: Fine-grained control over skill precedence
- **Token Budgeting**: Track and limit total prompt size
- **Rationale**: Allows customization of bot behavior without code changes

---

## Security Considerations

### Authentication
- Multi-provider OAuth (Azure AD and Google)
- Two access control modes: allowlist (specific users) or domain-based
- Session-based authentication via NextAuth
- Role-based access control stored in PostgreSQL
- Admin users initially seeded from ADMIN_EMAILS environment variable

### Authorization
- Three-tier role system (admin, superuser, user)
- Category-based document access
- Super users can only manage their assigned categories
- Users can only access subscribed category documents

### Data Isolation
- Users can only access their own threads
- Thread paths include userId: `data/threads/{userId}/{threadId}/`
- All API routes validate session and role before processing
- Category subscriptions control document visibility

### Thread Sharing Security
- 256-bit cryptographically secure share tokens
- Configurable expiration (1-90 days or never)
- Authentication required to access shared content
- Access logging for audit trails
- Instant revocation capability

### Input Validation
- File type validation (PDF, DOCX, XLSX, PPTX, images)
- File size limits enforced server-side (50MB admin, 10MB thread uploads)
- Query sanitization before processing
- SQL injection prevention via parameterized queries

### Environment Security
- Secrets in environment variables
- `.env` files gitignored
- Different configs for dev/preprod/prod

---

## Performance Optimizations

### Caching Strategy
| Data | TTL | Storage |
|------|-----|---------|
| Query responses | Configurable (1 hour default) | Redis |
| Tavily results | Configurable (1 day default) | Redis |
| Reranker results | Configurable (1 hour default) | Redis |
| Sessions | 24 hours | Redis |
| Embeddings | Permanent | Qdrant |

### Batch Processing
- Document embeddings created in batch (100 chunks at a time)
- Reduces OpenAI API calls during ingestion

### Database Indexing
- PostgreSQL indexes on frequently queried columns
- Qdrant HNSW index for vector search

### Lazy Loading
- Thread history loaded on demand
- Source citations expandable (not pre-loaded)

---

## Scalability Notes

### Current Design
- Single VM deployment
- PostgreSQL database (Kysely ORM)
- Local filesystem storage
- Suitable for 50+ concurrent users

### Future Scaling Options
1. **Database**: Use managed PostgreSQL (Azure Database, AWS RDS) for HA
2. **Horizontal Scaling**: Move thread storage to shared database
3. **CDN**: Static asset caching via Cloudflare
4. **Queue Processing**: Background job queue for document ingestion
5. **Multi-Region**: Replicate Qdrant for geographic distribution

---

## Error Handling Strategy

### User-Facing Errors
- Clear messages: "Service unavailable", "File too large"
- Retry buttons for transient failures
- Loading states for long operations

### Backend Errors
- Structured logging
- Graceful degradation (e.g., if Redis is down, skip caching)
- Error boundaries in React components

---

## Monitoring & Observability (Future)

Recommended additions for production:
- Request logging with correlation IDs
- LLM API usage tracking (via LiteLLM metrics)
- Qdrant query latency metrics
- Error rate dashboards
- PostgreSQL query performance monitoring
