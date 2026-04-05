# Policy Bot Documentation Index

Complete documentation reference for Policy Bot - an enterprise RAG platform for policy document management and intelligent querying.

---

## Quick Start

| Document | Description | Audience |
|----------|-------------|----------|
| [../README.md](../README.md) | Project overview, quick start, and setup instructions | All |
| [tech/INFRASTRUCTURE.md](tech/INFRASTRUCTURE.md) | Docker deployment, environment setup, operations | DevOps, Admins |

---

## Core Architecture

Technical architecture and system design documentation.

| Document | Description | Key Topics |
|----------|-------------|------------|
| [tech/SOLUTION.md](tech/SOLUTION.md) | Complete system architecture, RAG pipeline, design decisions | System overview, RAG pipeline, category system, authentication, tool routing, PWA architecture |
| [tech/DATABASE.md](tech/DATABASE.md) | PostgreSQL schema, Qdrant collections, Redis patterns, Kysely ORM | Database tables, relationships, vector storage, caching strategy |
| [tech/INFRASTRUCTURE.md](tech/INFRASTRUCTURE.md) | Docker deployment, profile-based provider selection, scalability guide, backup/restore, PWA deployment | Container orchestration, environment configuration, infrastructure selection, operations, health checks |
| [tech/auth.md](tech/auth.md) | Authentication system setup and configuration | Microsoft OAuth, Google OAuth, credentials login, access control, user management, Auth.js migration |
| [tech/Bot-Config-architecture.md](tech/Bot-Config-architecture.md) | Configuration architecture and settings management | Configuration layers, settings hierarchy |
| [tech/UI_WIREFRAMES.md](tech/UI_WIREFRAMES.md) | Interface designs and user flow diagrams | UI components, user workflows |

---

## API Documentation

REST API specifications and integration guides.

| Document | Description | Key Topics |
|----------|-------------|------------|
| [API/API_SPECIFICATION.md](API/API_SPECIFICATION.md) | Complete REST API reference | Authentication, endpoints, request/response formats, error codes |

---

## Feature Documentation

Detailed guides for specific features and capabilities.

### AI Enhancements

| Document | Description | Key Topics |
|----------|-------------|------------|
| [features/PROMPTS.md](features/PROMPTS.md) | Prompts system guide | Global prompts, category prompts, starter prompts, acronyms, variables, optimization |
| [features/SKILLS.md](features/SKILLS.md) | Skills system guide | Trigger types (always-on, category, keyword), match types, tool routing, priority system, compliance, examples |

### Tools & Integrations

| Document | Description | Key Topics |
|----------|-------------|------------|
| [features/Tools.md](features/Tools.md) | Tools system documentation | Web search, document generation, data sources, charts, task planning, YouTube, thread sharing, email |

### Progressive Web App

| Document | Description | Key Topics |
|----------|-------------|------------|
| [features/PWA.md](features/PWA.md) | Progressive Web App guide | Installation (desktop/mobile), capabilities, limitations, browser support, troubleshooting |

### LLM Routing

| Document | Description | Key Topics |
|----------|-------------|------------|
| [features/routes.md](features/routes.md) | Two-Route LLM Architecture | Route 1 (LiteLLM) vs Route 2 (Direct), route classification, admin gating, conflict warnings, fallback chain |

### Advanced Features

| Document | Description | Key Topics |
|----------|-------------|------------|
| [features/AUTONOMOUS_MODE_INTEGRATION.md](features/AUTONOMOUS_MODE_INTEGRATION.md) | Autonomous mode integration | Agent pipeline, budget tracking, streaming events, pause/resume/stop |

### Agent Bots (Programmatic API)

| Document | Description | Key Topics |
|----------|-------------|------------|
| [API/API_SPECIFICATION.md](API/API_SPECIFICATION.md) | Agent Bot API reference | `/api/agent-bots/{slug}/invoke`, async job polling, file uploads, output downloads, API key management |

---

## User Manuals

Guides for different user roles and workflows.

### End Users

| Document | Description | Audience |
|----------|-------------|----------|
| [user_manuals/USER_GUIDE.md](user_manuals/USER_GUIDE.md) | Complete end user guide | Regular users |

