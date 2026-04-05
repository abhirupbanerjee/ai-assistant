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
| **Interoperability** | Switch AI providers freely (OpenAI, Anthropic, Mistral, Gemini, DeepSeek, Fireworks, or local Ollama) |
| **No Lock-In** | Standard PostgreSQL database, portable vector stores, exportable configurations |
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

- **Next.js 16** - Modern React 19 framework with server-side rendering and App Router
- **PostgreSQL** - Battle-tested relational database via Kysely ORM (SQLite fully removed)
- **Qdrant** - Open-source vector database for semantic search
- **LiteLLM** - Unified gateway to 100+ LLM providers (Claude models use direct Anthropic SDK for reliable tool calling)
- **Redis** - High-performance caching and session management
- **Traefik** - Production-ready reverse proxy with automatic TLS
- **Ollama** - Local LLM inference for air-gapped / sensitive deployments

## Capabilities

### Core Features
- **RAG-Powered Q&A** - Natural language queries with source citations
- **Multi-Provider LLM** - OpenAI, Anthropic Claude (direct SDK), DeepSeek, Mistral, Gemini, Fireworks AI, Ollama via LiteLLM
- **Two-Route Architecture** - Route 1 (LiteLLM) and Route 2 (Direct: Anthropic, Fireworks) independently toggled for resilience, cost control, and compliance
- **Vision/Multimodal** - Analyze images with vision-capable models (GPT-4.1/5.x, Claude 4.5, Gemini 2.5, Mistral)
- **Thinking Models** - Native `<think>` token processing for extended reasoning models (DeepSeek R1, Claude 3.7+, Gemini Thinking)
- **Voice Input** - Configurable STT with 4 providers (OpenAI Whisper, Fireworks, Mistral Voxtral, Gemini), route-based fallback, admin-configurable recording limits
- **Speech Settings** - Unified admin panel for STT/TTS provider management with primary/fallback per route
- **Streaming Responses** - Real-time chat with typing indicators
- **Artifacts Panel** - Right sidebar showing uploads, generated content, web/YouTube sources

### Document Management
- **Category Organization** - Documents grouped by department (HR, Finance, IT, etc.)
- **Multi-Format Upload** - PDF, DOCX, XLSX, PPTX, images (up to 500MB, configurable)
- **Text Content Upload** - Paste text directly, bypasses OCR
- **Thread Uploads** - PDF, TXT, PNG, JPG, WebP files per conversation
- **Web URL Extraction** - Extract web page content via Tavily
- **YouTube Extraction** - Extract video transcripts via Supadata
- **Compliance Checking** - Compare user documents against policies

### Access Control
- **Three-Tier Roles** - Admin > SuperUser > User hierarchy
- **Category Subscriptions** - Users access only subscribed categories
- **Multi-Provider Auth** - Azure AD, Google OAuth, and email/password credentials
- **Flexible Authentication** - Credentials login enabled by default for fresh deployments, can be disabled after OAuth setup

### AI Enhancements
- **Prompts System** - Global and category-specific AI instructions
- **Skills System** - Modular behaviors triggered by category/keyword/always-on
- **Tool Routing** - Pattern-based forced tool invocation for reliable behavior
- **Configurable Limits** - Per-category tool call and maximum token limits
- **User Memory** - Recall user-specific facts across conversations
- **Thread Summarization** - Compress long conversations
- **Reranking** - BGE cross-encoder (large/base), Fireworks AI Qwen3 Reranker, Cohere API, or local bi-encoder via Transformers.js
- **Preflight Clarification (HITL)** - Main LLM pauses before responding to ask a focused question when the query is ambiguous; sees full RAG context + conversation history before deciding, so it only asks when genuinely needed
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
- **Function APIs** - OpenAI-style function calling with custom schemas
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
- **Email** - Send emails via SendGrid
- **Compliance Checker** - Post-response validation with weighted scoring and HITL clarification when response quality falls below threshold
- **Code Quality** - SonarCloud integration for static code analysis
- **PageSpeed** - Google PageSpeed Insights website performance analysis
- **SSL Scan** - SSL/TLS certificate validation and expiry checks
- **DNS Scan** - DNS record inspection and diagnostics
- **Cookie Audit** - Cookie compliance and privacy scanning
- **Redirect Audit** - URL redirect chain analysis
- **Load Testing** - k6 Cloud load test execution and reporting
- **Security Scan** - Automated security vulnerability scanning
- **Dependency Analysis** - Project dependency inspection and vulnerability checks

