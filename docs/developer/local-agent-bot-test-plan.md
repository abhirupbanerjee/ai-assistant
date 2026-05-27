# Local Agent Bot Test Page — Implementation Plan

> **Status:** Planning document  
> **Goal:** Build a standalone, local HTML page that lets developers test any Agent Bot against a live Policy Bot instance without writing code or using the admin dashboard.  
> **Output:** Single-file (`agent-bot-tester.html`) or multi-file static site opened directly in a browser (`file://` or served via `npx serve`).

---

## 1. Objective

Provide a lightweight, zero-build, client-side test harness for the Policy Bot Agent Bot public API. A developer or integrator should be able to:

1. Open the HTML file in any modern browser.
2. Enter their **Policy Bot base URL** (e.g., `http://localhost:3000` or `https://policybot.gov`) and **API key**.
3. Discover which Agent Bot the key belongs to (via the `/api/agent-bots/spec` discovery endpoint).
4. View the bot's metadata (name, description, input schema, supported output types, upload config).
5. Fill a dynamic form generated from the bot's `inputSchema`.
6. Optionally upload files if the bot supports it.
7. Select an output type and invoke the bot (**async mode only** — safe default).
8. Watch live polling progress (`pending` → `running` → `completed`/`failed`).
9. View the response: text preview, JSON tree, or download generated files.
10. Click **"Test Another Bot"** to return to the setup screen and start over with a different key or URL.

---

## 2. Why This Exists

| Pain Point | How This Tool Helps |
|------------|---------------------|
| Admin Test tab requires login + admin rights | Uses only the public API key — works for external integrators |
| `curl` / Postman requires manual polling logic | Built-in polling with visual progress |
| Input schema is invisible until you open the admin UI | Auto-generates form fields from `/api/agent-bots/spec` |
| No quick way to verify a key or bot health | Discovery endpoint validation on every load |
| Need to switch between bots frequently | One-click reset to test another bot |

---

## 3. Architecture

### 3.1 Runtime Model

This is a **pure static HTML + vanilla JavaScript** application. No bundler, no framework, no server required.

```
┌─────────────────────────────────────────┐
│  Browser (file:// or npx serve)         │
│                                         │
│  ┌─────────────┐    ┌────────────────┐ │
│  │ Setup Page  │───►│ Discovery Call │ │
│  │ (URL + Key) │    │ GET /spec      │ │
│  └─────────────┘    └────────────────┘ │
│         │                               │
│         ▼                               │
│  ┌─────────────────────────────────┐    │
│  │ Input / Response Page           │    │
│  │  • Dynamic form                 │    │
│  │  • File upload (optional)       │    │
│  │  • Invoke → Poll → Results      │    │
│  │  • Back button to Setup         │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
                      │
                      │ HTTPS / HTTP
                      ▼
        ┌─────────────────────────────┐
        │  Policy Bot Instance        │
        │  /api/agent-bots/spec       │
        │  /api/agent-bots/{slug}/... │
        └─────────────────────────────┘
```

### 3.2 State Machine

```
[SETUP] ──(fetch spec)──► [LOADING] ──(success)──► [INPUT_FORM]
   ▲                          │
   │                      (failure)
   │                          ▼
   └──────────────────── [ERROR_DISPLAY]

[INPUT_FORM] ──(invoke + poll)──► [JOB_POLLING] ──(completed)──► [RESULTS]
   │                                │
   │                            (failed)
   │                                ▼
   └──────────────────────────── [ERROR_DISPLAY]

[RESULTS] ──("Test Another Bot")──► [SETUP]
```

### 3.3 Data Flow

1. **Discovery**  
   `GET {baseUrl}/api/agent-bots/spec`  
   Header: `Authorization: Bearer {apiKey}`

2. **Upload (optional)**  
   `POST {baseUrl}/api/agent-bots/{slug}/upload`  
   FormData with `file` field  
   → receive `fileId`

3. **Invoke**  
   `POST {baseUrl}/api/agent-bots/{slug}/invoke`  
   Body: `{ input, outputType, async: true, files?: [...] }`

4. **Poll**  
   `GET {baseUrl}/api/agent-bots/{slug}/jobs/{jobId}`  
   Every **2 seconds** until `status` is `completed` or `failed`.

5. **Download**  
   `GET {baseUrl}{downloadUrl}` (from outputs array)  
   Or open in new tab for binary files.

---

## 4. Page Design

### 4.1 Setup Page (Initial View)

**Purpose:** Capture connection details and validate them.

