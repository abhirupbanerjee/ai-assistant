# Policy Bot API Reference

## Overview

Policy Bot provides a RESTful API for RAG-based document querying and management. All endpoints use JSON for request/response bodies unless otherwise specified (file uploads use `multipart/form-data`).

**Base URL**: `https://policybot.abhirup.app/api`
**Local Development**: `http://localhost:3000/api`
**Current Version**: v1 (implicit in all endpoints)

---

## HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful read/update operations |
| 201 | Created | Resource successfully created |
| 202 | Accepted | Async operation started (document processing) |
| 400 | Bad Request | Validation failed or malformed request |
| 401 | Unauthorized | Authentication required or session expired |
| 403 | Forbidden | Insufficient permissions for requested action |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource or state conflict |
| 413 | Payload Too Large | File/content size exceeded |
| 500 | Internal Server Error | Server-side processing error |

---

## Authentication

All endpoints except `/api/auth/*` and `/api/branding` require authentication via NextAuth session cookies.

### Authentication Flow

```
    User
     |
     v
+---------------+     +-------------------+
|  Login Page   |---->| OAuth Provider    |
| /auth/signin  |     | (Azure AD/Google) |
+---------------+     +-------------------+
                              |
                              v
                      +---------------+
                      | Callback URL  |
                      | /api/auth/    |
                      | callback/*    |
                      +---------------+
                              |
                              v
                      +---------------+
                      | Session Cookie|
                      | Set in Browser|
                      +---------------+
                              |
                              v
+---------------+     +---------------+
| API Request   |---->| Middleware    |
| with Cookie   |     | Validates     |
+---------------+     +---------------+
                              |
                              v
                      +---------------+
                      | Protected     |
                      | Resource      |
                      +---------------+
```

### Access Control Modes

| Mode | Environment Variable | Description |
|------|---------------------|-------------|
| `allowlist` | `ACCESS_MODE=allowlist` | Only pre-approved users can sign in (default) |
| `domain` | `ACCESS_MODE=domain` | Any user from allowed email domains can sign in |

### User Roles

| Role | Access Level |
|------|--------------|
| `admin` | Full system access: manage categories, users, documents, settings |
| `superuser` | Manage documents and user subscriptions for assigned categories |
| `user` | Query documents in subscribed categories, manage own threads |

### Development Auth Bypass

When `AUTH_DISABLED=true` in environment:
- All routes are accessible without authentication
- A mock user `dev@localhost` is used for all requests

---

## Quick Reference

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| POST | `/api/chat` | Yes | Any | Send message and get RAG response |
| POST | `/api/chat/stream` | Yes | Any | Send message and get streaming RAG response |
| POST | `/api/transcribe` | Yes | Any | Convert audio to text |
| GET | `/api/threads` | Yes | Any | List user's threads |
| POST | `/api/threads` | Yes | Any | Create new thread |
| GET | `/api/threads/{id}` | Yes | Owner | Get thread with messages |
| PATCH | `/api/threads/{id}` | Yes | Owner | Update thread |
| DELETE | `/api/threads/{id}` | Yes | Owner | Delete thread |
| POST | `/api/threads/{id}/upload` | Yes | Owner | Upload file to thread |
| DELETE | `/api/threads/{id}/upload` | Yes | Owner | Delete uploaded file |
| GET | `/api/user/categories` | Yes | Any | Get accessible categories |
| GET | `/api/user/subscriptions` | Yes | Any | Get user's subscriptions |
| GET | `/api/branding` | No | - | Get branding settings |
| GET | `/api/admin/categories` | Yes | Admin | List all categories |
| POST | `/api/admin/categories` | Yes | Admin | Create category |
| GET | `/api/admin/categories/{id}` | Yes | Admin | Get category details |
| PUT | `/api/admin/categories/{id}` | Yes | Admin | Update category |
| DELETE | `/api/admin/categories/{id}` | Yes | Admin | Delete category |
| GET | `/api/admin/documents` | Yes | Admin | List all documents |
| POST | `/api/admin/documents` | Yes | Admin | Upload document |
| POST | `/api/admin/documents/text` | Yes | Admin | Upload text content |
| GET | `/api/admin/documents/{id}` | Yes | Admin | Get document details |
| PATCH | `/api/admin/documents/{id}` | Yes | Admin | Update document |
| DELETE | `/api/admin/documents/{id}` | Yes | Admin | Delete document |
| POST | `/api/admin/documents/{id}/reindex` | Yes | Admin | Reindex document |
| GET | `/api/admin/users` | Yes | Admin | List all users |
| POST | `/api/admin/users` | Yes | Admin | Add user |
| PATCH | `/api/admin/users` | Yes | Admin | Update user role |
| DELETE | `/api/admin/users` | Yes | Admin | Remove user |
| GET | `/api/admin/settings` | Yes | Admin | Get all settings |
| PATCH | `/api/admin/settings` | Yes | Admin | Update settings |
| GET | `/api/admin/stats` | Yes | Admin | Get system statistics |
| GET | `/api/admin/providers` | Yes | Admin | Check provider status |
| POST | `/api/admin/refresh` | Yes | Admin | Reindex all documents |
| GET | `/api/admin/system-prompt` | Yes | Admin | Get system prompt |
| PUT | `/api/admin/system-prompt` | Yes | Admin | Update system prompt |
| GET | `/api/admin/reranker-status` | Yes | Admin | Check reranker status |
| GET | `/api/superuser/documents` | Yes | Superuser | List assigned documents |
| POST | `/api/superuser/documents` | Yes | Superuser | Upload to category |
| POST | `/api/superuser/documents/text` | Yes | Superuser | Upload text to category |
| DELETE | `/api/superuser/documents/{id}` | Yes | Superuser | Delete own document |
| GET | `/api/superuser/users` | Yes | Superuser | List category users |
| POST | `/api/superuser/users` | Yes | Superuser | Add subscription |
| DELETE | `/api/superuser/users` | Yes | Superuser | Remove subscription |
| GET | `/api/admin/tools` | Yes | Admin | List all tools |
| POST | `/api/admin/tools` | Yes | Admin | Initialize tools to defaults |
| GET | `/api/admin/tools/{name}` | Yes | Admin | Get tool config |
| PATCH | `/api/admin/tools/{name}` | Yes | Admin | Update tool config |
| POST | `/api/admin/tools/{name}/test` | Yes | Admin | Test tool connectivity |
| GET | `/api/admin/skills` | Yes | Admin | List all skills |
| POST | `/api/admin/skills` | Yes | Admin | Create skill |
| PUT | `/api/admin/skills/{id}` | Yes | Admin | Update skill |
| DELETE | `/api/admin/skills/{id}` | Yes | Admin | Delete skill |
| DELETE | `/api/admin/skills` | Yes | Admin | Reset core skills |
| GET | `/api/admin/skills/preview` | Yes | Admin | Preview skill activation |
| PATCH | `/api/admin/skills/settings` | Yes | Admin | Update skills settings |
| GET | `/api/categories/{id}/prompt` | Yes | Admin/Superuser | Get category prompt |
| PUT | `/api/categories/{id}/prompt` | Yes | Admin/Superuser | Update category prompt |
| DELETE | `/api/categories/{id}/prompt` | Yes | Admin/Superuser | Reset category prompt |
| GET | `/api/superuser/tools` | Yes | Superuser | List tools with overrides |
| POST | `/api/superuser/tools/{name}` | Yes | Superuser | Set category tool override |
| GET | `/api/admin/data-sources` | Yes | Admin | List all data sources |
| POST | `/api/admin/data-sources` | Yes | Admin | Create API data source |
| GET | `/api/admin/data-sources/{id}` | Yes | Admin | Get data source details |
| PUT | `/api/admin/data-sources/{id}` | Yes | Admin | Update data source |
| DELETE | `/api/admin/data-sources/{id}` | Yes | Admin | Delete data source |
| POST | `/api/admin/data-sources/{id}/test` | Yes | Admin | Test data source connectivity |
| POST | `/api/admin/data-sources/upload-csv` | Yes | Admin | Upload CSV data source |
| POST | `/api/admin/data-sources/parse-openapi` | Yes | Admin | Parse OpenAPI spec |
| GET | `/api/admin/function-apis` | Yes | Admin | List all Function APIs |
| POST | `/api/admin/function-apis` | Yes | Admin | Create Function API |
| GET | `/api/admin/function-apis/{id}` | Yes | Admin | Get Function API details |
| PUT | `/api/admin/function-apis/{id}` | Yes | Admin | Update Function API |
| DELETE | `/api/admin/function-apis/{id}` | Yes | Admin | Delete Function API |
| POST | `/api/admin/function-apis/{id}/test` | Yes | Admin | Test Function API |
| GET | `/api/admin/tool-routing` | Yes | Admin | List all routing rules |
| POST | `/api/admin/tool-routing` | Yes | Admin | Create routing rule |
| GET | `/api/admin/tool-routing/{id}` | Yes | Admin | Get routing rule by ID |
| PATCH | `/api/admin/tool-routing/{id}` | Yes | Admin | Update routing rule |
| DELETE | `/api/admin/tool-routing/{id}` | Yes | Admin | Delete routing rule |
| POST | `/api/admin/tool-routing/test` | Yes | Admin | Test routing with message |
| POST | `/api/threads/{id}/share` | Yes | Owner | Create share link for thread |
| DELETE | `/api/threads/{id}/share` | Yes | Owner | Revoke share link |
| GET | `/api/shared/{token}` | No | - | Access shared thread (public) |
| GET | `/api/shared/{token}/download/{type}/{id}` | No | - | Download shared attachment |
| GET | `/api/shares/{shareId}` | Yes | Owner | Get share details |
| DELETE | `/api/shares/{shareId}` | Yes | Owner | Revoke specific share |
| GET | `/api/chat/export` | Yes | Any | Export thread as PDF/DOCX |
| POST | `/api/admin/documents/url` | Yes | Admin | Ingest document from URL |
| POST | `/api/superuser/documents/url` | Yes | Superuser | Ingest document from URL |
| GET | `/api/documents/{id}/download` | Yes | Any | Download document file |
| GET | `/api/user/memory` | Yes | Any | Get user's extracted memories |
| DELETE | `/api/user/memory` | Yes | Any | Clear user memories |
| GET | `/api/admin/memory/stats` | Yes | Admin | Get memory extraction stats |
| GET | `/api/admin/summarization/stats` | Yes | Admin | Get summarization stats |
| GET | `/api/admin/backup` | Yes | Admin | Download system backup |
| POST | `/api/admin/backup/restore` | Yes | Admin | Restore from backup |
| GET | `/api/superuser/backup` | Yes | Superuser | Download category backup |
| GET | `/api/admin/cache` | Yes | Admin | Get cache statistics |
| DELETE | `/api/admin/cache` | Yes | Admin | Clear cache |
| GET | `/api/tools/status` | Yes | Any | Check tool availability status |
| GET | `/api/admin/settings/superuser` | Yes | Admin | Get superuser settings |
| PATCH | `/api/admin/settings/superuser` | Yes | Admin | Update superuser settings |
| GET | `/api/admin/tools/dependencies` | Yes | Admin | Get tool dependencies |
| PATCH | `/api/admin/tools/dependencies` | Yes | Admin | Update tool dependencies |
| GET | `/api/admin/rag-testing/results` | Yes | Admin | Get RAG test results |
| POST | `/api/admin/rag-testing/run` | Yes | Admin | Run RAG test queries |
| GET | `/api/admin/tools/task-planner/templates` | Yes | Admin | List task planner templates |
| POST | `/api/admin/tools/task-planner/templates` | Yes | Admin | Create task planner template |
| GET | `/api/admin/tools/task-planner/templates/{key}` | Yes | Admin | Get template by key |
| PUT | `/api/admin/tools/task-planner/templates/{key}` | Yes | Admin | Update template |
| DELETE | `/api/admin/tools/task-planner/templates/{key}` | Yes | Admin | Delete template |
| POST | `/api/admin/branding/icon` | Yes | Admin | Upload custom bot icon |
| GET | `/api/threads/{id}/summary` | Yes | Owner | Get thread summary |
| GET | `/api/threads/{id}/archived` | Yes | Owner | Get archived messages |
| POST | `/api/w/{slug}/init` | No | - | Initialize workspace session |
| POST | `/api/w/{slug}/chat/stream` | No | - | Streaming chat for workspace |
| GET | `/api/w/{slug}/threads` | No | - | List workspace threads (standalone) |
| POST | `/api/w/{slug}/threads` | No | - | Create workspace thread (standalone) |
| GET | `/api/w/{slug}/threads/{threadId}` | No | - | Get workspace thread with messages |
| PATCH | `/api/w/{slug}/threads/{threadId}` | No | - | Update workspace thread |
| DELETE | `/api/w/{slug}/threads/{threadId}` | No | - | Delete workspace thread |
| POST | `/api/w/{slug}/upload` | No | - | Upload file to workspace session |
| GET | `/api/admin/workspaces` | Yes | Admin | List all workspaces |
| POST | `/api/admin/workspaces` | Yes | Admin | Create workspace |
| GET | `/api/admin/workspaces/{id}` | Yes | Admin | Get workspace details |
| PATCH | `/api/admin/workspaces/{id}` | Yes | Admin | Update workspace |
| DELETE | `/api/admin/workspaces/{id}` | Yes | Admin | Delete workspace |
| GET | `/api/admin/workspaces/{id}/users` | Yes | Admin | List workspace users |
| POST | `/api/admin/workspaces/{id}/users` | Yes | Admin | Add user to workspace |
| DELETE | `/api/admin/workspaces/{id}/users/{userId}` | Yes | Admin | Remove workspace user |
| GET | `/api/admin/workspaces/{id}/analytics` | Yes | Admin | Get workspace analytics |
| GET | `/api/admin/workspaces/{id}/script` | Yes | Admin | Get embed script |
| GET | `/api/admin/settings/workspaces` | Yes | Admin | Get workspace global settings |
| PATCH | `/api/admin/settings/workspaces` | Yes | Admin | Update workspace global settings |
| GET | `/api/superuser/workspaces` | Yes | Superuser | List superuser's workspaces |
| POST | `/api/superuser/workspaces` | Yes | Superuser | Create workspace (scoped) |
| GET | `/api/superuser/workspaces/{id}` | Yes | Superuser | Get workspace details |
| PATCH | `/api/superuser/workspaces/{id}` | Yes | Superuser | Update workspace |
| DELETE | `/api/superuser/workspaces/{id}` | Yes | Superuser | Delete workspace |
| GET | `/api/superuser/workspaces/{id}/users` | Yes | Superuser | List workspace users |
| POST | `/api/superuser/workspaces/{id}/users` | Yes | Superuser | Add user to workspace |
| DELETE | `/api/superuser/workspaces/{id}/users/{userId}` | Yes | Superuser | Remove workspace user |

