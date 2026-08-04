# Drive Connector Microservice

Phase 1 **shared service-identity** connector for Google Sheets, Drive, Docs, and
Microsoft OneDrive/Excel. A tiny Node/TypeScript service (zero runtime dependencies
— Node built-ins only)
that owns a GCP service-account credential, mints/refreshes OAuth2 access tokens
internally, and exposes a stable REST surface secured by a static bearer token.

The host AI-assistant app calls it via its existing **Function API** tool, which
sends static auth headers — perfect for this design since the connector handles
all Google OAuth complexity behind the bearer token.

---

## Architecture

```
┌──────────────┐   static bearer    ┌──────────────────┐   service-account   ┌──────────┐
│  AI Assistant │ ─────────────────▶ │ drive-connector  │ ──────────────────▶ │  Google  │
│  (Function API)│  POST /<toolName>  │  (this service)  │  OAuth2 JWT-bearer  │  APIs    │
└──────────────┘   raw args as body  └──────────────────┘  token (auto-refresh)└──────────┘
```

- **Phase 1 (this service):** one GCP service account shared by all users.
  Every sheet/doc must be explicitly shared with the service account's
  `client_email`.
- **Phase 2 (future):** the connector already accepts an optional `userId`
  on every call (ignored now). Phase 2 will add per-user OAuth token storage
  and route calls to the user's own Drive — no API contract change needed.

---

## Prerequisites

### 1. Create a GCP service account

1. Go to **Google Cloud Console → IAM & Admin → Service Accounts**.
2. **Create service account** → name it (e.g. `ai-assistant-connector`).
3. No project role needed (access is granted per-file by sharing).
4. **Keys tab → Add Key → Create new key → JSON**. Download the JSON file.
   This is your `gcp-service-account.json`.
5. Note the **`client_email`** inside the JSON (e.g.
   `ai-assistant-connector@my-project.iam.gserviceaccount.com`).

### 2. Enable APIs

In the same GCP project, enable:
- **Google Sheets API**
- **Google Drive API**
- **Google Docs API**
- **Google Slides API**

(APIs & Services → Library → search and Enable each.)

### 3. Share your sheets/docs/slides with the service account (read/write tools)

Open the Google Sheet, Doc, or Slides deck → **Share** → paste the service
account's `client_email` → grant **Viewer** (read-only) or **Editor**
(read/write).

> The service account only sees files explicitly shared with its email.
>
> **Note:** `drive_upload_file` and `drive_list_folders` use the
> `drive.file` scope. Files uploaded via `drive_upload_file` are owned by
> the acting identity (service account or connected user) and do **not**
> need to be shared back with the service account. Folders created by the
> app are also visible to `drive_list_folders` automatically.

---

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `CONNECTOR_BEARER_TOKEN` | **Yes** | — | Static bearer token clients must send. Min 16 chars. Generate with `openssl rand -hex 32`. |
| `PORT` | No | `8090` | HTTP listen port. |
| `SERVICE_ACCOUNT_PATH` | No | `/run/secrets/gcp-service-account.json` | Path to the service-account JSON key file. |
| `SERVICE_ACCOUNT_JSON` | No | — | Inline JSON key (overrides `SERVICE_ACCOUNT_PATH`). Useful for env-var injection in Docker. |
| `GOOGLE_SCOPES` | No | spreadsheets + drive.readonly + drive.file + documents + presentations | Space/comma-delimited Google API scopes. The default now includes `drive.file` so the connector can upload files and list app-created folders. |
| `GOOGLE_TIMEOUT_MS` | No | `30000` | Outbound Google API request timeout. |
| `CORS_ORIGINS` | No | `*` | Comma-delimited allowed CORS origins. |
| `MS_CLIENT_ID` | No | — | Azure AD / Microsoft Entra application ID. Used for OneDrive/Excel app-only access. Defaults to `AZURE_AD_CLIENT_ID`. |
| `MS_CLIENT_SECRET` | No | — | Azure AD application secret. Defaults to `AZURE_AD_CLIENT_SECRET`. |
| `MS_TENANT_ID` | No | — | Azure AD tenant ID. Defaults to `AZURE_AD_TENANT_ID`. |
| `MS_GRAPH_TIMEOUT_MS` | No | `30000` | Outbound Microsoft Graph request timeout. |
| `CONNECTOR_HMAC_SECRET` | No (Phase 2) | — | HMAC secret shared with the app. When set, the connector verifies the `X-Connector-User-Sig` header and trusts `X-Connector-User-Id` (ignoring any body `userId`). Must match the app's `CONNECTOR_HMAC_SECRET`. Generate with `openssl rand -hex 32`. |
| `APP_BASE_URL` | No (Phase 2) | — | Base URL of the AI-assistant app (e.g. `https://assistant.example.com`). Used to call the internal vault endpoint (`/api/connectors/vault/tokens`) to fetch per-user OAuth tokens. Required for per-user mode; without it the connector only uses the shared service account. |
| `LOG_LEVEL` | No | `info` | `debug` \| `info` \| `warn` \| `error` |

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness probe. Returns the service-account email. |
| `GET` | `/tools` | None | All tool schemas in OpenAI function format. |
| `POST` | `/<toolName>` | Bearer | Execute a tool. **Body = raw function arguments.** |
| `POST` | `/invoke` | Bearer | Convenience: `{"op":"<toolName>","args":{...},"userId":"..."}` |

