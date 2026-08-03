/**
 * HTTP server entry point for the drive-connector microservice.
 *
 * Endpoints:
 *   GET  /health   — liveness probe (no auth)
 *   GET  /tools    — tool schemas in OpenAI function format (no auth)
 *   POST /invoke   — execute a tool (requires Bearer token)
 *
 * The /invoke body shape mirrors the app's Function API contract:
 *   { "op": "<tool_name>", "args": { ... } }
 *
 * Identity (Phase 2):
 *   The app injects `X-Connector-User-Id` (email) and `X-Connector-User-Sig`
 *   (HMAC-SHA256) headers on every request. When CONNECTOR_HMAC_SECRET is
 *   configured, the connector verifies the signature and trusts the header
 *   userId — ignoring any `userId` in the body (which is LLM-controlled and
 *   spoofable). When the secret is unset, it falls back to body userId
 *   (Phase 1 shared service-account mode).
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { loadConfig, AppConfig } from './config';
import { logger, setLogLevel } from './logger';
import { TOOLS, TOOL_MAP, toOpenAISchema } from './tools';
import {
  OpResult,
  sheetsGetValues,
  sheetsBatchGetValues,
  sheetsUpdateValues,
  sheetsAppendValues,
  sheetsGetSpreadsheet,
  driveListFiles,
  driveGetFile,
  docsExport,
  msDriveListFiles,
  msDriveGetFile,
  msDriveDownloadFile,
} from './ops';
import { getServiceAccountEmail } from './google';

/** Parsed request body for /invoke. */
interface InvokeBody {
  op: string;
  args?: Record<string, unknown>;
  userId?: string;
}

/** Read and parse JSON body from an IncomingMessage. */
function readJsonBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Resolve the CORS `Access-Control-Allow-Origin` value for a request.
 * - If `corsOrigins` contains `"*"`, returns `"*"`.
 * - If the request's `Origin` header matches an entry, returns that origin.
 * - Otherwise returns `null` (no CORS header — browser blocks the response).
 */
function corsAllowOrigin(req: http.IncomingMessage, cfg: AppConfig): string | null {
  if (cfg.corsOrigins.includes('*')) return '*';
  const origin = req.headers['origin'];
  if (origin && cfg.corsOrigins.includes(origin)) return origin;
  return null;
}

/** CORS headers to set on a response, or null if the origin is not allowed. */
function corsHeaders(
  req: http.IncomingMessage,
  cfg: AppConfig
): Record<string, string> | null {
  const allow = corsAllowOrigin(req, cfg);
  if (!allow) return null;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connector-User-Id, X-Connector-User-Sig',
    'Vary': 'Origin',
  };
}

/** Send a JSON response with CORS headers if the origin is allowed. */
function sendJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: AppConfig,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(payload)),
  };
  const cors = corsHeaders(req, cfg);
  if (cors) Object.assign(headers, cors);
  res.writeHead(status, headers);
  res.end(payload);
}

/**
 * Verify the signed identity headers (X-Connector-User-Id + X-Connector-User-Sig)
 * and return the trusted userId, or null if the request is unverified.
 *
 * When `cfg.hmacSecret` is configured, ONLY a validly-signed header is trusted.
 * When `cfg.hmacSecret` is null (Phase 1 mode), the header is accepted unsigned
 * as a fallback, and the body userId remains the ultimate source.
 *
 * @param req - the incoming HTTP request
 * @param cfg - the app config
 * @returns `{ userId, verified }` — `verified` is true when the HMAC signature
 *          was present and valid. `userId` is the resolved identity or null.
 */
function resolveConnectorIdentity(
  req: http.IncomingMessage,
  cfg: AppConfig
): { userId: string | null; verified: boolean } {
  const headerUserId = req.headers['x-connector-user-id'];
  const headerSig = req.headers['x-connector-user-sig'];
  const userId = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId;

  if (!userId || typeof userId !== 'string') {
    return { userId: null, verified: false };
  }

  // No secret configured — Phase 1 / unsigned mode. Accept the header value
  // without verification (the caller may still use body userId instead).
  if (!cfg.hmacSecret) {
    return { userId, verified: false };
  }

  const sig = Array.isArray(headerSig) ? headerSig[0] : headerSig;
  if (!sig) {
    return { userId: null, verified: false };
  }

  const expected = crypto.createHmac('sha256', cfg.hmacSecret).update(userId, 'utf8').digest('hex');
  if (expected.length !== sig.length) {
    return { userId: null, verified: false };
  }
  try {
    if (crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) {
      return { userId, verified: true };
    }
  } catch {
    // invalid hex — treat as unverified
  }
  return { userId: null, verified: false };
}