---

## Common Schemas

### Thread

```typescript
interface Thread {
  id: string;
  title: string;
  createdAt: string;      // ISO 8601
  updatedAt: string;      // ISO 8601
  uploadCount: number;
  categoryIds: number[];
}

interface ThreadWithMessages extends Thread {
  messages: Message[];
  uploads: string[];      // Uploaded filenames
}
```

### Message

```typescript
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  attachments?: string[];
  timestamp: string;      // ISO 8601
}
```

### Source

```typescript
interface Source {
  documentName: string;
  pageNumber: number;
  chunkText: string;
  score: number;
  isWeb?: boolean;        // True if from Tavily web search
}
```

### Document

```typescript
interface Document {
  id: number;
  filename: string;
  size: number;           // Bytes
  chunkCount: number;
  uploadedAt: string;     // ISO 8601
  uploadedBy: string;     // Email
  status: "processing" | "ready" | "error";
  errorMessage?: string;
  isGlobal: boolean;
  categories: CategoryAssignment[];
}

interface CategoryAssignment {
  categoryId: number;
  categoryName: string;
}
```

### Category

```typescript
interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  createdBy: string;
  createdAt: string;      // ISO 8601
  documentCount: number;
  superUserCount: number;
  subscriberCount: number;
}
```

### User

```typescript
interface User {
  email: string;
  name?: string;
  role: "admin" | "superuser" | "user";
  addedAt: string;        // ISO 8601
  addedBy: string;        // Email of admin who added
  subscriptions?: Subscription[];       // For regular users
  assignedCategories?: CategoryRef[];   // For superusers
}

interface Subscription {
  categoryId: number;
  categoryName: string;
  isActive: boolean;
}

interface CategoryRef {
  categoryId: number;
  categoryName: string;
}
```

### Workspace

```typescript
interface Workspace {
  id: string;
  slug: string;                    // 16-char URL path
  name: string;
  type: "embed" | "standalone";
  is_enabled: boolean;
  access_mode: "category" | "explicit";
  // Branding
  primary_color: string;
  logo_url?: string;
  chat_title?: string;
  greeting_message: string;
  suggested_prompts?: string[];
  footer_text?: string;
  // LLM overrides
  llm_provider?: string;
  llm_model?: string;
  temperature?: number;
  system_prompt?: string;
  // Embed-specific
  allowed_domains: string[];
  daily_limit: number;
  session_limit: number;
  // Features
  voice_enabled: boolean;
  file_upload_enabled: boolean;
  max_file_size_mb: number;
  // Meta
  category_ids: number[];
  created_by: string;
  created_by_role: "admin" | "superuser";
  created_at: string;              // ISO 8601
  updated_at: string;              // ISO 8601
}

interface WorkspaceSession {
  id: string;
  workspace_id: string;
  visitor_id?: string;
  user_id?: string;
  message_count: number;
  started_at: string;
  last_activity: string;
  expires_at?: string;
}

interface WorkspaceThread {
  id: string;
  workspace_id: string;
  session_id: string;
  title: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

interface WorkspaceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  created_at: string;
}
```

### ApiError

```typescript
interface ApiError {
  error: string;          // Human-readable message
  code?: ErrorCode;       // Machine-readable code
  details?: string;       // Additional context
}

type ErrorCode =
  | "AUTH_REQUIRED"
  | "ADMIN_REQUIRED"
  | "SUPERUSER_REQUIRED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FILE_TOO_LARGE"
  | "UPLOAD_LIMIT"
  | "INVALID_FILE_TYPE"
  | "DUPLICATE"
  | "SERVICE_ERROR";
```

---

## Endpoints

### 1. Authentication

#### `GET/POST /api/auth/*`