### Agent Bots (API)
Expose your AI capabilities as a programmatic API for external systems, apps, and CI/CD pipelines:

- **API Key Management** - Per-bot API keys with scope control
- **Async Job Queue** - Submit jobs, poll status, download outputs
- **Version History** - Snapshot and rollback bot configurations
- **Analytics** - Per-bot usage and performance tracking
- **File Uploads** - Attach files to bot job submissions
- **Multiple Output Types** - Text, documents, spreadsheets, presentations, audio

> Configure agent bots via Admin > Agent Bots. Invoke externally via `POST /api/agent-bots/[slug]/invoke`.

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

### Operations
- **Backup & Restore** - Full database backup and restore via Admin and SuperUser dashboards
- **RAG Testing** - Built-in retrieval test suite with result scoring (Admin > RAG Testing)
- **LLM Discovery** - Auto-discover available models from LiteLLM proxy
- **Reranker Status** - Monitor local reranker model download and readiness

## Directory Structure

```
policy-bot/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # REST API endpoints
│   │   │   ├── chat/           # RAG chat (streaming + HITL)
│   │   │   ├── threads/        # Thread CRUD + file uploads + sharing
│   │   │   ├── admin/          # Admin endpoints (documents, users, categories, settings, agent-bots)
│   │   │   ├── superuser/      # SuperUser endpoints (global scope)
│   │   │   ├── user/           # User-scoped endpoints
│   │   │   ├── autonomous/     # Autonomous agent plan control (pause/resume/stop)
│   │   │   ├── agent-bots/     # Public agent bot invocation API
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
│   │   ├── db/                 # Database layer — PostgreSQL via Kysely
│   │   │   ├── compat/         # 31 async modules (all DB access goes here)
│   │   │   ├── schema/         # PostgreSQL schema + LiteLLM DB init SQL
│   │   │   ├── kysely.ts       # Kysely instance factory (Postgres-only)
│   │   │   └── db-types.ts     # TypeScript types for all tables
│   │   ├── tools/              # 23+ tool implementations
│   │   ├── agent/              # Autonomous agent (planner, executor, checker, summarizer)
│   │   ├── agent-bots/         # Agent bot job runner and output management
│   │   ├── image-gen/          # Image generation (DALL-E, Gemini Imagen)
│   │   ├── diagram-gen/        # Diagram generation (Mermaid)
│   │   ├── translation/        # Multi-provider translation
│   │   ├── docgen/             # Document generation (PDF, DOCX, Markdown)
│   │   ├── streaming/          # Streaming response utilities
│   │   ├── chunking/           # Document chunking strategies
│   │   ├── data-sources/       # External API and CSV data sources
│   │   ├── workspace/          # Workspace utilities (embed/standalone)
│   │   ├── rag.ts              # RAG pipeline
│   │   ├── redis.ts            # Redis caching
│   │   ├── ingest.ts           # Document ingestion
│   │   └── skills.ts           # Skills system
│   └── types/                  # TypeScript definitions
├── docs/                       # Comprehensive documentation
│   ├── API/
│   │   └── API_SPECIFICATION.md        # Full REST API reference
│   ├── features/
│   │   ├── Tools.md                    # Tool system documentation
│   │   ├── PROMPTS.md                  # Prompts system guide
│   │   ├── SKILLS.md                   # Skills system guide (includes tool routing)
│   │   ├── PWA.md                      # Progressive Web App guide
│   │   ├── routes.md                   # Two-Route LLM Architecture
│   │   └── AUTONOMOUS_MODE_INTEGRATION.md
│   ├── tech/
│   │   ├── SOLUTION.md                 # Architecture and design decisions
│   │   ├── DATABASE.md                 # PostgreSQL/Qdrant/Redis schema
│   │   ├── DB-techstack.md             # Database technical stack
│   │   ├── INFRASTRUCTURE.md           # Deployment and operations
│   │   ├── scaling.md                  # Scaling guide (1–500+ users)
│   │   ├── auth.md                     # Authentication architecture
│   │   ├── addLLM.md                   # Adding new LLM providers
│   │   ├── liteLLM-implementation-guide.md
│   │   ├── fresh-vm-setup.md           # Fresh VM deployment guide
│   │   ├── Bot-Config-architecture.md  # Configuration architecture
│   │   └── UI_WIREFRAMES.md            # Interface designs
│   └── user_manuals/
│       ├── USER_GUIDE.md
│       ├── ADMIN_GUIDE.md
│       └── SUPERUSER_GUIDE.md
├── litellm-proxy/              # LiteLLM configuration
├── docker-compose.yml          # Production stack
├── docker-compose.local.yml    # Local development stack (Postgres + Qdrant + Redis + LiteLLM)
└── Dockerfile                  # Multi-stage build
```

