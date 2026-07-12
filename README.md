# AI Assistant

**An open-source, interoperable AI platform for governments, ministries, and enterprises.**

Deploy AI-powered solutions across your organization while maintaining complete control over your data, infrastructure, and AI providers. No vendor lock-in. Core data stays on your infrastructure, while cloud LLM routes remain available for approved non-sensitive workloads. No ML expertise required.

## Why AI Assistant?

Governments and organizations face a critical challenge: **how to adopt AI responsibly** while meeting regulatory requirements for data protection, avoiding dependency on single vendors, and delivering value without building complex ML infrastructure.

AI Assistant solves this by providing:

| Requirement | How We Deliver |
|-------------|----------------|
| **Data Sovereignty** | Databases, vector stores, and files stay under your control; cloud LLM routes are opt-in for approved non-sensitive workloads |
| **Open Source** | Polyform NonCommercial licensed, fully auditable code with no proprietary dependencies |
| **Interoperability** | Switch AI providers freely (OpenAI, Anthropic, Mistral, Gemini, DeepSeek, Fireworks, Moonshot, Ollama, Ollama Cloud) |
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

- **Next.js 16** — Modern React 19 framework with server-side rendering and App Router
- **TypeScript 5.9** — Strict mode throughout the entire codebase
- **Tailwind CSS** — Utility-first styling with custom `primary` color scale
- **PostgreSQL** — Primary relational database via Kysely ORM (SQLite available for development, PostgreSQL required for production)
- **Qdrant** — Open-source vector database for semantic search
- **Direct LLM SDKs** — All providers use native SDKs/APIs (OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Moonshot, Ollama, Azure AI Foundry, Fireworks, Ollama Cloud) — zero proxy dependencies
- **Redis** — High-performance caching and session management
- **FalkorDB** (optional) — Graph database for graph-augmented RAG (multi-hop entity queries)
- **Traefik** — Production-ready reverse proxy with automatic TLS
- **Ollama** — Local LLM inference for air-gapped / sensitive deployments


## Capabilities

### Core Features
- **RAG-Powered Q&A** — Natural language queries with source citations over organizational documents
- **Multi-Provider LLM** — 10 providers: OpenAI, Anthropic Claude, Gemini, Mistral, DeepSeek, Moonshot, Ollama, Azure AI Foundry, Fireworks AI, Ollama Cloud — all via direct native SDKs
- **Three-Route Architecture** — Route 2 (Direct Providers), Route 3 (Local Ollama), Route 5 (Aggregator Gateways) independently toggled for resilience, cost control, and compliance
- **Graph-Augmented RAG** (optional) — FalkorDB integration for multi-hop entity queries across documents
- **Vision/Multimodal** — Analyze images with vision-capable models (GPT-4.1/5.x, Claude 4.5, Gemini 2.5, Mistral, Anthropic)
- **Thinking Models** — Native `<think>` token processing for extended reasoning models (DeepSeek R1, Claude 3.7+, Gemini Thinking, Kimi K2-family)
- **Slash Commands** — 16 predefined `/` commands for fast terminal tool invocation (`/image`, `/chart`, `/pdf`, `/slide`, etc.) with inline autocomplete
- **Voice Input** — Configurable STT with 4 providers (OpenAI Whisper, Gemini, Mistral Voxtral, Fireworks), route-based fallback
- **Speech Settings** — Unified admin panel for STT/TTS provider management with primary/fallback per route
- **Streaming Responses** — Real-time SSE chat with typing indicators and tool call progress
- **Artifacts Panel** — Right sidebar showing uploads, generated content, web/YouTube sources

### Document Management
- **Category Organization** - Documents grouped by department (HR, Finance, IT, etc.)
- **Multi-Format Upload** - PDF, DOCX, XLSX, PPTX, images (up to 500MB, configurable)
- **Text Content Upload** - Paste text directly, bypasses OCR
- **Thread Uploads** - PDF, TXT, PNG, JPG, WebP files per conversation
- **Web URL Extraction** - Extract web page content via Tavily
- **YouTube Extraction** - Extract video transcripts via Supadata
- **Compliance Checking** - Compare user documents against policies