NextAuth.js handles all authentication routes.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/signin` | GET | Sign-in page |
| `/api/auth/signout` | POST | Sign out user |
| `/api/auth/session` | GET | Get current session |
| `/api/auth/callback/azure-ad` | GET | Azure AD OAuth callback |
| `/api/auth/callback/google` | GET | Google OAuth callback |

---

### 2. Chat

#### `POST /api/chat`

Send a message and receive a RAG-powered response with document sources.

**Authentication**: Required
**Role**: Any authenticated user

**Headers**:

| Header | Value | Required |
|--------|-------|----------|
| Content-Type | application/json | Yes |
| Cookie | next-auth.session-token=... | Yes |

**Request Body**:

```typescript
{
  message: string;    // User's question (required)
  threadId: string;   // Thread ID (required)
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "message": "What is the annual leave policy?",
    "threadId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Response** `200 OK`:

```typescript
{
  message: {
    id: string;
    role: "assistant";
    content: string;
    sources: Source[];
    timestamp: string;  // ISO 8601
  };
  threadId: string;
}
```

**Example Response**:

```json
{
  "message": {
    "id": "msg_abc123",
    "role": "assistant",
    "content": "According to the HR Handbook, employees are entitled to 20 days of annual leave per year...",
    "sources": [
      {
        "documentName": "HR_Handbook_2024.pdf",
        "pageNumber": 12,
        "chunkText": "Annual leave entitlement is 20 working days...",
        "score": 0.89
      }
    ],
    "timestamp": "2025-12-06T10:30:00Z"
  },
  "threadId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Message is required" | VALIDATION_ERROR | Include message in request body |
| 400 | "Thread ID is required" | VALIDATION_ERROR | Include threadId in request body |
| 401 | "Unauthorized" | AUTH_REQUIRED | Sign in again |
| 404 | "Thread not found" | NOT_FOUND | Verify thread exists and belongs to you |
| 500 | "Failed to process message" | SERVICE_ERROR | Contact administrator |

**Notes**:
- Web search via Tavily auto-triggers if RAG returns insufficient context
- Sources are limited to top relevant chunks based on system settings
- Thread categories determine which document collections are searched

---

### 3. Transcription

#### `POST /api/transcribe`

Convert audio to text using OpenAI Whisper.

**Authentication**: Required
**Role**: Any authenticated user

**Request**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio` | File | Yes | Audio file (webm, mp3, wav, m4a) |

**Constraints**:
- Max file size: 25MB

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/transcribe \
  -H "Cookie: next-auth.session-token=abc123..." \
  -F "audio=@recording.webm"
```

**Response** `200 OK`:

```typescript
{
  text: string;      // Transcribed text
  duration: number;  // Audio duration in seconds
}
```

**Example Response**:

```json
{
  "text": "What is the policy for remote work?",
  "duration": 3.5
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "No audio file provided" | VALIDATION_ERROR | Include audio file in form data |
| 400 | "Invalid audio format" | INVALID_FILE_TYPE | Use webm, mp3, wav, or m4a |
| 401 | "Unauthorized" | AUTH_REQUIRED | Sign in again |
| 413 | "File too large" | FILE_TOO_LARGE | Keep audio under 25MB |
| 500 | "Transcription failed" | SERVICE_ERROR | Check OpenAI API status |

---

### 4. Threads

#### `GET /api/threads`

List all threads for the current user.

**Authentication**: Required
**Role**: Any authenticated user

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max threads to return (1-100) |
| `offset` | number | 0 | Pagination offset |

**Example Request**:

```bash
curl -X GET "https://policybot.abhirup.app/api/threads?limit=20&offset=0" \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  threads: Thread[];
  total: number;
}
```

**Example Response**:

```json
{
  "threads": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Leave Policy Questions",
      "createdAt": "2025-12-01T09:00:00Z",
      "updatedAt": "2025-12-06T10:30:00Z",
      "uploadCount": 1,
      "categoryIds": [1, 3]
    }
  ],
  "total": 15
}
```

---

#### `POST /api/threads`

Create a new thread.

**Authentication**: Required
**Role**: Any authenticated user

**Request Body**:

```typescript
{
  title?: string;         // Optional, defaults to "New Thread"
  categoryIds?: number[]; // Optional, categories to assign
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/threads \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "title": "HR Policy Questions",
    "categoryIds": [1]
  }'
```

**Response** `201 Created`:

```typescript
{
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  uploadCount: number;
  categoryIds: number[];
}
```

---

#### `GET /api/threads/{threadId}`

Get a specific thread with all messages.

**Authentication**: Required (must own thread)
**Role**: Thread owner

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/threads/550e8400-e29b-41d4-a716-446655440000 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  uploadCount: number;
  categoryIds: number[];
  messages: Message[];
  uploads: string[];  // List of uploaded filenames
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 401 | "Unauthorized" | AUTH_REQUIRED | Sign in again |
| 404 | "Thread not found" | NOT_FOUND | Verify thread ID is correct |

---

#### `PATCH /api/threads/{threadId}`

Update thread metadata (title or categories).

**Authentication**: Required (must own thread)
**Role**: Thread owner

**Request Body**:

```typescript
{
  title?: string;         // New title (max 100 characters)
  categoryIds?: number[]; // New category selection
}
```

**Example Request**:

```bash
curl -X PATCH https://policybot.abhirup.app/api/threads/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "title": "Updated Title",
    "categoryIds": [1, 2]
  }'
```

**Response** `200 OK`:

```typescript
{
  id: string;
  title: string;
  categoryIds: number[];
  updatedAt: string;
}
```

---

#### `DELETE /api/threads/{threadId}`

Delete a thread and all associated data (messages, uploads).

**Authentication**: Required (must own thread)
**Role**: Thread owner

**Example Request**:

```bash
curl -X DELETE https://policybot.abhirup.app/api/threads/550e8400-e29b-41d4-a716-446655440000 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: {
    threadId: string;
    messageCount: number;
    uploadCount: number;
  };
}
```

---

### 5. Thread Uploads

#### `POST /api/threads/{threadId}/upload`

Upload a PDF to a thread for compliance checking.

**Authentication**: Required (must own thread)
**Role**: Thread owner

**Request**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF file |

**Constraints**:
- Max 3 files per thread
- Max 5MB per file
- PDF format only

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/threads/550e8400-e29b-41d4-a716-446655440000/upload \
  -H "Cookie: next-auth.session-token=abc123..." \
  -F "file=@document.pdf"
```

**Response** `200 OK`:

```typescript
{
  filename: string;
  size: number;        // Bytes
  uploadCount: number; // Total uploads in thread
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "No file provided" | VALIDATION_ERROR | Include file in form data |
| 400 | "Only PDF files allowed" | INVALID_FILE_TYPE | Upload PDF format only |
| 413 | "File too large (max 5MB)" | FILE_TOO_LARGE | Reduce file size |
| 400 | "Maximum 3 files per thread" | UPLOAD_LIMIT | Delete existing files first |

---

#### `DELETE /api/threads/{threadId}/upload/{filename}`

Delete an uploaded file from a thread.

**Authentication**: Required (must own thread)
**Role**: Thread owner

**Example Request**:

```bash
curl -X DELETE https://policybot.abhirup.app/api/threads/550e8400-e29b-41d4-a716-446655440000/upload/document.pdf \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  filename: string;
  uploadCount: number;  // Remaining uploads
}
```

---

### 6. User Categories

#### `GET /api/user/categories`

Get categories available to the current user based on their role.

**Authentication**: Required
**Role**: Any authenticated user

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/user/categories \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  categories: Array<{
    id: number;
    name: string;
    slug: string;
    description?: string;
  }>;
}
```

**Role-Based Behavior**:

| Role | Categories Returned |
|------|---------------------|
| `admin` | All categories |
| `superuser` | Assigned categories only |
| `user` | Subscribed categories only |

---

#### `GET /api/user/subscriptions`

Get the current user's category subscriptions.

**Authentication**: Required
**Role**: Any authenticated user

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/user/subscriptions \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  subscriptions: Array<{
    categoryId: number;
    categoryName: string;
    categorySlug: string;
    isActive: boolean;
  }>;
}
```

---

### 7. Branding

#### `GET /api/branding`

Get branding settings. This is the only public endpoint (no authentication required).

**Authentication**: Not required

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/branding
```

**Response** `200 OK`:

```typescript
{
  botName: string;   // e.g., "Policy Bot"
  botIcon: string;   // Icon key
  availableIcons: Array<{
    key: string;
    label: string;
    lucideIcon: string;
  }>;
}
```

**Available Icon Keys**:
- `government` - Landmark icon
- `operations` - Settings icon
- `finance` - DollarSign icon
- `kpi` - BarChart3 icon
- `logs` - FileText icon
- `data` - Database icon
- `monitoring` - Activity icon
- `architecture` - Layers icon
- `internet` - Globe icon
- `systems` - Server icon
- `policy` - ScrollText icon (default)

---

### 8. Admin - Categories

#### `GET /api/admin/categories`

List all categories with statistics.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/categories \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  categories: Category[];
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 401 | "Unauthorized" | AUTH_REQUIRED | Sign in again |
| 403 | "Admin access required" | ADMIN_REQUIRED | Contact administrator |

---

#### `POST /api/admin/categories`

Create a new category.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  name: string;         // Required: unique category name
  description?: string; // Optional: category description
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/categories \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{"name": "Human Resources", "description": "HR policies and procedures"}'
```

**Response** `201 Created`:

```typescript
{
  category: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    createdBy: string;
    createdAt: string;
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Category name is required" | VALIDATION_ERROR | Include name in request |
| 409 | "Category \"X\" already exists" | DUPLICATE | Use a different name |

---

#### `GET /api/admin/categories/{id}`

Get category details with users and documents.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/categories/1 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  category: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    createdBy: string;
    createdAt: string;
  };
  superUsers: Array<{
    userId: number;
    email: string;
    name: string | null;
  }>;
  subscribers: Array<{
    userId: number;
    email: string;
    name: string | null;
    isActive: boolean;
  }>;
  documentCount: number;
}
```

---

#### `PUT /api/admin/categories/{id}`

Update a category.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  name?: string;        // New name (must be unique)
  description?: string; // New description
}
```

**Example Request**:

```bash
curl -X PUT https://policybot.abhirup.app/api/admin/categories/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{"name": "HR & Compliance", "description": "Updated description"}'
```

**Response** `200 OK`:

```typescript
{
  category: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
  };
}
```

---

#### `DELETE /api/admin/categories/{id}`

Delete a category. Documents in this category become unassigned.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X DELETE https://policybot.abhirup.app/api/admin/categories/1 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: {
    id: number;
    name: string;
    documentsUnassigned: number;
  };
}
```

