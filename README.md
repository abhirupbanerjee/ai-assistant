# Policy Bot

An enterprise RAG platform for policy document management and intelligent querying. Built with Next.js, ChromaDB, and multi-provider LLM support.

## Platform Benefits

| Benefit | Description |
|---------|-------------|
| **No Vendor Lock-In** | Switch between OpenAI, Mistral, Gemini, or run locally with Ollama |
| **Data Sovereignty** | All data stored locally (SQLite, ChromaDB, filesystem) with full backup control |
| **Department Isolation** | Category-based access ensures users only see relevant policies |
| **Cost Optimization** | Shared infrastructure reduces per-user AI costs vs individual subscriptions |
| **Extensible Tools** | Connect to internal APIs, databases, and external services |

## Capabilities

### Core Features
- **RAG-Powered Q&A** - Natural language queries with source citations
- **Multi-Provider LLM** - OpenAI, Mistral, Gemini, Ollama via LiteLLM
- **Vision/Multimodal** - Analyze images with vision-capable models (GPT-4.1, Gemini, Mistral)
- **Voice Input** - Whisper transcription for audio questions
- **Streaming Responses** - Real-time chat with typing indicators
- **Artifacts Panel** - Right sidebar showing uploads, generated content, web/YouTube sources

### Document Management
- **Category Organization** - Documents grouped by department (HR, Finance, IT, etc.)
- **Multi-Format Upload** - PDF, DOCX, XLSX, PPTX, images (up to 50MB)
- **Text Content Upload** - Paste text directly, bypasses OCR
- **Thread Uploads** - PDF, TXT, PNG, JPG, WebP files per conversation
- **Web URL Extraction** - Extract web page content via Tavily
- **YouTube Extraction** - Extract video transcripts via Supadata
- **Compliance Checking** - Compare user documents against policies

### Access Control
- **Three-Tier Roles** - Admin > SuperUser > User hierarchy
- **Category Subscriptions** - Users access only subscribed categories
- **Multi-Provider Auth** - Azure AD and Google OAuth

### AI Enhancements
- **Skills System** - Inject behaviors based on category/keyword triggers
- **User Memory** - Recall user-specific facts across conversations
- **Thread Summarization** - Compress long conversations
- **Reranking** - Cohere API or local Transformers.js

### Collaboration
- **Thread Sharing** - Share conversations via secure links with expiration
- **Email Notifications** - Optional SendGrid integration for share alerts
- **Access Control** - Authentication required to view shared content
- **Download Control** - Configurable file download permissions per share

### Workspaces
- **Embed Mode** - Lightweight chat widget for external websites via script tag
- **Standalone Mode** - Full-featured chat with threads accessible via direct URL
- **Custom Branding** - Per-workspace colors, logos, and greetings
- **Category Scoping** - Each workspace accesses specific document categories
- **LLM Overrides** - Custom model/temperature per workspace
- **Access Control** - Category-based or explicit user list access
- **Analytics** - Usage tracking per workspace (sessions, messages, tokens)

### Tools
- **Web Search** - Tavily integration for current information
- **Data Sources** - Query external APIs and CSV files
- **Function APIs** - OpenAI-style function calling
- **Chart Generation** - Visualize data in responses
- **Task Planning** - Multi-step workflow execution
- **YouTube** - Extract and query video transcripts

## Directory Structure

```
policy-bot/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # REST API endpoints
│   │   │   ├── chat/           # RAG chat (streaming + non-streaming)
│   │   │   ├── threads/        # Thread CRUD + file uploads
│   │   │   ├── admin/          # Admin endpoints (documents, users, categories, settings)
│   │   │   ├── superuser/      # SuperUser endpoints
│   │   │   ├── user/           # User endpoints
│   │   │   └── w/[slug]/       # Workspace API endpoints
│   │   ├── admin/              # Admin dashboard UI
│   │   ├── superuser/          # SuperUser dashboard UI
│   │   ├── [slug]/             # Standalone workspace pages
│   │   ├── e/[slug]/           # Hosted embed workspace pages
│   │   └── page.tsx            # Chat interface
│   ├── components/             # React components
│   │   ├── chat/               # Chat UI (messages, input, sources)
│   │   ├── admin/              # Admin dashboard components
│   │   ├── workspace/          # Workspace components (embed + standalone)
│   │   └── ui/                 # Shared UI components
│   ├── lib/                    # Core libraries
│   │   ├── db/                 # SQLite layer (users, categories, documents, config)
│   │   ├── tools/              # Tool implementations (web search, charts, data sources)
│   │   ├── rag.ts              # RAG pipeline
│   │   ├── chroma.ts           # ChromaDB client
│   │   ├── redis.ts            # Redis caching
│   │   ├── ingest.ts           # Document ingestion
│   │   └── skills.ts           # Skills system
│   └── types/                  # TypeScript definitions
├── docs/                       # Comprehensive documentation
│   ├── SOLUTION.md             # Architecture and design decisions
│   ├── DATABASE.md             # Complete SQLite/ChromaDB/Redis schema
│   ├── API_SPECIFICATION.md    # Full REST API reference
│   ├── Tools.md                # Tool system documentation
│   ├── UI_WIREFRAMES.md        # Interface designs
│   ├── INFRASTRUCTURE.md       # Deployment and operations
│   ├── Bot-Config-architecture.md # Prompts, skills, tools, memory architecture
│   └── user_manuals/           # User, Admin, SuperUser guides
├── litellm-proxy/              # LiteLLM configuration
├── docker-compose.yml          # Production stack
├── docker-compose.dev.yml      # Development stack
└── Dockerfile                  # Multi-stage build
```

