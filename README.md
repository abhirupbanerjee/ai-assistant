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
- **Task Planning** - Multi-step workflow execution with templates
- **YouTube** - Extract and query video transcripts
- **Document Generation** - Create PDF, DOCX, Markdown files
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
│   │   ├── db/                 # SQLite layer (users, categories, documents, config)
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
│   │   ├── DATABASE.md         # Complete SQLite/ChromaDB/Redis schema
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
OPENAI_API_KEY=sk-...          # GPT-4.1, GPT-5.x models
ANTHROPIC_API_KEY=sk-ant-...   # Claude Sonnet/Haiku/Opus 4.5
DEEPSEEK_API_KEY=sk-...        # DeepSeek Reasoner, Chat
GEMINI_API_KEY=...             # Gemini 2.5 Pro/Flash
MISTRAL_API_KEY=...            # Mistral Large 3, Small 3.2

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

### Core Architecture
| Document | Content |
|----------|---------|
| [SOLUTION.md](docs/tech/SOLUTION.md) | Architecture, RAG pipeline, design decisions |
| [DATABASE.md](docs/tech/DATABASE.md) | SQLite schema, ChromaDB collections, Redis patterns |
| [INFRASTRUCTURE.md](docs/tech/INFRASTRUCTURE.md) | Docker deployment, scaling, backup/restore |
| [Bot-Config-architecture.md](docs/tech/Bot-Config-architecture.md) | Configuration architecture |

### Features
| Document | Content |
|----------|---------|
| [PROMPTS.md](docs/features/PROMPTS.md) | Prompts system: global, category, starter prompts, acronyms |
| [SKILLS.md](docs/features/SKILLS.md) | Skills system: trigger types, tool routing, compliance, priority, examples |
| [Tools.md](docs/features/Tools.md) | Tools: web search, data sources, charts, task planning |
| [PWA.md](docs/features/PWA.md) | Progressive Web App: installation, capabilities, limitations |

### API & User Guides
| Document | Content |
|----------|---------|
| [API_SPECIFICATION.md](docs/API/API_SPECIFICATION.md) | Complete REST API reference |
| [USER_GUIDE.md](docs/user_manuals/USER_GUIDE.md) | End user guide for chat, uploads, voice input |
| [ADMIN_GUIDE.md](docs/user_manuals/ADMIN_GUIDE.md) | Admin dashboard guide for system management |
| [SUPERUSER_GUIDE.md](docs/user_manuals/SUPERUSER_GUIDE.md) | Superuser guide for category management |

## License

MIT