**Fields:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| Policy Bot URL | text | `http://localhost:3000` | Stripped of trailing slash |
| API Key | password | — | Masked input; `ab_pk_...` format hint |

**Actions:**
- **Connect** — fetches `/api/agent-bots/spec`
- **Remember me** — optional `localStorage` persistence of URL and key (warn about security)

**Loading State:**
- Spinner + "Discovering agent bot..."

**Error State:**
- Red banner with HTTP status + error message from response body (e.g., `INVALID_API_KEY`, `AGENT_BOT_DISABLED`)
- Keep form values so user can correct and retry

**Success Transition:**
- Fade out setup, fade in input/response page pre-populated with discovered metadata.

---

### 4.2 Input / Response Page (Main View)

**Purpose:** Display bot metadata, collect input, execute, and show results.

#### 4.2.1 Header Bar

- **Bot Name** (from spec): large bold text
- **Bot Slug**: small monospace badge
- **Description**: subtitle text
- **Version**: `v1.2` (label from spec)
- **Back / Reset** button: clears all state and returns to Setup Page

#### 4.2.2 Metadata Accordion (collapsed by default)

- Input schema parameters table
- Supported output types (chips)
- Upload config (max files, max size, allowed types)
- Endpoint list (for reference)

#### 4.2.3 Dynamic Input Form

Generated from `inputSchema.parameters`:

| Schema Type | HTML Input | Validation |
|-------------|------------|------------|
| `string` + required | `<input type="text">` or `<textarea>` | `required` attribute |
| `string` + optional | `<input type="text">` | none |
| `number` | `<input type="number">` | `min`/`max` if specified |
| `boolean` | `<input type="checkbox">` | — |
| `enum` (if provided) | `<select>` | — |

- **Special handling for `query`:** always render as `<textarea rows="6">` regardless of type, since it is typically the main prompt.
- Labels use `parameter.name` + `parameter.description` as help text.
- Defaults pre-filled from `parameter.default`.

#### 4.2.4 Output Type Selector

`<select>` populated from `outputConfig.enabledTypes`.  
Pre-select `outputConfig.defaultType`.  
Disabled if only one type is enabled.

#### 4.2.5 File Upload (conditional)

Rendered only if `uploadConfig.enabled === true`.

- Native `<input type="file" multiple>`
- Validate count ≤ `maxFiles`
- Validate each file size ≤ `maxSizePerFileMB`
- Validate MIME type against `allowedTypes` (support wildcards like `image/*`)
- Show file list with remove buttons
- **Upload strategy:** upload files immediately on selection (not at invoke time) so `fileId`s are ready. Show per-file upload status.

#### 4.2.6 Invoke Button

- Label: **"Run Agent Bot"**
- Disabled while: form invalid, files uploading, or job already running
- On click: assemble payload, POST to `/invoke`, start polling

#### 4.2.7 Job Status Panel

Appears after invoke. Shows:

- **Job ID**: monospace, copy-to-clipboard button
- **Status Badge**: `pending` (gray), `running` (blue pulse), `completed` (green), `failed` (red)
- **Elapsed timer**: seconds since invoke
- **Progress bar**: indeterminate for pending/running, filled for completed/failed
- **Cancel button**: (nice-to-have v2) — not required for MVP

#### 4.2.8 Results Panel

Appears when `status === 'completed'`.

**Text / JSON / Markdown output:**
- Render in a scrollable `<pre>` or markdown-preview div
- Copy-to-clipboard button
- If JSON, pretty-print with syntax highlighting (simple CSS classes)

**File output (pdf, docx, xlsx, pptx, image, podcast, chart, diagram):**
- Filename + file size (human-readable)
- **Preview** if possible:
  - `image` → `<img>` tag
  - `chart` / `diagram` → attempt SVG/PNG render (or just show as download)
  - Others → generic file icon
- **Download button** → opens `{baseUrl}{downloadUrl}` in new tab

**Sources Panel (collapsible):**
- If `sources` array present, show table: Document, Page, Score, Snippet (truncated)

**Token Usage & Timing:**
- Small footer: `Prompt: 3,200 | Completion: 1,800 | Total: 5,000 tokens | Time: 45s`

#### 4.2.9 Error Panel

Appears when `status === 'failed'` or any non-2xx during polling.

- Error message (from `job.error.message` or fallback)
- Error code badge (e.g., `PROCESSING_ERROR`)
- Suggested fix based on known error code mapping (see §6)
- **Retry** button: returns to input form with values preserved

---

## 5. Technical Specification

### 5.1 File Structure