### Access Control
- **Four-Tier Roles** - Super Admin > Admin > Superuser > User hierarchy (superusers are category-scoped)
- **Super Admin** - Seeded from `ADMIN_EMAILS`; exclusive access to sensitive financial data (cost views and provider balances)
- **Category Subscriptions** - Users access only subscribed categories
- **Multi-Provider Auth** - Azure AD, Google OAuth, and email/password credentials
- **Flexible Authentication** - Credentials login enabled by default for fresh deployments, can be disabled after OAuth setup

### AI Enhancements
- **Auto Model Selection** - Per-message intelligent model selection based on query context, tool routing, image presence, and token budget. Available in main chat, workspaces, autonomous agent (per-role), and agent bots. Falls back to global default if selection fails.
- **Prompts System** - Global and category-specific AI instructions
- **Skills System** - Modular behaviors triggered by category/keyword/always-on
- **Tool Routing** - Pattern-based forced tool invocation for reliable behavior
- **Configurable Limits** - Per-category tool call and maximum token limits
- **User Memory** — Recall user-specific facts across conversations
- **Thread Summarization** — Compress long conversations automatically
- **Reranking** — Priority fallback: BGE Large → Fireworks Qwen3 → Cohere → BGE Base → Local bi-encoder
- **Preflight Clarification (HITL)** — Main LLM pauses to ask a focused question when the query is ambiguous; sees full RAG context first
- **Autonomous Agent (Beta)** — Multi-step task planning with budget controls, quality checks, subagent ReAct loops, HITL tool safety gating, and configurable planner/executor/checker/summarizer prompts
- **Working Memory** (beta) — Cross-wave context persistence in autonomous agent via `plan_memories` table

### Collaboration (Beta)
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
- **Aggregate Data** - Server-side aggregation (group, count, sum, avg) across data sources
- **Function APIs** - OpenAI-style function calling with custom schemas
- **Chart Generation** - Visualize data in responses
- **YouTube** - Extract and query video transcripts
- **Document Generation** - Create PDF, DOCX, Markdown files
- **Presentation Generation** - Create PPTX slides with layouts and styling
- **Spreadsheet Generation** - Create XLSX files with formulas and formatting
- **Podcast Generation** - Generate multi-voice audio content (OpenAI TTS, Gemini)
- **Image Generation** - Gemini Imagen and Nano Banana integration
- **Diagram Generation** - Mermaid diagrams (18 types: flowcharts, sequences, C4, mindmaps, Gantt, etc.)
- **Translation** - Multi-provider translation (OpenAI, Gemini, Mistral)
- **Email** - Send emails via SendGrid
- **Compliance Checker** - Post-response validation with weighted scoring and HITL clarification
- **Website Analysis** - Google PageSpeed Insights, SSL/TLS cert checks, DNS inspection, cookie audits, redirect chain analysis
- **Code Quality** - SonarCloud integration for static code analysis
- **Load Testing** - k6 Cloud load test execution and reporting
- **HTML Generator** - Generate interactive HTML pages (dashboards, documentation, books, playbooks)
- **File to HTML** - Convert DOCX/PDF documents to searchable HTML pages

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
- **Subagent ReAct Loops** - Multi-turn reasoning within a single task (think → act → observe → repeat), with admin-configurable iteration limits and per-task budget allocation
- **Tool Safety Gating** - `subagentSafe` classification on all 21 tools; unsafe tools (generative/costly) trigger human-in-the-loop approval before execution
- **Budget Tracking** - Enforce token and cost limits per execution, with live per-model cost tracking
- **Quality Checking** - Automated validation with confidence thresholds
- **Streaming Progress** - Real-time updates on plan execution status, including subagent step telemetry and thinking content
- **Pause/Resume/Stop** - Control agent execution mid-flight

> **Note:** Autonomous Mode is currently in beta. Enable via Admin > Settings > Agent. Subagent mode can be enabled separately in Admin > Settings > Agent > Subagent Configuration.