**Key Sections:**
- Getting started and authentication
- Chatting and asking questions
- File uploads (PDFs, images, documents)
- Voice input with Whisper
- Thread management
- Sources and citations
- Artifacts panel
- PWA installation (desktop and mobile)
- Personalization and settings

### Administrators

| Document | Description | Audience |
|----------|-------------|----------|
| [user_manuals/ADMIN_GUIDE.md](user_manuals/ADMIN_GUIDE.md) | Complete admin dashboard guide | System administrators |

**Key Sections:**
- Dashboard overview and statistics
- Categories management
- Users and roles
- Documents and uploads
- Prompts configuration (global, category, acronyms)
- Skills management (always-on, category, keyword)
- Tools configuration and API keys
- Tool routing rules
- Task planner templates
- Data sources (APIs, CSV)
- Workspaces (embed and standalone)
- Agent Bots (programmatic API, API key management, job analytics)
- RAG Testing (built-in retrieval test suite)
- Settings (LLM, RAG, reranker, memory, PWA, agent)
- System management, backup/restore, and LLM discovery

### Superusers

| Document | Description | Audience |
|----------|-------------|----------|
| [user_manuals/SUPERUSER_GUIDE.md](user_manuals/SUPERUSER_GUIDE.md) | Category manager guide | Department managers, superusers |

**Key Sections:**
- Dashboard and category management
- User subscription management
- Document uploads (category-specific)
- Prompts customization (category addendums)
- Tools configuration overrides
- Task planner templates (assigned categories)
- Data sources (category-specific)
- Workspaces creation and management

---

## Documentation by Topic

### Authentication & Access Control