### Available tools

| Tool | Category | Description |
|---|---|---|
| `sheets_get_values` | sheets | Read a range (A1 notation). |
| `sheets_batch_get_values` | sheets | Read multiple ranges in one call. |
| `sheets_update_values` | sheets | Write values into a range. |
| `sheets_append_values` | sheets | Append rows after the last row of data. |
| `sheets_get_spreadsheet` | sheets | Get spreadsheet metadata (tabs, dimensions, named ranges). |
| `drive_list_files` | drive | List files visible to the service account. |
| `drive_get_file` | drive | Get metadata for a single file. |
| `drive_upload_file` | drive | Upload a file to Google Drive (multipart, with optional Office→Google conversion and find-or-create folder placement). |
| `drive_list_folders` | drive | List app-created folders (picker-safe set under the `drive.file` scope). |
| `docs_export` | docs | Export a Google Doc as text/markdown/PDF/DOCX. |
| `docs_create` | docs | Create a new Google Doc. |
| `docs_get` | docs | Get a Google Doc title and body text. |
| `docs_append_text` | docs | Append text to the end of a Google Doc. |
| `docs_replace_text` | docs | Replace all occurrences of a string in a Google Doc. |
| `slides_export` | slides | Export a Google Slides deck as text/PDF/PPTX (Drive export). |
| `slides_get_presentation` | slides | Get Slides structure with per-slide text and speaker notes. |
| `slides_create` | slides | Create a new Google Slides presentation. |
| `slides_add_slide` | slides | Add a slide to a presentation. |
| `slides_insert_text` | slides | Insert text into a shape on a slide. |
| `slides_replace_all_text` | slides | Replace all occurrences of text across a presentation. |
| `ms_drive_create_folder` | onedrive | Create a folder in OneDrive. |
| `ms_drive_upload_file` | onedrive | Upload a text file to OneDrive. |
| `ms_excel_get_range` | onedrive | Read a range from an Excel workbook in OneDrive. |
| `ms_excel_update_range` | onedrive | Write values into a range of an Excel workbook. |

Every tool accepts an optional `userId` (string) — reserved for Phase 2
per-user OAuth. It is accepted but ignored in Phase 1.

---

## Running locally

```bash
cd services/drive-connector
npm install
npm run build

# Set required env vars
export CONNECTOR_BEARER_TOKEN="$(openssl rand -hex 32)"
export SERVICE_ACCOUNT_PATH="/path/to/gcp-service-account.json"

npm start
```

Smoke test:

```bash
# Health check
curl http://localhost:8090/health

# List tools
curl http://localhost:8090/tools | jq

# Read a sheet range (path-based — matches Function API contract)
curl -X POST http://localhost:8090/sheets_get_values \
  -H "Authorization: Bearer $CONNECTOR_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"spreadsheetId":"1ABC...xyz","range":"Sheet1!A1:D10"}'

# Same call via /invoke convenience endpoint
curl -X POST http://localhost:8090/invoke \
  -H "Authorization: Bearer $CONNECTOR_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"op":"sheets_get_values","args":{"spreadsheetId":"1ABC...xyz","range":"Sheet1!A1:D10"}}'
```

---

## Docker deployment

### 1. Place the service-account key

```bash
mkdir -p config
cp /path/to/gcp-service-account.json config/gcp-service-account.json
```

### 2. Set the bearer token

Add to your `.env`:

