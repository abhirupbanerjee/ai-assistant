# Admin Guide

This guide explains how to use the Admin Dashboard to manage all aspects of AI Assistant.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Dashboard Overview](#2-dashboard-overview)
3. [Categories](#3-categories)
4. [Users](#4-users)
5. [Documents](#5-documents)
6. [Prompts](#6-prompts)
7. [Skills](#7-skills)
8. [Tools](#8-tools)
9. [Tool Routing](#9-tool-routing)
10. [Task Planner Templates](#10-task-planner-templates)
11. [Data Sources](#11-data-sources)
12. [Workspaces](#12-workspaces)
13. [Agent Bots](#13-agent-bots)
14. [Settings](#14-settings)
15. [System Management](#15-system-management)
16. [Troubleshooting](#16-troubleshooting)
17. [Quick Reference](#17-quick-reference)

---

## 1. Introduction

### What is an Admin?

An **Admin** has full control over all aspects of AI Assistant. Admins can:
- Manage all categories, users, and content
- Configure global settings and tools
- Create and manage skills
- Perform system administration tasks
- Grant Superuser access to other users

### Role Comparison

| Capability | User | Superuser | Admin |
|------------|------|-----------|-------|
| Chat with assistant | ✅ | ✅ | ✅ |
| Upload documents to threads | ✅ | ✅ | ✅ |
| Upload documents to categories | ❌ | ✅ (assigned) | ✅ (all + global) |
| Manage user subscriptions | ❌ | ✅ (assigned) | ✅ (all) |
| Configure data sources | ❌ | ✅ (assigned) | ✅ (all) |
| Configure tools per category | ❌ | ✅ (assigned) | ✅ (global + all) |
| Edit category prompts | ❌ | ✅ (assigned) | ✅ (global + all) |
| Create/manage workspaces | ❌ | ✅ (assigned) | ✅ (all) |
| Create/delete users | ❌ | ❌ | ✅ |
| Manage all categories | ❌ | ❌ | ✅ |
| Create skills (priority 100+) | ❌ | ✅ (assigned) | ✅ (all) |
| Create skills (priority 1-99) | ❌ | ❌ | ✅ |
| System settings & backups | ❌ | ❌ | ✅ |

### Accessing the Admin Dashboard

1. Log in to AI Assistant with an Admin account
2. Click your profile or the menu icon
3. Select **Admin** from the navigation
4. Or navigate directly to `/admin`

---

## 2. Dashboard Overview

The Admin Dashboard provides a comprehensive overview of system health and activity.

### Statistics Cards

| Card | Description |
|------|-------------|
| **Total Users** | Number of registered user accounts |
| **Active Users** | Users who logged in within the last 30 days |
| **Total Documents** | Documents across all categories |
| **Total Categories** | Number of configured categories |
| **Processing Queue** | Documents currently being indexed |
| **Error Count** | Documents with processing errors |

### System Health

The dashboard displays system component status:

| Component | Description |
|-----------|-------------|
| **Database** | PostgreSQL connection status and pool stats |
| **Vector Store** | Qdrant vector store connection status |
| **LLM Routes** | Active LLM routes and provider status (Routes 2/3/5) |
| **OCR Service** | Document processing pipeline |

### Recent Activity

Widgets showing recent system activity:
- **Recent Documents** - Last 20 uploads across all categories
- **Recent Users** - Latest user registrations and logins
- **Processing Activity** - Document processing status

### Navigation Tabs

| Tab | Purpose |
|-----|---------|
| **Dashboard** | Overview, system health, and infrastructure status |
| **Stats** | Detailed usage statistics |
| **Categories** | Manage document categories |
| **Documents** | All documents across categories |
| **Users** | User account management |
| **Prompts** | System prompt, category prompts, acronyms, skills |
| **Tools** | Tool management, dependencies, and routing |
| **Workspaces** | Embed and standalone chatbot instances |
| **Autonomous Mode** | Multi-agent task orchestration (beta) |
| **Agent Bots** | Programmatic API bots (API keys, jobs, analytics, versions) |
| **Settings** | LLM, RAG, reranker, memory, agent, and system configuration |

### Dashboard Submenu

| Section | Purpose |
|---------|---------|
| **Overview** | Summary statistics cards |
| **User Statistics** | User activity and growth trends |
| **Document Statistics** | Upload volume and processing status |
| **Query Statistics** | Chat usage and response times |
| **System Health** | Service connection status |
| **Infrastructure** | Active database/vector store provider, connection status, collection stats, and environment configuration. Use this to verify your deployment is using the correct stack. |

### Prompts Submenu

| Section | Purpose |
|---------|---------|
| **System Prompt** | Global AI instructions for all conversations |
| **Category Prompts** | Category-specific addendums and starter prompts |
| **Acronyms** | Acronym mappings for document processing |
| **Skills** | AI behavior configurations (keyword/category triggered) |

### Tools Submenu

| Section | Purpose |
|---------|---------|
| **Tools Management** | Enable/disable tools, configure tool settings |
| **Slash Commands** | Edit labels, hints, aliases, and enable states for `/` commands |
| **Dependencies** | Manage tool dependencies and execution order |
| **Tool Routing** | Keyword/regex patterns to force specific tools |

### Users Submenu

| Section | Purpose |
|---------|---------|
| **User Management** | Create, edit, delete users and manage roles |
| **Superuser Settings** | Configure superuser category limits |
| **Credentials Authentication** | Enable/disable email/password login, password policy |

### Settings Submenu

| Section | Purpose |
|---------|---------|
| **AI & API Setup** | Organization-scoped provider credentials, capability assignments, health, members, audit, and usage |
| **API Keys** | Legacy read-only redirect to AI & API Setup while the redesigned UI is enabled |
| **LLM** | Legacy read-only redirect for provider/model routing; use AI & API Setup |
| **RAG** | Retrieval settings, chunk size, similarity threshold |
| **RAG Tuning** | Interactive RAG parameter testing |
| **RAG Testing** | Built-in retrieval test suite with result scoring |
| **Reranker** | Legacy read-only redirect for reranking providers; use AI & API Setup |
| **Memory** | User memory extraction, semantic retrieval, and temporal filtering |
| **Summarization** | Thread summarization settings |
| **Limits** | Conversation history, upload limits |
| **Agent** | Autonomous agent budget, quality threshold, timeout settings, model assignments, executor profiles, planner reasoning toggle, **subagent mode** (ReAct loops, tool safety gating, HITL approval), **working memory** (cross-wave context, beta) |
| **Superuser** | Superuser quota and permissions |
| **Backup** | Database backup and restore |
| **Branding** | Bot name, icon, accent color, PWA settings |
| **Tokens** | Per-category max tokens, per-tool call limits |
| **Routes** | Legacy read-only redirect for provider routing; use AI & API Setup |
| **File Uploads** | Max upload size, allowed file types |
| **Document Processing** | Legacy read-only redirect for OCR providers; use AI & API Setup |
| **Speech** | Legacy read-only redirect for STT/TTS providers; use AI & API Setup |
| **Cache** | Cache TTL and management |
| **Display** | UI appearance, dark mode, font size |

---

## 3. Categories

Categories organize documents and control user access.

### Viewing Categories

The Categories tab lists all configured categories:

| Column | Description |
|--------|-------------|
| **Name** | Category display name |
| **Slug** | URL-friendly identifier |
| **Documents** | Document count |
| **Subscribers** | Users with access |
| **Superusers** | Assigned Superuser managers |
| **Status** | Active/Inactive |

### Creating a Category

1. Click **Add Category**
2. Fill in the configuration:
   - **Name** - Display name (e.g., "HR Policies")
   - **Slug** - URL identifier (auto-generated, editable)
   - **Description** - Purpose of this category
   - **Icon** - Optional emoji or icon
3. Configure access:
   - **Public** - Visible to all authenticated users
   - **Private** - Visible only to subscribed users
4. Click **Create**

### Category Settings

#### General Settings

| Setting | Description |
|---------|-------------|
| **Name** | Display name |
| **Slug** | URL identifier (changing breaks links) |
| **Description** | Category purpose |
| **Status** | Active/Inactive |

#### Access Control

| Setting | Description |
|---------|-------------|
| **Visibility** | Public or Private |
| **Default Subscription** | Auto-subscribe new users |
| **Require Approval** | Manual subscription approval |

#### Assigned Superusers

Assign users with Superuser role to manage this category:
1. Click **Manage Superusers**
2. Select users from the list
3. Click **Save**

### Deleting a Category

> **Warning:** Deleting a category removes all associated documents permanently.

1. Select the category
2. Click **Delete**
3. Type the category name to confirm
4. Click **Confirm Delete**

---

## 4. Users

Manage all user accounts and access.

### User List

| Column | Description |
|--------|-------------|
| **Email** | User's email address |
| **Name** | Display name |
| **Role** | User, Superuser, or Admin |
| **Status** | Active, Inactive, or Pending |
| **Subscriptions** | Category count |
| **Last Active** | Most recent login |
| **Created** | Account creation date |

### Creating a User

1. Click **Add User**
2. Fill in account details:
   - **Email** - Required, must be unique
   - **Name** - Display name
   - **Password** - Initial password (user can change)
   - **Role** - User, Superuser, or Admin
3. Configure subscriptions:
   - Select categories for access
4. Click **Create User**

### User Roles

| Role | Capabilities |
|------|-------------|
| **User** | Chat, upload to threads only, access subscribed categories |
| **Superuser** | Manage assigned categories + can be subscribed to other categories for read access |
| **Admin** | Full system access (cannot view cost/financial data) |
| **Super Admin** | Full admin access **plus** exclusive access to financial data: cost views in Settings > Usage and the Pricing tab with provider balances |

> **Note:** Superusers support a hybrid role model where they can both manage their assigned categories (full access) and be subscribed to other categories (read-only access for chat/queries).

> **Super Admin:** This role is seeded from the `ADMIN_EMAILS` environment variable and cannot be assigned through the User Management UI. It is the only role that can see model/provider cost figures and provider account balances. Regular admins see token usage only.

### Editing a User

1. Click the user row or **Edit** button
2. Modify details as needed:
   - Change role
   - Update subscriptions
   - Reset password
   - Activate/deactivate account
3. Click **Save**

### Assigning Superuser Categories

For users with Superuser role:
1. Edit the user
2. In **Assigned Categories**, select categories for management
3. Click **Save**

The Superuser can now manage those categories (upload documents, manage users, configure tools/prompts).

### Adding Subscriptions to Superusers

Superusers can also be subscribed to additional categories for **read-only access** (hybrid role):

1. Edit the superuser
2. In **Subscribed Categories**, select categories for read access
3. Click **Save**

This allows a superuser to:
- **Manage** their assigned categories (full access)
- **Query/chat** with subscribed categories (read-only)

**Example use case:** An HR superuser manages the "HR Policies" category but is subscribed to "Legal" and "Compliance" for reference when answering questions.

**Visual indicators in the user list:**
- **Orange badges** - Assigned/managed categories
- **Blue badges** - Subscribed categories (read-only)

### Deactivating vs Deleting

| Action | Effect |
|--------|--------|
| **Deactivate** | User cannot log in, data preserved |
| **Delete** | Account and associated data removed |

### Credentials Authentication

AI Assistant supports email/password login alongside OAuth providers (Microsoft/Google). This is useful for:
- Fresh VM deployments before OAuth is configured
- Development and testing environments
- Offline or air-gapped deployments
- Backup authentication when OAuth services are unavailable

#### Configuring Credentials System-Wide

1. In the **Users** section, expand **Credentials Authentication**
2. Configure settings:
   - **Enable Credentials Login** - Toggle system-wide email/password login
   - **Minimum Password Length** - Password policy (4-128 characters, default: 8)
3. Click **Save Changes**
4. **Restart the server** for changes to take effect

> **Note:** Disabling credentials removes the email/password form from the login page. Make sure OAuth is configured before disabling.

#### Setting User Passwords

1. Navigate to **Users** → select a user → **Edit**
2. In the user form, use **Set Password** or **Manage Credentials**
3. Enter and confirm the new password
4. Click **Save**

Alternatively, use the API:
```
PUT /api/admin/users/{userId}/credentials
Body: { "password": "new-password" }
```

#### First Admin Setup (Fresh Deployment)

For initial deployment without OAuth:

1. Set in `.env`:
   ```
   ADMIN_EMAILS=admin@example.com
   CREDENTIALS_ADMIN_PASSWORD=secure-initial-password
   ```
2. Start the application
3. Login with email/password at `/auth/signin`
4. (Optional) Configure OAuth, then disable credentials via Admin UI

See [Authentication Documentation](../../tech/auth.md) for complete details.

### Bulk Operations

Select multiple users to:
- Bulk activate/deactivate
- Bulk add to category
- Bulk remove from category
- Export user list

---

## 5. Documents

Manage all documents across all categories.

### Document List

| Column | Description |
|--------|-------------|
| **Filename** | Document name |
| **Category** | Assigned category (or Global) |
| **Size** | File size |
| **Status** | Processing, Ready, or Error |
| **Uploaded By** | User who uploaded |
| **Upload Date** | When uploaded |

### Filtering Documents

Filter by:
- **Category** - Specific category or Global
- **Status** - Processing, Ready, Error
- **Uploader** - Specific user
- **Date Range** - Upload date range

### Uploading Documents

#### To a Category

1. Click **Upload**
2. Select target category (or Global)
3. Choose upload method:
   - **File** - Drag and drop or browse
   - **Text** - Paste content directly
   - **Web** - Enter URLs to ingest
   - **YouTube** - Enter video URL for transcript
4. Click **Upload**

#### Global Documents

Global documents are available to all categories:
1. Select **Global** as the category
2. Upload as normal

### Document Processing

After upload, documents are processed using a tiered extraction strategy:

| Stage | Description |
|-------|-------------|
| **Uploaded** | File received |
| **Processing** | Text extraction (local parsers first, then API providers) and chunking |
| **Embedding** | Vector embeddings generated |
| **Ready** | Searchable in chat |

**Built-in local parsers** (always active, no configuration needed):
- **mammoth** — DOCX text extraction
- **exceljs** — XLSX spreadsheet extraction
- **officeparser** — PPTX slide extraction
- **pdf-parse** — PDF text extraction

If local parsers fail, the system falls back to configured API providers (Mistral OCR, Azure Document Intelligence). OCR provider keys are managed in **Settings → API Keys**.

### Managing Documents

| Action | Description |
|--------|-------------|
| **View** | See document details and chunks |
| **Reprocess** | Re-run processing pipeline |
| **Move** | Change category assignment |
| **Delete** | Remove document permanently |

### Processing Errors

If a document shows Error status:
1. Click the document to see error details
2. Common issues:
   - Unsupported format
   - Corrupted file
   - Document extraction failure (check logs for specific parser used)
   - File too large
3. Options:
   - Fix and re-upload
   - Try text upload instead
   - Contact support for complex issues

---

## 6. Prompts

Configure AI behavior through system prompts.

> **📖 Detailed Documentation:** For comprehensive information about the prompts system including prompt hierarchy, variables, optimization, and best practices, see [docs/features/PROMPTS.md](../../features/PROMPTS.md).

### Global System Prompt

The global prompt applies to all conversations:

1. Navigate to **Prompts** tab
2. Select **Global** from the category dropdown
3. Edit the **System Prompt** text area
4. Click **Save**

**Best practices for global prompts:**
- Define the AI's role and personality
- Set response formatting guidelines
- Establish citation requirements
- Specify safety guardrails

### Category-Specific Prompts

Add category-specific instructions that append to the global prompt:

1. Select a category from the dropdown
2. Edit the **Category Addendum** text area
3. Click **Save**

**Prompt hierarchy:**
```
Global System Prompt
        ↓
Category Addendum (appended)
        ↓
Final prompt to AI
```

### Starter Prompts

Configure suggested questions for new conversations:

1. Select a category
2. Scroll to **Starter Prompts**
3. Enter one prompt per line
4. Click **Save**

Users see these as clickable suggestions when starting a chat.

### AI Prompt Optimization

Use AI to improve your prompts:

1. Write your initial prompt
2. Click **Optimize with AI**
3. Review suggestions
4. Accept, modify, or reject
5. Save the final version

### Prompt Variables

Available variables in prompts:

| Variable | Description |
|----------|-------------|
| `{category}` | Current category name |
| `{user_name}` | Current user's name |
| `{date}` | Today's date |

### Acronyms

Configure acronym expansions that are automatically added to the AI's context during document processing and retrieval.

**Purpose:** Help the AI understand domain-specific acronyms without adding them to every prompt.

1. Navigate to **Prompts** tab
2. Select **Acronyms** from the submenu
3. Add acronyms in the format: `ACRONYM = Full Expansion`
4. One acronym per line
5. Click **Save**

**Example:**
```
SOE = State-Owned Enterprise
KPI = Key Performance Indicator
NDA = Non-Disclosure Agreement
EBITDA = Earnings Before Interest, Taxes, Depreciation, and Amortization
```

**How it works:**
- Acronyms are automatically appended to the system prompt
- The AI uses them to understand abbreviations in documents and queries
- Global acronyms apply to all categories
- Category-specific acronym management available in Superuser dashboard

---

## 7. Skills

Skills are specialized behaviors that enhance AI capabilities.

> **📖 Detailed Documentation:** For comprehensive information about the skills system including trigger types, match types, priority system, and advanced examples, see [docs/features/SKILLS.md](../../features/SKILLS.md).

### What are Skills?

Skills inject additional instructions based on context:
- **Always-on** - Active in every conversation (Admin only)
- **Category-triggered** - Active in specific categories
- **Keyword-triggered** - Active when user mentions specific words

### Skill Priority Tiers

Skills use a priority system to determine execution order:

| Tier | Priority Range | Access | Use Case |
|------|----------------|--------|----------|
| **Core** | 1-9 | Admin only | Critical system behaviors |
| **High** | 10-99 | Admin only | Important integrations |
| **Medium** | 100-499 | Admin + Superuser | Category-specific behaviors |
| **Low** | 500+ | Admin + Superuser | Optional enhancements |

> **Note:** Superusers can only create skills with priority 100 or higher (Medium/Low tiers) and cannot use the "always" trigger type.

### Viewing Skills

The Skills tab displays all configured skills:

| Column | Description |
|--------|-------------|
| **Name** | Skill identifier |
| **Trigger Type** | Always-on, Category, or Keyword |
| **Categories** | Linked categories (if category-triggered) |
| **Keywords** | Trigger words (if keyword-triggered) |
| **Tool** | ⚡ icon indicates a tool is forced |
| **Status** | Active or Inactive |

### Creating a Skill

1. Click **Add Skill**
2. Configure the skill:
   - **Name** - Unique identifier
   - **Description** - What this skill does
   - **Trigger Type** - When to activate
3. For Category triggers:
   - Select one or more categories
4. For Keyword triggers:
   - Enter keywords (comma-separated)
   - Set match type: Exact, Contains, or Regex
5. Write the **Skill Prompt**:
   - Instructions injected when skill activates
6. **Tool Association** (Keyword type only, optional):
   - Select a tool to force when keywords match
   - Set force mode: Required, Preferred, or Suggested
   - Configure tool-specific options (chart type, data sources, etc.)
7. **Compliance Configuration** (optional):
   - Enable compliance checking for this skill
   - Set required sections (markdown headings that must be present)
   - Override pass/warn thresholds
   - Add custom clarification instructions
8. Set **Active** to Yes
9. Click **Save**

### Tool Association

Keyword-triggered skills can optionally force a specific tool to be called:

| Field | Description |
|-------|-------------|
| **Force Tool** | Select tool (web_search, chart_gen, doc_gen, data_source, etc.) |
| **Force Mode** | Required (must call), Preferred (encouraged), Suggested (optional) |
| **Tool Config** | Tool-specific options like chart type, data sources, domains |

This combines prompt injection with deterministic tool invocation - useful for commands like "generate a chart" or "search the web for..."

### Compliance Configuration

Skills can enable compliance validation to check AI responses for required sections, tool success, and data quality.

| Field | Description |
|-------|-------------|
| **Enable Compliance** | Turn on compliance checking for this skill |
| **Required Sections** | Markdown headings that must be present (e.g., "## Summary") |
| **Pass Threshold** | Override global pass threshold (default: 80) |
| **Warn Threshold** | Override global warn threshold (default: 50) |
| **Clarification Instructions** | Custom context for LLM-generated questions |

**Opt-In Model:** Compliance checking is opt-in at the skill level. If no matched skills have compliance enabled, the check is skipped entirely.

### Skill Prompt Guidelines

Skill prompts should:
- Be concise and focused
- Complement (not contradict) the system prompt
- Include specific instructions for the skill's purpose
- Provide examples if the behavior is complex

### Skill Examples

#### Memory Recall Skill (Always-on)
```
When relevant to the user's question, recall and reference
previous conversation context. Cite specific earlier exchanges
when building on prior discussions.
```

#### Compliance Skill (Keyword-triggered)
Keywords: `compliance, regulation, policy violation, audit`
```
When discussing compliance topics:
- Reference specific regulation sections
- Include effective dates
- Note any recent changes
- Recommend consulting the compliance team for specific cases
```

#### SOE Assessment Skill (Category-triggered)
Categories: `SOE`
```
You are an SOE assessment specialist. Use the 6-dimension
framework for assessments. When multi-step analysis is needed,
use the task_planner tool with appropriate templates.
```

### Editing Skills

1. Click the skill name or **Edit**
2. Modify configuration
3. Update the prompt
4. Click **Save**

### Deactivating Skills

Toggle **Active** to No to disable a skill without deleting it.

---

## 8. Tools

Configure AI tools and their settings.

### Tool Overview

AI Assistant includes these built-in tools:

| Tool | Description |
|------|-------------|
| **Web Search** | Search the web via Tavily API |
| **Document Generator** | Create PDF, DOCX, Markdown files |
| **Data Source Query** | Query APIs and CSV data |
| **Chart Generator** | Create data visualizations |
| **YouTube Transcript** | Extract video transcripts |
| **Task Planner** | Multi-step task management |
| **Function APIs** | Call external APIs |
| **Thread Sharing** | Share conversations via secure links |
| **Email (SendGrid)** | Send email notifications |
| **Compliance Checker** | Validate AI responses with scoring and HITL |

### Global Tool Configuration

Configure default settings for all categories:

1. Navigate to **Tools** tab
2. Select a tool
3. Configure global settings:
   - **Enabled** - Tool available by default
   - **API Keys** - Required credentials
   - **Default Options** - Default parameters
4. Click **Save**

### Category Tool Overrides

Override global settings per category:

1. Select a tool
2. Click **Category Overrides**
3. Select a category
4. Configure:
   - **Enabled** - Override global enabled state
   - **Branding** - Category-specific branding (for Doc Gen)
   - **Config** - Category-specific options
5. Click **Save**

### Tool-Specific Configuration

#### Web Search (Tavily)

| Setting | Description |
|---------|-------------|
| **API Key** | Tavily API key (managed in **Settings → API Keys**) |
| **Default Topic** | general, news, or finance |
| **Search Depth** | basic or advanced |
| **Max Results** | Results per query (1-20) |
| **Include Answer** | AI summary: false, basic, advanced |
| **Include Domains** | Restrict to specific domains |
| **Exclude Domains** | Block specific domains |

#### Document Generator

| Setting | Description |
|---------|-------------|
| **Default Format** | PDF, DOCX, or Markdown |
| **Logo URL** | Organization logo |
| **Organization Name** | Header text |
| **Primary Color** | Theme color (hex) |
| **Font Family** | Document font |

#### HTML Generator

| Setting | Default | Description |
|---------|---------|-------------|
| **Enabled** | `true` | Enable interactive HTML page generation |
| **Default Page Type** | `auto` | Default layout: auto, dashboard, documentation, book, report, website, playbook |
| **Enable Branding** | `false` | Add organization branding to HTML pages |
| **Logo URL** | — | URL or data URL of organization logo |
| **Organization Name** | — | Name displayed in page header |
| **Primary Color** | `#003366` | Primary color for headings and accents |
| **Font Family** | `Segoe UI, Arial, sans-serif` | Primary font for page text |
| **Page Expiration** | `30 days` | Days until generated pages expire (0 = never) |
| **Max Page Size** | `50 MB` | Maximum generated HTML page size |

**Page Types:**
- `auto` - Auto-infer layout from content
- `dashboard` - Power BI-style analytical dashboard with KPI summaries and chart grid
- `documentation` - Structured docs with TOC sidebar and search
- `book` - Ebook-style chapters with metadata and language options
- `report` - Formal report layout (executive summary, findings, recommendations)
- `website` - Frontend webpage mockup (header, hero, sections, footer)
- `playbook` - Interactive playbook with sticky header, hero search bar, accordion cards from ## headings, and playbook footer branding

#### File to HTML

| Setting | Default | Description |
|---------|---------|-------------|
| **Enabled** | `true` | Enable DOCX/PDF to HTML conversion |
| **Enable Branding** | `false` | Add organization branding to HTML pages |
| **Logo URL** | — | URL or data URL of organization logo |
| **Organization Name** | — | Name displayed in page header |
| **Primary Color** | `#003366` | Primary color for headings and accents |
| **Font Family** | `Segoe UI, Arial, sans-serif` | Primary font for page text |
| **Document Expiration** | `30 days` | Days until converted pages expire (0 = never) |

**Supported Formats:**
- `.docx` - Preferred — retains all embedded images as base64
- `.pdf` - Text extraction only (images not yet supported)

**Page Types:**
- `documentation` - Standard TOC/sidebar page (default)
- `playbook` - Card-based interactive playbook layout derived from document headings

#### YouTube Transcript

| Setting | Description |
|---------|-------------|
| **Enabled** | Allow transcript extraction |
| **Preferred Language** | Transcript language preference |

#### Task Planner

| Setting | Description |
|---------|-------------|
| **Enabled** | Allow multi-step planning |
| **Max Tasks** | Maximum tasks per plan |

#### Thread Sharing

| Setting | Description |
|---------|-------------|
| **Enabled** | Allow users to share threads |
| **Default Expiry Days** | Default link expiration (7, 30, 90, or never) |
| **Allow Downloads by Default** | Default download permission |
| **Allowed Roles** | Which roles can share (admin, superuser, user) |
| **Max Shares per Thread** | Limit shares per thread |
| **Rate Limit** | Maximum shares per hour |

#### Email (SendGrid)

| Setting | Description |
|---------|-------------|
| **Enabled** | Enable email notifications |
| **SendGrid API Key** | Your SendGrid API key |
| **Sender Email** | Verified sender email address |
| **Sender Name** | Display name for emails |
| **Rate Limit** | Maximum emails per hour |

**Email Setup:**
1. Create a SendGrid account at sendgrid.com
2. Verify your sender email/domain
3. Generate an API key with "Mail Send" permission
4. Enter the API key in the Email tool settings
5. Configure sender email (must match verified sender)
6. Test by sharing a thread with email notification

#### Compliance Checker

The Compliance Checker validates AI responses and triggers Human-in-the-Loop (HITL) clarification when issues are detected.

| Setting | Description |
|---------|-------------|
| **Enabled** | Enable compliance validation globally |
| **Pass Threshold** | Score for passing (default: 80, recommended: 70-80) |
| **Warning Threshold** | Score for warning (default: 50, recommended: 40-60) |
| **Enable HITL** | Show clarification dialog when below warning threshold |
| **Use Weighted Scoring** | Weight checks by importance |
| **Clarification Provider** | LLM provider for generating questions (auto, openai, gemini, mistral) |
| **Clarification Model** | Specific model (leave empty for default) |
| **Use LLM Clarifications** | Generate contextual questions via LLM |
| **Clarification Timeout** | Max wait time in ms (recommended: 3000-5000) |
| **Fallback to Templates** | Use pre-defined templates if LLM fails |
| **Allow Accept & Flag** | Show "Accept but flag for review" option |

**Opt-In Model:**
Compliance checks only run for skills that explicitly enable compliance in their configuration. This prevents unnecessary overhead.

**Weighted Scoring:**
When enabled, check types have different weights:
- Artifact failures (charts/docs): 30%
- Tool execution errors: 25%
- Empty results: 25%
- Missing sections: 20%

### Testing Tools

1. Select a tool
2. Click **Test**
3. Enter test parameters
4. View results
5. Verify configuration works

### Slash Commands

Slash commands provide users with a fast way to request specific terminal tool outputs by typing `/` followed by a command key. Admins can customize the behavior and appearance of each command.

**Access:** Admin → Tools → Slash Commands

#### Command List

The system includes 16 predefined slash commands covering all terminal tools:

| Command | Tool | Output | Aliases |
|---------|------|--------|---------|
| `image` | `image_gen` | AI-generated image | `img` |
| `chart` | `chart_gen` | Data visualization | — |
| `diagram` | `diagram_gen` | Mermaid diagram | `diag` |
| `flowchart` | `diagram_gen` | Flowchart diagram | — |
| `sequence` | `diagram_gen` | Sequence diagram | — |
| `c4` | `diagram_gen` | C4 architecture diagram | — |
| `gantt` | `diagram_gen` | Gantt chart | — |
| `bar-chart` | `chart_gen` | Bar chart | — |
| `line-chart` | `chart_gen` | Line chart | — |
| `infographic` | `image_gen` | Infographic image | — |
| `photo` | `image_gen` | Photorealistic image | — |
| `pdf` | `doc_gen` | PDF document | — |
| `docx` | `doc_gen` | Word document | `doc`, `word` |
| `html` | `html_gen` | Interactive HTML page | — |
| `slide` | `pptx_gen` | PowerPoint presentation | `pptx` |
| `sheet` | `xlsx_gen` | Excel spreadsheet | `xlsx` |

#### Editing Commands

Click any command card to open the edit modal:

| Field | Editable | Description |
|-------|----------|-------------|
| **Label** | ✅ | Display name shown in the UI |
| **Description** | ✅ | Short help text for users |
| **Aliases** | ✅ | Alternative command keys (comma-separated) |
| **Hint** | ✅ | The instruction injected into the AI's system prompt |
| **Icon** | ✅ | Lucide icon name for visual identification |
| **Enabled** | ✅ | Whether users can invoke this command |
| **Sort Order** | ✅ | Position in the autocomplete menu |
| **Command Key** | ❌ | Fixed identifier (e.g., `pdf`, `image`) |
| **Tool Name** | ❌ | Fixed mapping to the underlying tool |

#### Important Rules

- **Tool dependency:** A slash command only works if its underlying tool is enabled in **Tools Management**. If a tool is disabled, its commands appear grayed out with a warning.
- **No new commands:** You can only edit the 16 predefined commands. You cannot create new commands or remap tools.
- **Reset to defaults:** The **Reset to Defaults** button restores all original labels, descriptions, hints, aliases, icons, and enable states.

#### Hint Customization

The **Hint** field is the most powerful customization. It is appended to the system prompt as:

```
[SUGGESTED APPROACH: {hint}]
```

Tips for writing effective hints:
- Be specific about what the tool should do
- For `doc_gen` commands, include `Use format='...'` (the backend handles this automatically for format-aware commands)
- For diagram commands, specify `diagram_type='...'`
- For chart commands, specify `recommended_chart='...'`
- For image commands, specify `style='...'`

---

## 9. Tool Routing

Tool Routing allows you to force specific tools to be called when user messages match certain patterns. This ensures reliable tool invocation instead of leaving the decision entirely to the LLM.

> **📖 Detailed Documentation:** For comprehensive information about skill-based tool routing including pattern syntax, force modes, and examples, see [docs/features/SKILLS.md](../../features/SKILLS.md).

### Why Use Tool Routing?

Without routing rules, the LLM may:
- Write prose about creating a chart instead of actually calling the chart tool
- Ask for confirmation before generating visualizations
- Describe assessment steps instead of using the Task Planner

Tool routing forces `tool_choice` in the OpenAI API, ensuring deterministic behavior.

### Accessing Tool Routing

1. Navigate to the **Tools** tab
2. Click the **Tool Routing** sub-tab
3. View, create, or edit routing rules

### Understanding Routing Rules

Each routing rule consists of:

| Field | Description |
|-------|-------------|
| **Tool Name** | The tool to invoke when patterns match |
| **Rule Name** | Descriptive name for the rule |
| **Rule Type** | `keyword` (word boundary matching) or `regex` |
| **Patterns** | List of patterns to match |
| **Force Mode** | How strongly to force the tool |
| **Priority** | Order of evaluation (lower = higher priority) |
| **Categories** | Limit rule to specific categories (optional) |
| **Active** | Enable/disable the rule |

### Force Modes

| Mode | Behavior |
|------|----------|
| **Required** | Forces this specific tool to be called |
| **Preferred** | Forces the LLM to use some tool (can choose which) |
| **Suggested** | Hint only, LLM still decides |

### Creating a Routing Rule

1. Click **Add Rule**
2. Configure the rule:
   - Select the target **Tool**
   - Enter a **Rule Name**
   - Choose **Rule Type** (keyword or regex)
   - Add **Patterns** (one per line)
   - Select **Force Mode**
   - Set **Priority** (default: 100)
   - Optionally limit to specific **Categories**
3. Click **Save**

### Example Rules

#### Chart Generation Keywords
```
Tool: chart_gen
Type: keyword
Patterns: chart, graph, plot, visualize, visualization
Force Mode: required
```

When a user says "create a chart showing sales", the `chart_gen` tool is forced.

#### Task Planner Regex
```
Tool: task_planner
Type: regex
Patterns: \binitiate\b.*assessment, \bevaluate\s+all\b
Force Mode: required
```

When a user says "initiate SOE assessment", the `task_planner` tool is forced.

### Testing Routing Rules

1. Click **Test Routing**
2. Enter a test message
3. Optionally select categories
4. Click **Test**
5. View which rules match and the resulting `tool_choice`

### Multi-Match Resolution

When multiple rules match the same message:

1. Rules are sorted by **priority** (lower number first)
2. If multiple `required` rules match different tools → LLM must use one of them
3. If single `required` rule matches → That specific tool is forced
4. `preferred` rules are processed after `required`
5. `suggested` rules only apply if no higher modes match

### Default Rules

On first access, these default rules are created:

| Tool | Patterns |
|------|----------|
| **chart_gen** | chart, graph, plot, visualize, bar chart, pie chart, line graph |
| **task_planner** | initiate, assessment, evaluate all, step by step, create a plan |
| **doc_gen** | generate report, create pdf, export to pdf, formal document |
| **web_search** | search the web, look up online, latest news, current information |

### Editing and Deleting Rules

- **Edit**: Click a rule to modify its configuration
- **Delete**: Click the delete icon to remove a rule
- **Toggle Active**: Enable/disable rules without deleting them

### Best Practices

1. **Use specific patterns** - Avoid overly broad patterns that match unintended messages
2. **Set appropriate priority** - More specific rules should have lower priority numbers
3. **Test before saving** - Use the test panel to verify patterns match as expected
4. **Use categories when appropriate** - Limit domain-specific rules to relevant categories
5. **Monitor tool logs** - Check server logs to verify routing is working as expected

---

## 10. Task Planner Templates

Templates define structured workflows for the AI.

### Template Management

Access template management:
1. Navigate to **Tools** tab
2. Select **Task Planner**
3. Click **Manage Templates**

### Viewing Templates

| Column | Description |
|--------|-------------|
| **Key** | Unique identifier |
| **Name** | Display name with placeholders |
| **Category** | Assigned category |
| **Tasks** | Number of steps |
| **Status** | Active or Inactive |

### Creating Templates

1. Click **Add Template**
2. Select the target category
3. Configure:
   - **Key** - Unique identifier (e.g., `quarterly_review`)
   - **Name** - Display name (e.g., `{department} Q{quarter} Review`)
   - **Description** - When to use this template
   - **Placeholders** - Variables (comma-separated)
4. Add tasks:
   - Click **Add Task**
   - Enter description with `{placeholders}`
   - Reorder with drag handles
5. Set **Active** to Yes
6. Click **Save**

### Template Structure

```json
{
  "key": "soe_identify",
  "name": "{country} SOE Identification",
  "description": "Identify SOEs in a country",
  "placeholders": ["country"],
  "tasks": [
    { "id": 1, "description": "Search for {country} SOE list" },
    { "id": 2, "description": "Gather fiscal data" },
    { "id": 3, "description": "Apply Pareto filter" }
  ]
}
```

### Template Permissions

| Role | Can Create | Can Edit | Can Delete |
|------|------------|----------|------------|
| Admin | ✅ All categories | ✅ All | ✅ All |
| Superuser | ✅ Assigned only | ✅ Assigned only | ❌ |

### Deactivating Templates

1. Edit the template
2. Set **Active** to No
3. Save

Inactive templates are hidden from the AI but preserved in the database.

---

## 11. Data Sources

Configure external data connections for AI queries.

### Data Source Types

| Type | Description |
|------|-------------|
| **API** | REST API endpoints |
| **CSV** | Uploaded CSV files |

### Creating an API Data Source

1. Click **Add Data Source** → **API**
2. Configure connection:
   - **Name** - Display name
   - **Description** - What data this provides
   - **Endpoint URL** - Full API URL
   - **Method** - GET or POST
3. Configure authentication:
   - **None** - No auth required
   - **API Key** - Key in header or query
   - **Bearer Token** - JWT or OAuth token
   - **Basic Auth** - Username/password
4. Define parameters:
   - Parameters the AI can use
   - Mark required vs optional
5. Map response:
   - Define expected response structure
   - Map fields to descriptions
6. Assign categories:
   - Select which categories can use this source
7. Click **Save**

### Creating a CSV Data Source

1. Click **Add Data Source** → **CSV**
2. Upload your CSV file
3. Review detected columns:
   - Confirm data types
   - Add descriptions
4. Assign categories
5. Click **Save**

### Testing Data Sources

1. Select the data source
2. Click **Test Connection**
3. Review:
   - Connection status
   - Sample data
   - Response time
4. Fix any errors before saving

### Authentication Types

| Type | Configuration |
|------|---------------|
| **None** | No additional config |
| **API Key** | Key value, header name, location |
| **Bearer** | Token value |
| **Basic** | Username and password |

### OpenAPI Import

Import from OpenAPI/Swagger specifications:
1. Click **Import OpenAPI**
2. Paste the spec (JSON or YAML)
3. Review parsed configuration
4. Adjust as needed
5. Save

---

## 12. Workspaces

Workspaces allow you to create embeddable and standalone chatbot instances that can be deployed on external websites or accessed via direct URLs.

### What is a Workspace?

A **Workspace** is a configurable chatbot instance that:
- Can access **one or more categories** (document collections)
- Has its own branding (colors, logo, greeting)
- Has its own URL path (random 16-character string)
- Can be either **Embed** or **Standalone** type

### Workspace Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Embed** | Lightweight widget for external websites | Customer support widget, FAQ bot |
| **Standalone** | Full-featured chat with threads and history | Internal team portal, department-specific assistant |

### Feature Comparison

| Feature | Main AI Assistant | Standalone Workspace | Embed Workspace |
|---------|-----------------|---------------------|-----------------|
| Memory (facts) | ✅ | ❌ | ❌ |
| Settings menu | ✅ | ❌ | ❌ |
| Thread sidebar | ✅ | ✅ | ❌ |
| Artifacts panel | ✅ | ✅ | ❌ |
| Clear chat button | ❌ | ❌ | ✅ |
| Message persistence | ✅ | ✅ | Analytics only |
| Authentication | Required | Optional | None |
| Voice input | ✅ | ✅ (if enabled) | ✅ (if enabled) |
| File upload | ✅ | ✅ (if enabled) | ✅ (if enabled) |

### Enabling Workspaces

The Workspaces feature can be enabled/disabled globally:

1. Navigate to **Settings** → **General**
2. Find **Enable Workspaces**
3. Toggle the switch

When disabled, all workspace URLs return 404.

### Creating a Workspace

1. Navigate to **Workspaces** tab
2. Click **New Workspace**
3. Select type: **Embed** or **Standalone**
4. Configure the workspace:

#### Basic Settings

| Setting | Description |
|---------|-------------|
| **Name** | Internal display name for admin reference |
| **Categories** | Select one or more categories the workspace can access |
| **Greeting Message** | Welcome message shown to users |
| **Suggested Prompts** | Starter questions (one per line) |

#### Branding

| Setting | Description |
|---------|-------------|
| **Primary Color** | Hex color for UI elements |
| **Logo URL** | Optional logo image URL |
| **Chat Title** | Custom title (default: workspace name) |
| **Footer Text** | Optional footer message |

#### LLM Overrides (Optional)

Override global LLM settings for this workspace:

| Setting | Description |
|---------|-------------|
| **Provider** | OpenAI, Gemini, Mistral, etc. (default: global) |
| **Model** | Specific model to use, or **⚡ Auto** for intelligent per-message selection |
| **Temperature** | Response creativity (0-1) |
| **System Prompt** | Additional instructions prepended to global prompt |

> **Auto Model Selection:** When **⚡ Auto** is selected, the system evaluates each incoming message (query context, tool routing, token budget) and picks the best available enabled model automatically. This is scoped to the workspace's linked categories. If selection fails, the global default model is used.

#### Feature Toggles

| Setting | Description |
|---------|-------------|
| **Voice Input** | Enable microphone input |
| **File Upload** | Allow file attachments |
| **Max File Size** | Maximum upload size in MB (default 25 MB) |

#### Embed-Specific Settings

For **Embed** workspaces only:

| Setting | Description |
|---------|-------------|
| **Allowed Domains** | Whitelist of domains where embed can run |
| **Daily Limit** | Maximum messages per day (all users) |
| **Session Limit** | Maximum messages per session |

5. Click **Create**
6. Copy the generated URL or embed script

### Workspace URLs

Workspaces use random 16-character slugs for security:

| Type | URL Pattern | Example |
|------|-------------|---------|
| Standalone | `/{slug}` | `ai.abhirup.app/2yibbnmbmctyu` |
| Embed (hosted) | `/e/{slug}` | `ai.abhirup.app/e/2yibbnmbmctyu` |
| Embed (script) | External site with script tag | See embed script section |

### Embed Script

For **Embed** workspaces, copy the generated script:

```html
<!-- AI Assistant Workspace -->
<script
  src="https://ai.abhirup.app/embed/workspace.js"
  data-workspace-id="2yibbnmbmctyu"
></script>
```

Paste this script into the target website's HTML to display the chat widget.

### Access Control (Standalone)

Standalone workspaces support two access modes:

#### Category-Based Access (Default)

Users must have access to **ALL** categories linked to the workspace:

```
Workspace linked to: [HR, Legal, Finance]
User has: [HR, Legal, Finance, IT] → ✅ Can access
User has: [HR, Legal]              → ❌ Cannot access (missing Finance)
```

#### Explicit User List

Only users explicitly added to the workspace can access:

1. Select workspace
2. Click **Manage Users**
3. Add users from the search
4. Click **Save**

To switch access mode:
1. Edit workspace
2. Change **Access Mode** to "Explicit User List"
3. Add authorized users

### Managing Workspace Users

For standalone workspaces with explicit access mode:

| Action | Steps |
|--------|-------|
| **Add User** | Click "Add User" → Search → Select → Add |
| **Remove User** | Find user in list → Click "Remove" |
| **Bulk Import** | Upload CSV with email addresses |

### Workspace Analytics

View usage statistics for each workspace:

| Metric | Description |
|--------|-------------|
| **Sessions** | Total unique sessions |
| **Messages** | Total messages sent |
| **Unique Visitors** | Distinct visitor count |
| **Avg Response Time** | Average AI response latency |
| **Token Usage** | Total tokens consumed |

Access analytics:
1. Select workspace
2. Click **Analytics**
3. Select date range

### Editing Workspaces

1. Navigate to **Workspaces** tab
2. Click on the workspace name or **Edit** button
3. Modify settings
4. Click **Save**

### Disabling/Enabling Workspaces

Toggle individual workspaces on/off:
1. Find the workspace in the list
2. Click the **Enabled** toggle

Disabled workspaces return 404 at their URLs.

### Deleting Workspaces

1. Select the workspace
2. Click **Delete**
3. Confirm the action

**Warning:** Deleting a workspace removes all session data and analytics.

### Superuser Workspace Management

Superusers can create and manage workspaces within their assigned categories:

| Action | Admin | Superuser |
|--------|-------|-----------|
| Create workspace (any category) | ✅ | ❌ |
| Create workspace (assigned categories) | ✅ | ✅ |
| Add any user to workspace | ✅ | ❌ |
| Add users from assigned categories | ✅ | ✅ |
| View all workspaces | ✅ | ❌ |
| View own workspaces | ✅ | ✅ |

---

## 13. Agent Bots

Expose AI Assistant capabilities as a REST API for external systems, CI/CD pipelines, or third-party apps.

### What are Agent Bots?

Agent Bots are API-accessible chatbot instances. Instead of a user interacting via the browser, an external system POSTs a message and polls for the response. Each bot has its own:
- System prompt and category access
- Enabled tool set
- LLM model and temperature settings
- API keys for callers
- Job history and analytics

### Creating an Agent Bot

1. Navigate to **Admin** → **Agent Bots**
2. Click **New Agent Bot**
3. Configure:
   - **Name** - Display name
   - **Slug** - URL identifier (e.g., `hr-bot`)
   - **Description** - Purpose
   - **System Prompt** - AI instructions for this bot
   - **Categories** - Document categories this bot can access
   - **Tools** - Enabled tools (web search, doc gen, etc.)
   - **LLM Config** - Model (including **⚡ Auto** for intelligent per-invocation selection), temperature, max tokens
4. Click **Create**

### Managing API Keys

1. Open the agent bot
2. Click **API Keys** → **Generate New Key**
3. Copy the key immediately (not shown again)
4. Assign a name to the key (e.g., "CI/CD Pipeline", "Mobile App")

### Invoking an Agent Bot

```bash
# Submit a job
curl -X POST https://your-domain.com/api/agent-bots/hr-bot/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the leave policy?"}'

# Response: { "jobId": "abc123", "status": "pending" }

# Poll for completion
curl https://your-domain.com/api/agent-bots/hr-bot/jobs/abc123 \
  -H "Authorization: Bearer YOUR_API_KEY"

# Download output file (if generated)
curl https://your-domain.com/api/agent-bots/hr-bot/jobs/abc123/outputs/output1/download \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -o report.pdf
```

### Bot Versions

1. Open the agent bot → **Versions** tab
2. Click **Save Version** to snapshot the current config
3. Click any version to restore it
4. Use versioning before making significant prompt changes

### Analytics

The Analytics tab shows per-bot usage:
- Total jobs submitted and completed
- Success / failure rates
- Token consumption and cost
- Average job duration

---

## 14. Settings

Configure system-wide settings.

### AI & API Setup

Use **Admin → Settings → AI & API Setup** to configure AI providers and API-backed capabilities for an organization. Providers and capabilities are loaded from the server registry, so the page may show services beyond LLMs, including embeddings, reranking, web search, document intelligence, image generation, podcast audio, STT/TTS, and developer/analysis tools.

#### Organization Selection and Roles

- A workspace belongs to one organization and inherits that organization's provider credentials and capability configuration.
- A **super admin** can select and administer any organization and can create `ENTITY` or `INDIVIDUAL` organizations.
- An **organization admin (`org_admin`)** manages only their own organization.
- An organization **member** consumes configuration but cannot administer provider credentials.
- Provider keys are organization-owned. There is no per-user BYOK.

#### Credential Modes

| Mode | Use |
|---|---|
| **Platform Managed** | Uses credentials configured by the platform/deployment. Platform-managed financial cost is visible only to super admins. |
| **Organization BYOK** | Uses an encrypted credential supplied by the organization. If the selected organization credential is missing or invalid, the capability is unavailable—there is no platform-key fallback. |

For BYOK, enter a credential once for a provider and reference it from multiple capabilities. The service encrypts the key before storage; after submission, the raw key cannot be displayed.

Credential actions are deliberately limited to:

- **Test Connection** — verify the provider and update verification state;
- **Replace Key** — store replacement material and invalidate cached provider clients; and
- **Disable Connection** — prevent further use without revealing or deleting historical audit/usage data.

There is no **Show Key** action.

#### Capability Configuration and Health

Capabilities are grouped into **Core AI**, **Knowledge & Search**, **Media**, and **Developer / Analysis Tools**. Select a provider, optional model/service, and enablement state for each capability. Importance is shown as `REQUIRED`, `RECOMMENDED`, or `OPTIONAL`.

| Health | Meaning |
|---|---|
| `READY` | Configured with an available credential |
| `DEGRADED` | Usable with warnings or missing recommended configuration |
| `UNAVAILABLE` | Configured but the selected provider/credential cannot be used |
| `NOT_CONFIGURED` | No active configuration |

Warnings do not block saving, allowing staged setup. Treat missing required capabilities as operationally significant before making the organization available to users.

#### Members, Audit, and Usage

Authorized administrators can manage organization membership, review redacted credential events, and view organization-attributed token usage. Audit entries record create, replace, disable, enable, test, and rotate actions but never raw key material.

Cost visibility follows the credential owner:

- platform-managed cost: super admin only;
- organization BYOK cost: `org_admin` for their own organization (and super admins across organizations).

#### Legacy Settings Pages

When the redesigned UI feature flag is enabled, **API Keys**, **LLM**, **Routes**, **Reranker**, **Document Processing**, and **Speech** display a read-only card linking to AI & API Setup. They are redirected, not deleted. Direct writes to retired legacy endpoints return HTTP `409` with code `LEGACY_WRITE_DISABLED`.

**RAG remains writable** in its existing settings page because chunking, retrieval, thresholds, and token budgets are retrieval behavior rather than provider credential ownership.

For architecture and migration/rollback details, see [AI & API Setup Redesign](../tech/AI-API-Setup-Redesign.md).

### Speech Settings

The **Speech** section under Settings manages Speech-to-Text (STT) and Text-to-Speech (TTS) provider configuration. It has two collapsible panels.

#### Speech-to-Text (STT)

Configures which provider handles voice input transcription. Providers are route-bound:

| Provider | Route | Models | Cost |
|----------|-------|--------|------|
| **OpenAI Whisper** | Route 2 (Direct) | `whisper-1` | $0.006/min |
| **Google Gemini** | Route 2 (Direct) | `gemini-2.5-flash`, `gemini-2.5-pro` | ~$0.06/min |
| **Mistral Voxtral** | Route 2 (Direct) | `voxtral-mini-transcribe-v2` | $0.003/min |
| **Fireworks AI** | Route 5 (Aggregator) | `whisper-v3-turbo`, `whisper-v3-large` | $0.001/min |

**Route Defaults**: Each route has a default and fallback STT provider. When the global default route is disabled, the system automatically falls back to the other active route's providers.

**Recording Limits**: Configure minimum (1–60s) and maximum (10–600s, default 120s) recording duration. The client auto-stops recording at the maximum and discards recordings shorter than the minimum.

Route 3 (Ollama) does not support STT.

#### Text-to-Speech (TTS)

Controls which TTS providers are available system-wide. Independent of LLM routes (both use direct API calls).

| Provider | Description |
|----------|-------------|
| **OpenAI TTS** | `gpt-4o-mini-tts` — 13 voices, MP3 output |
| **Google Gemini TTS** | Flash/Pro preview — 30 voices, multi-speaker WAV |

Set a primary and fallback TTS provider. Voice selection, style, and podcast-specific settings remain in **Tools > Podcast Generator**.

### General Settings

| Setting | Description |
|---------|-------------|
| **Application Name** | Displayed in UI and documents |
| **Application Logo** | Logo URL for branding |
| **Support Email** | Contact for user support |
| **Default Language** | UI language |

### Appearance Settings

| Setting | Description |
|---------|-------------|
| **Accent Color** | Primary theme color for the application (users can customize) |

### Routes

The **Routes** section controls which LLM provider paths are active. AI Assistant uses a three-route architecture with all providers using direct native SDKs/APIs:

| Route | Providers | Connection |
|-------|-----------|------------|
| **Route 2** | OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Moonshot | Native SDK / direct API |
| **Route 3** | Ollama (local) | OpenAI SDK → ollama:11434/v1 |
| **Route 5** | Azure AI Foundry, Fireworks AI, Ollama Cloud | Native SDK / OpenAI-compat |

| Setting | Description |
|---------|-------------|
| **Route 2 toggle** | Enable/disable direct provider route |
| **Route 3 toggle** | Enable/disable local Ollama route |
| **Route 5 toggle** | Enable/disable aggregator gateway route |
| **Primary route** | Preferred route for fallback ordering |

**Key behaviors:**
- At least one route must always be enabled
- Disabling a route removes its models from the chat model selector
- In **LLM Settings**, disabled-route providers and models appear greyed out (view-only)
- Red warnings appear if the default or fallback model belongs to a disabled route
- See [`docs/features/LLM.md`](../features/LLM.md) for the authoritative architecture reference

See [features/routes.md](../features/routes.md) for technical details.

### Provider Selection Guidelines

Choose provider tier based on data sensitivity before configuring the default model:

| Provider Tier | Use Case | Data Classification |
|---|---|---|
| **Ollama** (Local) | Simple RAG, document lookup, basic Q&A | ✅ Government-sensitive / classified — data never leaves your network |
| **Cloud LLMs** — OpenAI, Claude, Gemini, Mistral, DeepSeek | Complex reasoning, tool calls, multi-step workflows | Public / non-sensitive data only |
| **Fireworks AI** | Developer testing of open-source models | Development / test environments only |

> **Rule:** Never configure a Cloud LLM or Fireworks AI model as the default for workspaces that handle government-sensitive or classified data. Use Ollama for all sensitive workloads.

### AI Configuration

| Setting | Description |
|---------|-------------|
| **LLM Model** | Default model for chat (OpenAI, Gemini, Mistral, Ollama) |
| **Temperature** | Response creativity (0-1) |
| **Max Tokens** | Maximum response length |
| **Context Window** | Document context size |
| **Streaming** | Enable real-time streaming responses |
| **Memory Extraction Tokens** | Maximum tokens for memory extraction |
| **Prompt Max Tokens** | Maximum tokens for prompt context |

#### Vision-Capable Models

The following models support image analysis (multimodal):

| Model | Provider | Vision Support |
|-------|----------|----------------|
| gpt-4.1 | OpenAI | ✅ |
| gpt-4.1-mini | OpenAI | ✅ |
| gpt-4.1-nano | OpenAI | ✅ |
| gemini-2.5-pro | Google | ✅ |
| gemini-2.5-flash | Google | ✅ |
| gemini-2.5-flash-lite | Google | ✅ |
| mistral-large-3 | Mistral | ✅ |
| mistral-small-3.2 | Mistral | ✅ |

When a vision-capable model is configured, users can upload images in their chat threads for analysis.

#### Model Capability Toggles

Each model row in the LLM Settings table has **five** capability toggles:

| Toggle | Icon | Description | Impact |
|--------|------|-------------|--------|
| **Tools** | Wrench | Model supports function/tool calling | Enables tool execution in conversations |
| **Vision** | Eye | Model supports image/multimodal input | Enables file upload in chat |
| **Parallel** | Zap | Model handles multiple tool calls concurrently | Tool calls execute in parallel instead of sequentially |
| **Thinking** | Brain | Model outputs reasoning/thinking content | Identifies models with extended reasoning (e.g., Claude thinking blocks, DeepSeek `<think>` tags) |
| **Forced Tools** | Wrench | Model supports forced `tool_choice` (`required` or a specific function pin) | Tool-routing rules that pin a specific tool are honored; when Off, `tool_choice` is downgraded to `auto` |

Defaults are auto-detected when models are added or refreshed (via "Get Details" or "Refresh Capabilities"). Admins can override any toggle manually.

**Parallel-capable models:** Claude, Gemini, Mistral Large, GPT-4.1, GPT-5-nano, GPT-5.2+, Fireworks-hosted models

**Thinking-capable models:** Claude, Qwen3, QwQ, DeepSeek-R1, o1/o3/o4

**Forced-tool capable models:** Most OpenAI-compatible chat models (OpenAI GPT-4/5/5.5/5.6, Google Gemini, Mistral, Fireworks-hosted models, DeepSeek V4, Kimi K2.5/K2.6/K2.7/K3, GLM-5.x).

**Not forced-tool capable:** OpenAI o-series (`o1`, `o3`, `o3-mini`, `o4-mini`), GPT-OSS (`gpt-oss-120b`, `gpt-oss-20b`), Claude adaptive-thinking models, older think-tag reasoning models (`qwen3`, `qwq`, `kimi-k2.5`/`kimi-k2.6` dot-aliases), and all Ollama/Ollama Cloud models.

> **Forced Tools explained:** When a tool-routing rule uses force mode `Required`, the app tries to pin a specific tool via the OpenAI `tool_choice` parameter. Some models (notably reasoning/think-tag models and adaptive-thinking Claude models) do not reliably honor a pinned tool and may ignore it or hallucinate tool results. If **Forced Tools** is Off for a model, the app automatically downgrades `tool_choice` to `auto` for that model, letting the model choose its own tool (or none). Keep it On only for models known to support forced tool choice.

> **Note:** When a route is disabled, all toggles for that route's models become read-only (greyed out).

#### Image Processing Strategy

The system automatically determines image handling based on model and OCR configuration:

| Configuration | Strategy | User Experience |
|--------------|----------|-----------------|
| Vision model + OCR enabled | `vision-and-ocr` | Full visual analysis + text extraction |
| Vision model + No OCR | `vision-only` | Visual analysis only |
| Non-vision model + OCR enabled | `ocr-only` | Text extraction only (warning shown) |
| Non-vision model + No OCR | `none` | Image upload blocked (error shown) |

**To enable full image support:**
1. Configure a vision-capable model (see table above)
2. Add OCR provider credentials in **Settings → API Keys** (Document Processing section):
   - **Mistral OCR**: Requires Mistral API key
   - **Azure Document Intelligence**: Requires endpoint + API key
3. Enable the OCR provider in **Settings → Document Processing**

**User Notifications:**
- Users see a yellow warning when only OCR is available (no visual analysis)
- Users see a red error when images cannot be processed at all
- The FileUpload component displays the current capability status

### Embedding Settings

| Setting | Description |
|---------|-------------|
| **Embedding Model** | Model for vector embeddings |
| **Chunk Size** | Document chunk size |
| **Chunk Overlap** | Overlap between chunks |

### RAG Settings

| Setting | Description |
|---------|-------------|
| **Top K Results** | Documents to retrieve |
| **Similarity Threshold** | Minimum relevance score |
| **Reranker** | Enable/disable reranking |
| **Reranker Providers** | Priority-ordered list (BGE Large, Cohere, BGE Base, Local) |

#### User Upload Threshold (NEW - May 2026)

The minimum reranker score for user-uploaded documents is now configurable via environment variable:

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `USER_UPLOAD_MIN_RERANK_SCORE` | `0.30` | Minimum relevance score for general user-upload retrieval. Explicit requests about an uploaded/attached document bypass this filter so the upload is still available for review and summarization. |

**Why this matters:** Previously, the threshold of 0.05 was barely any filtering, causing poor retrieval quality. The default of 0.30 keeps general user-upload retrieval focused, while explicit attached-file summary/review prompts still include uploaded content. Set to a lower value (e.g., 0.15) if you want more permissive general filtering, or higher (e.g., 0.50) for stricter filtering.

#### Token Budget Management (NEW - May 2026)

The RAG pipeline now proactively manages token budgets before sending to the LLM:

1. **Token Counting**: Uses `tiktoken` to count tokens in the assembled prompt (system + history + RAG context + question)
2. **Intelligent Truncation**: If the prompt exceeds the model's token budget, the system removes lowest-scored chunks first
3. **Logging**: Truncation events are logged with before/after token counts: `[TokenBudget] Context truncated from X to Y tokens (budget: Z)`

**Benefits:**
- Prevents silent truncation by the API (which could cut off mid-chunk)
- Ensures the most relevant chunks are always included
- Provides visibility into context size via logs

**No configuration needed** — this is automatic behavior enabled for all requests.

### Agent Settings (Beta)

The **Agent** section configures the autonomous multi-step task execution system. This is an advanced feature that decomposes complex requests into planned tasks, executes them with tool calling, checks quality, and synthesizes a final answer.

#### Model Assignment

| Setting | Description |
|---------|-------------|
| **Planner Model** | Model for task decomposition and DAG creation. Thinking-capable models recommended. Set to **⚡ Auto** for intelligent per-plan selection. |
| **Executor Model** | Model for running individual tasks. Supports executor profiles for specialized routing. Set to **⚡ Auto** for intelligent per-task selection. |
| **Checker Model** | Model for quality validation and confidence scoring. Set to **⚡ Auto** for intelligent per-check selection. |
| **Summarizer Model** | Model for final output synthesis. Set to **⚡ Auto** for intelligent per-summary selection. |
| **Planner Reasoning** | Enable chain-of-thought reasoning in the planner (only shown when planner model is thinking-capable) |

> **Auto Model Selection for Agent Roles:** Each role (Planner, Executor, Checker, Summarizer) can be set to **⚡ Auto** independently. The system picks the best model for that role's specific workload:
> - **Planner** → prioritizes reasoning capability
> - **Executor** → prioritizes function calling / tool execution
> - **Checker** → prioritizes reasoning capability
> - **Summarizer** → prioritizes reasoning capability
>
> Auto is disabled for the `local_private` executor profile (air-gapped deployments must stay on Ollama). If Auto selection fails, the global default model is used.

#### Budget & Quality

| Setting | Default | Description |
|---------|---------|-------------|
| **Max Tokens** | 2,000,000 | Total token budget per autonomous execution |
| **Max Cost** | — | Maximum dollar cost per execution |
| **Max Tasks** | 10 | Maximum tasks per plan |
| **Quality Threshold** | 0.7 | Minimum confidence score (0.0–1.0) before retry |
| **Max Retries** | 2 | Retries per task before marking failed |

#### Subagent Mode

Subagent mode enables multi-turn ReAct loops within individual tasks for complex reasoning:

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Subagent Mode** | Off | Master toggle for multi-turn subagent ReAct loops |
| **Default Tasks to Subagent** | Off | Planner marks new tasks as subagent-enabled by default |
| **Require HITL for Unsafe Tools** | On | Pause before generative/costly tools in subagent loops |
| **Max Iterations per Task** | 15 | ReAct loop ceiling (1–30). Higher values allow deeper reasoning but consume more tokens. |
| **Budget Allocation (%)** | 25 | Percentage of plan budget allocated per subagent task |

#### Working Memory (Beta)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Working Memory** | Off | Persist per-wave task summaries into the `plan_memories` table so the executor can reference prior-wave context in long-running plans. No LLM overhead — summaries are deterministic. |

> **Working Memory behavior:** When enabled, after each wave completes the system saves a truncated summary (≤500 chars) of completed tasks. Before the next wave executes, the last 2 waves of summaries (≤1500 chars) are injected into the executor prompt as `[Previous Waves Summary]`. This helps the agent maintain continuity across many waves without growing the prompt indefinitely.

#### Streaming & Timeouts

- **Stream Progress**: Real-time SSE events stream task status to the chat UI
- **Task Timeouts**: Type-specific limits are enforced automatically (deep analysis: 20 min, image/document generation: 15 min, charts/research: 10 min)
- **Retry Backoff**: Recoverable API errors (rate limits, timeouts) trigger exponential backoff with automatic retry; fatal errors skip retry

### Memory Settings

The **Memory** section under Settings controls how AI Assistant extracts, stores, and retrieves user-specific facts across conversations. Memory enables the AI to personalize responses based on past interactions.

#### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Memory** | Off | Master toggle for the user memory system. When enabled, facts about users are extracted from conversations and stored for future reference. |
| **Extraction Threshold** | 5 | Minimum number of messages in a thread before fact extraction is triggered. Higher values reduce extraction frequency. |
| **Max Facts Per Category** | 20 | Maximum number of facts stored per user per category. Older facts are replaced when this limit is reached. |
| **Max Facts Per Query** | 10 | Maximum number of facts returned by semantic retrieval when a user sends a message. Controls how many relevant memories are injected into the AI's context. |
| **Auto-Extract on Thread End** | On | When enabled, facts are automatically extracted when a conversation thread ends. |
| **Extraction Max Tokens** | 1000 | Token budget for the LLM call that extracts facts from conversation history. |
| **Fact Max Age (Days)** | 0 (no limit) | Maximum age in days for facts to be included in context. Facts older than this threshold are filtered out. Set to 0 to disable temporal filtering. |

#### How It Works

1. **Fact Extraction**: After N messages (defined by Extraction Threshold), the system analyzes the conversation using an LLM to identify key facts about the user (e.g., "User prefers PDF format", "User works in HR department").
2. **Storage**: Facts are stored in the `user_memories` database table, organized by user and category, with timestamps for temporal tracking.
3. **Semantic Retrieval**: When a user sends a message, the system embeds the query and searches for semantically relevant facts in the Qdrant vector store. This returns only the most relevant facts (up to `Max Facts Per Query`) rather than all stored facts.
4. **Fallback**: If Qdrant is unavailable, the system falls back to a SQLite full-scan with temporal filtering applied.
5. **Temporal Filtering**: When `Fact Max Age (Days)` is set to a value greater than 0, facts older than the specified number of days are excluded from the AI's context, ensuring the AI only uses recent, relevant information.
6. **Context Injection**: Retrieved facts are formatted and injected into the system prompt, allowing the AI to personalize responses based on remembered user preferences and history.

#### API Endpoints

- `GET /api/user/memory` — View extracted memories for the current user
- `DELETE /api/user/memory` — Clear all memories for the current user
- `GET /api/admin/memory/stats` — View memory extraction statistics (admin only)

#### Best Practices

- **Start with defaults**: The default settings work well for most deployments. Adjust gradually based on observed behavior.
- **Semantic retrieval vs. full scan**: Semantic retrieval via Qdrant provides more relevant results than the SQLite fallback. Ensure Qdrant is running for best results.
- **Temporal filtering**: For deployments where user preferences change frequently (e.g., quarterly policy updates), set `Fact Max Age (Days)` to 90 or 180 to keep memories current.
- **Extraction threshold**: Lower values (3-5) work well for chat-heavy use cases. Higher values (10+) reduce LLM costs for document-focused deployments.

### Security Settings

| Setting | Description |
|---------|-------------|
| **Session Timeout** | Auto-logout duration |
| **Password Requirements** | Minimum complexity |
| **Rate Limiting** | Request limits per user |
| **Allowed Domains** | Email domain restrictions |

### API Configuration

| Setting | Description |
|---------|-------------|
| **YouTube API Key** | YouTube data API key |

> **Note:** LLM provider keys, Tavily API key, OCR keys, and reranker keys are now managed in **Settings → API Keys**.

### Progressive Web App (PWA) Settings

Configure AI Assistant as an installable Progressive Web App.

> **📖 Detailed Documentation:** For comprehensive information about PWA capabilities, installation, and technical details, see [docs/features/PWA.md](../../features/PWA.md).

| Setting | Description |
|---------|-------------|
| **Enable PWA** | Allow users to install AI Assistant as a standalone app |
| **App Name** | Name shown in app launcher (defaults to Application Name) |
| **App Short Name** | Short name for mobile home screen (max 12 chars) |
| **App Icon** | Icon URL for the installed app (square PNG, 512x512px recommended) |
| **Theme Color** | Browser UI theme color (hex value) |
| **Background Color** | Splash screen background color |

**PWA Capabilities:**
- ✅ Install on desktop (Windows, macOS, Linux)
- ✅ Install on mobile (iOS, Android)
- ✅ Standalone window without browser UI
- ✅ Automatic updates via service worker
- ✅ Custom app icon and name
- ⚠️ Requires internet connection (no offline mode)

**Testing PWA:**
1. Enable PWA in settings
2. Configure app name and icon
3. Visit AI Assistant in Chrome or Edge
4. Look for install prompt in address bar
5. Click "Install" to test

**Icon Requirements:**
- Format: PNG, SVG, or ICO
- Recommended size: 512x512px
- Square aspect ratio
- If not provided, defaults to Application Logo

---

## 15. System Management

Administrative functions for system maintenance.

### Backup & Restore

#### Creating a Backup

1. Navigate to **Settings** → **Backup**
2. Click **Create Backup**
3. Select what to include:
   - Database
   - Uploaded files
   - Configuration
4. Click **Generate**
5. Download the backup file

#### Restoring from Backup

1. Navigate to **Settings** → **Restore**
2. Upload backup file
3. Select what to restore
4. Click **Restore**

> **Warning:** Restore overwrites current data.

> **Large backups:** Production backup files may be 50–500MB. The restore endpoint supports up to 500MB by default. If you need a larger limit, set `MAX_UPLOAD_SIZE=1gb` (or higher) in your `.env` file and rebuild the container.

> **Cross-provider migration:** You can migrate between database providers (SQLite ↔ PostgreSQL) by creating a backup on the source system and restoring on a new deployment with a different `DATABASE_PROVIDER` setting. Update `.env` and restart containers with the appropriate Docker profile before restoring.

### Database Management

| Action | Description |
|--------|-------------|
| **Vacuum** | Optimize database size |
| **Reindex** | Rebuild search indexes |
| **Clear Cache** | Clear temporary data |

### Database & Vector Store Selection

AI Assistant supports two database backends and two vector store backends. Choose the combination that fits your deployment size.

#### Database Options

| Option | Users | Setup | Concurrency | Notes |
|--------|-------|-------|-------------|-------|
| **SQLite** (default) | Up to ~50 | Zero config | WAL mode | Single file at `data/app/ai-assistant.db` |
| **PostgreSQL** | 50+ | One-time init | Connection pool (10) | Requires `DATABASE_PROVIDER=postgres` |

#### Vector Store Options

| Option | Scale | Memory | Setup |
|--------|-------|--------|-------|
| **Qdrant** | All scales | ~512MB | `--profile qdrant` |

#### Enabling PostgreSQL

Set these environment variables in `.env` before starting containers:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://ai-assistant:password@postgres:5432/ai-assistant
POSTGRES_USER=ai-assistant
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=ai-assistant
```

Then start with the postgres profile:

```bash
docker compose --profile postgres --profile qdrant up -d --build
```

The app waits for PostgreSQL to be healthy before starting. An idempotent schema migration runs automatically on first connection — no manual SQL steps required.

#### Migrating from SQLite to PostgreSQL

1. Create a full backup: **Settings → Backup → Create Backup** (include Database + Files + Config)
2. Update `.env`: set `DATABASE_PROVIDER=postgres`, `DATABASE_URL`, and Postgres credentials
3. Restart containers with the postgres profile: `docker compose --profile postgres --profile qdrant up -d --build`
4. Restore the backup: **Settings → Restore → Upload Backup**
5. Verify data integrity via the Dashboard statistics cards

> **Note:** During and after migration, the system automatically falls back to SQLite for any data not yet available in PostgreSQL, so there is no service interruption.

### Processing Queue

View and manage document processing:

| Column | Description |
|--------|-------------|
| **Document** | Filename |
| **Status** | Queue position, processing, error |
| **Started** | When processing began |
| **Duration** | Processing time |

Actions:
- **Retry** - Re-queue failed document
- **Cancel** - Stop processing
- **Priority** - Move to front of queue

### System Logs

View system activity:
- **Access Logs** - User activity
- **Error Logs** - System errors
- **API Logs** - External API calls
- **Chat Logs** - Conversation history

### Usage Statistics

| Metric | Description |
|--------|-------------|
| **Total Queries** | Chat interactions |
| **Documents Processed** | Processing volume |
| **API Calls** | External API usage |
| **Storage Used** | Disk space consumption |

---

## 16. Troubleshooting

### Common Issues

#### Documents Not Appearing in Search

**Causes:**
- Document still processing
- Processing error
- Wrong category

**Solutions:**
1. Check document status in Documents tab
2. Wait for processing to complete
3. If Error, click for details and fix
4. Verify category assignment

#### Users Cannot Access Category

**Causes:**
- No subscription
- Inactive subscription
- Category is private

**Solutions:**
1. Check user's subscriptions
2. Verify subscription is Active
3. Add subscription if missing

#### Tool Not Working

**Causes:**
- Tool disabled globally
- Tool disabled for category
- Missing API key
- Invalid configuration

**Solutions:**
1. Check global tool settings
2. Check category overrides
3. Verify API keys in **Settings → API Keys**
4. Test tool with Test button

#### AI Not Using Skills

**Causes:**
- Skill inactive
- Trigger conditions not met
- Conflicting skills

**Solutions:**
1. Verify skill is Active
2. Check trigger type and conditions
3. Test with explicit trigger words/categories

#### Tool Routing Not Working

**Causes:**
- Rule inactive
- Pattern not matching
- Wrong force mode
- Category scope mismatch

**Solutions:**
1. Verify the routing rule is Active
2. Test the pattern with **Test Routing** panel
3. Check if the rule is scoped to specific categories
4. Verify the pattern type (keyword vs regex) matches your intent
5. Check server logs for routing debug messages

#### Compliance Check Not Running

**Causes:**
- Compliance checker tool disabled globally
- No matched skills have compliance enabled (opt-in model)
- Skill's complianceConfig.enabled is false

**Solutions:**
1. Enable compliance_checker tool in Admin > Tools
2. Enable compliance on at least one skill (Admin > Prompts > Skills)
3. Verify the skill that should trigger compliance has "Enable compliance checking" toggled on
4. Check if the skill is matching (view matched skills in response debug)

#### HITL Clarification Not Appearing

**Causes:**
- Score above warning threshold
- enableHitl is disabled in compliance checker config
- useLlmClarifications disabled and no templates match

**Solutions:**
1. Lower the warning threshold to trigger HITL more easily (for testing)
2. Verify enableHitl is checked in compliance checker settings
3. Check that fallbackToTemplates is enabled if LLM clarification fails

#### Processing Queue Stuck

**Causes:**
- OCR service down
- Large file backlog
- System resources exhausted

**Solutions:**
1. Check system health on Dashboard
2. Restart OCR service if needed
3. Cancel stuck documents and retry
4. Contact support for persistent issues

#### Thread Sharing Not Working

**Causes:**
- Thread sharing tool disabled
- User's role not allowed to share
- Rate limit exceeded

**Solutions:**
1. Verify `share_thread` tool is enabled in Tools settings
2. Check `allowedRoles` configuration includes the user's role
3. Review rate limit settings if users report blocked shares
4. Check server logs for detailed error messages

#### Email Notifications Not Sending

**Causes:**
- Email tool not enabled
- Invalid SendGrid API key
- Sender email not verified
- Rate limit exceeded

**Solutions:**
1. Enable the `send_email` tool in Tools settings
2. Verify SendGrid API key is correct and active
3. Ensure sender email is verified in SendGrid dashboard
4. Check SendGrid activity logs for delivery issues
5. Increase rate limit if needed

### Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Rate limit exceeded" | Too many requests | Wait and retry |
| "Model not available" | LLM service issue | Check provider API keys and Admin > Settings > LLM |
| "Embedding failed" | Vector store issue | Check embedding service |
| "Authentication failed" | Invalid credentials | Verify API keys |

### Getting Help

For issues not covered here:
1. Check system logs for details
2. Note exact error messages
3. Document steps to reproduce
4. Contact support with details

---

## 17. Quick Reference

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search |
| `Esc` | Close modal |
| `Ctrl+S` | Save current form |
| `Ctrl+N` | New item (context-aware) |

### File Upload Limits

| Type | Limit |
|------|-------|
| File upload | 50MB |
| Text content | 10MB |
| Web URLs | 5 per batch |
| YouTube | 1 per request |
| Backup restore | 500MB (default, configurable via `MAX_UPLOAD_SIZE` env var — requires rebuild) |

### Supported File Types

- PDF (`.pdf`)
- Word (`.docx`)
- Excel (`.xlsx`)
- PowerPoint (`.pptx`)
- Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`)

### Status Icons

| Icon | Meaning |
|------|---------|
| 🟢 | Active/Ready |
| 🟡 | Processing/Pending |
| 🔴 | Error/Inactive |
| ⚙️ | Configurable |
| 🔒 | Locked/Protected |

### Role Hierarchy

```
Admin
  ├── Full system access
  ├── All category management
  ├── User administration
  └── System configuration

Superuser
  ├── Managed category access (full control)
  │   ├── Document uploads
  │   ├── User subscriptions
  │   ├── Tool configuration
  │   └── Prompt customization
  ├── Subscribed category access (read-only)
  │   └── Chat/query documents
  └── Category creation (within quota)

User
  ├── Chat access
  ├── Thread document uploads
  └── Subscribed category access
```

### Multi-Category Thread Selection

All roles (Admin, Superuser, User) can select **multiple categories** when creating a new chat thread:

| Role | Available Categories for Selection |
|------|-----------------------------------|
| **Admin** | All categories in the system |
| **Superuser** | Managed categories + subscribed categories |
| **User** | Subscribed categories only |

When creating a thread:
1. Click **+ New Thread**
2. Select one or more categories from the dropdown
3. The AI will query documents across all selected categories
4. The chat header displays which categories are active

### Tool Availability

| Tool | Admin | Superuser | User |
|------|-------|-----------|------|
| Web Search | Configure | Configure* | Use |
| Doc Generator | Configure | Configure* | Use |
| Data Sources | Create all | Create* | Use |
| Task Planner | Configure | Create templates* | Use |
| Chart Gen | Configure | Configure* | Use |
| YouTube | Configure | Configure* | Use |

*For assigned categories only

---

*Last updated: May 2026 (v3.1 - Added Slash Commands management section under Tools, including command registry, editing, and reset-to-defaults documentation)*
