# Workspace Chatbots — Standalone & Embed

> **Audience:** Administrators, superusers, developers embedding AI Assistant on external sites  
> **Scope:** Complete guide to creating, configuring, and integrating workspace chatbots

---

## Table of Contents

1. [Objective](#1-objective)
2. [Sample Use Cases](#2-sample-use-cases)
3. [How to Create a Workspace](#3-how-to-create-a-workspace)
4. [Workspace API Documentation](#4-workspace-api-documentation)
5. [Integrating in an External Portal or System](#5-integrating-in-an-external-portal-or-system)
6. [Known Error Codes](#6-known-error-codes)
7. [Known Issues and Fixes](#7-known-issues-and-fixes)

---

## 1. Objective

**Workspaces** are scoped chat environments that expose AI Assistant's RAG capabilities through a dedicated URL slug. Each workspace is linked to one or more document **categories**, has independent branding, optional LLM overrides, and its own access control rules.

Workspaces solve the problem of **deploying AI Assistant capabilities outside the main application** — whether as a full-featured standalone portal for authenticated users or as a lightweight embed widget on a public-facing website.

### Standalone vs Embed

| Aspect | Standalone | Embed |
|--------|-----------|-------|
| **URL** | `/{slug}` | `/e/{slug}` or external site via script |
| **Features** | Full chat: threads, history, artifacts, file upload, voice | Text-only chat, session-based, lightweight |
| **Authentication** | Required (or optional anonymous) | None by default; optional auth gating |
| **Thread persistence** | Yes — full thread CRUD | No — ephemeral 24h sessions |
| **Artifacts** | Yes — charts, documents, diagrams, images | No — LLM is instructed not to generate artifacts |
| **Rate limiting** | Per-user (implicit) | Per-IP daily + session limits |
| **Domain restriction** | N/A | `allowed_domains` whitelist |
| **Best for** | Internal team portals, department assistants | Public websites, customer support widgets |

### Key Capabilities

- **Category-scoped RAG** — Each workspace searches only its linked categories
- **Independent branding** — Colors, logo, greeting, suggested prompts per workspace
- **LLM overrides** — Per-workspace model (including **⚡ Auto** for intelligent per-message selection), temperature, system prompt
- **Access control** — Category-based (subscriptions) or explicit user list
- **WhatsApp channel** — Standalone workspaces can receive WhatsApp messages
- **Analytics** — Sessions, messages, visitors, response times, token usage
- **File upload** — Both modes support document/image uploads (if enabled)
- **Voice input** — Both modes support microphone input (if enabled)

---

## 2. Sample Use Cases

### Use Case A: Government E-Services Portal (Embed)

**Scenario:** A government's main portal wants to offer citizens an AI assistant for common queries about taxes, permits, and public services.

**Workspace Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | `Citizen Services Assistant` |
| **Type** | `embed` |
| **Categories** | `Taxation`, `Public Services`, `Housing` |
| **Greeting** | `Hello! I'm your government services assistant. Ask me about taxes, permits, or public programs.` |
| **Suggested Prompts** | `How do I apply for a business license?`, `What are the property tax deadlines?` |
| **Branding** | Primary color: `#0055A4` (national blue), Government crest logo |
| **Rate Limits** | Daily: 50 messages/IP, Session: 10 messages |
| **Allowed Domains** | `gov.gd`, `services.gov.gd` |

**Integration:**

```html
<!-- Embedded in the footer of gov.gd -->
<script
  src="https://ai.abhirup.app/embed/workspace.js"
  data-workspace-id="a1b2c3d4e5f67890"
  data-api-base="https://ai.abhirup.app"
  data-position="bottom-right"
  async
></script>
```

---

### Use Case B: Ministry Department Portal (Standalone)

**Scenario:** The Ministry of Health wants an internal AI assistant for staff to query policy documents, clinical guidelines, and procurement rules.

**Workspace Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | `Ministry of Health Intranet AI` |
| **Type** | `standalone` |
| **Categories** | `Clinical Guidelines`, `Procurement`, `HR Policies` |
| **Access Mode** | `category` (staff must be subscribed to all linked categories) |
| **Greeting** | `Welcome to the Ministry of Health knowledge assistant.` |
| **LLM Override** | Model: `claude-sonnet-4`, Temperature: `0.3` |
| **Features** | File upload: enabled (max 25MB), Voice: enabled |

**Usage:** Staff bookmark `https://ai.abhirup.app/moh-portal-2026` and log in with their SSO credentials.

---

### Use Case C: WhatsApp Citizen Hotline

**Scenario:** The tax authority wants to offer WhatsApp-based query support for citizens who prefer messaging over web portals.

**Prerequisites:** Meta Business account, WhatsApp Business API access, webhook endpoint

**Setup:**
1. Create a **standalone** workspace linked to the `Taxation` category
2. In Admin → Workspaces → WhatsApp, configure:
   - Phone Number ID
   - Verify Token
   - App Secret (encrypted at rest)
   - Access Token (encrypted at rest)
3. Register the webhook URL with Meta: `https://ai.abhirup.app/api/w/{slug}/channels/whatsapp/webhook`
4. Citizens message the official WhatsApp number

**Current Limitation:** WhatsApp responses use a simplified LLM call without full RAG (see [Known Issues](#whatsapp-rag-is-minimal)). Best for simple Q&A.

---

### Use Case D: Multi-Department Embed Widget

**Scenario:** A university wants a single embed widget on its student portal that can answer questions about admissions, finance, and student services.

**Approach:** Create **one embed workspace** linked to all three categories:

| Category | Documents |
|----------|-----------|
| `Admissions` | Entry requirements, application forms, deadlines |
| `Student Finance` | Fee structures, payment plans, scholarships |
| `Student Services` | Housing, counselling, disability support |

The widget appears on every page of the student portal, contextually answering questions based on the combined knowledge base.

---

## 3. How to Create a Workspace

### Prerequisites

- **Role:** Admin (full control) or Superuser (scoped to assigned categories)
- **Categories:** At least one category with uploaded, processed documents

### Step-by-Step

#### 1. Navigate to Workspaces

1. Log in as an Admin
2. Go to **Admin Dashboard**
3. Click the **Workspaces** tab in the left sidebar

#### 2. Create the Workspace

1. Click **New Workspace**
2. Select type: **Standalone** or **Embed**
3. Fill in basic details:

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | Internal display name | `MOH Intranet AI` |
| **Categories** | Select one or more categories | `Clinical Guidelines`, `Procurement` |
| **Greeting Message** | Welcome text shown on first open | `Welcome to the Ministry of Health assistant.` |
| **Suggested Prompts** | Quick-start buttons (one per line) | `What are the clinical guidelines for hypertension?` |

#### 3. Configure Branding

| Field | Description |
|-------|-------------|
| **Primary Color** | Hex color for buttons, headers, accents |
| **Logo URL** | Optional logo displayed in chat header |
| **Chat Title** | Custom title (defaults to workspace name) |
| **Footer Text** | Small footer in embed action bar |

#### 4. Configure LLM Overrides (Optional)

Override global LLM settings for this workspace:

| Field | Description |
|-------|-------------|
| **Provider** | OpenAI, Gemini, Mistral, Anthropic, etc. |
| **Model** | Specific model override, or **⚡ Auto** for intelligent per-message selection |
| **Temperature** | Response creativity (0.0–1.0) |

> **Auto Model Selection:** When **⚡ Auto** is selected, the system evaluates each incoming message (query context, tool routing, token budget) and picks the best available enabled model automatically, scoped to the workspace's linked categories. If selection fails, the global default model is used.
| **System Prompt** | Additional instructions prepended to global prompt |

> **Tip:** Lower temperatures (0.2–0.4) work well for policy/Q&A workspaces where precision matters.

#### 5. Configure Feature Toggles

| Feature | Standalone | Embed |
|---------|-----------|-------|
| **Voice Input** | ✅ Configurable | ✅ Configurable |
| **File Upload** | ✅ Configurable | ✅ Configurable |
| **Max File Size** | Default 25MB | Default 25MB |

#### 6. Configure Access Control (Standalone Only)

**Category-Based Access (Default):**

Users must have **active subscriptions to ALL** categories linked to the workspace.

```
Workspace linked to: [HR, Legal, Finance]
User subscriptions:  [HR, Legal, Finance, IT] → ✅ Can access
User subscriptions:  [HR, Legal]              → ❌ Cannot access
```

**Explicit User List:**

1. Edit the workspace
2. Change **Access Mode** to "Explicit User List"
3. Go to **Manage Users**
4. Add users individually or bulk-import via CSV

#### 7. Configure Embed-Specific Settings (Embed Only)

| Field | Description |
|-------|-------------|
| **Allowed Domains** | Comma-separated whitelist (e.g., `gov.gd,services.gov.gd`) |
| **Daily Limit** | Max messages per IP per day |
| **Session Limit** | Max messages per session |
| **Require Authentication** | If true, unauthenticated users are redirected to login |

> **Security:** The embed widget validates the `Origin` header against `allowed_domains`. Requests from unauthorized domains are rejected with 403.

#### 8. Save and Deploy

1. Click **Create**
2. The workspace is assigned a random 16-character slug (e.g., `a1b2c3d4e5f67890`)
3. Go to the **Script** tab to get deployment code

---

## 4. Workspace API Documentation

### Base URL

```
https://your-domain.com/api/w/{slug}
```

### Public Workspace API

All endpoints validate the workspace slug, check `Origin` headers for embed mode, and enforce session validity.

#### `POST /api/w/{slug}/init`

Initialize or retrieve a session.

**Request Body (embed):**

```json
{
  "visitorId": "visitor_abc123"  // Optional; from localStorage
}
```

**Request Body (standalone):**

```json
{
  "threadId": "thread_abc123"  // Optional; resume existing thread
}
```

**Response (`200 OK`):**

```json
{
  "sessionId": "sess_def456",
  "workspace": {
    "name": "Citizen Services Assistant",
    "slug": "a1b2c3d4e5f67890",
    "type": "embed",
    "primaryColor": "#0055A4",
    "logoUrl": "https://gov.gd/logo.png",
    "chatTitle": "Citizen Services",
    "greetingMessage": "Hello! I'm your government services assistant.",
    "suggestedPrompts": ["How do I apply for a permit?"],
    "voiceEnabled": true,
    "fileUploadEnabled": true,
    "maxFileSizeMB": 25
  },
  "rateLimits": {
    "dailyLimit": 50,
    "dailyUsed": 3,
    "sessionLimit": 10,
    "sessionUsed": 1
  },
  "thread": null  // or thread object for standalone
}
```

---

#### `POST /api/w/{slug}/chat/stream`

SSE streaming chat endpoint. This is the primary interface for workspace conversations.

**Headers:**

| Header | Value | Required |
|--------|-------|----------|
| `Content-Type` | `application/json` | Yes |
| `Origin` | Whitelisted domain (embed only) | Yes (embed) |

**Request Body:**

```json
{
  "message": "What are the tax filing deadlines?",
  "sessionId": "sess_def456",
  "threadId": "thread_abc123",  // Standonly only; omit for new thread
  "attachments": ["uploaded_file.pdf"]  // Optional uploaded filenames
}
```

**SSE Events:**

| Event | Description |
|-------|-------------|
| `chunk` | Text delta from the LLM |
| `sources` | RAG source citations (max 3 unique documents) |
| `tool_start` / `tool_complete` | Tool execution progress |
| `done` | Stream completed successfully |
| `error` | Processing error |

**Note:** Embed mode explicitly disables artifact-generating tools (images, charts, documents, diagrams). The LLM receives a system instruction: *"Do not generate images, charts, diagrams, or documents."*

---

#### `POST /api/w/{slug}/upload`

Upload a file for use in the current session/thread.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | Document or image |
| `sessionId` | string | Yes | Session identifier |

**Constraints:**
- Max size: `max_file_size_mb` (workspace setting, default 25MB)
- Allowed types: images, PDFs, DOCX, XLSX, PPTX, TXT
- Files are stored in `data/workspace-uploads/{workspaceId}/{sessionId}/`

**Response (`200 OK`):**

```json
{
  "filename": "budget_2026.xlsx",
  "size": 24576,
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

---

#### `GET /api/w/{slug}/threads`

List threads for the current user (standalone only).

**Query:** `?sessionId=sess_def456`

**Response:**

```json
{
  "threads": [
    {
      "id": "thread_abc123",
      "title": "Tax Questions",
      "createdAt": "2026-05-01T10:00:00Z",
      "updatedAt": "2026-05-20T14:30:00Z",
      "isArchived": false
    }
  ]
}
```

---

#### `POST /api/w/{slug}/threads`

Create a new thread (standalone only).

**Request Body:**

```json
{
  "title": "New Discussion",
  "sessionId": "sess_def456"
}
```

---

#### `GET /api/w/{slug}/threads/{threadId}`

Get a thread with all messages.

**Response:**

```json
{
  "id": "thread_abc123",
  "title": "Tax Questions",
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "What are the deadlines?",
      "createdAt": "2026-05-20T14:30:00Z"
    },
    {
      "id": "msg_2",
      "role": "assistant",
      "content": "The tax filing deadline is...",
      "sources": [...],
      "createdAt": "2026-05-20T14:30:05Z"
    }
  ]
}
```

---

### Admin Workspace API

These endpoints require an authenticated admin/superuser session.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/workspaces` | List all workspaces |
| POST | `/api/admin/workspaces` | Create workspace |
| GET | `/api/admin/workspaces/{id}` | Get workspace details |
| PATCH | `/api/admin/workspaces/{id}` | Update workspace |
| DELETE | `/api/admin/workspaces/{id}` | Delete workspace |
| GET | `/api/admin/workspaces/{id}/analytics?days=30` | Usage analytics |
| GET | `/api/admin/workspaces/{id}/script` | Get embed scripts / standalone URL |
| GET | `/api/admin/workspaces/{id}/users` | List explicit users |
| POST | `/api/admin/workspaces/{id}/users` | Add single or bulk users |
| DELETE | `/api/admin/workspaces/{id}/users/{userId}` | Remove user |
| GET | `/api/admin/workspaces/{id}/whatsapp` | Get WhatsApp config |
| PUT | `/api/admin/workspaces/{id}/whatsapp` | Create/update WhatsApp channel |
| DELETE | `/api/admin/workspaces/{id}/whatsapp` | Delete WhatsApp channel |

---

## 5. Integrating in an External Portal or System

### Integration Patterns

#### Pattern 1: Script Tag Embed (Floating Widget)

The simplest integration — adds a floating chat button to any website.

```html
<script
  src="https://your-domain.com/embed/workspace.js"
  data-workspace-id="a1b2c3d4e5f67890"
  data-api-base="https://your-domain.com"
  data-position="bottom-right"
  data-offset-x="20"
  data-offset-y="20"
  async
></script>
```

**Behavior:**
- Loads the embed bundle asynchronously
- Creates a floating button in the specified corner
- Opens an expandable chat window on click
- Persists `visitorId` in `localStorage` across page navigations

---

#### Pattern 2: Iframe Embed

For controlled placement within a page layout:

```html
<iframe
  src="https://your-domain.com/e/a1b2c3d4e5f67890"
  width="400"
  height="600"
  allow="microphone"
  style="border: 1px solid #ddd; border-radius: 8px;"
></iframe>
```

**Pros:** Full control over size and position; isolated CSS.  
**Cons:** No automatic visitor ID persistence (uses session cookie instead).

---

#### Pattern 3: Manual JavaScript Initialization

For dynamic single-page applications:

```javascript
window.AIAssistantEmbed({
  workspaceId: 'a1b2c3d4e5f67890',
  apiBaseUrl: 'https://your-domain.com',
  position: 'bottom-right',
  offsetX: 20,
  offsetY: 20,
  onOpen: () => console.log('Chat opened'),
  onMessage: (msg) => console.log('User sent:', msg),
});
```

---

#### Pattern 4: Standalone Portal Link

For internal users who need the full chat experience:

```markdown
[Open Health AI Assistant](https://your-domain.com/moh-portal-2026)
```

Users log in via SSO (Azure AD/Google) and are granted access based on their category subscriptions.

---

### Embed Widget Architecture

```
External Website
      │
      │ loads script tag
      ▼
┌─────────────────────────────┐
│   embed/workspace.js        │
│   (self-contained React)    │
│                             │
│   ┌─────────────────────┐   │
│   │  Floating Button    │   │
│   └─────────────────────┘   │
│              │              │
│              ▼              │
│   ┌─────────────────────┐   │
│   │  Expandable Window  │   │
│   │  • Header (logo)    │   │
│   │  • Messages         │   │
│   │  • Input + voice    │   │
│   │  • Suggested prompts│   │
│   └─────────────────────┘   │
└─────────────────────────────┘
              │
              │ POST /api/w/{slug}/init
              │ POST /api/w/{slug}/chat/stream (SSE)
              ▼
        AI Assistant Backend
```

**Key characteristics:**
- React is **bundled internally** — no conflicts with the host page's React version
- CSS is **injected into the bundle** — no external stylesheet dependencies
- Simple markdown rendering (`**bold**`, `*italic*`, `` `code` ``) — not full ReactMarkdown
- Built with esbuild targeting `es2020`

---

### WhatsApp Integration Setup

**Prerequisites:**
- Meta Business account
- WhatsApp Business API access
- Valid SSL certificate on your domain (Meta requires HTTPS webhooks)

**Steps:**

1. **Create a standalone workspace** and link it to the desired categories
2. **Go to Admin → Workspaces → [Your Workspace] → WhatsApp**
3. **Enter credentials:**
   - **Phone Number ID** — from Meta Business Manager
   - **Verify Token** — any random string you choose
   - **App Secret** — from Meta app settings (encrypted at rest)
   - **Access Token** — from Meta app settings (encrypted at rest)
4. **Save** — the system validates and encrypts credentials
5. **Configure Meta webhook:**
   - Callback URL: `https://your-domain.com/api/w/{slug}/channels/whatsapp/webhook`
   - Verify Token: the same token you entered above
   - Subscribe to: `messages`
6. **Test** by messaging the WhatsApp number

**Security:**
- Webhook signatures are verified with HMAC-SHA256
- Duplicate messages (same `meta_message_id`) are skipped
- Credentials are encrypted with the system encryption key

---

## 6. Known Error Codes

### HTTP Status Codes

| Status | Meaning | When Used |
|--------|---------|-----------|
| 200 | OK | Successful read/write |
| 201 | Created | New thread/session created |
| 400 | Bad Request | Validation failed |
| 401 | Unauthorized | Missing or invalid session (standalone with auth) |
| 403 | Forbidden | Domain not in allowlist; user lacks category access |
| 404 | Not Found | Workspace slug invalid or disabled |
| 413 | Payload Too Large | File exceeds `max_file_size_mb` |
| 429 | Rate Limit Exceeded | Daily/session limit reached |
| 500 | Internal Server Error | Processing failed |

### Workspace-Specific Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Workspace disabled` | Workspace `is_enabled = false` | Enable in Admin → Workspaces |
| `Domain not allowed` | `Origin` header not in `allowed_domains` | Add domain to workspace settings |
| `Rate limit exceeded` | IP hit daily or session limit | Wait for next day, or increase limits |
| `Category access denied` | User not subscribed to all linked categories | Subscribe user, or switch to explicit user list |
| `File type not allowed` | Uploaded file MIME type not in allowlist | Check allowed types in workspace settings |
| `WhatsApp signature invalid` | Webhook HMAC verification failed | Check App Secret matches Meta configuration |
| `WhatsApp message duplicate` | Same `meta_message_id` received twice | Normal — system auto-deduplicates |

---

## 7. Known Issues and Fixes

### Embed Widget Markdown is Limited

**Status:** By design — bundle size optimization  
**Affected:** External embed widget (`src/embed/components/EmbedMessage.tsx`)

#### Problem

The embed widget uses regex-based markdown rendering (`**bold**`, `*italic*`, `` `code` ``, line breaks). It does **not** support:
- Tables
- Code blocks
- Links (rendered as plain text)
- Lists (rendered as plain text)
- Mermaid diagrams

#### Workaround

- The **hosted embed page** (`/e/{slug}`) uses the full ReactMarkdown renderer — use an iframe instead of the script tag if rich formatting is critical
- Instruct the LLM to use simple formatting (paragraphs, bold, short sentences) for embed responses

---

### WhatsApp RAG is Minimal

**Status:** MVP limitation  
**Affected:** WhatsApp channel responses

#### Problem

The WhatsApp processor (`src/lib/workspace/channels/whatsapp/processor.ts`) uses a **simplified LLM call** (`callLLMForWhatsApp`) that does **not** use the full RAG retrieval pipeline. Sources, uploaded documents, and advanced tool calling are not used in WhatsApp responses.

The code comment explicitly states: *"For MVP, use a simple LLM call without full RAG. This can be enhanced later."*

#### Workaround

- Use WhatsApp for simple Q&A and FAQ-style responses
- For complex document-grounded queries, direct users to the web chat interface
- Future enhancement: wire the WhatsApp processor to use `performRAGRetrieval()` + `generateResponseWithTools()`

---

### No Memory / Summary Context for Workspaces

**Status:** By design  
**Affected:** Both standalone and embed modes

#### Problem

Unlike the main AI Assistant chat, workspaces explicitly pass **empty strings** for memory context and summary context. This means:
- No personalized memory recall across sessions
- No thread summarization for long conversations

#### Workaround

- Use the main AI Assistant chat (`/chat`) if personalized memory is critical
- For workspaces, rely on RAG retrieval from documents and conversation history (last 10–20 messages)

---

### Sources Hard-Capped at 3

**Status:** By design — UI constraint  
**Affected:** All workspace chat responses

#### Problem

`MAX_SOURCES_DISPLAYED = 3` caps the number of unique source documents shown to the user, even if RAG retrieves more chunks from more documents.

#### Impact

Users may not see all relevant document citations. The LLM still receives all retrieved context in its prompt — only the UI display is limited.

#### Workaround

- If more sources are needed, use the main chat interface (which has a higher or configurable cap)
- Future enhancement: make `MAX_SOURCES_DISPLAYED` configurable per-workspace

---

### File Storage is Local Filesystem

**Status:** Infrastructure limitation  
**Affected:** Workspace file uploads

#### Problem

Uploaded files are saved to `data/workspace-uploads/{workspaceId}/{sessionId}/`. There is no S3 or cloud storage abstraction.

#### Impact

- Horizontal scaling requires shared storage (NFS, EFS) or sticky sessions
- Backups must include the `data/workspace-uploads/` directory

#### Workaround

- Mount a shared volume at `data/workspace-uploads/` in multi-instance deployments
- Include workspace uploads in backup scripts

---

### Rate Limit Cleanup is Probabilistic

**Status:** By design — performance optimization  
**Affected:** `workspace_rate_limits` table

#### Problem

Old rate limit records are only cleaned up with a **1% chance per request** (`maybeCleanupRateLimits(0.01)`). Over time, this table may accumulate stale records.

#### Workaround

- Periodically run `DELETE FROM workspace_rate_limits WHERE created_at < NOW() - INTERVAL '30 days'`
- Or add a cron job / scheduled task for cleanup

---

### Standalone Anonymous Sessions Expire in 7 Days

**Status:** By design  
**Affected:** Standalone workspaces with `auth_required = false`

#### Problem

Anonymous users (no login) get a 7-day session expiry. After expiry, their threads and history are orphaned.

#### Workaround

- Enable `auth_required` for persistent access
- Or implement a custom auth flow that creates workspace users automatically

---

## Quick Reference Card

```
┌────────────────────────────────────────────────────────────┐
│              WORKSPACE CHATBOT QUICK REF                    │
├────────────────────────────────────────────────────────────┤
│ CREATE                                                     │
│   Admin → Workspaces → New Workspace                      │
│   Choose: Standalone (full) or Embed (widget)             │
│                                                            │
│ CONFIGURE                                                  │
│   Categories → Branding → LLM Overrides → Features        │
│   Standonly: Access control (category-based or explicit)  │
│   Embed: Allowed domains + rate limits                    │
│                                                            │
│ DEPLOY STANDALONE                                          │
│   URL: https://your-domain.com/{slug}                     │
│   Users log in via SSO                                    │
│                                                            │
│ DEPLOY EMBED                                               │
│   Script: <script src=".../embed/workspace.js"            │
│            data-workspace-id="...">                       │
│   Iframe: <iframe src=".../e/{slug}">                    │
│                                                            │
│ API ENDPOINTS                                              │
│   POST /api/w/{slug}/init                                 │
│   POST /api/w/{slug}/chat/stream (SSE)                    │
│   POST /api/w/{slug}/upload                               │
│   GET  /api/w/{slug}/threads (standalone)                 │
│                                                            │
│ WHATSAPP (standalone only)                                 │
│   Admin → Workspaces → WhatsApp → Configure Meta creds    │
│   Webhook: /api/w/{slug}/channels/whatsapp/webhook        │
│                                                            │
│ WATCH FOR                                                  │
│   403 Domain not allowed → Check allowed_domains          │
│   429 Rate limit → Increase limits or wait                │
│   401 Access denied → Check category subscriptions        │
│   Embed markdown limited → Use iframe for rich formatting │
└────────────────────────────────────────────────────────────┘
```

---

*Last updated: May 2026*
