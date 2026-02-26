# Policy Bot

**An open-source, interoperable AI platform for governments, ministries, and enterprises.**

Deploy AI-powered solutions across your organization while maintaining complete control over your data, infrastructure, and AI providers. No vendor lock-in. No data leaves your premises. No ML expertise required.

## Why Policy Bot?

Governments and organizations face a critical challenge: **how to adopt AI responsibly** while meeting regulatory requirements for data protection, avoiding dependency on single vendors, and delivering value without building complex ML infrastructure.

Policy Bot solves this by providing:

| Requirement | How We Deliver |
|-------------|----------------|
| **Data Sovereignty** | All data remains on your infrastructure—databases, vector stores, and files never leave your control |
| **Open Source** | Polyform NonCommercial licensed, fully auditable code with no proprietary dependencies |
| **Interoperability** | Switch AI providers freely (OpenAI, Anthropic, Mistral, Gemini, DeepSeek, or local Ollama) |
| **No Lock-In** | Standard PostgreSQL/SQLite databases, portable vector stores, exportable configurations |
| **Zero ML Complexity** | Admin dashboard handles all AI configuration—no data scientists required |
| **Enterprise Security** | Role-based access, department isolation, audit trails, SSO integration |
| **Cost Control** | Shared infrastructure reduces per-user costs; budget controls on AI spending |

## Use Cases

Deploy across ministries, departments, and public-facing services:

| Domain | Application |
|--------|-------------|
| **Citizen Services** | 24/7 portals answering queries on government policies, procedures, permits, and entitlements |
| **Customer Support** | AI helpdesk with knowledge base integration, ticket routing, and escalation workflows |
| **Public Communications** | Generate tailored messaging for different audiences—citizens, officials, media, international |
| **Tourism & Culture** | Multilingual visitor support with real-time translation and local information guides |
| **Education** | Create accessible learning materials: podcasts, infographics, simplified explainers |
| **Teacher & Training** | Generate lesson plans, assessments, and teaching aids from official curricula |
| **Task Automation** | Autonomous agents handling multi-step workflows, document processing, and approvals |
| **Policy & Compliance** | RAG-powered Q&A on internal policies with source citations and version tracking |
| **Internal Knowledge** | Unified search across organizational documents, procedures, and institutional memory |

## Technical Foundation

Built with enterprise-grade, open-source technologies:

- **Next.js** - Modern React framework with server-side rendering
- **PostgreSQL/SQLite** - Battle-tested relational databases
- **ChromaDB/Qdrant** - Open-source vector databases for semantic search
- **LiteLLM** - Unified gateway to 100+ LLM providers
- **Redis** - High-performance caching and session management
- **Traefik** - Production-ready reverse proxy with automatic TLS

## Capabilities

### Core Features
- **RAG-Powered Q&A** - Natural language queries with source citations
- **Multi-Provider LLM** - OpenAI, Anthropic Claude, DeepSeek, Mistral, Gemini, Ollama via LiteLLM
- **Vision/Multimodal** - Analyze images with vision-capable models (GPT-4.1/5.x, Claude 4.5, Gemini 2.5, Mistral)
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
- **Prompts System** - Global and category-specific AI instructions
- **Skills System** - Modular behaviors triggered by category/keyword/always-on
- **Tool Routing** - Pattern-based forced tool invocation for reliable behavior
- **User Memory** - Recall user-specific facts across conversations
- **Thread Summarization** - Compress long conversations
- **Reranking** - BGE cross-encoder (large/base), Cohere API, or local bi-encoder via Transformers.js
- **Autonomous Agent** - Multi-step task planning with budget controls and quality checks

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
- **Task Planning** - Multi-step workflow execution with templates
- **YouTube** - Extract and query video transcripts
- **Document Generation** - Create PDF, DOCX, Markdown files
- **Presentation Generation** - Create PPTX slides with layouts and styling
- **Spreadsheet Generation** - Create XLSX files with formulas and formatting
- **Podcast Generation** - Generate multi-voice audio content (OpenAI TTS, Gemini)
- **Image Generation** - DALL-E 3 and Gemini Imagen integration
- **Diagram Generation** - Mermaid flowcharts, sequences, mindmaps
- **Translation** - Multi-provider translation (OpenAI, Gemini, Mistral)
- **Compliance Checker** - Response validation with weighted scoring and HITL clarification

### Autonomous Agent (Beta)
- **Task Planning** - Decompose complex requests into multi-step plans
- **Budget Tracking** - Enforce token and cost limits per execution
- **Quality Checking** - Automated validation with confidence thresholds
- **Streaming Progress** - Real-time updates on plan execution status
- **Pause/Resume/Stop** - Control agent execution mid-flight