---

### 9. Admin - Documents

#### `GET /api/admin/documents`

List all global policy documents.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/documents \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  documents: Document[];
  totalChunks: number;
}
```

---

#### `POST /api/admin/documents`

Upload a new policy document with category assignment.

**Authentication**: Required
**Role**: Admin only

**Request**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF file (max 50MB) |
| `categoryIds` | string | No | JSON array of category IDs |
| `isGlobal` | string | No | `"true"` to index in all categories |

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/documents \
  -H "Cookie: next-auth.session-token=abc123..." \
  -F "file=@HR_Handbook.pdf" \
  -F "categoryIds=[1,2]" \
  -F "isGlobal=false"
```

**Response** `202 Accepted`:

```typescript
{
  id: number;
  filename: string;
  size: number;
  status: "processing";
  isGlobal: boolean;
  categoryIds: number[];
  message: "Document is being processed";
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "No file provided" | VALIDATION_ERROR | Include file in form data |
| 400 | "Only PDF files allowed" | INVALID_FILE_TYPE | Upload PDF format only |
| 413 | "File too large (max 50MB)" | FILE_TOO_LARGE | Reduce file size |
| 409 | "Document already exists" | DUPLICATE | Use different filename |

**Notes**:
- Documents are processed asynchronously (chunking, embedding, indexing)
- Check document status via `GET /api/admin/documents/{id}`
- Processing time depends on document size

---

#### `POST /api/admin/documents/text`

Upload text content directly as a document (bypasses file upload and OCR extraction).

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  name: string;           // Required: document name (max 255 chars)
  content: string;        // Required: text content (min 10 chars, max 10MB)
  categoryIds?: number[]; // Optional: category IDs to assign
  isGlobal?: boolean;     // Optional: index in all categories
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/documents/text \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "name": "Company Policy Overview",
    "content": "This document outlines the company policies...",
    "categoryIds": [1, 2],
    "isGlobal": false
  }'
```

**Response** `202 Accepted`:

```typescript
{
  id: string;
  filename: string;      // Name with .txt extension
  size: number;          // Content size in bytes
  status: "processing";
  message: "Document is being processed";
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Document name is required" | VALIDATION_ERROR | Include name |
| 400 | "Content is required" | VALIDATION_ERROR | Include content |
| 400 | "Content must be at least 10 characters" | VALIDATION_ERROR | Add more content |
| 409 | "Document with this name already exists" | DUPLICATE | Use different name |
| 413 | "Content too large (max 10MB)" | FILE_TOO_LARGE | Reduce content size |

**Notes**:
- Content is saved as a `.txt` file in the knowledge base
- Bypasses OCR/document extraction (text is used directly)
- Ideal for pasting text content without creating a file first

---

#### `GET /api/admin/documents/{docId}`

Get details of a specific document.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/documents/1 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  id: number;
  filename: string;
  size: number;
  chunkCount: number;
  uploadedAt: string;
  uploadedBy: string;
  status: "processing" | "ready" | "error";
  errorMessage?: string;
  isGlobal: boolean;
  categories: CategoryAssignment[];
  chunks?: Array<{        // Only if status is "ready"
    id: string;
    pageNumber: number;
    preview: string;      // First 100 chars
  }>;
}
```

---

#### `PATCH /api/admin/documents/{docId}`

Update document category assignments.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  categoryIds?: number[];  // New category assignments
  isGlobal?: boolean;      // Set global flag
}
```

**Example Request**:

```bash
curl -X PATCH https://policybot.abhirup.app/api/admin/documents/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{"categoryIds": [1, 2, 3], "isGlobal": false}'
```

**Response** `200 OK`:

```typescript
{
  id: number;
  filename: string;
  isGlobal: boolean;
  categories: CategoryAssignment[];
}
```

---

#### `DELETE /api/admin/documents/{docId}`

Delete a policy document from the global store.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X DELETE https://policybot.abhirup.app/api/admin/documents/1 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: {
    id: number;
    filename: string;
    chunksRemoved: number;
  };
}
```

---

#### `POST /api/admin/documents/{docId}/reindex`

Reindex an existing document (re-extract and re-embed).

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/documents/1/reindex \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `202 Accepted`:

```typescript
{
  id: number;
  filename: string;
  status: "processing";
  message: "Document is being reindexed";
}
```

---

### 10. Admin - User Management

#### `GET /api/admin/users`

List all users with their subscriptions/assignments.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/users \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  users: User[];
}
```

---

#### `POST /api/admin/users`

Add a new user with optional subscriptions/assignments.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  email: string;                          // Required: user's email
  role: "admin" | "superuser" | "user";   // Required: user role
  name?: string;                          // Optional: display name
  subscriptions?: number[];               // For role="user": category IDs
  assignedCategories?: number[];          // For role="superuser": category IDs
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/users \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "email": "user@example.com",
    "role": "user",
    "name": "John Doe",
    "subscriptions": [1, 2]
  }'
```

**Response** `200 OK`:

```typescript
{
  user: {
    email: string;
    name?: string;
    role: string;
    addedAt: string;
    addedBy: string;
  };
  message: "User added successfully";
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Email is required" | VALIDATION_ERROR | Include email |
| 400 | "Role must be..." | VALIDATION_ERROR | Use valid role |
| 400 | "Category with ID X not found" | NOT_FOUND | Verify category IDs |

---

#### `PATCH /api/admin/users`

Update a user's role.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  email: string;                          // Required: user's email
  role: "admin" | "superuser" | "user";   // Required: new role
}
```

**Example Request**:

```bash
curl -X PATCH https://policybot.abhirup.app/api/admin/users \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{"email": "user@example.com", "role": "superuser"}'
```

**Response** `200 OK`:

```typescript
{
  message: "User role updated successfully";
}
```

---

#### `DELETE /api/admin/users`

Remove a user from the allowlist.

**Authentication**: Required
**Role**: Admin only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | Email of user to remove |

**Example Request**:

```bash
curl -X DELETE "https://policybot.abhirup.app/api/admin/users?email=user@example.com" \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  message: "User removed successfully";
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Cannot remove yourself" | VALIDATION_ERROR | Ask another admin |
| 404 | "User not found" | NOT_FOUND | Verify email address |

---

### 11. Admin - User Subscriptions

#### `GET /api/admin/users/{userId}/subscriptions`

Get a user's category subscriptions.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/users/1/subscriptions \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  user: {
    id: number;
    email: string;
    name: string | null;
    role: string;
  };
  subscriptions: Array<{
    categoryId: number;
    categoryName: string;
    categorySlug: string;
    isActive: boolean;
  }>;
}
```

---

#### `POST /api/admin/users/{userId}/subscriptions`

Add a subscription for a user.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  categoryId: number;  // Category ID to subscribe
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/users/1/subscriptions \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{"categoryId": 1}'
```

**Response** `201 Created`:

```typescript
{
  success: true;
  subscription: {
    userId: number;
    categoryId: number;
    categoryName: string;
    isActive: boolean;
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 404 | "User not found" | NOT_FOUND | Verify user ID |
| 404 | "Category not found" | NOT_FOUND | Verify category ID |
| 409 | "User is already subscribed" | DUPLICATE | User already has access |

---

#### `PUT /api/admin/users/{userId}/subscriptions`

Toggle subscription active status.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  categoryId: number;
  isActive: boolean;
}
```

**Example Request**:

```bash
curl -X PUT https://policybot.abhirup.app/api/admin/users/1/subscriptions \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{"categoryId": 1, "isActive": false}'
```

**Response** `200 OK`:

```typescript
{
  success: true;
  subscription: {
    userId: number;
    categoryId: number;
    isActive: boolean;
  };
}
```

---

#### `DELETE /api/admin/users/{userId}/subscriptions`

Remove a subscription from a user.

**Authentication**: Required
**Role**: Admin only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `categoryId` | number | Yes | Category ID to unsubscribe |

**Example Request**:

```bash
curl -X DELETE "https://policybot.abhirup.app/api/admin/users/1/subscriptions?categoryId=1" \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  removed: {
    userId: number;
    categoryId: number;
  };
}
```

---

### 12. Admin - Settings

#### `GET /api/admin/settings`

Get all configurable settings.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/settings \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  rag: {
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    cacheTTLSeconds: number;
    updatedAt?: string;
    updatedBy?: string;
  };
  llm: {
    model: string;
    temperature: number;
    maxTokens: number;
    updatedAt?: string;
    updatedBy?: string;
  };
  acronyms: {
    mappings: Record<string, string>;
  };
  tavily: {
    enabled: boolean;
    cacheTTLSeconds: number;
  };
  branding: {
    botName: string;
    botIcon: string;
  };
  embedding: {
    model: string;
    dimensions: number;
  };
  reranker: {
    enabled: boolean;
    provider: string;
    topKForReranking: number;
    minRerankerScore: number;
    cacheTTLSeconds: number;
  };
  uploadLimits: {
    maxFilesPerThread: number;
    maxFileSizeMB: number;
    allowedTypes: string[];
  };
  retentionSettings: {
    threadRetentionDays: number;
    storageAlertThreshold: number;
  };
  availableModels: string[];
  modelPresets: Array<{
    name: string;
    model: string;
    temperature: number;
    maxTokens: number;
  }>;
  brandingIcons: Array<{
    key: string;
    label: string;
  }>;
  defaults: Record<string, unknown>;
}
```