## Quick Start

### Development
```bash
cp .env.example .env.local
# Configure OPENAI_API_KEY, ADMIN_EMAILS

docker compose -f docker-compose.dev.yml up -d
npm install && npm run dev
```

### Production
```bash
# Configure .env with auth providers and domain
docker compose up -d --build
```

## Infrastructure

| Service | Purpose |
|---------|---------|
| **Next.js** | Application (port 3000) |
| **ChromaDB** | Vector database (port 8000) |
| **Redis** | Cache + sessions (port 6379) |
| **LiteLLM** | Multi-provider LLM gateway (port 4000) |
| **Traefik** | Reverse proxy + TLS (ports 80, 443) |

## External API Keys & Licenses

Policy Bot integrates with several external services. All are optional except LLM providers.

### LLM Providers (At least one required)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | GPT-4, GPT-4o, embeddings | Ollama (local models) |
| **Mistral** | [console.mistral.ai](https://console.mistral.ai/api-keys) | Mistral Large, vision, OCR | Ollama (local models) |
| **Google Gemini** | [ai.google.dev](https://ai.google.dev/) | Gemini Pro, 1M context | Ollama (local models) |
| **Ollama** | [ollama.ai](https://ollama.ai) | Local models (Llama, Mistral) | N/A (is the local option) |

> **Tip:** Use [LiteLLM](https://docs.litellm.ai/) proxy (included) to switch providers without code changes.

### Authentication (Production required)

| Service | Get Key | Purpose | Notes |
|---------|---------|---------|-------|
| **Azure AD** | [Azure Portal](https://portal.azure.com) → App registrations | Enterprise SSO | Requires CLIENT_ID, CLIENT_SECRET, TENANT_ID |
| **Google OAuth** | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | Google sign-in | Requires CLIENT_ID, CLIENT_SECRET |

### Document Processing (Optional)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **Azure Document Intelligence** | [Azure Portal](https://portal.azure.com) → Cognitive Services | Enhanced Office docs (DOCX, XLSX, PPTX) with layout preservation | Basic text extraction (included) |

### RAG Enhancements (Optional)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **Cohere** | [dashboard.cohere.com](https://dashboard.cohere.com/api-keys) | Chunk reranking for better search relevance | Local ONNX reranker (Transformers.js, included) |

> **Local Reranker:** Policy Bot includes a local reranker using `onnxruntime-node` and Transformers.js. Enable via Admin > Settings > Reranker. No API key required.

### Tools (Optional)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **Tavily** | [tavily.com](https://tavily.com) | Web search, URL content extraction | None (web features disabled) |
| **Supadata** | [supadata.ai](https://supadata.ai) | YouTube transcript extraction | `youtube-transcript` npm (may be blocked) |
| **SendGrid** | [sendgrid.com](https://app.sendgrid.com/settings/api_keys) | Email notifications for thread sharing | None (email features disabled) |

### Data Source Encryption (Recommended)

| Setting | Generate With | Purpose |
|---------|---------------|---------|
| `DATA_SOURCE_ENCRYPTION_KEY` | `openssl rand -hex 32` | Encrypt API credentials stored in database |

### Configuration Summary

```bash
# Required (pick at least one LLM)
OPENAI_API_KEY=sk-...          # Or use LiteLLM with other providers

# Production Auth (at least one)
AZURE_AD_CLIENT_ID=...
GOOGLE_CLIENT_ID=...

# Optional Enhancements
COHERE_API_KEY=...             # Or use local reranker
TAVILY_API_KEY=...             # For web search
AZURE_DI_ENDPOINT=...          # For Office docs

# Admin-Configured (via UI)
# - SendGrid API key (Admin > Tools > Email)
# - Supadata API key (Admin > Tools > YouTube)
```

See `.env.example` for complete configuration reference.

---

## Documentation

| Document | Content |
|----------|---------|
| [SOLUTION.md](docs/SOLUTION.md) | Architecture, RAG pipeline, design decisions |
| [DATABASE.md](docs/DATABASE.md) | SQLite schema, ChromaDB collections, Redis patterns |
| [API_SPECIFICATION.md](docs/API_SPECIFICATION.md) | Complete REST API reference |
| [Tools.md](docs/Tools.md) | Tool system: web search, data sources, charts, etc. |
| [INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Docker deployment, scaling, backup/restore |
| [Bot-Config-architecture.md](docs/Bot-Config-architecture.md) | Prompts, skills, tools overview, memory architecture |

## License

MIT