### Progressive Web App (PWA)
- **Installable** - Add to home screen (mobile) or desktop
- **Standalone Mode** - App-like experience without browser UI
- **Auto-Updates** - Service worker manages updates
- **Dynamic Branding** - App name and icon from admin settings
- **Cross-Platform** - Works on Windows, macOS, Linux, iOS, Android
- **Offline Page** - Friendly offline message (online connection required for functionality)

### Operations
- **Backup & Restore** — Full database backup and restore via Admin and SuperUser dashboards
- **RAG Testing** — Built-in retrieval test suite with result scoring and trend tracking (Admin > RAG Testing)
- **LLM Discovery** — Auto-discover available models from 8 provider APIs
- **Model Latency Tracking** — P50 latency metrics for data-driven auto model selection
- **Token Usage Analytics** — Per-model, per-user token consumption tracking
- **Reranker Status** — Monitor local reranker model download and readiness

## Directory Structure

```
ai-assistant/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # REST API endpoints
│   │   │   ├── chat/           # RAG chat (streaming + HITL)
│   │   │   ├── threads/        # Thread CRUD + file uploads + sharing
│   │   │   ├── admin/          # Admin endpoints (documents, users, categories, settings, agent-bots)
│   │   │   ├── superuser/      # Superuser endpoints (global scope)
│   │   │   ├── user/           # User-scoped endpoints
│   │   │   ├── autonomous/     # Autonomous agent plan control (pause/resume/stop)
│   │   │   ├── agent-bots/     # Public agent bot invocation API
│   │   │   └── w/[slug]/       # Workspace API endpoints
│   │   ├── admin/              # Admin dashboard UI
│   │   ├── superuser/          # Superuser dashboard UI
│   │   ├── [slug]/             # Standalone workspace pages
│   │   ├── e/[slug]/           # Hosted embed workspace pages
│   │   └── page.tsx            # Landing page (redirects authenticated users → /chat)
│   ├── components/             # React components
│   │   ├── chat/               # Chat UI (messages, input, sources)
│   │   ├── admin/              # Admin dashboard components
│   │   ├── workspace/          # Workspace components (embed + standalone)
│   │   └── ui/                 # Shared UI components
│   ├── hooks/                  # 11 custom React hooks
│   ├── contexts/               # 2 React contexts (mobile menu, toast)
│   ├── embed/                  # 10 files — Standalone embed widget (iframe-friendly)
│   ├── scripts/                # 2 runtime scripts (cleanup, reindex)
│   ├── middleware.ts           # Auth redirects, embed CSP headers
│   ├── lib/                    # Core libraries
│   │   ├── db/                 # Database layer — PostgreSQL via Kysely
│   │   │   ├── compat/         # 33 async modules (all DB access goes here)
│   │   │   ├── schema/         # PostgreSQL schema SQL
│   │   │   ├── kysely.ts       # Kysely instance factory (Postgres-only)
│   │   │   └── db-types.ts     # TypeScript types for all tables
│   │   ├── tools/              # 22 tool implementations
│   │   ├── agent/              # Autonomous agent (planner, executor, checker, summarizer)
│   │   ├── agent-bots/         # Agent bot job runner and output management
│   │   ├── image-gen/          # Image generation (DALL-E, Gemini Imagen)
│   │   ├── diagram-gen/        # Diagram generation (Mermaid)
│   │   ├── translation/        # Multi-provider translation
│   │   ├── docgen/             # Document generation (PDF, DOCX, Markdown)
│   │   ├── streaming/          # Streaming response utilities
│   │   ├── chunking/           # Document chunking strategies
│   │   ├── pptxgen/            # PPTX generation
│   │   ├── xlsxgen/            # XLSX generation
│   │   ├── audio/              # PCM to WAV conversion
│   │   ├── compliance/         # Compliance checking
│   │   ├── vector-store/       # Qdrant client
│   │   ├── skills/             # Skills resolver, seed, types
│   │   ├── data-sources/       # External API and CSV data sources
│   │   ├── workspace/          # Workspace utilities (embed/standalone)
│   │   ├── rag.ts              # RAG pipeline
│   │   ├── redis.ts            # Redis caching
│   │   ├── ingest.ts           # Document ingestion
│   │   ├── llm-client.ts       # Internal LLM client with multi-route fallback
│   │   ├── llm-fallback.ts     # Cross-route fallback chain
│   │   ├── openai.ts           # Main OpenAI-compatible completion + tool calling
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
│   │   ├── LLM.md                      # Authoritative LLM Architecture (routes, providers, SDKs, fallback)
│   │   ├── routes.md                   # Three-Route LLM Architecture
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
├── litellm-proxy/              # LiteLLM configuration (legacy — no longer used by AI Assistant)
├── docker-compose.yml          # Production stack
├── docker-compose.local.yml    # Local development stack (Postgres + Qdrant + Redis)
└── Dockerfile                  # Multi-stage build
```

