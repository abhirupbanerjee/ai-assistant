# AI Assistant Test Portal

The Test Portal is a standalone Next.js application for registering and testing approved AI
Assistant workspace and Agent Bot HTTP integrations. It has its own package, Microsoft Entra ID
application, encrypted session, PostgreSQL database, migrations, container, and runtime
configuration.

The portal is intentionally isolated from the stable AI Assistant application. Build and run it
from this directory only. It must not import, mount, or receive database credentials from the
repository-root `src/` or `services/` paths.

> **Implementation status:** the isolation, public-contract, authentication, role, database,
> readiness, and audit foundations are present. Registration and testing workflows from later
> implementation phases are not yet complete.

## Prerequisites

- Node.js 22 or newer
- npm
- PostgreSQL 17 or a compatible supported PostgreSQL server
- A dedicated Microsoft Entra single-tenant application registration
- Docker and Docker Compose only if using the container workflow

## Microsoft Entra setup

Create a separate Entra application for this portal. Do not reuse the AI Assistant application
registration.

Configure the application as follows:

1. Add a **Web** redirect URI matching the portal origin exactly:

   ```text
   http://localhost:3100/auth/callback
   ```

   For production, replace the local origin with the production HTTPS origin.

2. Create a client secret and store its value in `ENTRA_CLIENT_SECRET`.
3. Record the directory tenant ID and application client ID.
4. Use a single-tenant account type.
5. The portal requests only `openid profile email`.

See `docs/configuration.md` for the security and role-mapping details.

## Configuration

Copy the environment template:

```bash
cp .env.example .env.local
```

Required settings:

| Variable | Purpose |
|---|---|
| `PORTAL_BASE_URL` | Exact externally visible portal origin, without a path, query, or fragment |
| `PORTAL_SESSION_SECRET` | At least 32 cryptographically random bytes for encrypted portal sessions |
| `ENTRA_TENANT_ID` | Dedicated Entra directory tenant GUID |
| `ENTRA_CLIENT_ID` | Dedicated Entra application/client GUID |
| `ENTRA_CLIENT_SECRET` | Dedicated Entra client-secret value |
| `DATABASE_URL` | Dedicated portal PostgreSQL connection string |
| `DATABASE_SSL` | `true` by default; set to `false` only for an explicitly trusted local database |
| `PORTAL_ADMIN_EMAILS` | Optional comma-separated exact administrator email allowlist |
| `PORTAL_ADMIN_OBJECT_IDS` | Optional comma-separated Entra object-ID administrator allowlist |

Compose-only convenience settings:

| Variable | Purpose |
|---|---|
| `PORTAL_DB_PASSWORD` | Password used to initialize and connect to the local Compose PostgreSQL service |
| `PORTAL_PORT` | Host port mapped to container port 3000; defaults to 3100 |

At least one administrator email or object ID is required in production. Object-ID mapping is
preferred. Generate a session secret with, for example:

```bash
openssl rand -base64 48
```

`PORTAL_ALLOW_INSECURE_LOCAL_DEVELOPMENT=true` permits HTTP only when the configured production-mode
hostname is `localhost` or `127.0.0.1`. Never use it to justify an insecure non-local deployment.

## Install and run with a host PostgreSQL database

All commands in this section run from the `test-portal/` directory.

1. Install exactly the locked dependencies:

   ```bash
   npm ci
   ```

2. Create a dedicated database and least-privilege portal identity. One local example is:

   ```sql
   CREATE ROLE portal_app LOGIN PASSWORD 'replace-with-a-strong-password';
   CREATE DATABASE test_portal OWNER portal_app;
   ```

3. Confirm or update `DATABASE_URL` in `.env.local`, for example:

   ```text
   DATABASE_URL=postgresql://portal_app:replace-with-a-strong-password@127.0.0.1:5432/test_portal
   DATABASE_SSL=false
   ```

4. Start the development server on the configured local portal port:

   ```bash
   npm run dev -- --port 3100
   ```

5. Open `http://localhost:3100`.

Startup validates configuration and applies portal-owned migrations. The database identity must own
or have schema privileges only for the dedicated portal database.

## Run with Docker Compose

The Compose stack includes the portal and a dedicated PostgreSQL service.

1. Copy the environment template and replace every development placeholder needed for your Entra
   registration and administrator mapping:

   ```bash
   cp .env.example .env
   ```

2. Build and start the stack from `test-portal/` so that the Docker build context cannot access the
   stable application paths:

   ```bash
   docker compose -f compose.yml up --build -d
   ```

3. Follow portal logs:

   ```bash
   docker compose -f compose.yml logs -f portal
   ```

4. Open `http://localhost:3100` unless `PORTAL_PORT` or `PORTAL_BASE_URL` was changed.

5. Stop the stack:

   ```bash
   docker compose -f compose.yml down
   ```

The PostgreSQL data volume remains after `down`. To intentionally remove local portal data, use
`docker compose -f compose.yml down -v`.

## Production build without Docker

Install dependencies and run all checks before building:

```bash
npm ci
npm run check
npm run build
npm run start -- --port 3100
```

All required environment values must be available to the production process. Production requires an
HTTPS `PORTAL_BASE_URL` and at least one administrator mapping. The standalone container build uses
Next.js standalone output from `next.config.ts`.

## Health and readiness

| Endpoint | Meaning |
|---|---|
| `GET /api/health` | Process liveness; does not depend on PostgreSQL |
| `GET /api/readiness` | Configuration, migration, and PostgreSQL readiness |

Examples:

```bash
curl --fail http://localhost:3100/api/health
curl --fail http://localhost:3100/api/readiness
```

A readiness response with HTTP 503 means the portal configuration or database is unavailable. The
server logs contain a sanitized failure message and do not log database credentials.

## Verification commands

```bash
npm run lint              # ESLint
npm run type-check        # TypeScript without emitting output
npm test                  # All Node-based tests
npm run test:unit         # Unit tests
npm run test:contract     # Public-contract fixture tests
npm run test:integration  # Integration definition tests
npm run test:isolation    # Standalone path-boundary controls
npm run test:browser      # Playwright browser tests; requires a running configured portal
npm run check             # Lint, type-check, and all Node-based tests
npm audit                 # Dependency vulnerability report
```

The browser test command expects `PORTAL_BASE_URL` or defaults to `http://127.0.0.1:3100`. Install a
Playwright browser once if the environment does not already contain one:

```bash
npx playwright install chromium
```

## Troubleshooting

### Portal fails during startup

Check that every required value in `.env.local` or the deployment secret store is present. Startup
rejects malformed Entra GUIDs, a session secret shorter than 32 bytes, an insecure production URL,
and a production configuration with no administrator mapping.

### Readiness returns 503

Verify that PostgreSQL is reachable from the portal, the database exists, the portal identity owns
the portal schema, and `DATABASE_SSL` matches the server. Local Compose deliberately disables TLS
only on its private development network.

### Entra reports a redirect URI mismatch

The Entra Web redirect URI must be exactly `${PORTAL_BASE_URL}/auth/callback`, including scheme,
hostname, and port. `PORTAL_BASE_URL` itself must contain only the origin.

### Sign-in succeeds but the user is not an administrator

Use the exact normalized email claim or, preferably, the Entra object ID in `PORTAL_ADMIN_EMAILS` or
`PORTAL_ADMIN_OBJECT_IDS`, then restart the portal. Unmapped authenticated identities intentionally
receive the `user` role.

### Docker build cannot find repository-root files

This is expected. The image must be built with `test-portal/` as its context. Stable application
paths are deliberately unavailable to the build.