---

#### `PATCH /api/admin/settings`

Update settings by type.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  type: "rag" | "llm" | "acronyms" | "tavily" | "uploadLimits" |
        "retention" | "preset" | "branding" | "embedding" |
        "reranker" | "restoreAllDefaults";
  settings: {
    // Settings object varies by type
  };
}
```

**Example Request (Update LLM)**:

```bash
curl -X PATCH https://policybot.abhirup.app/api/admin/settings \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "type": "llm",
    "settings": {
      "model": "gpt-4o",
      "temperature": 0.7,
      "maxTokens": 4000
    }
  }'
```

**Response** `200 OK`:

```typescript
{
  success: true;
  settings: {
    // Updated settings
  };
}
```

**Supported Setting Types**:

| Type | Description | Key Settings |
|------|-------------|--------------|
| `rag` | RAG configuration | chunkSize, chunkOverlap, topK, cacheTTLSeconds |
| `llm` | LLM configuration | model, temperature, maxTokens |
| `acronyms` | Acronym mappings | mappings (key-value pairs) |
| `tavily` | Web search config | enabled, cacheTTLSeconds |
| `uploadLimits` | Upload constraints | maxFilesPerThread, maxFileSizeMB |
| `retention` | Data retention | threadRetentionDays, storageAlertThreshold |
| `preset` | Apply model preset | presetName |
| `branding` | Branding settings | botName, botIcon |
| `embedding` | Embedding config | model, dimensions |
| `reranker` | Reranker config | enabled, provider, topKForReranking |
| `restoreAllDefaults` | Reset all settings | (no settings required) |

---

### 13. Admin - System Prompt

#### `GET /api/admin/system-prompt`

Get the current system prompt with metadata.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/system-prompt \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  systemPrompt: string;
  updatedAt?: string;
  updatedBy?: string;
}
```

---

#### `PUT /api/admin/system-prompt`

Update the system prompt.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  systemPrompt: string;  // Min 10 characters
}
```

**Example Request**:

```bash
curl -X PUT https://policybot.abhirup.app/api/admin/system-prompt \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "systemPrompt": "You are a helpful policy assistant for government staff..."
  }'
```

**Response** `200 OK`:

```typescript
{
  success: true;
  systemPrompt: string;
  updatedAt: string;
  updatedBy: string;
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "System prompt must be at least 10 characters" | VALIDATION_ERROR | Add more content |

---

### 14. Admin - System Operations

#### `POST /api/admin/refresh`

Reindex all documents and clear cache.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/refresh \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `202 Accepted`:

```typescript
{
  success: true;
  message: "Reindex started";
  documentsQueued: number;
}
```

**Notes**:
- This operation can take significant time for large document collections
- Existing searches continue to work during reindexing
- Cache is cleared immediately

---

#### `GET /api/admin/stats`

Get system statistics for the admin dashboard.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/stats \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  database: {
    users: number;
    categories: number;
    documents: number;
    threads: number;
    messages: number;
  };
  chromadb: {
    collections: number;
    totalVectors: number;
  };
  storage: {
    totalBytes: number;
    documentsBytes: number;
    threadsBytes: number;
    percentUsed: number;
  };
  recentActivity: Array<{
    type: "user_added" | "document_uploaded" | "thread_created";
    description: string;
    timestamp: string;
  }>;
}
```

---

#### `GET /api/admin/providers`

Check the status and availability of configured LLM providers.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/providers \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  providers: {
    openai: {
      provider: "openai";
      available: boolean;
      configured: boolean;
      error?: string;
    };
    mistral: {
      provider: "mistral";
      available: boolean;
      configured: boolean;
      error?: string;
    };
    ollama: {
      provider: "ollama";
      available: boolean;
      configured: boolean;
      error?: string;
    };
    azure: {
      provider: "azure";
      available: boolean;
      configured: boolean;
      error?: string;
    };
  };
  services: {
    embedding: {
      name: string;
      model: string;
      provider: string;
      available: boolean;
      configured: boolean;
      error?: string;
    };
    ocr: {
      name: string;
      model: string;
      provider: string;
      available: boolean;
      configured: boolean;
      error?: string;
    };
    audio: {
      name: string;
      model: string;
      provider: string;
      available: boolean;
      configured: boolean;
      error?: string;
    };
  };
  usingProxy: boolean;
  proxyUrl: string | null;
}
```

**Provider Configuration**:

| Provider | Required Environment Variables |
|----------|--------------------------------|
| `openai` | `OPENAI_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `ollama` | `OLLAMA_API_BASE` |
| `azure` | `AZURE_API_KEY`, `AZURE_API_BASE` |

---

#### `GET /api/admin/reranker-status`

Check reranker availability (Cohere API and local transformers.js).

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/reranker-status \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  cohere: {
    available: boolean;
    configured: boolean;
    error?: string;
  };
  local: {
    available: boolean;
    model: string;
    error?: string;
  };
}
```

---

### 15. Super User - Document Management

Super users can upload and manage documents within their assigned categories.

#### `GET /api/superuser/documents`

Get documents in super user's assigned categories.

**Authentication**: Required
**Role**: Superuser only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/superuser/documents \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  assignedCategories: Array<{
    categoryId: number;
    categoryName: string;
    categorySlug: string;
  }>;
  documents: Array<{
    id: number;
    filename: string;
    size: number;
    status: "processing" | "ready" | "error";
    uploadedBy: string;
    uploadedAt: string;
    categories: CategoryAssignment[];
  }>;
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 401 | "Unauthorized" | AUTH_REQUIRED | Sign in again |
| 403 | "Super user access required" | SUPERUSER_REQUIRED | Contact administrator |

---

#### `POST /api/superuser/documents`

Upload a document to one of super user's assigned categories.

**Authentication**: Required
**Role**: Superuser only

**Request**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF file (max 50MB) |
| `categoryId` | string | Yes | Category ID (must be assigned) |

**Constraints**:
- Max 50MB per file
- PDF only
- Cannot set `isGlobal` flag (always false)
- Category must be assigned to the super user

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/superuser/documents \
  -H "Cookie: next-auth.session-token=abc123..." \
  -F "file=@HR_Policy.pdf" \
  -F "categoryId=1"
```

**Response** `202 Accepted`:

```typescript
{
  id: number;
  filename: string;
  size: number;
  status: "processing";
  message: "Document is being processed";
  category: {
    categoryId: number;
    categoryName: string;
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "No file provided" | VALIDATION_ERROR | Include file |
| 400 | "Category ID is required" | VALIDATION_ERROR | Include categoryId |
| 400 | "Only PDF files allowed" | INVALID_FILE_TYPE | Use PDF format |
| 403 | "You do not have access to upload to this category" | FORBIDDEN | Use assigned category |
| 404 | "Category not found" | NOT_FOUND | Verify category ID |
| 413 | "File too large (max 50MB)" | FILE_TOO_LARGE | Reduce file size |

---

#### `POST /api/superuser/documents/text`

Upload text content directly to one of super user's assigned categories.

**Authentication**: Required
**Role**: Superuser only

**Request Body**:

```typescript
{
  name: string;       // Required: document name (max 255 chars)
  content: string;    // Required: text content (min 10 chars, max 10MB)
  categoryId: number; // Required: category ID (must be assigned)
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/superuser/documents/text \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "name": "HR Policy Update",
    "content": "This document contains the latest HR policy updates...",
    "categoryId": 1
  }'
```

**Response** `202 Accepted`:

```typescript
{
  id: string;
  filename: string;
  size: number;
  status: "processing";
  message: "Document is being processed";
  category: {
    categoryId: number;
    categoryName: string;
  };
}
```

---

#### `DELETE /api/superuser/documents/{docId}`

Delete a document (only if uploaded by this super user).

**Authentication**: Required
**Role**: Superuser only

**Constraints**:
- Document must be in one of super user's assigned categories
- Document must have been uploaded by this super user

**Example Request**:

```bash
curl -X DELETE https://policybot.abhirup.app/api/superuser/documents/5 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: {
    id: number;
    filename: string;
    chunksRemoved: number;
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Invalid document ID" | VALIDATION_ERROR | Use numeric ID |
| 403 | "You do not have access to delete this document" | FORBIDDEN | Document not in your categories |
| 403 | "You can only delete documents you uploaded" | FORBIDDEN | Not the uploader |
| 404 | "Document not found" | NOT_FOUND | Verify document ID |

---

### 16. Admin - Tools Management

Tools extend the AI's capabilities beyond text generation (web search, document generation, etc.).

#### `GET /api/admin/tools`

List all tools with their configurations.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/tools \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  tools: Array<{
    name: string;
    displayName: string;
    description: string;
    category: 'autonomous' | 'processor';
    enabled: boolean;
    config: Record<string, unknown>;
    hasDefinition: boolean;
    updatedAt?: string;
    updatedBy?: string;
  }>;
}
```

---

#### `POST /api/admin/tools`

Initialize all tools to their default configurations.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  message: "All tools initialized";
  tools: string[];  // Tool names initialized
}
```

---

#### `GET /api/admin/tools/{toolName}`

Get specific tool configuration with audit history.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/tools/web_search \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  tool: {
    name: string;
    displayName: string;
    description: string;
    category: string;
    enabled: boolean;
    config: Record<string, unknown>;
    configSchema: Record<string, unknown>;
    defaultConfig: Record<string, unknown>;
  };
  auditHistory: Array<{
    operation: 'create' | 'update' | 'delete';
    oldConfig?: Record<string, unknown>;
    newConfig?: Record<string, unknown>;
    changedBy: string;
    changedAt: string;
  }>;
}
```

---

#### `PATCH /api/admin/tools/{toolName}`

Update tool configuration.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  enabled?: boolean;
  config?: Record<string, unknown>;
  reset?: boolean;  // Reset to defaults
}
```

**Example Request**:

```bash
curl -X PATCH https://policybot.abhirup.app/api/admin/tools/web_search \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "enabled": true,
    "config": {
      "maxResults": 10,
      "defaultSearchDepth": "advanced"
    }
  }'