```env
CONNECTOR_BEARER_TOKEN=<your-generated-token>
```

Generate a token with:
```bash
openssl rand -hex 32
```

### 3. Start with the override compose file

**Recommended — use the root Makefile:**

```bash
# Start app + infrastructure + drive-connector
make up

# Or start only the connector (app/infrastructure must already be running)
make up-connector

# Rebuild and restart only the connector after code changes
make build-connector
```

**Equivalent raw `docker compose` commands (same result, more typing):**

```bash
# Start everything
docker compose \
  -f docker-compose.yml \
  -f services/drive-connector/docker-compose.connector.yml \
  up -d

# Start only the connector
docker compose \
  -f docker-compose.yml \
  -f services/drive-connector/docker-compose.connector.yml \
  up -d drive-connector

# Rebuild and restart only the connector
docker compose \
  -f docker-compose.yml \
  -f services/drive-connector/docker-compose.connector.yml \
  up -d --build drive-connector
```

Run `make help` for a full list of shortcuts.

The app container reaches the connector at `http://drive-connector:8090`
(they share the `policy-bot-network`).

### 4. Verify it's running

```bash
# From the VM host:
curl http://localhost:8090/health

# From inside the app container (confirms network connectivity):
docker exec policy-bot-app node -e \
  "fetch('http://drive-connector:8090/health').then(r=>r.json()).then(j=>console.log(j))"

# Check container logs:
docker logs policy-bot-drive-connector --tail 20
```

---

## VM deployment workflow (end-to-end)

This section maps to the standard git-based deployment flow used on the
production VM. The connector is **separate from the main app** — it has its
own Dockerfile and compose override — so it does not affect your normal
`docker compose up -d --build` for the app.

### First-time setup (do once on the VM)

```bash
# 1. Pull the latest code (includes services/ and .dockerignore changes)
git pull

# 2. Place your GCP service-account key
cp /path/to/gcp-service-account.json config/gcp-service-account.json

# 3. Generate and set the bearer token
echo "CONNECTOR_BEARER_TOKEN=$(openssl rand -hex 32)" >> .env

# 4. Build and start the connector
make up-connector

# Or, equivalently:
# docker compose \
#   -f docker-compose.yml \
#   -f services/drive-connector/docker-compose.connector.yml \
#   up -d --build drive-connector

# 5. Verify
curl http://localhost:8090/health
```

### Normal app deployment (unchanged)

Your existing flow is **not affected** — the main app rebuilds as before:

```bash
git pull
make down
make up
```

Or, equivalently:

```bash
git pull
docker compose \
  -f docker-compose.yml \
  -f services/drive-connector/docker-compose.connector.yml \
  down
docker compose \
  -f docker-compose.yml \
  -f services/drive-connector/docker-compose.connector.yml \
  up -d --build
```

This rebuilds the main app and the connector together. The connector can also
be managed independently with `make up-connector`, `make down-connector`, and
`make build-connector`.