## Quick Start

### Development
```bash
cp .env.example .env.local
# Configure OPENAI_API_KEY, ADMIN_EMAILS, DATABASE_URL, VECTOR_STORE_PROVIDER

# PostgreSQL + Qdrant + Redis + LiteLLM
docker compose -f docker-compose.local.yml up -d
npm install && npm run dev

```

### Production
```bash
# Configure .env with auth providers and domain

# PostgreSQL + Qdrant
docker compose --profile qdrant up -d --build

# Add Ollama for local LLM inference
docker compose --profile qdrant --profile ollama up -d --build
```

## Scaling Guide

Choose your configuration based on concurrent user count:

| Users | Database | Pool | Vector Store | Redis | Instances | Est. Cost |
|-------|----------|------|--------------|-------|-----------|-----------|
| **1-25** | PostgreSQL | 15 | Qdrant | Optional | 1 | $20-50/mo |
| **26-100** | PostgreSQL | 25 | Qdrant | Yes | 1-2 | $100-200/mo |
| **100-250** | PostgreSQL | 40 | Qdrant | Dedicated | 2-3 | $300-600/mo |
| **250-500** | PostgreSQL HA | 50 | Qdrant Cluster | Cluster | 4-5 | $800-1500/mo |
| **500+** | PgBouncer+PG | 50×N | Qdrant Cluster | Cluster | 8+ | $2000+/mo |

**Key Configuration:**
```bash
# Database pool size
DATABASE_POOL_MAX=20                      # Default, adjust per tier

# Vector store selection
VECTOR_STORE_PROVIDER=qdrant
```

See [scaling.md](docs/tech/scaling.md) for detailed architecture diagrams, configuration examples, and migration guides.

## Infrastructure

| Service | Purpose | Profile |
|---------|---------|---------|
| **Traefik** | Reverse proxy + TLS (ports 80, 443) | Default |
| **Next.js** | Application (port 3000) | Default |
| **Redis** | Cache + sessions (port 6379) | Default |
| **PostgreSQL** | Relational database (port 5432) | `--profile postgres` |
| **Qdrant** | Vector database (ports 6333/6334) | `--profile qdrant` |
| **LiteLLM** | Multi-provider LLM gateway (port 4000) | `--profile litellm` |
| **Ollama** | Local LLM inference | `--profile ollama` |

## External API Keys & Licenses

Policy Bot integrates with several external services. All are optional except LLM providers.

