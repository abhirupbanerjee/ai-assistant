# Known Issues & Fixes

This document tracks known issues, limitations, and their workarounds in the PolicyBot codebase.
All developers should consult this file before making changes to affected areas.

---

## 1. Next.js 16: Segment Config Exports Must Be Static Literals

**Status:** Active limitation
**Affected files:** All `route.ts` files using `maxDuration`, `runtime`, etc.
**Date discovered:** 2026-04-04

### Problem

Next.js 16 (Turbopack) requires route segment config exports (`maxDuration`, `runtime`, `dynamic`, etc.) to be **static literals** evaluated at build time. Any runtime expression causes a build failure:

```
Error: Invalid segment configuration export detected:
  "maxDuration" with value "parseInt(process.env.STREAM_MAX_DURATION || '300', 10)"
  is not a valid value for this configuration.
```

This means you **cannot** use environment variables, function calls, or any computed values:

```typescript
// FAILS at build time
export const maxDuration = parseInt(process.env.STREAM_MAX_DURATION || '300', 10);
export const maxDuration = Number(process.env.MY_VAR);
export const maxDuration = getConfig().timeout;

// WORKS — must be a plain number literal
export const maxDuration = 1800;
```

### Current Fix

All route segment configs use static literal `1800` (30 minutes). This is a generous outer safety net — the actual stream duration is controlled by the DB-configurable `streaming_max_duration` setting (admin UI: Agent Settings, range 60–600s).

### Affected Routes

| Route | Value | Purpose |
|-------|-------|---------|
| `src/app/api/chat/stream/route.ts` | `1800` | Chat streaming (autonomous mode can run long) |
| `src/app/api/admin/backup/restore/route.ts` | `1800` | Backup restore (large files) |
| `src/app/api/admin/backup/files/trigger/route.ts` | `1800` | Backup trigger |

### Related Note

The OpenAI client in `src/lib/openai.ts` has a separate `timeout: 300_000` (5 minutes) for individual API calls. This is independent of the route-level `maxDuration` and controls how long to wait for the upstream LLM provider to respond.

---

## 2. Next.js 16: Middleware File Convention Deprecated

**Status:** Active — using deprecated convention intentionally
**Affected files:** `src/middleware.ts`
**Date discovered:** 2026-01-01 (Next.js 16 upgrade)

### Problem

Next.js 16 deprecated the `middleware.ts` file convention in favor of the new `proxy` pattern. The build warns:

```
middleware file convention is deprecated, use proxy instead
```

### Why We Still Use middleware.ts

The project was briefly migrated to `proxy.ts` (commit `1a53261`, Jan 2026) but reverted back to `middleware.ts` (commit `d56d811`, Apr 2026) because:

1. **Dynamic CSP headers for embed routes**: The `/e/*` (embed widget) routes require runtime-dynamic `Content-Security-Policy` headers with `frame-ancestors` set from the `ALLOWED_EMBED_ORIGINS` environment variable. The `next.config.ts` `headers()` function only supports build-time values — it cannot read runtime env vars.

2. **Route-level auth decisions**: The middleware handles authentication redirects (unauthenticated users → `/auth/signin`) and landing page logic (authenticated users on `/` → `/chat`). These require request-time session checks.

3. **The Next.js 16 proxy pattern** does not provide equivalent request/response header manipulation capabilities needed for our CSP use case.

### What the Middleware Does

```
Request → middleware.ts
  ├─ /e/* routes → Set dynamic CSP frame-ancestors from ALLOWED_EMBED_ORIGINS env var
  ├─ / (root) → Redirect authenticated users to /chat
  └─ All other routes → Redirect to /auth/signin if not authenticated
```

### Future Resolution Options

1. **Keep middleware.ts** — current approach, works despite deprecation warning
2. **Move CSP to Traefik** — handle `frame-ancestors` at the reverse proxy level (docker-compose already uses Traefik)
3. **Per-route CSP** — set headers in individual `/e/*` API route handlers instead of middleware
4. **Wait for Next.js** — future versions may provide runtime header middleware in the proxy pattern

### Related Commits

| Commit | Date | Description |
|--------|------|-------------|
| `1a53261` | 2026-01-01 | Renamed `middleware.ts` → `proxy.ts` (Next.js 16 migration) |
| `d56d811` | 2026-04-01 | Renamed back to `middleware.ts` (proxy pattern insufficient) |
| `188b5f2` | 2026-04-01 | Added static CSP headers in next.config.ts for embed routes |
| `f79d171` | 2026-04-01 | Refined embed origin config |
| `d00af87` | 2026-04-01 | Added runtime CSP in middleware.ts for dynamic frame-ancestors |