/** Constant-time string comparison to avoid timing attacks on the bearer token. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Verify the Authorization header against the configured bearer token. */
function authenticate(req: http.IncomingMessage, cfg: AppConfig): boolean {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return safeEqual(match[1], cfg.bearerToken);
}

/** Validate required params and coerce types for a given tool. */
function validateArgs(
  toolName: string,
  args: Record<string, unknown>
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const def = TOOL_MAP[toolName];
  if (!def) return { ok: false, error: `Unknown operation: ${toolName}` };

  const values: Record<string, unknown> = {};
  for (const param of def.params) {
    const raw = args[param.name];
    if (raw === undefined || raw === null) {
      if (param.required) {
        return { ok: false, error: `Missing required parameter: ${param.name}` };
      }
      if (param.default !== undefined) values[param.name] = param.default;
      continue;
    }
    // Basic type guard.
    const actual = Array.isArray(raw) ? 'array' : typeof raw;
    if (actual !== param.type) {
      return {
        ok: false,
        error: `Parameter "${param.name}" must be of type ${param.type}, got ${actual}`,
      };
    }
    values[param.name] = raw;
  }
  return { ok: true, values };
}

/** Dispatch a validated operation. */
async function dispatch(
  cfg: AppConfig,
  op: string,
  v: Record<string, unknown>
): Promise<OpResult> {
  switch (op) {
    case 'sheets_get_values':
      return sheetsGetValues(cfg, String(v.spreadsheetId), String(v.range), v.userId as string | undefined);
    case 'sheets_batch_get_values':
      return sheetsBatchGetValues(cfg, String(v.spreadsheetId), v.ranges as string[], v.userId as string | undefined);
    case 'sheets_update_values':
      return sheetsUpdateValues(
        cfg,
        String(v.spreadsheetId),
        String(v.range),
        v.values as unknown[][],
        v.valueInputOption as string | undefined,
        v.userId as string | undefined
      );
    case 'sheets_append_values':
      return sheetsAppendValues(
        cfg,
        String(v.spreadsheetId),
        String(v.range),
        v.values as unknown[][],
        v.valueInputOption as string | undefined,
        v.insertDataOption as string | undefined,
        v.userId as string | undefined
      );
    case 'sheets_get_spreadsheet':
      return sheetsGetSpreadsheet(cfg, String(v.spreadsheetId), v.userId as string | undefined);
    case 'drive_list_files':
      return driveListFiles(cfg, {
        q: v.q as string | undefined,
        pageSize: v.pageSize as number | undefined,
        pageToken: v.pageToken as string | undefined,
        fields: v.fields as string | undefined,
        userId: v.userId as string | undefined,
      });
    case 'drive_get_file':
      return driveGetFile(cfg, String(v.fileId), v.fields as string | undefined, v.userId as string | undefined);
    case 'docs_export':
      return docsExport(cfg, String(v.fileId), v.mimeType as string | undefined, v.userId as string | undefined);
    // ── Microsoft Graph (OneDrive) ──────────────────────────────────────────
    case 'ms_drive_list_files':
      return msDriveListFiles(cfg, {
        top: v.top as number | undefined,
        skip: v.skip as number | undefined,
        userId: v.userId as string | undefined,
      });
    case 'ms_drive_get_file':
      return msDriveGetFile(cfg, String(v.itemId), v.userId as string | undefined);
    case 'ms_drive_download_file':
      return msDriveDownloadFile(cfg, String(v.itemId), v.userId as string | undefined);
    default:
      return { ok: false, error: `Unknown operation: ${op}` };
  }
}