> **Note:** Autonomous Mode is currently in beta. Enable via Admin > Settings > Agent.

### Progressive Web App (PWA)
- **Installable** - Add to home screen (mobile) or desktop
- **Standalone Mode** - App-like experience without browser UI
- **Auto-Updates** - Service worker manages updates
- **Dynamic Branding** - App name and icon from admin settings
- **Cross-Platform** - Works on Windows, macOS, Linux, iOS, Android
- **Offline Page** - Friendly offline message (online connection required for functionality)

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
│   │   ├── db/                 # Database layer — SQLite + PostgreSQL (users, categories, documents, config)
│   │   ├── tools/              # Tool implementations (web search, charts, data sources)
│   │   ├── agent/              # Autonomous agent (planner, executor, checker, summarizer)
│   │   ├── image-gen/          # Image generation (DALL-E, Gemini Imagen)
│   │   ├── diagram-gen/        # Diagram generation (Mermaid)
│   │   ├── translation/        # Multi-provider translation
│   │   ├── docgen/             # Document generation (PDF, DOCX, Markdown)
│   │   ├── streaming/          # Streaming response utilities
│   │   ├── chunking/           # Document chunking strategies
│   │   ├── data-sources/       # External API and CSV data sources
│   │   ├── workspace/          # Workspace utilities (embed/standalone)
│   │   ├── rag.ts              # RAG pipeline
│   │   ├── chroma.ts           # ChromaDB client
│   │   ├── redis.ts            # Redis caching
│   │   ├── ingest.ts           # Document ingestion
│   │   └── skills.ts           # Skills system
│   └── types/                  # TypeScript definitions
├── docs/                       # Comprehensive documentation
│   ├── API/                    # API specifications
│   │   └── API_SPECIFICATION.md # Full REST API reference
│   ├── features/               # Feature documentation
│   │   ├── Tools.md            # Tool system documentation
│   │   ├── PROMPTS.md          # Prompts system guide
│   │   ├── SKILLS.md           # Skills system guide (includes tool routing)
│   │   ├── PWA.md              # Progressive Web App guide
│   │   └── AUTONOMOUS_MODE_INTEGRATION.md # Autonomous mode
│   ├── tech/                   # Technical architecture
│   │   ├── SOLUTION.md         # Architecture and design decisions
│   │   ├── DATABASE.md         # Complete SQLite/PostgreSQL/ChromaDB/Redis schema
│   │   ├── INFRASTRUCTURE.md   # Deployment and operations
│   │   ├── Bot-Config-architecture.md # Configuration architecture
│   │   └── UI_WIREFRAMES.md    # Interface designs
│   └── user_manuals/           # User, Admin, SuperUser guides
│       ├── USER_GUIDE.md       # End user guide
│       ├── ADMIN_GUIDE.md      # Admin dashboard guide
│       └── SUPERUSER_GUIDE.md  # Superuser guide
├── litellm-proxy/              # LiteLLM configuration
├── docker-compose.yml          # Production stack
├── docker-compose.dev.yml      # Development stack
└── Dockerfile                  # Multi-stage build
```

## Quick Start

### Development
```bash
cp .env.example .env.local
# Configure OPENAI_API_KEY, ADMIN_EMAILS, DATABASE_PROVIDER, VECTOR_STORE_PROVIDER

# SQLite + ChromaDB (default)
docker compose -f docker-compose.dev.yml up -d
npm install && npm run dev

# Or PostgreSQL + Qdrant
docker compose -f docker-compose.dev.yml --profile postgres --profile qdrant up -d
npm install && npm run dev
```

### Production
```bash
# Configure .env with auth providers and domain

# SQLite + ChromaDB (small teams, ≤25 users)
docker compose --profile chromadb up -d --build

# PostgreSQL + Qdrant (recommended for 25+ users)
docker compose --profile postgres --profile qdrant up -d --build
```

## Scaling Guide

Choose your configuration based on concurrent user count:

| Users | Database | Pool | Vector Store | Redis | Instances | Est. Cost |
|-------|----------|------|--------------|-------|-----------|-----------|
| **1-25** | SQLite | N/A | ChromaDB | Optional | 1 | $20-50/mo |
| **26-100** | PostgreSQL | 25 | ChromaDB/Qdrant | Yes | 1-2 | $100-200/mo |
| **100-250** | PostgreSQL | 40 | Qdrant | Dedicated | 2-3 | $300-600/mo |
| **250-500** | PostgreSQL HA | 50 | Qdrant Cluster | Cluster | 4-5 | $800-1500/mo |
| **500+** | PgBouncer+PG | 50×N | Qdrant Cluster | Cluster | 8+ | $2000+/mo |

**Key Configuration:**
```bash
# Database pool size (PostgreSQL only)
DATABASE_POOL_MAX=20                      # Default, adjust per tier