## Quick Start

### Development
```bash
cp .env.example .env.local
# Configure OPENAI_API_KEY, ADMIN_EMAILS, DATABASE_URL, VECTOR_STORE_PROVIDER

# PostgreSQL + Qdrant + Redis
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
| **Ollama** | Local LLM inference | `--profile ollama` |

## External API Keys & Licenses

AI Assistant integrates with several external services. All are optional except LLM providers.

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
| **Moonshot AI** | [platform.moonshot.cn](https://platform.moonshot.cn/) | Kimi models via direct Route 2 access | Ollama (local models) |
| **Azure AI Foundry** | [azure.microsoft.com](https://azure.microsoft.com/en-us/products/ai-services/ai-foundry) | Serverless catalog models via Route 5 | N/A |
| **Ollama Cloud** | [ollama.com](https://ollama.com/settings/keys) | Hosted Ollama models via Route 5 aggregator | N/A |

### Provider Selection Guidelines

Choose provider tier based on data sensitivity and task complexity:

| Provider Tier | Use Case | Data Classification |
|---|---|---|
| **Ollama** (Local) | Simple RAG, document lookup, basic Q&A, non-complex queries | ✅ Government-sensitive / classified — data never leaves your network |
| **Cloud LLMs** — OpenAI, Claude, Gemini, Mistral, DeepSeek, Moonshot | Complex reasoning, tool calls, multi-step workflows, coding | Public / non-sensitive data only — requests route through external APIs |
| **Fireworks AI** | Developer testing of open-source models | Development / test environments only — not for production sensitive data |
| **Ollama Cloud** | Hosted Ollama models | Public / non-sensitive data only — requests route through Ollama Cloud |

> **Rule:** Never route government-sensitive or classified data through Cloud LLM or Fireworks AI providers. Use Ollama for all sensitive workloads.
>
> **Tip:** All providers use direct native SDKs — switch models via the chat model selector or Admin > Settings > LLM without any proxy configuration changes.

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

> **Built-in Local Parsers (no API key required):** AI Assistant includes local document processing that runs automatically before API providers: `mammoth` (DOCX), `exceljs` (XLSX), `officeparser` (PPTX), and `pdf-parse` (PDF). API providers above are only needed for enhanced extraction (layout preservation, handwriting, scanned documents).

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

> **Local Reranker:** AI Assistant includes BGE cross-encoder rerankers using `onnxruntime-node` and Transformers.js. Models download automatically on first use (~670MB for large, ~220MB for base). Configure priority order via Admin > Settings > Reranker.

### External Tools and Integrations (Optional)

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
MOONSHOT_API_KEY=...               # Moonshot Kimi models (direct Route 2)
MOONSHOT_API_BASE=...              # Optional custom Moonshot endpoint
OLLAMA_API_BASE=http://localhost:11434  # Local Ollama (or host.docker.internal)
AZURE_FOUNDRY_ENDPOINT=...         # Azure AI Foundry endpoint (Route 5)
AZURE_FOUNDRY_API_KEY=...          # Azure AI Foundry API key (Route 5)
OLLAMA_CLOUD_API_KEY=...           # Ollama Cloud hosted models (Route 5)

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