```

**Response** `200 OK`:

```typescript
{
  tool: {
    name: string;
    enabled: boolean;
    config: Record<string, unknown>;
    updatedAt: string;
    updatedBy: string;
  };
}
```

---

#### `POST /api/admin/tools/{toolName}/test`

Test tool connectivity and configuration.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/tools/web_search/test \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  tool: string;
  success: boolean;
  message: string;
  latency?: number;  // For web_search
  testedAt: string;
  testedBy: string;
}
```

---

### 17. Admin - Skills Management

Skills are modular prompt components that can be dynamically injected into the system prompt.

#### `GET /api/admin/skills`

List all skills.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  skills: Array<{
    id: number;
    name: string;
    description: string | null;
    triggerType: 'always' | 'category' | 'keyword';
    triggerValue: string | null;
    categoryRestricted: boolean;
    isIndex: boolean;
    priority: number;
    isActive: boolean;
    isCore: boolean;
    tokenEstimate: number;
    categories: Array<{ id: number; name: string }>;
  }>;
  settings: {
    enabled: boolean;
    maxTotalTokens: number;
    debugMode: boolean;
  };
}
```

---

#### `POST /api/admin/skills`

Create a new custom skill.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  name: string;
  description?: string;
  promptContent: string;
  triggerType: 'always' | 'category' | 'keyword';
  triggerValue?: string;  // Keywords for keyword type
  categoryRestricted?: boolean;
  isIndex?: boolean;
  priority?: number;
  categoryIds?: number[];  // Link to categories
}
```

**Response** `201 Created`:

```typescript
{
  skill: {
    id: number;
    name: string;
    // ... full skill object
  };
}
```

---

#### `PUT /api/admin/skills/{skillId}`

Update a skill.

**Authentication**: Required
**Role**: Admin only

**Request Body**: Same as POST

**Response** `200 OK`:

```typescript
{
  skill: { /* updated skill */ };
}
```

---

#### `DELETE /api/admin/skills/{skillId}`

Delete a skill. Core skills cannot be deleted.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: { id: number; name: string };
}
```

**Error Response** `400`:

```typescript
{
  error: "Cannot delete core skill";
}
```

---

#### `DELETE /api/admin/skills`

Reset all core skills to their defaults.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  message: "Core skills restored to defaults";
  restoredCount: number;
}
```

---

#### `GET /api/admin/skills/preview`

Preview which skills would activate for a test message.

**Authentication**: Required
**Role**: Admin only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | Test message |
| `categoryIds` | string | No | Comma-separated category IDs |

**Response** `200 OK`:

```typescript
{
  activatedSkills: Array<{
    id: number;
    name: string;
    triggerType: string;
    triggerReason: string;  // Why it was activated
  }>;
  totalTokens: number;
  budgetRemaining: number;
}
```

---

#### `PATCH /api/admin/skills/settings`

Update skills system settings.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  enabled?: boolean;
  maxTotalTokens?: number;
  debugMode?: boolean;
}
```

**Response** `200 OK`:

```typescript
{
  settings: {
    enabled: boolean;
    maxTotalTokens: number;
    debugMode: boolean;
  };
}
```

---

### 18. Admin - Category Prompts

Category-specific prompt addendums and starter prompts.

#### `GET /api/categories/{id}/prompt`

Get category prompt configuration.

**Authentication**: Required
**Role**: Admin or Superuser (for assigned categories)

**Response** `200 OK`:

```typescript
{
  categoryId: number;
  promptAddendum: string;
  starterPrompts: Array<{
    label: string;
    prompt: string;
  }>;
  maxCharactersAvailable: number;
  updatedAt?: string;
  updatedBy?: string;
}
```

---

#### `PUT /api/categories/{id}/prompt`

Update category prompt configuration.

**Authentication**: Required
**Role**: Admin or Superuser (for assigned categories)

**Request Body**:

```typescript
{
  promptAddendum?: string;
  starterPrompts?: Array<{
    label: string;   // Max 30 chars
    prompt: string;  // Max 500 chars
  }>;
}
```

**Constraints**:
- Max 6 starter prompts per category
- Combined system prompt + addendum max 8,000 characters
- Forbidden phrases blocked for security

**Response** `200 OK`:

```typescript
{
  categoryId: number;
  promptAddendum: string;
  starterPrompts: Array<{ label: string; prompt: string }>;
  updatedAt: string;
  updatedBy: string;
}
```

---

#### `DELETE /api/categories/{id}/prompt`

Reset category prompt to global system prompt only.

**Authentication**: Required
**Role**: Admin or Superuser (for assigned categories)

**Response** `200 OK`:

```typescript
{
  success: true;
  categoryId: number;
}
```

---

### 19. Admin - Data Sources

Manage API and CSV data sources for structured data querying.

#### `GET /api/admin/data-sources`

List all data sources (APIs and CSVs).

**Authentication**: Required
**Role**: Admin only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | No | Filter by type: `api` or `csv` |
| `categoryId` | number | No | Filter by linked category |

**Response** `200 OK`:

```typescript
{
  apis: DataAPIConfig[];
  csvs: DataCSVConfig[];
  counts: {
    apis: number;
    csvs: number;
    total: number;
  };
}
```

---

#### `POST /api/admin/data-sources`

Create a new API data source.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  name: string;                    // Required, unique
  description?: string;
  endpoint: string;                // Required, full URL
  method?: 'GET' | 'POST';         // Default: 'GET'
  responseFormat?: 'json' | 'csv'; // Default: 'json'
  authentication?: {
    type: 'none' | 'bearer' | 'api_key' | 'basic';
    credentials?: {
      token?: string;
      apiKey?: string;
      apiKeyHeader?: string;
      apiKeyLocation?: 'header' | 'query';
      username?: string;
      password?: string;
    };
  };
  headers?: Record<string, string>;
  parameters?: DataAPIParameter[];
  responseStructure?: {
    jsonPath: string;
    dataIsArray: boolean;
    fields: ResponseField[];
    totalCountPath?: string;
  };
  sampleResponse?: object;
  openApiSpec?: object;
  configMethod?: 'manual' | 'openapi';
  categoryIds?: number[];
}
```

**Response** `200 OK`:

```typescript
{
  success: true;
  dataSource: DataAPIConfig;
}
```

---

#### `GET /api/admin/data-sources/{id}`

Get data source details.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  dataSource: DataAPIConfig | DataCSVConfig;
  type: 'api' | 'csv';
}
```

---

#### `PUT /api/admin/data-sources/{id}`

Update a data source.

**Authentication**: Required
**Role**: Admin only

**Request Body**: Same as POST (partial updates supported)

**Response** `200 OK`:

```typescript
{
  success: true;
  dataSource: DataAPIConfig | DataCSVConfig;
}
```

---

#### `DELETE /api/admin/data-sources/{id}`

Delete a data source.

**Authentication**: Required
**Role**: Admin only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Data source type: `api` or `csv` |

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: { id: string; type: string; };
}
```

---

#### `POST /api/admin/data-sources/{id}/test`

Test data source connectivity.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  success: boolean;
  latencyMs: number;
  sampleData?: object[];
  recordCount?: number;
  error?: string;
}
```

---

#### `POST /api/admin/data-sources/upload-csv`

Upload a CSV file as a data source.

**Authentication**: Required
**Role**: Admin only

**Request**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | CSV file |
| `name` | string | Yes | Unique data source name |
| `description` | string | No | Human-readable description |
| `categoryIds` | string | No | JSON array of category IDs |

**Response** `200 OK`:

```typescript
{
  success: true;
  dataSource: DataCSVConfig;
}
```

---

#### `POST /api/admin/data-sources/parse-openapi`

Parse an OpenAPI specification to auto-configure an API data source.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  spec: object | string;  // OpenAPI spec as JSON or YAML string
}
```

**Response** `200 OK`:

```typescript
{
  success: true;
  endpoints: Array<{
    path: string;
    method: string;
    operationId: string;
    summary: string;
    parameters: object[];
    responseSchema: object;
  }>;
}
```

---

### 20. Admin - Function APIs

Manage Function API configurations with OpenAI-format tool schemas.

#### `GET /api/admin/function-apis`

List all Function API configurations.

**Authentication**: Required
**Role**: Admin only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `categoryId` | number | No | Filter by linked category |

**Response** `200 OK`:

```typescript
{
  functionApis: FunctionAPIConfig[];
  count: number;
}
```

---

#### `POST /api/admin/function-apis`

Create a new Function API configuration.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  name: string;                              // Required, unique
  description?: string;
  baseUrl: string;                           // Required
  authType: 'api_key' | 'bearer' | 'basic' | 'none';
  authHeader?: string;                       // e.g., 'X-API-Key'
  authCredentials?: string;                  // API key or token
  defaultHeaders?: Record<string, string>;
  toolsSchema: Array<{                       // Required, OpenAI format
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: {
        type: 'object';
        properties: Record<string, object>;
        required?: string[];
      };
    };
  }>;
  endpointMappings: Record<string, {         // Required
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
  }>;
  timeoutSeconds?: number;                   // Default: 30
  cacheTTLSeconds?: number;                  // Default: 3600
  categoryIds?: number[];
}
```

**Response** `200 OK`:

```typescript
{
  success: true;
  functionApi: FunctionAPIConfig;
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Name is required" | VALIDATION_ERROR | Include name |
| 400 | "Base URL is required" | VALIDATION_ERROR | Include baseUrl |
| 400 | "Invalid tools schema" | VALIDATION_ERROR | Fix schema format |
| 400 | "Invalid endpoint mappings" | VALIDATION_ERROR | Ensure all functions have mappings |
| 409 | "A function API with this name already exists" | DUPLICATE | Use unique name |

---

#### `GET /api/admin/function-apis/{id}`

Get Function API details.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  functionApi: FunctionAPIConfig;
}
```

---

#### `PUT /api/admin/function-apis/{id}`

Update a Function API configuration.

**Authentication**: Required
**Role**: Admin only

**Request Body**: Same as POST (partial updates supported)

**Response** `200 OK`:

```typescript
{
  success: true;
  functionApi: FunctionAPIConfig;
}
```

---

#### `DELETE /api/admin/function-apis/{id}`

Delete a Function API configuration.

**Authentication**: Required
**Role**: Admin only

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: { id: string; };
}
```

---

#### `POST /api/admin/function-apis/{id}/test`

Test Function API connectivity.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  functionName?: string;  // Optional: test specific function
  testParams?: object;    // Optional: parameters to pass
}
```

**Response** `200 OK`:

```typescript
{
  success: boolean;
  latencyMs: number;
  response?: unknown;
  error?: string;
}
```

---

### 21. Superuser - Tools Management

Superusers can configure category-level tool overrides.

#### `GET /api/superuser/tools`

View tools with category-level overrides for assigned categories.

**Authentication**: Required
**Role**: Superuser only

**Response** `200 OK`:

```typescript
{
  tools: Array<{
    name: string;
    displayName: string;
    description: string;
    category: string;
    globalEnabled: boolean;
    categories: Array<{
      categoryId: number;
      categoryName: string;
      isEnabled: boolean | null;  // null = inherit
      effectiveEnabled: boolean;
      branding: BrandingConfig | null;
    }>;
  }>;
  assignedCategories: Array<{
    id: number;
    name: string;
    slug: string;
  }>;
}
```

---

#### `POST /api/superuser/tools/{toolName}`

Create or update category-level tool override.

**Authentication**: Required
**Role**: Superuser only

**Request Body**:

```typescript
{
  categoryId: number;
  isEnabled?: boolean | null;  // null to inherit from global
  branding?: {
    enabled: boolean;
    logoUrl?: string;
    organizationName?: string;
    primaryColor?: string;
  };
}
```

**Response** `200 OK`:

```typescript
{
  categoryId: number;
  toolName: string;
  isEnabled: boolean | null;
  branding: BrandingConfig | null;
  effectiveEnabled: boolean;
}
```

---

### 22. Super User - User Management

Super users can manage subscriptions for regular users within their assigned categories.

#### `GET /api/superuser/users`

Get users subscribed to super user's assigned categories.

**Authentication**: Required
**Role**: Superuser only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/superuser/users \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  assignedCategories: Array<{
    categoryId: number;
    categoryName: string;
    categorySlug: string;
  }>;
  users: Array<{
    id: number;
    email: string;
    name: string | null;
    subscriptions: Array<{
      categoryId: number;
      categoryName: string;
      isActive: boolean;
    }>;
  }>;
}
```

---

#### `POST /api/superuser/users`

Add subscription for a user to one of super user's categories.

**Authentication**: Required
**Role**: Superuser only

**Request Body**:

```typescript
{
  userEmail: string;   // Target user's email
  categoryId: number;  // Category ID (must be assigned to super user)
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/superuser/users \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "userEmail": "user@example.com",
    "categoryId": 1
  }'
```

**Response** `201 Created`:

```typescript
{
  success: true;
  subscription: {
    userId: number;
    categoryId: number;
    categoryName: string;
    isActive: boolean;
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "userEmail and categoryId are required" | VALIDATION_ERROR | Include both fields |
| 400 | "Can only manage subscriptions for regular users" | VALIDATION_ERROR | Target must be role=user |
| 403 | "You do not have access to manage this category" | FORBIDDEN | Use assigned category |
| 404 | "User not found" | NOT_FOUND | Verify email address |
| 409 | "User is already subscribed" | DUPLICATE | User already has access |

---

#### `DELETE /api/superuser/users`

Remove subscription from one of super user's categories.

**Authentication**: Required
**Role**: Superuser only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userEmail` | string | Yes | Target user's email |
| `categoryId` | number | Yes | Category ID to unsubscribe |

**Example Request**:

```bash
curl -X DELETE "https://policybot.abhirup.app/api/superuser/users?userEmail=user@example.com&categoryId=1" \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  removed: {
    userId: number;
    categoryId: number;
  };
}
```

---

### 23. Super User - Category Management

Super users can view their accessible categories (both managed and subscribed) and create new categories within their quota.

#### `GET /api/superuser/categories`

Get super user's accessible categories (both managed and subscribed).

**Authentication**: Required
**Role**: Superuser only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/superuser/categories \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  managedCategories: Array<{
    id: number;
    name: string;
    slug: string;
    description: string | null;
    documentCount: number;
    subscriberCount: number;
    createdByMe: boolean;
  }>;
  subscribedCategories: Array<{
    id: number;
    name: string;
    slug: string;
    description: string | null;
    isActive: boolean;
  }>;
  quota: {
    used: number;          // Categories created by this superuser
    limit: number;         // Max categories they can create
    canCreate: boolean;    // Whether they can create more
  };
}
```

**Notes**:
- `managedCategories` come from `super_user_categories` table (full control)
- `subscribedCategories` come from `user_subscriptions` table (read-only access)
- A category can appear in both lists if the superuser manages AND is subscribed to it

---

#### `POST /api/superuser/categories`

Create a new category (within superuser's quota).

**Authentication**: Required
**Role**: Superuser only

**Request Body**:

```typescript
{
  name: string;         // Required: category name (max 100 chars)
  description?: string; // Optional: category description
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/superuser/categories \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "name": "My Department",
    "description": "Documents for my department"
  }'
```

**Response** `201 Created`:

```typescript
{
  success: true;
  category: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    createdBy: string;
    createdAt: string;
  };
  quota: {
    used: number;
    limit: number;
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Category name is required" | VALIDATION_ERROR | Include name |
| 400 | "Category name must be 100 characters or less" | VALIDATION_ERROR | Shorten name |
| 403 | "Category limit reached..." | QUOTA_EXCEEDED | Contact admin for higher quota |
| 409 | "Category \"X\" already exists" | DUPLICATE | Use different name |

---

#### `DELETE /api/superuser/categories`

Delete a category created by this super user.

**Authentication**: Required
**Role**: Superuser only

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `categoryId` | number | Yes | Category ID to delete |

**Constraints**:
- Can only delete categories you created
- Deletes all documents, subscriptions, and ChromaDB data for the category

**Example Request**:

```bash
curl -X DELETE "https://policybot.abhirup.app/api/superuser/categories?categoryId=5" \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  deleted: {
    categoryId: number;
    categoryName: string;
    documentsDeleted: number;
    deleteErrors?: string[];  // Any failed document deletions
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "Category ID is required" | VALIDATION_ERROR | Include categoryId |
| 403 | "You can only delete categories you created" | FORBIDDEN | Must be category creator |
| 404 | "Category not found" | NOT_FOUND | Verify category ID |

---

### 24. Admin - Tool Routing

Manage keyword and regex-based routing rules that force specific tools to be called when patterns match user messages.

#### `GET /api/admin/tool-routing`

List all routing rules with optional seeding of defaults.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/tool-routing \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  rules: Array<{
    id: string;
    toolName: string;
    ruleName: string;
    ruleType: 'keyword' | 'regex';
    patterns: string[];
    forceMode: 'required' | 'preferred' | 'suggested';
    priority: number;
    categoryIds: number[] | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
  }>;
  count: number;
}
```

**Notes**:
- Default routing rules are automatically seeded on first access if none exist
- Rules are returned sorted by priority (lower = higher priority)

---

#### `POST /api/admin/tool-routing`

Create a new routing rule.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  toolName: string;     // Required: target tool name (e.g., "chart_gen")
  ruleName: string;     // Required: descriptive rule name
  ruleType: 'keyword' | 'regex';  // Required
  patterns: string[];   // Required: array of patterns to match
  forceMode?: 'required' | 'preferred' | 'suggested';  // Default: 'required'
  priority?: number;    // Default: 100 (lower = higher priority)
  categoryIds?: number[];  // Optional: limit to specific categories
  isActive?: boolean;   // Default: true
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/tool-routing \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "toolName": "chart_gen",
    "ruleName": "Chart Keywords",
    "ruleType": "keyword",
    "patterns": ["chart", "graph", "visualize", "plot"],
    "forceMode": "required",
    "priority": 10
  }'