> **Note:** If you run `docker compose down` *without* the `-f` override,
> the connector is not touched (it's not in the base `docker-compose.yml`).
> If you run `docker compose down` *with* the override, both stop.

### Updating the connector after code changes

When you push connector code changes and pull them on the VM:

```bash
git pull

# Rebuild and restart only the connector (app keeps running):
make build-connector

# Or, equivalently:
# docker compose \
#   -f docker-compose.yml \
#   -f services/drive-connector/docker-compose.connector.yml \
#   up -d --build drive-connector
```

### Stopping the connector

```bash
make down-connector

# Or, equivalently:
docker compose \
  -f docker-compose.yml \
  -f services/drive-connector/docker-compose.connector.yml \
  down drive-connector
```

To stop without removing the container, use:

```bash
docker compose \
  -f docker-compose.yml \
  -f services/drive-connector/docker-compose.connector.yml \
  stop drive-connector
```

---

## Wiring into the AI Assistant (Function API config)

In **Admin → Tools → Function API**, create a new config with these values:

| Field | Value |
|---|---|
| **Name** | Google Drive Connector |
| **Description** | Shared service-account access to Google Sheets, Drive, Docs, Slides, and Microsoft OneDrive/Excel |
| **Base URL** | `http://drive-connector:8090` |
| **Auth Type** | `bearer` |
| **Auth Header** | *(leave default — uses `Authorization: Bearer <token>`)* |
| **Auth Credentials** | *your `CONNECTOR_BEARER_TOKEN` value* |
| **Timeout (s)** | `30` |
| **Cache TTL (s)** | `0` (or `60` for read-only ops) |
| **Enabled** | ✅ |

Then paste the **Tools Schema** (copy from `curl http://drive-connector:8090/tools`
→ `tools` array) and the **Endpoint Mappings** below.

### Endpoint mappings (JSON)

Each tool maps to a path-based POST endpoint — the app sends the raw function
arguments as the JSON body, which is exactly what the connector expects:

```json
{
  "sheets_get_values":        { "method": "POST", "path": "/sheets_get_values" },
  "sheets_batch_get_values":  { "method": "POST", "path": "/sheets_batch_get_values" },
  "sheets_update_values":     { "method": "POST", "path": "/sheets_update_values" },
  "sheets_append_values":     { "method": "POST", "path": "/sheets_append_values" },
  "sheets_get_spreadsheet":   { "method": "POST", "path": "/sheets_get_spreadsheet" },
  "drive_list_files":         { "method": "POST", "path": "/drive_list_files" },
  "drive_get_file":           { "method": "POST", "path": "/drive_get_file" },
  "drive_upload_file":        { "method": "POST", "path": "/drive_upload_file" },
  "drive_list_folders":       { "method": "POST", "path": "/drive_list_folders" },
  "docs_export":              { "method": "POST", "path": "/docs_export" },
  "slides_export":            { "method": "POST", "path": "/slides_export" },
  "slides_get_presentation":  { "method": "POST", "path": "/slides_get_presentation" }
}
```

### Assign to a category

Under **Category Access**, check the **PMO** category (or whichever category
should have access). The tools will then be available to LLMs serving chats
in that category.

### SSRF hostname allowlist (required for Docker-network connectors)

The app enforces an **SSRF guard** that blocks URLs resolving to
private/reserved IP ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16`, `169.254.0.0/16`, etc.). The `drive-connector` service
runs on the Docker network, so its hostname `http://drive-connector:8090`
resolves to a private IP and is blocked by default.

To allow the connector, add this to the app's `.env`:

```bash
SSRF_ALLOW_HOSTS=drive-connector
```

Then restart the app container (`docker compose up -d app`). This is a
**hostname allowlist**, not an IP bypass: the redirect-safe SSRF fetch still
validates every redirect hop, and `169.254.169.254` (cloud metadata) remains
blocked even from an allowlisted host. Exact match only — wildcards are not
supported.

Only admin-configured HTTP targets use this allowlist. LLM-controlled tools
like `web_extract` and `pagespeed` stay fully guarded and cannot use it.

---

## Security notes

- The bearer token is compared in **constant time** to prevent timing attacks.
- The service-account JSON key is mounted **read-only** and never logged.
- Access tokens are cached in-memory with a 60-second safety margin before
  expiry; a 401 from Google triggers an automatic token refresh + retry.
- The service account only sees files **explicitly shared** with its
  `client_email` — grant the minimum role (Viewer for read-only categories).
- For production, rotate the bearer token periodically and restrict
  `CORS_ORIGINS` to the app's domain.

---

## File layout

```
services/drive-connector/
├── package.json              # No runtime deps; devDeps: typescript, @types/node
├── tsconfig.json
├── Dockerfile                # Multi-stage: build → node:22-slim runtime
├── docker-compose.connector.yml  # Override to add the service
├── .gitignore
├── README.md                 # This file
└── src/
    ├── config.ts             # Env-based configuration
    ├── logger.ts             # Leveled JSON logger
    ├── http.ts               # Dependency-free HTTP client (node http/https)
    ├── google.ts             # Service-account JWT → access token + cache
    ├── tools.ts              # Tool registry + OpenAI schema renderer
    ├── ops.ts                # Sheets/Drive/Docs API implementations
    └── server.ts             # HTTP server, bearer auth, dispatcher
```

---

## Phase 2 roadmap

This service is designed so Phase 2 (per-user OAuth) is **additive**:

1. Add an OAuth connect flow in the host app (Google + Microsoft).
2. Store encrypted refresh tokens in a vault table (reuse
   `src/lib/encryption.ts` AES-256-GCM).
3. Thread `userId` through `executeTool()` call sites.
4. The connector looks up the user's token by `userId` and mints per-user
   access tokens instead of the service-account JWT.
5. Falls back to the shared service account when `userId` is absent.

No change to the REST contract or Function API config is needed — the
`userId` field is already accepted on every call.