- [tech/auth.md](tech/auth.md) - **Complete authentication guide** (OAuth setup, credentials login, admin management)
- [tech/SOLUTION.md § Authentication Flow](tech/SOLUTION.md#12-authentication-flow) - Authentication architecture
- [tech/SOLUTION.md § User Roles & Permissions](tech/SOLUTION.md#user-roles--permissions) - Role hierarchy
- [user_manuals/ADMIN_GUIDE.md § Users](user_manuals/ADMIN_GUIDE.md#4-users) - User management
- [API/API_SPECIFICATION.md § Authentication](API/API_SPECIFICATION.md) - API authentication

### Categories & Document Management

- [tech/SOLUTION.md § Category System](tech/SOLUTION.md#1-category-system) - Category architecture
- [tech/DATABASE.md](tech/DATABASE.md) - Database schema for categories and documents
- [user_manuals/ADMIN_GUIDE.md § Categories](user_manuals/ADMIN_GUIDE.md#3-categories) - Category management
- [user_manuals/ADMIN_GUIDE.md § Documents](user_manuals/ADMIN_GUIDE.md#5-documents) - Document uploads and processing

### RAG (Retrieval-Augmented Generation)

- [tech/SOLUTION.md § RAG Pipeline](tech/SOLUTION.md#2-rag-pipeline) - RAG architecture and flow
- [user_manuals/ADMIN_GUIDE.md § Settings](user_manuals/ADMIN_GUIDE.md#13-settings) - RAG configuration
- [user_manuals/USER_GUIDE.md § Sources and Citations](user_manuals/USER_GUIDE.md) - How sources work

### AI Configuration

- [features/routes.md](features/routes.md) - **Two-Route LLM Architecture** (Route 1: LiteLLM, Route 2: Direct SDKs, admin gating, conflict warnings)
- [features/PROMPTS.md](features/PROMPTS.md) - System and category prompts
- [features/SKILLS.md](features/SKILLS.md) - Contextual AI behaviors
- [user_manuals/ADMIN_GUIDE.md § Prompts](user_manuals/ADMIN_GUIDE.md#6-prompts) - Prompt management UI
- [user_manuals/ADMIN_GUIDE.md § Skills](user_manuals/ADMIN_GUIDE.md#7-skills) - Skills management UI

### Tools & Function Calling

- [features/Tools.md](features/Tools.md) - Complete tools documentation
- [features/SKILLS.md](features/SKILLS.md) - Skill-based tool routing
- [user_manuals/ADMIN_GUIDE.md § Tools](user_manuals/ADMIN_GUIDE.md#8-tools) - Tools configuration UI
- [user_manuals/ADMIN_GUIDE.md § Tool Routing](user_manuals/ADMIN_GUIDE.md#9-tool-routing) - Routing rules UI

### Workspaces (Embed & Standalone)

- [tech/SOLUTION.md § Workspaces](tech/SOLUTION.md) - Workspace architecture
- [user_manuals/ADMIN_GUIDE.md § Workspaces](user_manuals/ADMIN_GUIDE.md#12-workspaces) - Workspace creation and management
- [user_manuals/SUPERUSER_GUIDE.md § Workspaces](user_manuals/SUPERUSER_GUIDE.md#11-workspaces) - Superuser workspace access

### Progressive Web App (PWA)

- [features/PWA.md](features/PWA.md) - Complete PWA guide
- [tech/SOLUTION.md § PWA](tech/SOLUTION.md#14-progressive-web-app-pwa) - PWA architecture
- [tech/INFRASTRUCTURE.md § PWA Deployment](tech/INFRASTRUCTURE.md#progressive-web-app-pwa-deployment) - Deployment guide
- [user_manuals/USER_GUIDE.md § PWA](user_manuals/USER_GUIDE.md#progressive-web-app-pwa) - User installation guide
- [user_manuals/ADMIN_GUIDE.md § PWA Settings](user_manuals/ADMIN_GUIDE.md#progressive-web-app-pwa-settings) - Admin configuration

### Deployment & Operations

- [tech/INFRASTRUCTURE.md](tech/INFRASTRUCTURE.md) - Complete deployment guide
- [tech/INFRASTRUCTURE.md § Operations](tech/INFRASTRUCTURE.md#operations) - Monitoring, backup, updates
- [tech/INFRASTRUCTURE.md § Troubleshooting](tech/INFRASTRUCTURE.md#troubleshooting) - Common issues

### Data Sources & External APIs

- [features/Tools.md § Data Source Tool](features/Tools.md#data-source-tool) - API and CSV integration
- [user_manuals/ADMIN_GUIDE.md § Data Sources](user_manuals/ADMIN_GUIDE.md#11-data-sources) - Data source configuration

### Task Planning & Workflows

- [features/Tools.md § Task Planner Tool](features/Tools.md#task-planner-tool) - Multi-step workflows
- [user_manuals/ADMIN_GUIDE.md § Task Planner Templates](user_manuals/ADMIN_GUIDE.md#10-task-planner-templates) - Template management

### Thread Sharing & Collaboration

- [features/Tools.md § Thread Sharing Tool](features/Tools.md#thread-sharing-tool) - Share conversations
- [features/Tools.md § Email Tool](features/Tools.md#email-tool) - Email notifications
- [user_manuals/ADMIN_GUIDE.md § Tools](user_manuals/ADMIN_GUIDE.md#8-tools) - Thread sharing and email configuration

---

## Feature Matrix

Quick reference for feature availability by user role.

| Feature | User | Superuser | Admin |
|---------|------|-----------|-------|
| **Chat & Query** | ✅ | ✅ | ✅ |
| **Thread Management** | ✅ | ✅ | ✅ |
| **File Upload (threads)** | ✅ | ✅ | ✅ |
| **Voice Input** | ✅ | ✅ | ✅ |
| **PWA Installation** | ✅ | ✅ | ✅ |
| **Document Upload (categories)** | ❌ | ✅ (assigned) | ✅ (all) |
| **User Management** | ❌ | ✅ (assigned) | ✅ (all) |
| **Category Management** | ❌ | ✅ (assigned) | ✅ (all) |
| **Prompts (global)** | ❌ | ❌ (read-only) | ✅ |
| **Prompts (category)** | ❌ | ✅ (assigned) | ✅ (all) |
| **Skills Management** | ❌ | ✅ (priority 100+, assigned) | ✅ (all) |
| **Tool Configuration** | ❌ | ✅ (overrides) | ✅ (global) |
| **Tool Routing** | ❌ | ❌ | ✅ |
| **Data Sources** | ❌ | ✅ (assigned) | ✅ (all) |
| **Workspaces** | ❌ | ✅ (assigned) | ✅ (all) |
| **Agent Bots (API)** | ❌ | ❌ | ✅ |
| **RAG Testing** | ❌ | ❌ | ✅ |
| **System Settings** | ❌ | ❌ | ✅ |
| **Backup/Restore** | ❌ | ✅ (own org) | ✅ (all) |

---

## Technology Stack Reference

| Technology | Documentation |
|------------|---------------|
| **Next.js 16** | [tech/SOLUTION.md § Technology Stack](tech/SOLUTION.md#technology-stack) |
| **PostgreSQL** (database) | [tech/DATABASE.md](tech/DATABASE.md), [tech/DB-techstack.md](tech/DB-techstack.md) |
| **Qdrant** (vector store) | [tech/DATABASE.md](tech/DATABASE.md), [tech/INFRASTRUCTURE.md § Selection Guide](tech/INFRASTRUCTURE.md#infrastructure-selection-guide) |
| **Redis** | [tech/DATABASE.md](tech/DATABASE.md) |
| **Kysely** (DB abstraction) | [tech/DATABASE.md § Abstraction Layer](tech/DATABASE.md#database-abstraction-layer-kysely) |
| **LiteLLM** | [tech/INFRASTRUCTURE.md](tech/INFRASTRUCTURE.md) |
| **Docker** | [tech/INFRASTRUCTURE.md § Docker Compose](tech/INFRASTRUCTURE.md#docker-compose--profile-based-services) |
| **Traefik** | [tech/INFRASTRUCTURE.md](tech/INFRASTRUCTURE.md) |

---

## External Service Integrations

Documentation for third-party API integrations.

| Service | Purpose | Documentation |
|---------|---------|---------------|
| **OpenAI** | GPT-4.1/5.x, embeddings, Whisper | [tech/SOLUTION.md](tech/SOLUTION.md), [user_manuals/ADMIN_GUIDE.md § Settings](user_manuals/ADMIN_GUIDE.md#13-settings) |
| **Anthropic** | Claude Sonnet/Haiku/Opus 4.5+, 1M context — **direct SDK** (bypasses LiteLLM) | [tech/SOLUTION.md](tech/SOLUTION.md) |
| **Mistral** | Mistral Large 3, Small 3.2, OCR | [tech/SOLUTION.md](tech/SOLUTION.md) |
| **Google Gemini** | Gemini 2.5 Pro/Flash, Thinking | [tech/SOLUTION.md](tech/SOLUTION.md) |
| **DeepSeek** | DeepSeek Reasoner (R1), Chat | [tech/SOLUTION.md](tech/SOLUTION.md) |
| **Fireworks AI** | Open-source models (dev/test) | [tech/SOLUTION.md](tech/SOLUTION.md) |
| **Ollama** | Local LLM inference (air-gapped) | [tech/SOLUTION.md](tech/SOLUTION.md) |
| **Azure AD** | Enterprise SSO | [tech/auth.md § Microsoft Azure AD](tech/auth.md#microsoft-azure-ad) |
| **Google OAuth** | Google sign-in | [tech/auth.md § Google OAuth](tech/auth.md#google-oauth) |
| **Tavily** | Web search, URL extraction | [features/Tools.md § Web Search](features/Tools.md#web-search-tool) |
| **Supadata** | YouTube transcript extraction | [features/Tools.md § YouTube](features/Tools.md#youtube-tool) |
| **Cohere** | API-based reranking | [user_manuals/ADMIN_GUIDE.md § Settings](user_manuals/ADMIN_GUIDE.md#13-settings) |
| **SendGrid** | Email notifications for thread sharing | [features/Tools.md § Email Tool](features/Tools.md#email-tool) |
| **Azure Document Intelligence** | API-based document processing (all formats) | [tech/SOLUTION.md](tech/SOLUTION.md) |
| **SonarCloud** | Static code quality analysis | [features/Tools.md](features/Tools.md) |
| **Google PageSpeed** | Website performance analysis | [features/Tools.md](features/Tools.md) |
| **k6 Cloud** | Cloud load testing | [features/Tools.md](features/Tools.md) |

---

## Troubleshooting Guides

| Issue Area | Documentation |
|------------|---------------|
| **Deployment Issues** | [tech/INFRASTRUCTURE.md § Troubleshooting](tech/INFRASTRUCTURE.md#troubleshooting) |
| **Admin Dashboard** | [user_manuals/ADMIN_GUIDE.md § Troubleshooting](user_manuals/ADMIN_GUIDE.md#15-troubleshooting) |
| **Superuser Dashboard** | [user_manuals/SUPERUSER_GUIDE.md § Troubleshooting](user_manuals/SUPERUSER_GUIDE.md#13-troubleshooting) |
| **PWA Installation** | [features/PWA.md § Troubleshooting](features/PWA.md) |
| **Tool Issues** | [user_manuals/ADMIN_GUIDE.md § Troubleshooting](user_manuals/ADMIN_GUIDE.md#15-troubleshooting) |

---

## Version History

This documentation index tracks major documentation updates.

| Version | Date | Changes |
|---------|------|---------|
| **3.3** | April 2026 | **Two-Route LLM Architecture** — Route 1 (LiteLLM) and Route 2 (Direct: Anthropic, Fireworks) independently toggled. Route-aware model filtering, admin UI gating (view-only for disabled routes), model conflict warnings, cross-route fallback chain, model readiness gating on chat submit. |
| **3.2** | March 2026 | **Anthropic Direct SDK** — Claude chat + tool calling bypasses LiteLLM via `@anthropic-ai/sdk` for reliable tool call JSON. LiteLLM cache fix (`clearLiteLLMCache()` after model sync). Stream reset SSE event for clean model fallback. |
| **3.1** | March 2026 | Agent Bots (programmatic API), Fireworks AI + DeepSeek + Anthropic providers, Thinking Models (`<think>` processing), 8+ new tools (SonarCloud, PageSpeed, SSL/DNS/Cookie/Redirect scan, k6 load test, security scan, dependency analysis), Next.js 16, configurable tool call limits |
| **3.0** | March 2026 | PostgreSQL-only (SQLite removed), Kysely ORM, async database access, `src/lib/db/utils.ts` for pure utilities |
| **2.9** | February 2025 | PostgreSQL + Qdrant support, Docker Compose profile-based service selection, Infrastructure dashboard (Admin → Dashboard → Infrastructure), MAX_UPLOAD_SIZE for large backup restores, scalability guide |
| **2.8** | February 2025 | Vision capability handling: runtime strategy detection (vision-and-ocr, ocr-only, none), `/api/config/capabilities` endpoint, FileUpload warnings |
| **2.7** | February 2025 | Added Autonomous Agent (beta) documentation, Content Generation (image/diagram/translation), skill tool association, updated tech docs |
| **2.6** | February 2025 | Superuser skill creation (priority 100+), updated permissions matrix, API spec alignment |
| **2.5** | January 2025 | Added comprehensive feature documentation (PROMPTS.md, SKILLS.md, PWA.md), updated all guides with cross-references, added PWA sections throughout |
| **2.4** | January 2025 | Added vision-capable models, thread sharing, email notifications |
| **2.3** | December 2024 | Added workspaces (embed and standalone modes), analytics |
| **2.2** | November 2024 | Added task planner templates, data sources, function APIs |
| **2.1** | October 2024 | Added skills system, tool routing, user memory |
| **2.0** | September 2024 | Major refactor: category system, vector store, Redis, multi-provider LLM |
| **1.0** | August 2024 | Initial release |

---

## Contributing to Documentation

When updating documentation:

1. **Keep it current**: Update docs alongside code changes
2. **Cross-reference**: Link related documentation sections
3. **Use examples**: Include practical examples and code snippets
4. **Update this index**: Add new documents to the appropriate sections
5. **Version updates**: Note significant changes in Version History above

### Documentation Standards

- **Format**: Use Markdown with GitHub Flavored Markdown extensions
- **Structure**: Include table of contents for documents >500 lines
- **Code Blocks**: Use appropriate syntax highlighting
- **Links**: Use relative paths for internal documentation
- **Diagrams**: Use ASCII art for simple flows, Mermaid for complex diagrams
- **Screenshots**: Include when beneficial, but maintain as separate files

---

## Getting Help

- **General Questions**: See [user_manuals/USER_GUIDE.md](user_manuals/USER_GUIDE.md)
- **Admin Tasks**: See [user_manuals/ADMIN_GUIDE.md](user_manuals/ADMIN_GUIDE.md)
- **Technical Issues**: See [tech/INFRASTRUCTURE.md § Troubleshooting](tech/INFRASTRUCTURE.md#troubleshooting)
- **API Integration**: See [API/API_SPECIFICATION.md](API/API_SPECIFICATION.md)
- **Feature Requests**: Contact your system administrator

---

*Last updated: April 2026 (v3.3)*
