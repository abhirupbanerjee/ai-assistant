# Platform Rebranding: Policy Bot → AI Assistant

> **Date:** July 3, 2026  
> **Scope:** Complete rebranding across all documentation, source code, configuration, and APIs  
> **Status:** Complete — all changes applied and validated

---

## Summary

The platform formerly known as **Policy Bot** has been rebranded to **AI Assistant**. The portal domain has changed to **ai.abhirup.app**. This document catalogs every change, explains the impact on external integrations, and provides migration guidance.

---

## What Changed

### 1. Platform Name

| Before | After |
|--------|-------|
| `Policy Bot` | `AI Assistant` |

Changed everywhere: browser tab titles, sign-in pages, app headers, landing pages, PWA manifests, branding defaults, email sender names, generated document metadata, database schema comments, Docker Compose comments, environment file headers, SonarQube project name, and all documentation.

### 2. Portal Domain

| Before | After |
|--------|-------|
| `policybot.gov` | `ai.abhirup.app` |
| `policybot.abhirup.app` | `ai.abhirup.app` |
| `policybot.example.com` | `ai.abhirup.app` |
| `policybot.app` | `ai.abhirup.app` |

Updated in all API specifications, curl examples, embed scripts, webhook URLs, NEXTAUTH_URL references, and documentation.

### 3. npm Package Name

| Before | After |
|--------|-------|
| `policy-bot` | `ai-assistant` |

The `name` field in `package.json` changed. npm scripts now display as `ai-assistant@0.1.0`.

### 4. Copyright Holder

| Before | After |
|--------|-------|
| `Policy Bot Contributors` | `AB` |

Updated in `LICENSE` file (3 occurrences).

### 5. Embed Widget API (Breaking Change)

| Before | After |
|--------|-------|
| `window.PolicyBotEmbed()` | `window.AIAssistantEmbed()` |
| `interface PolicyBotEmbedOptions` | `interface AIAssistantEmbedOptions` |
| `function initPolicyBotEmbed()` | `function initAIAssistantEmbed()` |
| `globalName: 'PolicyBotEmbed'` | `globalName: 'AIAssistantEmbed'` |
| DOM container: `policybot-embed-container` | `ai-assistant-embed-container` |
| Console prefix: `[PolicyBot Embed]` | `[AI Assistant Embed]` |

**This is a breaking change for any external website that uses the embed widget via `window.PolicyBotEmbed()`.**

### 6. Internal Code Identifiers

| Before | After |
|--------|-------|
| `whyPolicyBot` (JS object property) | `whyPlatform` |

Internal-only rename across `help/page.tsx` and `WelcomeScreen.tsx`. No external impact.

### 7. HTTP User-Agent Strings

| Before | After |
|--------|-------|
| `PolicyBot-SSLScan/1.0` | `AIAssistant-SSLScan/1.0` |
| `PolicyBot-CookieAudit/1.0` | `AIAssistant-CookieAudit/1.0` |
| `PolicyBot-RedirectAudit/1.0` | `AIAssistant-RedirectAudit/1.0` |
| `PolicyBot/1.0` (Tavily) | `AIAssistant/1.0` |

No functional impact — these are HTTP headers sent to external services (SSL Labs, cookie audit tools, Tavily). Services identify clients by API key, not User-Agent.

---

## Files Changed (~70 files)

