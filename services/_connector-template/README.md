# Connector Microservice Template

Copy this directory to create a new connector for any external service
(GitHub, Notion, Slack, Jira, Figma, SonarQube, etc.).

## Quick Start

```bash
cp -r services/_connector-template services/my-connector
cd services/my-connector
```

## What to Customize

| File | Action |
|---|---|
| `package.json` | Change `name` to your connector name |
| `Dockerfile` | Update `PORT` if not 8090 |
| `src/config.ts` | Add service-specific env vars (timeouts, API keys, etc.) |
| `src/tools.ts` | Define your service's `ToolDef[]` — 7-12 curated operations |
| `src/ops.ts` | Implement each tool calling the external API |
| `src/ops.ts` | Update `VaultProvider` union to include your provider |
| `src/ops.ts` | Set `PROVIDER` constant to your provider key |

## Files to NOT change

| File | Reason |
|---|---|
| `src/http.ts` | Generic HTTP client — works for any REST API |
| `src/logger.ts` | Structured JSON logger — works for any service |
| `src/server.ts` | Generic HTTP server — dispatches via `OP_HANDLERS` |
| `src/vault.ts` | Token vault client — add your provider to `VaultProvider` |
| `tsconfig.json` | TypeScript config — same for all connectors |

## Architecture

```
GET  /health   → liveness probe (no auth)
GET  /tools    → OpenAI function schemas (auto-importable by host app)
POST /{toolName} → execute tool (bearer auth + HMAC identity)
POST /invoke   → convenience: { op, args, userId }
```

## Identity

The host app injects `X-Connector-User-Id` + `X-Connector-User-Sig` headers.
The connector verifies the HMAC signature and fetches the user's OAuth token
from the host app's vault endpoint (`GET /api/connectors/vault/tokens`).

## Docker

```bash
docker build -t my-connector .
docker run -p 8090:8090 \
  -e CONNECTOR_BEARER_TOKEN=$(openssl rand -hex 32) \
  -e CONNECTOR_HMAC_SECRET=... \
  -e APP_BASE_URL=http://host:3000 \
  my-connector
```