/** Handle a single HTTP request. */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: AppConfig
): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // CORS preflight.
  if (method === 'OPTIONS') {
    const cors = corsHeaders(req, cfg);
    if (cors) {
      res.writeHead(204, cors);
    } else {
      res.writeHead(204);
    }
    res.end();
    return;
  }

  logger.info('Request', { method, path });

  // Public endpoints (no auth).
  if (method === 'GET' && path === '/health') {
    let email: string | undefined;
    try {
      email = getServiceAccountEmail(cfg);
    } catch (err) {
      sendJson(req, res, cfg, 503, { ok: false, error: (err as Error).message });
      return;
    }
    sendJson(req, res, cfg, 200, { ok: true, service: 'drive-connector', serviceAccount: email });
    return;
  }

  if (method === 'GET' && path === '/tools') {
    sendJson(req, res, cfg, 200, {
      ok: true,
      tools: TOOLS.map(toOpenAISchema),
      count: TOOLS.length,
    });
    return;
  }

  // Authenticated endpoints.
  // Two invocation modes:
  //   1. POST /invoke  { "op": "<toolName>", "args": {...}, "userId": "..." }
  //      — convenience for manual testing / curl.
  //   2. POST /<toolName>  { ...raw args... }
  //      — matches the app's Function API contract: endpointMappings maps
  //        each tool name to { method: 'POST', path: '/<toolName>' } and the
  //        executor sends the function arguments as the JSON body verbatim.
  if (method === 'POST' && (path === '/invoke' || TOOL_MAP[path.slice(1)])) {
    if (!authenticate(req, cfg)) {
      sendJson(req, res, cfg, 401, { ok: false, error: 'Unauthorized: invalid or missing bearer token' });
      return;
    }

    // Resolve signed identity from headers (X-Connector-User-Id + X-Connector-User-Sig).
    // When HMAC is configured, the header identity is the ONLY trusted source.
    // The body userId is LLM-controlled and must never override a verified header.
    const identity = resolveConnectorIdentity(req, cfg);
    if (cfg.hmacSecret && !identity.verified) {
      sendJson(req, res, cfg, 401, {
        ok: false,
        error: 'Unauthorized: missing or invalid X-Connector-User-Sig (HMAC verification failed)',
        code: 'IDENTITY_UNVERIFIED',
      });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(req, res, cfg, 400, { ok: false, error: (err as Error).message });
      return;
    }

    let op: string;
    let args: Record<string, unknown>;
    let bodyUserId: string | undefined;

    if (path === '/invoke') {
      const parsed = (body || {}) as InvokeBody;
      op = parsed.op;
      args = parsed.args || {};
      bodyUserId = parsed.userId;
    } else {
      // Path-based: tool name is the path, body is the raw args.
      op = path.slice(1);
      const parsed = (body || {}) as Record<string, unknown>;
      args = parsed;
      bodyUserId = parsed.userId as string | undefined;
    }

    // Trusted identity resolution:
    //  - HMAC verified → use header userId, strip body userId from args (anti-spoof)
    //  - HMAC not configured (Phase 1) → fall back to body userId
    //  - Neither present → undefined (shared service-account context)
    let userId: string | undefined;
    if (identity.verified && identity.userId) {
      userId = identity.userId;
      // Remove any LLM-injected userId from args so it cannot leak into dispatch.
      if ('userId' in args) {
        const { userId: _stripped, ...rest } = args;
        args = rest;
      }
    } else if (!cfg.hmacSecret) {
      userId = bodyUserId;
    }

    if (!op || typeof op !== 'string') {
      sendJson(req, res, cfg, 400, { ok: false, error: 'Missing or invalid operation name' });
      return;
    }

    const validated = validateArgs(op, { ...args, userId });
    if (!validated.ok) {
      sendJson(req, res, cfg, 400, { ok: false, error: validated.error });
      return;
    }

    logger.info('Invoke', { op, userId: userId || null, identityVerified: identity.verified });
    try {
      const result = await dispatch(cfg, op, validated.values);
      const status = result.ok ? 200 : result.status && result.status >= 400 ? result.status : 500;
      sendJson(req, res, cfg, status, result);
    } catch (err) {
      logger.error('Unhandled error in dispatch', { op, error: (err as Error).message });
      sendJson(req, res, cfg, 500, { ok: false, error: (err as Error).message });
    }
    return;
  }

  // Unknown route.
  sendJson(req, res, cfg, 404, { ok: false, error: `Not found: ${method} ${path}` });
}

/** Start the server. */
export function startServer(cfgOverride?: AppConfig): http.Server {
  const cfg = cfgOverride || loadConfig();
  setLogLevel(cfg.logLevel);

  const server = http.createServer((req, res) => {
    handleRequest(req, res, cfg).catch((err) => {
      logger.error('Fatal request error', { error: (err as Error).message });
      if (!res.headersSent) {
        sendJson(req, res, cfg, 500, { ok: false, error: 'Internal server error' });
      }
    });
  });

  server.listen(cfg.port, () => {
    logger.info('drive-connector listening', { port: cfg.port, logLevel: cfg.logLevel });
  });

  // Graceful shutdown.
  const shutdown = (sig: string) => {
    logger.info(`Received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Start automatically when run directly.
if (require.main === module) {
  startServer();
}