# Provider selection
DATABASE_PROVIDER=postgres                # sqlite | postgres
VECTOR_STORE_PROVIDER=qdrant              # chromadb | qdrant
```

See [scaling.md](docs/tech/scaling.md) for detailed architecture diagrams, configuration examples, and migration guides.

## Infrastructure

| Service | Purpose | Profile |
|---------|---------|---------|
| **Traefik** | Reverse proxy + TLS (ports 80, 443) | Default |
| **Next.js** | Application (port 3000) | Default |
| **Redis** | Cache + sessions (port 6379) | Default |
| **SQLite** | Relational database (file-based) | Default |
| **PostgreSQL** | Relational database (port 5432) | `--profile postgres` |
| **ChromaDB** | Vector database (port 8000) | `--profile chromadb` |
| **Qdrant** | Vector database (port 6333) | `--profile qdrant` |
| **LiteLLM** | Multi-provider LLM gateway (port 4000) | `--profile litellm` |

## External API Keys & Licenses

Policy Bot integrates with several external services. All are optional except LLM providers.

### LLM Providers (At least one required)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | GPT-4.1, GPT-5.x, embeddings | Ollama (local models) |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com/) | Claude Sonnet/Haiku/Opus 4.5, 1M context | N/A |
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com/) | DeepSeek Reasoner, Chat (no vision) | Ollama (local models) |
| **Mistral** | [console.mistral.ai](https://console.mistral.ai/api-keys) | Mistral Large 3, Small 3.2, vision, OCR | Ollama (local models) |
| **Google Gemini** | [ai.google.dev](https://ai.google.dev/) | Gemini 2.5 Pro/Flash, 1M context | Ollama (local models) |
| **Ollama** | [ollama.ai](https://ollama.ai) | Local models (Llama, Qwen, Mistral, Phi) | N/A (is the local option) |

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
| **Mistral OCR** | [console.mistral.ai](https://console.mistral.ai/api-keys) | Vision-based PDF/image OCR with layout understanding | pdf-parse (included) |

> **Local PDF Processing:** Policy Bot includes `pdf-parse` for basic PDF text extraction. No API key required.

### RAG Enhancements (Optional)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **Cohere** | [dashboard.cohere.com](https://dashboard.cohere.com/api-keys) | API-based reranking for search relevance | BGE reranker (included) |

**Reranker Providers (Priority-based fallback):**
| Provider | Model | Type | Size | API Key |
|----------|-------|------|------|---------|
| **BGE Large** | `Xenova/bge-reranker-large` | Cross-encoder | ~670MB | None (local) |
| **Cohere** | `rerank-english-v3.0` | API | N/A | Required |
| **BGE Base** | `Xenova/bge-reranker-base` | Cross-encoder | ~220MB | None (local) |
| **Local** | `Xenova/all-MiniLM-L6-v2` | Bi-encoder | ~90MB | None (local) |

**Chunking Strategies:**
- **Recursive** - Default chunking with configurable size and overlap
- **Semantic** - Context-aware chunking based on content boundaries

> **Local Reranker:** Policy Bot includes BGE cross-encoder rerankers using `onnxruntime-node` and Transformers.js. Models download automatically on first use (~670MB for large, ~220MB for base). Configure priority order via Admin > Settings > Reranker.

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
OPENAI_API_KEY=sk-...          # GPT-4.1, GPT-5.x models
ANTHROPIC_API_KEY=sk-ant-...   # Claude Sonnet/Haiku/Opus 4.5
DEEPSEEK_API_KEY=sk-...        # DeepSeek Reasoner, Chat
GEMINI_API_KEY=...             # Gemini 2.5 Pro/Flash
MISTRAL_API_KEY=...            # Mistral Large 3, Small 3.2

# Production Auth (at least one)
AZURE_AD_CLIENT_ID=...
GOOGLE_CLIENT_ID=...

# Optional Enhancements
COHERE_API_KEY=...             # Or use local BGE reranker
TAVILY_API_KEY=...             # For web search
AZURE_DI_ENDPOINT=...          # For Office docs

# Admin-Configured (via UI)
# - SendGrid API key (Admin > Tools > Email)
# - Supadata API key (Admin > Tools > YouTube)
```

See `.env.example` for complete configuration reference.

## License

**Polyform NonCommercial 1.0.0**

This software is free to use for non-commercial purposes. Commercial use requires a separate license agreement. See [LICENSE](LICENSE) for full terms.