### Source Code (TypeScript/TSX): ~28 files
```
src/app/layout.tsx                       — Browser tab title
src/app/page.tsx                         — Landing page branding + placeholder
src/app/auth/signin/page.tsx             — Sign-in page heading
src/app/chat/page.tsx                    — Chat page branding defaults
src/app/help/page.tsx                    — Help page content + whyPlatform rename
src/app/shared/[token]/page.tsx          — Shared thread link
src/app/manifest.webmanifest/route.ts     — PWA manifest name + short_name
src/app/api/welcome/export/route.ts       — Welcome export defaults
src/app/service-terms/page.tsx            — All legal references
src/app/privacy-policy/page.tsx           — All legal references
src/components/layout/Header.tsx          — App header brand
src/components/chat/ChatWindow.tsx        — Chat window branding defaults
src/components/chat/WelcomeScreen.tsx     — Welcome screen + whyPlatform rename
src/components/admin/BrandingSettings.tsx — Admin branding defaults + placeholder
src/embed/index.tsx                       — Embed widget API (breaking change)
src/embed/components/EmbedWidget.tsx      — Console error prefix
src/lib/config-loader.ts                 — DB branding defaults
src/lib/backup.ts                        — Backup manifest
src/lib/workspace/script-generator.ts    — Embed script comments + API call
src/lib/db/utils.ts                      — Email sender defaults
src/lib/db/tool-config.ts                — Email sender defaults
src/lib/db/setup.ts                      — Console log text
src/lib/db/enabled-models.ts             — Comment text
src/lib/tools/send-email.ts              — Email sender defaults
src/lib/tools/pagespeed.ts               — User-Agent strings (3)
src/lib/tools/tavily.ts                  — User-Agent string
src/lib/docgen/pdf-builder.ts            — PDF creator metadata
src/lib/docgen/docx-builder.ts           — DOCX creator metadata
src/lib/pptxgen/pptx-builder.ts          — PPTX author metadata
src/lib/xlsxgen/xlsx-builder.ts          — XLSX creator metadata
src/lib/image-gen/ascii-fallback.ts      — Watermark text
src/lib/services/model-discovery.ts      — Comment text
```

### Documentation: ~26 files
```
README.md
AGENTS.md
docs/INDEX.md
docs/API/API_SPECIFICATION.md
docs/API/openapi.yaml
docs/features/LLM.md, Modes.md, PROMPTS.md, PWA.md, RAG.md, SKILLS.md
docs/features/Tools.md, agent-bot.md, air-gapped-deployment.md, auto-llm.md
docs/features/autonomous-mode.md, routes.md, slash-commands.md
docs/features/workspace-chatbot.md
docs/tech/SOLUTION.md, DATABASE.md, DB-techstack.md, INFRASTRUCTURE.md
docs/tech/scaling.md, auth.md, addLLM.md, liteLLM-implementation-guide.md
docs/tech/fresh-vm-setup.md, Bot-Config-architecture.md, Security-Audit.md
docs/user_manuals/USER_GUIDE.md, ADMIN_GUIDE.md, SUPERUSER_GUIDE.md
docs/user_manuals/super-admin.md
```

### Configuration & Scripts: ~10 files
```
package.json                             — npm package name
LICENSE                                  — Copyright holder
docker-compose.yml                       — Comment header
docker-compose.local.yml                 — Comment header
.env.example                             — Comment header
setup.sh                                 — Script comments
sonar-project.properties                 — SonarQube project name
scripts/sonar-scan.sh                    — Console output
scripts/test-connectivity.ts             — Console output
scripts/test-html-rendering.ts           — Mermaid diagram label
scripts/build-embed.ts                   — esbuild globalName
```

### Database Schemas: 2 files
```
src/lib/db/schema.sql                    — Comment headers
src/lib/db/schema/postgres.sql           — Comment header
```

### Plans (historical): ~6 files
```
plans/*.md                               — All references updated
```

---

## Impact on External Integrations

### 1. Workspace Chatbot Embed (`window.PolicyBotEmbed` → `window.AIAssistantEmbed`)

**BREAKING CHANGE.** Any external website using the embed widget must update.

#### If you use the auto-init script tag:
```html
<!-- OLD — will stop working -->
<script
  src="https://policybot.gov/embed/workspace.js"
  data-workspace-id="a1b2c3d4e5f67890"
  data-api-base="https://policybot.gov"
  async
></script>

<!-- NEW — update the domain and rebuild the embed -->
<script
  src="https://ai.abhirup.app/embed/workspace.js"
  data-workspace-id="a1b2c3d4e5f67890"
  data-api-base="https://ai.abhirup.app"
  async
></script>
```

#### If you use manual JavaScript initialization:
```javascript
// OLD — will throw "PolicyBotEmbed is not defined"
window.PolicyBotEmbed({
  workspaceId: 'a1b2c3d4e5f67890',
  apiBaseUrl: 'https://policybot.gov',
  position: 'bottom-right',
});

// NEW
window.AIAssistantEmbed({
  workspaceId: 'a1b2c3d4e5f67890',
  apiBaseUrl: 'https://ai.abhirup.app',
  position: 'bottom-right',
});
```