---

## 3. LiteLLM Breaks Anthropic Streaming Tool-Call JSON Assembly

**Status:** Fixed — permanent architectural bypass
**Affected files:** `src/lib/openai.ts`
**Date discovered:** March 2026

### Problem

When Claude models were routed through LiteLLM, the proxy translated Anthropic's native `tool_use` content blocks into OpenAI-compatible `delta.tool_calls` format during streaming. This JSON assembly was **unreliable** — LiteLLM would produce malformed tool-calling JSON that failed `executeTool()` parsing.

**Symptoms:**
- `doc_gen`, `xlsx_gen`, and `pptx_gen` tools failed intermittently with JSON parse errors
- Tool call arguments arrived as broken JSON strings after LiteLLM's chunked reassembly
- Affected all Claude models (Sonnet, Haiku, Opus) when tool calling was involved

### Root Cause

LiteLLM's streaming format converter reassembles tool input JSON from streamed `delta.tool_calls` chunks. For Anthropic models, this reassembly loses fidelity — partial JSON fragments get concatenated incorrectly, producing unparseable arguments.

### Fix Applied

Claude models now bypass LiteLLM entirely for chat completions, using the `@anthropic-ai/sdk` directly:

1. **Detection:** `isClaudeModel(model)` checks for `anthropic/` or `claude-` prefix
2. **Routing:** If Claude, `streamAnthropicCompletion()` is called instead of the OpenAI/LiteLLM path
3. **Key difference:** The direct SDK's `stream.finalMessage()` returns **pre-parsed** `block.input` objects (structured data), not JSON strings from chunked reassembly

```typescript
// Direct SDK — tool inputs arrive as already-parsed objects
for (const block of message.content) {
  if (block.type === 'tool_use') {
    toolCalls.push({ id: block.id, name: block.name, input: block.input });
  }
}
// Convert to OpenAI-compatible format for downstream executeTool()
const openaiToolCalls = toolCalls.map(tc => ({
  id: tc.id, type: 'function' as const,
  function: { name: tc.name, arguments: JSON.stringify(tc.input) },
}));
```

### Architecture Impact

Added **Tier 1b** to the LLM architecture:

| Tier | Path | Providers |
|------|------|-----------|
| Tier 1 | LiteLLM Proxy | OpenAI, Gemini, Mistral, DeepSeek, Ollama, Fireworks |
| **Tier 1b** | **Anthropic Direct SDK** | **Claude (Opus, Sonnet, Haiku)** |
| Tier 2 | Direct Provider APIs | Fireworks reranking, Tavily, OpenAI TTS |
| Tier 3 | Google GenAI SDK | Gemini Imagen, TTS |

Claude models are still registered with LiteLLM for non-chat services (embeddings, etc.). Only **chat completions with tool calling** bypass LiteLLM.

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/openai.ts` | ~129-131 | `isClaudeModel()` — prefix detection |
| `src/lib/openai.ts` | ~143-152 | `getAnthropicClient()` — singleton SDK client |
| `src/lib/openai.ts` | ~579-694 | `streamAnthropicCompletion()` — native streaming with pre-parsed tool inputs |
| `src/lib/openai.ts` | ~856-865 | Routing decision: Anthropic SDK vs LiteLLM |
| `docs/tech/liteLLM-implementation-guide.md` | ~45, 73-94 | Architectural rationale |

### Related Commits

| Commit | Description |
|--------|-------------|
| `bec97c1` | FIX: claude tool call fails intermittently for doc_gen, xlsx_gen, pptx_gen |
| `9c1c657` | FIX: claude flow to avoid json parse errors 1 |
| `245c84d` | FIX: claude flow to avoid json parse errors and add logging 2 |
| `4377874` | FIX: autonomous mode — skills with tool route fix 2 + documentation |

---

## Contributing to This Document

When you encounter a non-obvious limitation, build issue, or framework constraint:

1. Add a new numbered section following the format above
2. Include: Status, Affected files, Date discovered, Problem, Fix, and Future options
3. Reference relevant commit hashes and file paths
4. Keep descriptions concise but complete enough for a new developer to understand