```
agent-bot-tester/
├── index.html          # Single-file entry point (optional)
├── agent-bot-tester.html   # Alternative: everything inlined for portability
├── css/
│   └── styles.css      # Or embedded <style> for single-file mode
├── js/
│   ├── app.js          # State machine, routing, event binding
│   ├── api.js          # Fetch wrappers for all Agent Bot endpoints
│   ├── ui.js           # DOM builders: form generator, status panels
│   └── storage.js      # localStorage helpers (optional persistence)
└── README.md           # How to run
```

**Recommended approach:** Start as a single `agent-bot-tester.html` file with embedded CSS and JS for maximum portability (email to a colleague, open from disk, no CORS issues with `file://`). If it grows beyond ~800 lines, split into separate files and serve via `npx serve`.

### 5.2 API Client Module (`api.js`)

```javascript
// Pseudocode — exact implementation left to build phase
class AgentBotApi {
  constructor(baseUrl, apiKey) { /* strip trailing slash, store */ }

  async discover() {
    // GET /api/agent-bots/spec
    // Returns: spec object or throws ApiError
  }

  async uploadFile(slug, file) {
    // POST /api/agent-bots/{slug}/upload
    // FormData, track progress via XMLHttpRequest if desired
    // Returns: { fileId, filename }
  }

  async invoke(slug, { input, outputType, files }) {
    // POST /api/agent-bots/{slug}/invoke
    // Body: { input, outputType, async: true, files }
    // Returns: { jobId, status }
  }

  async getJobStatus(slug, jobId) {
    // GET /api/agent-bots/{slug}/jobs/{jobId}
    // Returns: full job object
  }

  buildDownloadUrl(downloadPath) {
    // Prefix baseUrl if downloadPath is relative
  }
}
```

**Error Handling:**
- Network errors → "Cannot connect to {baseUrl}. Is Policy Bot running?"
- 401 → "Invalid API key"
- 404 → "Agent bot not found or not active"
- 429 → Show rate limit headers, suggest waiting
- 524 → Should never happen in async mode; but if it does, suggest checking async flag

### 5.3 UI Generator Module (`ui.js`)

```javascript
// Pseudocode
function renderSetupPage(container, onConnect) { }
function renderInputPage(container, spec, onInvoke, onReset) { }
function renderStatusPanel(container, jobId) { }
function updateStatusPanel(container, job) { }
function renderResultsPanel(container, job, baseUrl, apiKey) { }
function renderErrorPanel(container, error, onRetry) { }
function generateInputForm(parameters) { /* returns DOM fragment */ }
function collectFormData(form) { /* returns { [name]: value } */ }
```

### 5.4 State Management

Simple in-memory object (no Redux needed):

```javascript
const state = {
  baseUrl: null,
  apiKey: null,
  spec: null,        // result of discovery
  inputValues: {},   // cached form data
  uploadedFiles: [], // [{ fileId, filename }]
  currentJobId: null,
  pollIntervalId: null,
};
```

On **"Test Another Bot"** (`onReset`): clear `state` entirely and re-render setup page.

---

## 6. CORS Considerations