#### Action Required:
1. **Rebuild the embed widget:** `npx tsx scripts/build-embed.ts`
2. Update all external pages that load the embed script
3. Change any `window.PolicyBotEmbed()` calls to `window.AIAssistantEmbed()`

### 2. Agent Bot API

**No breaking changes to the API itself.** The endpoints, authentication, and request/response formats remain identical.

#### What changed:
- API base URL: `https://policybot.gov/api/agent-bots/...` → `https://ai.abhirup.app/api/agent-bots/...`
- API specification examples now reference the new domain

#### Action Required:
Update the base URL in any external systems that invoke Agent Bots:

```bash
# OLD
curl -X POST "https://policybot.gov/api/agent-bots/hr-bot/invoke" \
  -H "Authorization: Bearer ab_pk_..."

# NEW
curl -X POST "https://ai.abhirup.app/api/agent-bots/hr-bot/invoke" \
  -H "Authorization: Bearer ab_pk_..."
```

### 3. REST API Consumers

All API endpoints are unchanged except for the domain:

| Resource | Old URL | New URL |
|----------|---------|---------|
| Chat | `https://policybot.gov/api/chat` | `https://ai.abhirup.app/api/chat` |
| Threads | `https://policybot.gov/api/threads` | `https://ai.abhirup.app/api/threads` |
| Admin | `https://policybot.gov/api/admin/...` | `https://ai.abhirup.app/api/admin/...` |
| Agent Bots | `https://policybot.gov/api/agent-bots/...` | `https://ai.abhirup.app/api/agent-bots/...` |
| Workspace API | `https://policybot.gov/api/w/{slug}` | `https://ai.abhirup.app/api/w/{slug}` |
| Branding | `https://policybot.gov/api/branding` | `https://ai.abhirup.app/api/branding` |

### 4. WhatsApp Webhook (Workspace)

If you have WhatsApp channels configured for workspaces, update the webhook URL in Meta's developer console:

```
OLD: https://policybot.gov/api/w/{slug}/channels/whatsapp/webhook
NEW: https://ai.abhirup.app/api/w/{slug}/channels/whatsapp/webhook
```

### 5. OAuth Redirect URIs

If you configured OAuth providers (Google, Azure AD) with the old domain, update the redirect URIs:

```
OLD: https://policybot.gov/api/auth/callback/google
NEW: https://ai.abhirup.app/api/auth/callback/google

OLD: https://policybot.gov/api/auth/callback/azure-ad
NEW: https://ai.abhirup.app/api/auth/callback/azure-ad
```

### 6. NEXTAUTH_URL

Update the environment variable:
```bash
# OLD
NEXTAUTH_URL=https://policybot.gov

# NEW
NEXTAUTH_URL=https://ai.abhirup.app
```

---

## Migration Checklist

Use this checklist when deploying the rebranded platform:

- [ ] Update `NEXTAUTH_URL` in `.env` / `.env.local`
- [ ] Update OAuth redirect URIs in Google Cloud Console
- [ ] Update OAuth redirect URIs in Azure AD App Registration
- [ ] Rebuild the embed widget: `npx tsx scripts/build-embed.ts`
- [ ] Update all external pages with new embed script URL + `window.AIAssistantEmbed()`
- [ ] Update all external systems calling the Agent Bot API with the new base URL
- [ ] Update WhatsApp webhook URLs in Meta developer console (if applicable)
- [ ] Update any CI/CD pipelines referencing the API
- [ ] Notify users of the new portal URL
- [ ] Update any bookmarks or saved links

---

## What Did NOT Change

These remain identical across the rebranding:

- All API endpoint paths (only the domain changed)
- Authentication mechanisms and API key formats
- Database schemas and data
- Role hierarchy (super_admin > admin > superuser > user)
- LLM routing architecture (Routes 2/3/5)
- Tool implementations and configurations
- Agent Bot job queue and output management
- Workspace slugs and configurations
- Thread IDs and shared links
- Deployment infrastructure (Docker, Traefik, PostgreSQL, Qdrant, Redis)

---

## Rollback

If needed, the `package.json` name, branding defaults, and documentation can be reverted. However, the `PolicyBotEmbed` → `AIAssistantEmbed` rename in the embed widget is a breaking change that would require external sites to update back. The embed bundle must be rebuilt after any rollback.

---

*Generated: July 3, 2026*
