# Agent Bots — Programmatic AI API

> **Audience:** Administrators, API integrators, developers building on AI Assistant  
> **Scope:** Complete guide to creating, configuring, and invoking Agent Bots via REST API

---

## Table of Contents

1. [Objective](#1-objective)
2. [Sample Use Cases](#2-sample-use-cases)
3. [How to Create a New Agent Bot](#3-how-to-create-a-new-agent-bot)
4. [Agent Bot API Documentation](#4-agent-bot-api-documentation)
5. [Integrating in an External Portal or System](#5-integrating-in-an-external-portal-or-system)
6. [Known Error Codes](#6-known-error-codes)
7. [Known Issues and Fixes](#7-known-issues-and-fixes)

---

## 1. Objective

**Agent Bots** expose AI Assistant's RAG, tool-calling, and document-generation capabilities as a **versioned, programmatic REST API**. Instead of requiring users to log into the AI Assistant web interface and chat manually, external systems — such as government portals, enterprise dashboards, CI/CD pipelines, or mobile apps — can invoke an Agent Bot via HTTP and receive structured outputs (text, JSON, PDF, DOCX, spreadsheets, charts, diagrams, images, or podcasts).

### Why Agent Bots?

| Problem | Agent Bot Solution |
|---------|-------------------|
| Citizens must visit a separate AI portal to ask policy questions | Embed an Agent Bot call directly into the government e-services portal |
| Analysts manually copy-paste chat outputs into Word documents | Request `docx` or `pdf` output directly from the API |
| External systems need consistent, reproducible AI behavior | Versioned configurations with immutable snapshots |
| Different departments need different AI behaviors | Per-bot system prompts, categories, and tool sets |
| Need audit trail and usage analytics | Built-in job tracking, token usage, and per-API-key analytics |

### Key Capabilities

- **RAG over categories** — Retrieve from organizational documents (same pipeline as the chat UI)
- **Tool calling** — Web search, data sources, function APIs, document generation, charts, diagrams
- **Structured output** — Text, JSON, Markdown, PDF, DOCX, XLSX, PPTX, images, podcasts, charts, diagrams
- **File uploads** — Submit documents as input context for extraction and analysis
- **Versioning** — Snapshot configurations and roll back when needed
- **Per-bot API keys** — Scoped authentication with rate limiting
- **Async execution** — Fire-and-forget jobs with polling or webhook callbacks
- **Analytics** — Per-bot usage tracking, token consumption, success rates

---

## 2. Sample Use Cases

### Use Case A: IT Portfolio Rationalisation Assessment

**Scenario:** A government's Digital Transformation Office needs to assess IT systems across ministries for consolidation opportunities.

**Agent Bot Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | `IT Portfolio Rationaliser` |
| **Slug** | `it-portfolio-rationaliser` |
| **System Prompt** | `You are an IT portfolio rationalisation specialist. Assess IT systems using the TOM (Target Operating Model) framework. For each system, evaluate: strategic fit, technical debt, duplication risk, integration complexity, and cloud readiness. Produce a ranked consolidation roadmap.` |
| **Categories** | `Enterprise Architecture`, `IT Strategy` |
| **Tools** | `web_search`, `doc_gen`, `data_source` |
| **Output Type** | `docx` |
| **LLM Model** | `gpt-4.1` or `claude-sonnet-4` |

**External Portal Integration:**

A ministry official visits the government's e-services portal, fills a form listing their systems, and clicks **Assess**. The portal backend:

1. Calls `POST /api/agent-bots/it-portfolio-rationaliser/invoke`
2. Passes the system list as `input.systems`
3. Receives a `jobId` immediately (async mode)
4. Polls `GET /api/agent-bots/it-portfolio-rationaliser/jobs/{jobId}` every 2 seconds
5. When `status: completed`, presents the DOCX download link to the official

**Sample Input:**

```json
{
  "input": {
    "query": "Assess the following IT systems for consolidation: (1) Ministry Finance SAP ECC 6.0, (2) Ministry Health Oracle EBS 12.1, (3) Ministry Education custom .NET payroll, (4) Ministry Transport cloud SaaS CRM. Apply TOM framework and produce ranked consolidation roadmap.",
    "ministry": "Ministry of Finance",
    "assessment_year": 2026
  },
  "outputType": "docx",
  "async": true
}
```

---

### Use Case B: Service Simplification Assessment

**Scenario:** A government's Public Service Reform Unit wants to evaluate citizen-facing services against service-simplification guidelines (e.g., digital-first, single-window, no duplicate data entry).

**Agent Bot Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | `Service Simplification Assessor` |
| **Slug** | `service-simplification` |
| **System Prompt** | `You are a service simplification analyst. Assess government services against these criteria: (1) Can it be completed fully online? (2) How many agencies touch the process? (3) Is data re-used across agencies? (4) What is the average turnaround time? (5) Are there private-sector equivalents that are faster? Score each service 1-5 and produce an action plan with quick wins.` |
| **Categories** | `Public Service Reform`, `Citizen Services` |
| **Tools** | `web_search` (to benchmark against other countries), `doc_gen` |
| **Output Type** | `docx` |

**Sample Input:**

```json
{
  "input": {
    "query": "Assess the Grenada birth certificate application process. Evaluate against service simplification guidelines. Prepare assessment result as a formal report.",
    "service_name": "Birth Certificate Application",
    "jurisdiction": "Grenada"
  },
  "outputType": "docx",
  "async": true
}
```

---

### Use Case C: Automated Compliance Report Generation

**Scenario:** A compliance department needs monthly regulatory compliance reports generated automatically from internal policy documents.

**Agent Bot Configuration:**

| Setting | Value |
|---------|-------|
| **Name** | `Compliance Report Generator` |
| **Slug** | `compliance-reporter` |
| **System Prompt** | `Generate a compliance report covering: data protection, financial reporting, environmental standards, and labour law. Cite specific document sections. Flag any gaps or expired certifications.` |
| **Categories** | `Compliance`, `Legal` |
| **Tools** | `doc_gen` |
| **Output Type** | `pdf` |

**CI/CD Integration:**

A Jenkins/GitHub Actions pipeline runs on the first of every month:

```bash
# Trigger report generation
curl -X POST "$POLICY_BOT/api/agent-bots/compliance-reporter/invoke" \
  -H "Authorization: Bearer $AGENT_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {"query": "Generate Q2 2026 compliance report"},
    "outputType": "pdf",
    "async": true,
    "webhookUrl": "https://compliance-portal.gov/webhook/reports",
    "webhookSecret": "whsec_..."
  }'
```

The webhook receives the completed job payload including the download URL.

---

## 3. How to Create a New Agent Bot

### Prerequisites

- **Role:** Admin or Superuser (superusers can only assign their own categories)
- **Categories:** At least one category with uploaded documents (for RAG context)
- **Tools:** Configure desired tools in **Admin → Tools** before enabling them on the bot

### Step-by-Step

#### 1. Navigate to Agent Bots

1. Log in as an Admin
2. Go to **Admin Dashboard**
3. Click the **Agent Bots** tab in the left sidebar

#### 2. Create the Bot

1. Click **New Agent Bot**
2. Fill in basic details:

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | Display name | `Service Simplification Assessor` |
| **Slug** | URL-safe identifier (unique) | `service-simplification` |
| **Description** | Brief purpose | `Assesses government services against simplification guidelines` |

3. Click **Create**

#### 3. Configure the First Version

Every bot needs at least one **version** to be invokable. The first version is created automatically.

##### Input Schema

Define what parameters callers must (or can) provide:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | The main request or question |
| `ministry` | string | No | Ministry name for context |
| `assessment_year` | number | No | Year of assessment |

##### Output Configuration

| Setting | Description |
|---------|-------------|
| **Enabled Types** | Which output formats callers can request |
| **Default Type** | Fallback when caller does not specify |
| **Document Branding** | Logo, organization name, primary color (for PDF/DOCX) |

**Supported Output Types:**

| Type | Use Case |
|------|----------|
| `text` | Plain text response |
| `json` | Structured data (parsed from LLM output) |
| `md` | Markdown document |
| `pdf` | Branded PDF report |
| `docx` | Microsoft Word document |
| `xlsx` | Excel spreadsheet (from table data) |
| `pptx` | PowerPoint presentation |
| `image` | AI-generated image (Gemini / Imagen 4) |
| `podcast` | AI-generated audio narration |
| `chart` | Chart.js visualization (PNG) |
| `diagram` | Mermaid diagram (SVG) |

##### System Prompt

Write instructions specific to this bot's purpose. This is prepended to the global system prompt.

**Tips:**
- Be explicit about output structure (headings, tables, scoring criteria)
- Mention any frameworks or methodologies to apply
- Specify citation requirements
- Set tone (formal report, concise summary, technical analysis)

> **Surface scoping:** Agent Bots receive **no personal style context**. The user's Personal Memory response style (tone / verbosity / custom persona) applies to main chat only; workspaces and Agent Bots get no `<response_style>` block. Set the bot's tone explicitly in this System Prompt field.

##### Categories

Select which document categories the bot can retrieve from:

1. Click **Link Categories**
2. Select one or more categories
3. The bot's RAG will search only within these categories

> **Note:** If no documents exist in the selected categories, RAG returns empty results. The bot may fall back to web search (if enabled) or general knowledge.

##### Tools

Select which tools the LLM can call during execution:

| Tool | When to Enable |
|------|---------------|
| `web_search` | Bot needs current/external information beyond internal documents |
| `doc_gen` | Bot needs to generate documents during the conversation (note: if output type is `pdf`/`docx`/`md`, `doc_gen` is automatically excluded because the output generator handles it post-LLM) |
| `data_source` | Bot needs to query external APIs or CSVs |
| `chart_gen` | Bot needs to create data visualizations |
| `task_planner` | Bot needs multi-step planning |
| `function_api` | Bot needs to call configured Function APIs |

##### LLM Configuration

| Setting | Description |
|---------|-------------|
| **Model** | Override the default model (e.g., `gpt-4.1`, `claude-sonnet-4`, `gemini-2.5-pro`), or select **⚡ Auto** for intelligent per-invocation selection |
| **Temperature** | Creativity vs determinism (0.0 = strict, 1.0 = creative) |

> **Auto Model Selection:** When **⚡ Auto** is selected, the system evaluates each incoming invocation (query context, tool routing, token budget) and picks the best available enabled model automatically, scoped to the bot's linked categories. If selection fails, the global default model is used.
| **Max Tokens** | Maximum response length |
| **Include Sources** | Include RAG source citations in the response |

4. Click **Save Version**

#### 4. Activate the Version

1. Go to the **Versions** tab
2. Find your version
3. Toggle **Active** to `On`
4. (Optional) Set as **Default** — this is the version used when callers don't specify one

#### 5. Generate an API Key

1. Go to the **API Keys** tab
2. Click **Generate New Key**
3. Enter a descriptive name (e.g., `E-Portal Production`)
4. Copy the key immediately — it is shown **only once**

The key format is: `ab_pk_xxxxxxxxxxxxxxxx`

#### 6. Test the Bot

1. Go to the **Test** tab
2. Fill in sample input parameters
3. Select an output type
4. Click **Run Test**
5. The test runs in **async mode by default** and polls for results automatically

> **Tip:** Use the Test tab to iterate on your system prompt and verify output quality before sharing the API with external teams.

---

## 4. Agent Bot API Documentation

### Base URL

```
https://your-domain.com/api/agent-bots/{slug}
```

### Authentication

All public Agent Bot endpoints require an API key in the `Authorization` header:

```
Authorization: Bearer ab_pk_your_api_key_here
```

### Public Endpoints

#### `POST /api/agent-bots/{slug}/invoke`

Execute the agent bot with provided input.

**Headers:**

| Header | Value | Required |
|--------|-------|----------|
| `Authorization` | `Bearer ab_pk_...` | Yes |
| `Content-Type` | `application/json` | Yes |

**Request Body:**

```typescript
{
  input: Record<string, unknown>;     // Required. Matches the version's input schema
  version?: number | 'latest' | 'default'; // Optional. Defaults to default version
  outputType?: OutputType;            // Optional. Defaults to version's default
  async?: boolean;                    // Optional. Defaults to false (sync mode) — see warning below
  files?: string[];                   // Optional. Uploaded file IDs
  webhookUrl?: string;                // Optional. For async webhook notification
  webhookSecret?: string;             // Optional. Webhook HMAC secret
}
```

> **⚠️ Critical Warning:** The API **does not automatically switch to async mode**. If you omit `async` or set it to `false`, the request runs **synchronously** and blocks until completion. If the LLM triggers web searches, tool calls, or document generation, the request may exceed Cloudflare's ~100-second timeout and return a **524 error**. There is no automatic fallback or retry-as-async. **Always explicitly set `"async": true`** for production integrations.

**OutputType enum:** `text`, `json`, `md`, `pdf`, `docx`, `xlsx`, `pptx`, `image`, `podcast`, `chart`, `diagram`

**Sync Response (`200 OK`)** — when `async: false`:

```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "outputs": [
    {
      "type": "docx",
      "filename": "550e8400_document_1716230400000.docx",
      "downloadUrl": "/api/agent-bots/service-simplification/jobs/550e8400/outputs/out_123/download",
      "fileSize": 45230,
      "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
  ],
  "sources": [
    {
      "documentName": "Service_Simplification_Guide.pdf",
      "pageNumber": 8,
      "chunkText": "Services should be designed digital-first...",
      "score": 0.91
    }
  ],
  "tokenUsage": {
    "promptTokens": 3200,
    "completionTokens": 1800,
    "totalTokens": 5000
  },
  "processingTimeMs": 45000
}
```

**Async Response (`202 Accepted`)** — when `async: true`:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

---

#### `GET /api/agent-bots/{slug}/jobs/{jobId}`

Get the status and results of an async job.

**Headers:**

| Header | Value | Required |
|--------|-------|----------|
| `Authorization` | `Bearer ab_pk_...` | Yes (public API) or `X-Admin-Test: true` (admin test mode) |

**Response (`200 OK`):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "createdAt": "2026-05-20T10:00:00Z",
  "startedAt": "2026-05-20T10:00:02Z",
  "completedAt": "2026-05-20T10:00:47Z",
  "outputs": [
    {
      "type": "docx",
      "filename": "550e8400_assessment_1716230400000.docx",
      "downloadUrl": "/api/agent-bots/service-simplification/jobs/550e8400/outputs/out_123/download",
      "fileSize": 45230,
      "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
  ],
  "sources": [ ... ],
  "tokenUsage": {
    "promptTokens": 3200,
    "completionTokens": 1800,
    "totalTokens": 5000
  },
  "processingTimeMs": 45000
}
```

**Status Values:**

| Status | Meaning |
|--------|---------|
| `pending` | Job queued, not yet started |
| `running` | Job is being processed |
| `completed` | Job finished successfully |
| `failed` | Job encountered an error |
| `cancelled` | Job was cancelled by user |

---

#### `POST /api/agent-bots/{slug}/upload`

Upload files to include as context in a subsequent invoke call.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | The file to upload |

**Response (`200 OK`):**

```json
{
  "fileId": "file_abc123",
  "filename": "budget_2026.xlsx",
  "fileSize": 24576,
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

**Usage Flow:**

```bash
# 1. Upload file
UPLOAD_RESP=$(curl -X POST "https://your-domain.com/api/agent-bots/service-simplification/upload" \
  -H "Authorization: Bearer ab_pk_..." \
  -F "file=@budget_2026.xlsx")

FILE_ID=$(echo $UPLOAD_RESP | jq -r '.fileId')

# 2. Invoke with file reference
curl -X POST "https://your-domain.com/api/agent-bots/service-simplification/invoke" \
  -H "Authorization: Bearer ab_pk_..." \
  -H "Content-Type: application/json" \
  -d "{
    \"input\": {\"query\": \"Analyse this budget for duplication and waste\"},
    \"files\": [\"$FILE_ID\"],
    \"outputType\": \"docx\",
    \"async\": true
  }"
```

---

#### `GET /api/agent-bots/{slug}/jobs/{jobId}/outputs/{outputId}/download`

Download a generated output file.

**Authentication:** API key (`Authorization: Bearer ...`) or admin session cookie (for Test tab downloads).

**Response:** Binary file content with appropriate `Content-Type` header.

---

### Admin Endpoints

These endpoints require an authenticated admin/superuser session cookie.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/agent-bots` | List all agent bots |
| POST | `/api/admin/agent-bots` | Create agent bot |
| GET | `/api/admin/agent-bots/{id}` | Get bot details |
| PATCH | `/api/admin/agent-bots/{id}` | Update bot |
| DELETE | `/api/admin/agent-bots/{id}` | Delete bot |
| GET | `/api/admin/agent-bots/{id}/versions` | List versions |
| POST | `/api/admin/agent-bots/{id}/versions` | Create version |
| GET | `/api/admin/agent-bots/{id}/versions/{versionId}` | Get version |
| PATCH | `/api/admin/agent-bots/{id}/versions/{versionId}` | Update version |
| DELETE | `/api/admin/agent-bots/{id}/versions/{versionId}` | Delete version |
| GET | `/api/admin/agent-bots/{id}/api-keys` | List API keys |
| POST | `/api/admin/agent-bots/{id}/api-keys` | Create API key |
| DELETE | `/api/admin/agent-bots/{id}/api-keys/{keyId}` | Revoke API key |
| GET | `/api/admin/agent-bots/{id}/analytics` | Get usage analytics |

---

## 5. Integrating in an External Portal or System

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    External Portal / System                 │
│  (Government e-services, Enterprise dashboard, Mobile app)  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              │ HTTPS + Bearer Token
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                  AI Assistant Agent Bot API                   │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  RAG Engine │◄───│  LLM + Tools │───►│Doc Generator │   │
│  │  (Qdrant)   │    │ (Multi-route)│    │ (PDF/DOCX/..)│   │
│  └─────────────┘    └──────────────┘    └──────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Integration Patterns

#### Pattern 0: Discovery / Auto-Configuration (Recommended First Step)

Before invoking an agent bot, an external system can discover its metadata using only the API key. No prior knowledge of the bot's slug, schema, or capabilities is required.

```bash
curl -X GET "https://ai.abhirup.app/api/agent-bots/spec" \
  -H "Authorization: Bearer ab_pk_..."
```

**Response:**

```json
{
  "name": "HR Policy Assistant",
  "slug": "hr-assistant",
  "description": "Answers HR policy questions",
  "baseUrl": "https://ai.abhirup.app/api/agent-bots/hr-assistant",
  "version": {
    "number": 3,
    "label": "v1.2"
  },
  "inputSchema": {
    "parameters": [
      {
        "name": "query",
        "type": "string",
        "description": "The HR policy question",
        "required": true
      },
      {
        "name": "jurisdiction",
        "type": "string",
        "description": "Country or territory",
        "required": false,
        "default": "Grenada"
      }
    ]
  },
  "uploadConfig": {
    "enabled": true,
    "maxFiles": 3,
    "maxSizePerFileMB": 10,
    "allowedTypes": ["application/pdf", "image/*"],
    "required": false
  },
  "outputConfig": {
    "enabledTypes": ["text", "json", "pdf", "docx"],
    "defaultType": "json",
    "supportsFallback": true
  },
  "endpoints": [
    {
      "path": "https://ai.abhirup.app/api/agent-bots/hr-assistant/invoke",
      "method": "POST",
      "purpose": "Execute the agent bot (sync or async)"
    },
    {
      "path": "https://ai.abhirup.app/api/agent-bots/hr-assistant/upload",
      "method": "POST",
      "purpose": "Upload files to include as context"
    },
    {
      "path": "https://ai.abhirup.app/api/agent-bots/hr-assistant/jobs/{jobId}",
      "method": "GET",
      "purpose": "Check async job status and results"
    },
    {
      "path": "https://ai.abhirup.app/api/agent-bots/hr-assistant/jobs/{jobId}/outputs/{outputId}/download",
      "method": "GET",
      "purpose": "Download generated file outputs"
    },
    {
      "path": "https://ai.abhirup.app/api/agent-bots/spec",
      "method": "GET",
      "purpose": "Discovery — returns this metadata"
    }
  ],
  "features": {
    "async": true,
    "sync": true,
    "webhooks": true,
    "includeSources": false
  }
}
```

**When to use:**
- External site onboarding — auto-populate agent registration forms
- Dynamic UI generation — build input forms from the `inputSchema.parameters` array
- Health checks — verify key validity and bot availability before invoking

**Key insight:** The API key **is** the identity. You don't need to know the slug in advance.

---

#### Pattern 1: Synchronous (Quick Queries)

For requests that complete in under ~30 seconds (simple text/JSON queries with no heavy tool calls):

```javascript
const response = await fetch(
  'https://ai.abhirup.app/api/agent-bots/hr-bot/invoke',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ab_pk_...',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { query: 'What is the maternity leave policy?' },
      outputType: 'text',
      async: false,  // Sync mode — omitting async also defaults to sync
    }),
  }
);

const result = await response.json();
console.log(result.outputs[0].content);
```

**When to use:** Simple Q&A, small RAG context, no web search, no document generation.

**Risk:** If the LLM takes too long or triggers multiple tool calls, the request may timeout (see [Known Issues § 524 Timeout](#524-timeout-cloudflare-error)). **The API does not automatically convert a slow sync request to async.**

---

#### Pattern 2: Asynchronous with Polling (Recommended)

For complex requests (document generation, web search, large context):

```javascript
async function invokeAgentBot(slug, input, outputType = 'text') {
  // 1. Submit job
  const invokeRes = await fetch(
    `https://ai.abhirup.app/api/agent-bots/${slug}/invoke`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ab_pk_...',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        outputType,
        async: true,  // Async mode
      }),
    }
  );

  if (!invokeRes.ok) {
    const error = await invokeRes.json();
    throw new Error(error.error || 'Invoke failed');
  }

  const { jobId } = await invokeRes.json();

  // 2. Poll for completion
  return new Promise((resolve, reject) => {
    const poll = async () => {
      const statusRes = await fetch(
        `https://ai.abhirup.app/api/agent-bots/${slug}/jobs/${jobId}`,
        {
          headers: { 'Authorization': 'Bearer ab_pk_...' },
        }
      );

      if (!statusRes.ok) {
        reject(new Error('Status poll failed'));
        return;
      }

      const job = await statusRes.json();

      if (job.status === 'completed') {
        resolve(job);
      } else if (job.status === 'failed') {
        reject(new Error(job.error?.message || 'Job failed'));
      } else {
        // pending or running — poll again in 2 seconds
        setTimeout(poll, 2000);
      }
    };

    poll();
  });
}

// Usage
const result = await invokeAgentBot('service-simplification', {
  query: 'Assess Grenada birth certificate process',
  jurisdiction: 'Grenada',
}, 'docx');

// Download the generated file
if (result.outputs?.[0]?.downloadUrl) {
  window.open(`https://ai.abhirup.app${result.outputs[0].downloadUrl}`, '_blank');
}
```

**When to use:** Document generation, web search, multi-tool calls, **any production integration**.
**When to use:** Document generation, web search, multi-tool calls, **any production integration**.

> **Recommendation:** Even if you expect a quick response, use `async: true` for all production calls. This insulates you from unexpected tool-triggering behavior that could cause timeouts.

---

#### Pattern 3: Asynchronous with Webhook

For server-to-server integrations where the external system has a webhook endpoint:

```bash
curl -X POST "https://ai.abhirup.app/api/agent-bots/compliance-reporter/invoke" \
  -H "Authorization: Bearer ab_pk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "input": {"query": "Generate Q2 compliance report"},
    "outputType": "pdf",
    "async": true,
    "webhookUrl": "https://compliance-portal.gov/webhook/agent-bot",
    "webhookSecret": "whsec_1234567890abcdef"
  }'
```

**Webhook Payload (job.completed):**

```json
{
  "event": "job.completed",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "agentBotId": "bot_abc",
  "agentBotSlug": "compliance-reporter",
  "status": "completed",
  "outputs": [
    {
      "type": "pdf",
      "filename": "Q2_Compliance_Report.pdf",
      "downloadUrl": "https://ai.abhirup.app/api/agent-bots/compliance-reporter/jobs/550e8400/outputs/out_123/download",
      "fileSize": 125000
    }
  ],
  "tokenUsage": {
    "promptTokens": 5000,
    "completionTokens": 3000,
    "totalTokens": 8000
  },
  "processingTimeMs": 65000,
  "timestamp": "2026-05-20T10:01:05Z"
}
```

**Webhook Payload (job.failed):**

```json
{
  "event": "job.failed",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "agentBotSlug": "compliance-reporter",
  "status": "failed",
  "error": {
    "message": "Model request failed: timeout",
    "code": "PROCESSING_ERROR"
  },
  "timestamp": "2026-05-20T10:01:05Z"
}
```

**Webhook Verification:**

The webhook includes an `X-Webhook-Signature` header (HMAC-SHA256 of the payload using `webhookSecret`). Verify it to ensure the payload is authentic.

---

### Rate Limit Headers

All Agent Bot responses include rate limit headers:

```
X-RateLimit-Limit-Minute: 60
X-RateLimit-Remaining-Minute: 58
X-RateLimit-Reset-Minute: 1716230460
X-RateLimit-Limit-Day: 1000
X-RateLimit-Remaining-Day: 847
X-RateLimit-Reset-Day: 1716316800
```

Respect these limits. If you receive `429 Too Many Requests`, wait until `Retry-After` before retrying.

---

## 6. Known Error Codes

### API Error Codes

| Code | HTTP | Description | Solution |
|------|------|-------------|----------|
| `INVALID_API_KEY` | 401 | API key missing or invalid | Verify the `Authorization: Bearer ab_pk_...` header |
| `API_KEY_EXPIRED` | 401 | API key has passed its expiry date | Generate a new API key in Admin → Agent Bots → API Keys |
| `API_KEY_REVOKED` | 401 | API key was deactivated | Generate a new API key |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Wait for `Retry-After` header, or request a higher rate limit |
| `AGENT_BOT_NOT_FOUND` | 404 | Slug does not match any active bot | Check the slug in the URL |
| `AGENT_BOT_DISABLED` | 403 | Bot exists but is inactive | Enable the bot in Admin → Agent Bots |
| `VERSION_NOT_FOUND` | 404 | Requested version does not exist or is inactive | Check version number, or use `default` |
| `INPUT_VALIDATION_ERROR` | 400 | Input does not match the version's input schema | Check required fields and types |
| `FILE_VALIDATION_ERROR` | 400 | File type or size not allowed | Check allowed types and size limits in the version config |
| `OUTPUT_TYPE_NOT_SUPPORTED` | 400 | Requested output type is not in the version's enabled types | Use one of the enabled output types |
| `JOB_NOT_FOUND` | 404 | Job ID does not exist or belongs to a different bot | Verify the jobId and bot slug |
| `PROCESSING_ERROR` | 500 | Internal error during execution | Check server logs; may be transient — retry with async mode |
| `WEBHOOK_DELIVERY_FAILED` | 500 | Async job completed but webhook could not be delivered | Check webhook URL accessibility and SSL certificate |

### HTTP Status Codes

| Status | Meaning | When Used |
|--------|---------|-----------|
| 200 | OK | Sync execution completed successfully |
| 202 | Accepted | Async job created successfully |
| 400 | Bad Request | Validation failed |
| 401 | Unauthorized | Missing or invalid API key |
| 403 | Forbidden | Bot disabled or API key lacks permission |
| 404 | Not Found | Bot, version, or job not found |
| 413 | Payload Too Large | File upload exceeds limit |
| 429 | Rate Limit Exceeded | Too many requests |
| 500 | Internal Server Error | Processing failed |
| 524 | Timeout | Cloudflare/proxy timeout (see Known Issues) |

---

## 7. Known Issues and Fixes

### 524 Timeout (Cloudflare Error)

**Status:** ✅ Fixed via async-by-default + polling  
**Affected:** Agent Bot Test tab, sync invocations with heavy tool usage  
**Date:** 2026-05-26

#### Problem

When an Agent Bot invoked tools that took a long time (e.g., Tavily `advanced` web search, multiple search rounds, document generation), the total processing time exceeded Cloudflare's ~100 second origin timeout, producing:

```
524: A timeout occurred
```

This was especially common when:
- Output type was `docx`, `pdf`, or `pptx`
- `web_search` tool was enabled and triggered multiple searches
- `doc_gen` tool was called by the LLM (which fails in agent-bot context, wasting time)
- The request was made in **sync mode** (`async: false`)

#### Fix Applied

1. **Async-by-default in Test tab** (`AgentBotTester.tsx`)
   - The admin Test tab now defaults to `async: true`
   - Automatically polls the job status endpoint every 2 seconds
   - Shows live status updates (`pending` → `running` → `completed`/`failed`)

2. **Job status endpoint supports admin testing** (`/api/agent-bots/{slug}/jobs/{jobId}`)
   - Added `X-Admin-Test: true` header support (same pattern as invoke endpoint)
   - Admin users can poll job status without needing an API key

3. **Exclude `doc_gen` tool when output is already a document format** (`executor.ts`)
   - When output type is `pdf`, `docx`, or `md`, the `doc_gen` tool is automatically excluded from the LLM's available tools
   - Prevents the LLM from wasting time calling `doc_gen` during the conversation (which would fail anyway due to missing thread context), since the output generator handles document creation **after** the LLM finishes

#### Prevention

- **Always use `async: true`** for production integrations
- **Poll** the job status endpoint every 2–5 seconds
- **Use webhooks** for server-to-server integrations to avoid polling entirely
- Keep `searchDepth: basic` in Tavily config if advanced depth is not strictly needed

---

### DocGen Tool Fails in Agent Bot Context

**Status:** Mitigated by auto-exclusion  
**Affected:** Agent bots with `doc_gen` enabled and document output types  
**Date:** Ongoing

#### Problem

The `doc_gen` tool requires an active chat thread context (`threadId`) to generate documents. Agent Bot invocations do not have a thread context, so every `doc_gen` tool call produces:

```
[DocGen] No thread context available
```

This wastes time and tokens, especially if the LLM retries the tool call.

#### Fix

As noted above, `doc_gen` is now automatically excluded when the output type is already a document format (`pdf`, `docx`, `md`). The output generator (`generateDocument` in `output-generator.ts`) handles document creation **after** the LLM response, using the LLM's text output as content.

#### If You Need Document Generation Mid-Conversation

This is not currently supported for Agent Bots. If your use case requires the LLM to generate intermediate documents during tool calling, use the **chat UI** or **workspace** instead.

---

### Empty RAG Results When Category Has No Documents

**Status:** Expected behavior  
**Affected:** Agent bots linked to categories with no uploaded documents

#### Problem

If an Agent Bot is linked to a category but that category has no documents (or the Qdrant collection does not exist), RAG returns empty results:

```
[Qdrant] Collection category_GOG Enterprise Architecture does not exist, returning empty results
```

The LLM may then rely entirely on web search (if enabled) or general knowledge.

#### Solution

- Upload documents to the linked categories before invoking the bot
- Ensure documents finish processing (status: `Ready`) before testing
- Enable `web_search` tool as a fallback for external information

---

### Model-Specific Tool Call Reliability

**Status:** Resolved (June 2026)
**Affected:** All providers — no longer relevant

#### Historical Context

In the pre-June-2026 LiteLLM-based architecture, streaming tool-call JSON assembly was unreliable for Claude models routed through LiteLLM, causing intermittent failures for document generation tools.

#### Resolution

All providers now use direct native SDKs/APIs (Routes 2/3/5). Every provider — OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Moonshot, Ollama, Azure Foundry, Fireworks, Ollama Cloud — connects via its own native SDK or API. Tool calling works reliably across all models without exception.

#### For Agent Bot Integrators

- All models support reliable tool calling via direct native SDKs
- No action required — routing is automatic per model prefix

---

## Quick Reference Card

```
┌────────────────────────────────────────────────────────────┐
│                    AGENT BOT QUICK REF                      │
├────────────────────────────────────────────────────────────┤
│ CREATE BOT                                                 │
│   Admin → Agent Bots → New Agent Bot                      │
│                                                            │
│ CREATE VERSION                                             │
│   Input schema → Output config → System prompt            │
│   → Categories → Tools → LLM config → Save                │
│                                                            │
│ ACTIVATE                                                   │
│   Versions tab → Toggle Active → Set as Default           │
│                                                            │
│ GET API KEY                                                │
│   API Keys tab → Generate New Key → Copy immediately      │
│                                                            │
│ INVOKE (Async — recommended)                               │
│   POST /api/agent-bots/{slug}/invoke                      │
│   Headers: Authorization: Bearer ab_pk_...                │
│   Body: {input, outputType, async: true}                  │
│                                                            │
│ POLL FOR RESULTS                                           │
│   GET /api/agent-bots/{slug}/jobs/{jobId}                 │
│   Poll every 2s until status = completed | failed         │
│                                                            │
│ DOWNLOAD OUTPUT                                            │
│   GET /api/agent-bots/{slug}/jobs/{jobId}/outputs/...     │
│                                                            │
│ OUTPUT TYPES                                               │
│   text, json, md, pdf, docx, xlsx, pptx, image,           │
│   podcast, chart, diagram                                 │
│                                                            │
│ ERROR CODES TO WATCH                                       │
│   524 → Use async mode                                    │
│   429 → Respect rate limit headers                        │
│   401 → Check API key                                     │
│   404 → Check slug / version / jobId                      │
└────────────────────────────────────────────────────────────┘
```

---

*Last updated: May 2026*