Agent Bot public endpoints are designed for external callers. However, when opening the tester from `file://`, browsers send `Origin: null`. Policy Bot must respond with:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Authorization, Content-Type
```

for the public Agent Bot routes (`/api/agent-bots/*`).

**Verification step:** Before building, confirm CORS is enabled on:
- `GET /api/agent-bots/spec`
- `POST /api/agent-bots/{slug}/invoke`
- `GET /api/agent-bots/{slug}/jobs/{jobId}`
- `POST /api/agent-bots/{slug}/upload`
- `GET /api/agent-bots/{slug}/jobs/.../download`

If CORS is blocked, the tester must be served from the same origin (e.g., `http://localhost:3000/agent-bot-tester.html`) or via a small local proxy.

---

## 7. UX Details

### 7.1 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` (in Setup) | Trigger Connect |
| `Ctrl/Cmd + Enter` (in Input Form) | Trigger Invoke |
| `Esc` | Cancel polling (if implemented) |

### 7.2 Copy-to-Clipboard

- Job ID
- Full JSON response
- cURL equivalent of the invoke request (nice-to-have: generates a curl command for sharing)

### 7.3 Auto-Save Draft

Save `inputValues` to `localStorage` (keyed by bot slug) so refreshing the page does not lose a carefully crafted prompt. Clear on successful completion or explicit reset.

### 7.4 Responsive Layout

- Mobile: stack vertically, full-width inputs
- Desktop: two-column layout (form left, status/results right) when screen ≥ 1024px

---

## 8. Build Steps (Implementation Checklist)

1. **Scaffold**
   - [ ] Create `agent-bot-tester.html` with basic HTML5 boilerplate
   - [ ] Embed minimal CSS (Tailwind CDN or custom ~200 lines)
   - [ ] Create `AgentBotApi` class with `fetch` wrappers

2. **Setup Page**
   - [ ] URL + API key inputs
   - [ ] Connect button → `GET /api/agent-bots/spec`
   - [ ] Loading spinner
   - [ ] Error banner with retry

3. **Discovery → Input Page**
   - [ ] Render bot name, slug, description, version
   - [ ] Generate dynamic form from `inputSchema.parameters`
   - [ ] Output type selector
   - [ ] Conditional file upload UI
   - [ ] File upload logic (immediate upload, fileId tracking)
   - [ ] Invoke button with validation

4. **Polling & Results**
   - [ ] POST invoke, capture `jobId`
   - [ ] Poll every 2s, update status badge + timer
   - [ ] Render results:
     - [ ] Text/JSON/Markdown preview
     - [ ] File download links
     - [ ] Sources table
     - [ ] Token usage / timing footer
   - [ ] Error panel for failed jobs

5. **Navigation**
   - [ ] "Test Another Bot" button clears state and returns to setup
   - [ ] Browser back button behavior (optional: hash routing `#setup` / `#run`)

6. **Polish**
   - [ ] localStorage persistence (URL, key, draft inputs)
   - [ ] Copy-to-clipboard buttons
   - [ ] cURL generator
   - [ ] Responsive CSS

7. **Testing**
   - [ ] Test with `text` output bot
   - [ ] Test with `docx` / `pdf` output bot
   - [ ] Test with file upload enabled
   - [ ] Test with invalid API key
   - [ ] Test with disabled bot
   - [ ] Test across Chrome, Firefox, Safari
   - [ ] Verify CORS on all endpoints

---

## 9. Testing Matrix

| Scenario | Expected Behavior |
|----------|-------------------|
| Valid key, simple text bot | Discovery succeeds → form renders → invoke → poll → text displayed |
| Valid key, document output bot | Discovery succeeds → invoke → poll → download link shown → file opens |
| Key with upload-enabled bot | File picker visible → upload on select → fileId passed to invoke |
| Invalid API key | Setup page shows red error: "Invalid API key (401)" |
| Bot disabled (403) | Error: "Agent bot is disabled" |
| Job fails mid-flight | Polling stops, red error panel with `job.error.message` |
| Network down | Error: "Cannot connect to {url}" |
| Large file upload | Rejected before upload if > maxSizePerFileMB |
| Browser refresh mid-poll | If localStorage enabled, offer to resume polling with same jobId (optional) |

---

## 10. Future Enhancements (Out of Scope for MVP)

| Feature | Value |
|---------|-------|
| Webhook test receiver | Local echo server to test webhook payloads |
| Batch runner | CSV input to run same bot multiple times |
| Response history | Sidebar of previous invocations for this session |
| Dark mode | Toggle for comfortable low-light testing |
| OpenAPI import | Paste an OpenAPI spec to test arbitrary endpoints beyond Agent Bots |

---

## 11. Quick Start (for the Developer Who Builds This)

```bash
# 1. Create the file
touch agent-bot-tester.html

# 2. Open in browser
open agent-bot-tester.html
# or
npx serve . -p 8080
# then visit http://localhost:8080/agent-bot-tester.html

# 3. Test against a running Policy Bot instance
#    (docker compose -f docker-compose.local.yml up -d)
```

---

## 12. References

- [`/docs/features/agent-bot.md`](../features/agent-bot.md) — Complete Agent Bot feature guide
- [`/docs/features/agent-bot.md#4-agent-bot-api-documentation`](../features/agent-bot.md#4-agent-bot-api-documentation) — Endpoint specs
- [`/docs/features/agent-bot.md#pattern-0-discovery--auto-configuration-recommended-first-step`](../features/agent-bot.md#pattern-0-discovery--auto-configuration-recommended-first-step) — Discovery pattern
- [`/docs/features/agent-bot.md#pattern-2-asynchronous-with-polling-recommended`](../features/agent-bot.md#pattern-2-asynchronous-with-polling-recommended) — Polling pattern
- [`/docs/features/agent-bot.md#6-known-error-codes`](../features/agent-bot.md#6-known-error-codes) — Error code reference

---

*Plan prepared: 2026-05-26*  
*Next step: Implement `agent-bot-tester.html` following this plan.*