### LLM Providers (At least one required)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | GPT-4.1, GPT-5.x, embeddings | Ollama (local models) |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com/) | Claude Sonnet/Haiku/Opus 4.5, 1M context | N/A |
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com/) | DeepSeek Reasoner, Chat (no vision) | Ollama (local models) |
| **Mistral** | [console.mistral.ai](https://console.mistral.ai/api-keys) | Mistral Large 3, Small 3.2, vision, OCR | Ollama (local models) |
| **Google Gemini** | [ai.google.dev](https://ai.google.dev/) | Gemini 2.5 Pro/Flash, 1M context, Thinking | Ollama (local models) |
| **Ollama** | [ollama.ai](https://ollama.ai) | Local models (Llama, Qwen, Mistral, Phi) | N/A (is the local option) |
| **Fireworks AI** | [fireworks.ai](https://fireworks.ai/account/api-keys) | Open-source models: MiniMax M2.5, Kimi K2.5, GPT-OSS, Qwen3 (dev/test) | Ollama (local models) |

### Provider Selection Guidelines

Choose provider tier based on data sensitivity and task complexity:

| Provider Tier | Use Case | Data Classification |
|---|---|---|
| **Ollama** (Local) | Simple RAG, document lookup, basic Q&A, non-complex queries | ✅ Government-sensitive / classified — data never leaves your network |
| **Cloud LLMs** — OpenAI, Claude, Gemini, Mistral, DeepSeek | Complex reasoning, tool calls, multi-step workflows, coding | Public / non-sensitive data only — requests route through external APIs |
| **Fireworks AI** | Developer testing of open-source models | Development / test environments only — not for production sensitive data |

> **Rule:** Never route government-sensitive or classified data through Cloud LLM or Fireworks AI providers. Use Ollama for all sensitive workloads.
>
> **Tip:** Use [LiteLLM](https://docs.litellm.ai/) proxy (included) to switch providers without code changes.

### Authentication (Production required)

| Service | Get Key | Purpose | Notes |
|---------|---------|---------|-------|
| **Azure AD** | [Azure Portal](https://portal.azure.com) → App registrations | Enterprise SSO | Requires CLIENT_ID, CLIENT_SECRET, TENANT_ID |
| **Google OAuth** | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | Google sign-in | Requires CLIENT_ID, CLIENT_SECRET |

### Document Processing (Optional)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **Azure Document Intelligence** | [Azure Portal](https://portal.azure.com) → Cognitive Services | Enterprise document processing with layout preservation (all formats) | Local parsers (included) |
| **Mistral OCR** | [console.mistral.ai](https://console.mistral.ai/api-keys) | Vision-based PDF/image OCR with layout understanding | pdf-parse (included) |

> **Built-in Local Parsers (no API key required):** Policy Bot includes local document processing that runs automatically before API providers: `mammoth` (DOCX), `exceljs` (XLSX), `officeparser` (PPTX), and `pdf-parse` (PDF). API providers above are only needed for enhanced extraction (layout preservation, handwriting, scanned documents).

### RAG Enhancements (Optional)

| Service | Get Key | Purpose | Local Alternative |
|---------|---------|---------|-------------------|
| **Cohere** | [dashboard.cohere.com](https://dashboard.cohere.com/api-keys) | API-based reranking for search relevance | BGE reranker (included) |

**Reranker Providers (Priority-based fallback):**
| Provider | Model | Type | Size | API Key |
|----------|-------|------|------|---------|
| **BGE Large** | `Xenova/bge-reranker-large` | Cross-encoder | ~670MB | None (local) |
| **Fireworks AI** | `qwen3-reranker-8b` | API (direct HTTP) | N/A | `FIREWORKS_AI_API_KEY` |
| **Cohere** | `rerank-english-v3.0` | API | N/A | `COHERE_API_KEY` |
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
| **SonarCloud** | [sonarcloud.io](https://sonarcloud.io) | Static code quality analysis | None |
| **Google PageSpeed** | [developers.google.com/speed/docs/insights/v5/get-started](https://developers.google.com/speed/docs/insights/v5/get-started) | Website performance analysis | None |
| **k6 Cloud** | [app.k6.io](https://app.k6.io) | Cloud load testing | None |

### Data Source Encryption (Recommended)

| Setting | Generate With | Purpose |
|---------|---------------|---------|
| `DATA_SOURCE_ENCRYPTION_KEY` | `openssl rand -hex 32` | Encrypt API credentials stored in database |

### Configuration Summary

```bash
# Required (pick at least one LLM)
OPENAI_API_KEY=sk-...              # GPT-4.1, GPT-5.x models
ANTHROPIC_API_KEY=sk-ant-...       # Claude Sonnet/Haiku/Opus 4.5
DEEPSEEK_API_KEY=sk-...            # DeepSeek Reasoner, Chat
GEMINI_API_KEY=...                 # Gemini 2.5 Pro/Flash, Thinking
MISTRAL_API_KEY=...                # Mistral Large 3, Small 3.2
FIREWORKS_AI_API_KEY=...           # Fireworks open-source models (dev/test)
OLLAMA_API_BASE=http://localhost:11434  # Local Ollama (or host.docker.internal)

# Production Auth (at least one)
AZURE_AD_CLIENT_ID=...
GOOGLE_CLIENT_ID=...

# Optional Enhancements
COHERE_API_KEY=...                 # Or use local BGE reranker
TAVILY_API_KEY=...                 # For web search
AZURE_DI_ENDPOINT=...              # For Office docs
PAGESPEED_API_KEY=...              # For PageSpeed analysis
SONARCLOUD_TOKEN=...               # For code quality analysis
K6_CLOUD_API_TOKEN=...             # For load testing

# Admin-Configured (via UI)
# - SendGrid API key (Admin > Tools > Email)
# - Supadata API key (Admin > Tools > YouTube)
```

See `.env.example` for complete configuration reference.

## License

**Polyform NonCommercial 1.0.0**

This software is free to use for non-commercial purposes. Commercial use requires a separate license agreement. See [LICENSE](LICENSE) for full terms.