```

**Response** `200 OK`:

```typescript
{
  success: true;
  rule: {
    id: string;
    toolName: string;
    ruleName: string;
    // ... full rule object
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "toolName is required and must be a string" | VALIDATION_ERROR | Include toolName |
| 400 | "ruleName is required and must be a string" | VALIDATION_ERROR | Include ruleName |
| 400 | "ruleType must be \"keyword\" or \"regex\"" | VALIDATION_ERROR | Use valid ruleType |
| 400 | "patterns must be a non-empty array of strings" | VALIDATION_ERROR | Include patterns array |
| 400 | "Invalid regex pattern: ..." | VALIDATION_ERROR | Fix regex syntax |

---

#### `GET /api/admin/tool-routing/{id}`

Get a specific routing rule by ID.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X GET https://policybot.abhirup.app/api/admin/tool-routing/abc123 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  rule: {
    id: string;
    toolName: string;
    ruleName: string;
    ruleType: 'keyword' | 'regex';
    patterns: string[];
    forceMode: 'required' | 'preferred' | 'suggested';
    priority: number;
    categoryIds: number[] | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 404 | "Routing rule not found" | NOT_FOUND | Verify rule ID |

---

#### `PATCH /api/admin/tool-routing/{id}`

Update an existing routing rule.

**Authentication**: Required
**Role**: Admin only

**Request Body** (all fields optional):

```typescript
{
  toolName?: string;
  ruleName?: string;
  ruleType?: 'keyword' | 'regex';
  patterns?: string[];
  forceMode?: 'required' | 'preferred' | 'suggested';
  priority?: number;
  categoryIds?: number[] | null;
  isActive?: boolean;
}
```

**Example Request**:

```bash
curl -X PATCH https://policybot.abhirup.app/api/admin/tool-routing/abc123 \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "patterns": ["chart", "graph", "visualize", "plot", "diagram"],
    "priority": 5
  }'
```

**Response** `200 OK`:

```typescript
{
  success: true;
  rule: {
    // ... updated rule object
  };
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 400 | "ruleType must be \"keyword\" or \"regex\"" | VALIDATION_ERROR | Use valid ruleType |
| 400 | "patterns must be a non-empty array" | VALIDATION_ERROR | Include patterns |
| 400 | "Invalid regex pattern: ..." | VALIDATION_ERROR | Fix regex syntax |
| 404 | "Routing rule not found" | NOT_FOUND | Verify rule ID |

---

#### `DELETE /api/admin/tool-routing/{id}`

Delete a routing rule.

**Authentication**: Required
**Role**: Admin only

**Example Request**:

```bash
curl -X DELETE https://policybot.abhirup.app/api/admin/tool-routing/abc123 \
  -H "Cookie: next-auth.session-token=abc123..."
```

**Response** `200 OK`:

```typescript
{
  success: true;
  message: "Routing rule deleted";
}
```

**Error Responses**:

| Status | Error | Code | Solution |
|--------|-------|------|----------|
| 404 | "Routing rule not found" | NOT_FOUND | Verify rule ID |

---

#### `POST /api/admin/tool-routing/test`

Test routing rules against a message to see which rules would match.

**Authentication**: Required
**Role**: Admin only

**Request Body**:

```typescript
{
  message: string;         // Required: message to test
  categoryIds?: number[];  // Optional: category context
}
```

**Example Request**:

```bash
curl -X POST https://policybot.abhirup.app/api/admin/tool-routing/test \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=abc123..." \
  -d '{
    "message": "Create a chart showing sales by region",
    "categoryIds": [1, 2]
  }'
```

**Response** `200 OK`:

```typescript
{
  matches: Array<{
    toolName: string;
    forceMode: 'required' | 'preferred' | 'suggested';
    ruleName: string;
    matchedPattern: string;
  }>;
  toolChoice: 'auto' | 'required' | { type: 'function'; function: { name: string } };
}
```

**Example Response**:

```json
{
  "matches": [
    {
      "toolName": "chart_gen",
      "forceMode": "required",
      "ruleName": "Chart Keywords",
      "matchedPattern": "chart"
    }
  ],
  "toolChoice": {
    "type": "function",
    "function": {
      "name": "chart_gen"
    }
  }
}
```

**Notes**:
- `toolChoice` determines the OpenAI `tool_choice` parameter:
  - `'auto'`: No routing match, LLM decides
  - `'required'`: Multiple tools matched, LLM must use one
  - `{ type: 'function', function: { name: '...' } }`: Specific tool forced

---

## Error Handling Best Practices

### Handling 401 Unauthorized

When receiving a 401 response, the user's session has expired or is invalid:

```typescript
if (response.status === 401) {
  // Redirect to login
  window.location.href = '/auth/signin';
}
```

### Handling 202 Accepted (Async Operations)

Document uploads return 202 immediately. Poll for completion:

```typescript
async function waitForProcessing(docId: number): Promise<void> {
  let status = 'processing';
  while (status === 'processing') {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
    const response = await fetch(`/api/admin/documents/${docId}`);
    const data = await response.json();
    status = data.status;
  }
}
```

---

## Rate Limiting

> **Note**: Rate limiting is planned for a future release. Currently, there are no request frequency limits enforced.

---

## API Versioning

**Current Version**: v1 (implicit in all endpoints)

Future versions will use explicit path prefix:
- v1: `/api/chat` (current, no prefix required)
- v2: `/api/v2/chat` (future)

**Breaking Change Policy**:
- Breaking changes announced 30 days in advance
- Old versions supported for 90 days post-deprecation
- Deprecation notices included in response headers

---

## OpenAPI Specification

An OpenAPI 3.0 specification is available at `docs/openapi.yaml` for tooling integration.

### Import into API Tools

The spec can be imported into popular API clients:

| Tool | How to Import |
|------|---------------|
| **Postman** | File → Import → Select `openapi.yaml` |
| **Insomnia** | Application → Preferences → Data → Import Data |
| **Bruno** | Collection → Import Collection → OpenAPI |
| **Swagger UI** | Point to the YAML file URL |

### Generate Client SDKs

Use `openapi-generator-cli` to generate typed clients:

```bash
# Install generator
npm install @openapitools/openapi-generator-cli -g

# Generate TypeScript client
openapi-generator-cli generate \
  -i docs/openapi.yaml \
  -g typescript-fetch \
  -o ./generated-client

# Generate Python client
openapi-generator-cli generate \
  -i docs/openapi.yaml \
  -g python \
  -o ./generated-client-python
```

**Available generators**: typescript-fetch, typescript-axios, python, java, go, rust, csharp, and [50+ more](https://openapi-generator.tech/docs/generators).

### Validate API Responses

Use the spec to validate responses in tests:

```typescript
import SwaggerParser from '@apidevtools/swagger-parser';

const api = await SwaggerParser.validate('docs/openapi.yaml');
// Use api.paths to validate response shapes
```

### Host Interactive Documentation

To serve interactive API docs (optional):

```bash
# Using Swagger UI Docker
docker run -p 8080:8080 \
  -e SWAGGER_JSON=/docs/openapi.yaml \
  -v $(pwd)/docs:/docs \
  swaggerapi/swagger-ui
```

Then visit `http://localhost:8080` for interactive API exploration.

---

## SDK Examples

### JavaScript/TypeScript

```typescript
// Send chat message
async function sendMessage(message: string, threadId: string) {
  const response = await fetch('https://policybot.abhirup.app/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, threadId }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return response.json();
}

// Upload document with categories
async function uploadDocument(file: File, categoryIds: number[], isGlobal: boolean) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('categoryIds', JSON.stringify(categoryIds));
  formData.append('isGlobal', String(isGlobal));

  const response = await fetch('https://policybot.abhirup.app/api/admin/documents', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  return response.json();
}

// Create user with subscriptions
async function createUser(email: string, role: string, subscriptions: number[]) {
  const response = await fetch('https://policybot.abhirup.app/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role, subscriptions }),
    credentials: 'include',
  });

  return response.json();
}
```

### cURL

```bash
# Create category
curl -X POST https://policybot.abhirup.app/api/admin/categories \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=TOKEN" \
  -d '{"name": "HR", "description": "Human Resources"}'

# Create user with subscriptions
curl -X POST https://policybot.abhirup.app/api/admin/users \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=TOKEN" \
  -d '{"email": "user@example.com", "role": "user", "subscriptions": [1,2]}'

# Upload document to categories
curl -X POST https://policybot.abhirup.app/api/admin/documents \
  -H "Cookie: next-auth.session-token=TOKEN" \
  -F "file=@policy.pdf" \
  -F "categoryIds=[1,2]"

# Super user: add subscription
curl -X POST https://policybot.abhirup.app/api/superuser/users \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=TOKEN" \
  -d '{"userEmail": "user@example.com", "categoryId": 1}'

# Super user: upload document to assigned category
curl -X POST https://policybot.abhirup.app/api/superuser/documents \
  -H "Cookie: next-auth.session-token=TOKEN" \
  -F "file=@HR_Policy.pdf" \
  -F "categoryId=1"

# Super user: delete own document
curl -X DELETE https://policybot.abhirup.app/api/superuser/documents/5 \
  -H "Cookie: next-auth.session-token=TOKEN"
```
