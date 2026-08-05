/**
 * HTTP server entry point for the GitHub connector microservice.
 *
 * Endpoints:
 *   GET  /health   — liveness probe (no auth)
 *   GET  /tools    — 12 GitHub tool schemas in OpenAI function format
 *   POST /invoke   — execute a tool (bearer auth + HMAC identity)
 *   POST /{toolName} — execute a specific tool
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { loadConfig, AppConfig } from './config';
import { logger, setLogLevel } from './logger';
import { TOOLS, TOOL_MAP, toOpenAISchema } from './tools';
import { OpResult, OP_HANDLERS, OpHandler } from './ops';

interface InvokeBody {
  op: string;
  args?: Record<string, unknown>;
  userId?: string;
}

const DEFAULT_BODY_LIMIT = 1_000_000;
const UPLOAD_BODY_LIMIT = 50_000_000;

function readJsonBody(req: http.IncomingMessage, maxBytes = DEFAULT_BODY_LIMIT): Promise<unknown> {
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
      if (!text) { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new Error('Request body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

function corsAllowOrigin(req: http.IncomingMessage, cfg: AppConfig): string | null {
  if (cfg.corsOrigins.includes('*')) return '*';
  const origin = req.headers['origin'];
  if (origin && cfg.corsOrigins.includes(origin)) return origin;
  return null;
}

function corsHeaders(req: http.IncomingMessage, cfg: AppConfig): Record<string, string> | null {
  const allow = corsAllowOrigin(req, cfg);
  if (!allow) return null;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connector-User-Id, X-Connector-User-Sig',
    'Vary': 'Origin',
  };
}

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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authenticate(req: http.IncomingMessage, cfg: AppConfig): boolean {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return safeEqual(match[1], cfg.bearerToken);
}

function resolveConnectorIdentity(
  req: http.IncomingMessage,
  cfg: AppConfig
): { userId: string | null; verified: boolean } {
  const headerUserId = req.headers['x-connector-user-id'];
  const headerSig = req.headers['x-connector-user-sig'];
  const userId = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId;

  if (!userId || typeof userId !== 'string') return { userId: null, verified: false };
  if (!cfg.hmacSecret) return { userId, verified: false };

  const sig = Array.isArray(headerSig) ? headerSig[0] : headerSig;
  if (!sig) return { userId: null, verified: false };

  const expected = crypto.createHmac('sha256', cfg.hmacSecret).update(userId, 'utf8').digest('hex');
  if (expected.length !== sig.length) return { userId: null, verified: false };
  try {
    if (crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) {
      return { userId, verified: true };
    }
  } catch { /* invalid hex */ }
  return { userId: null, verified: false };
}

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
      if (param.required) return { ok: false, error: `Missing required parameter: ${param.name}` };
      if (param.default !== undefined) values[param.name] = param.default;
      continue;
    }
    const actual = Array.isArray(raw) ? 'array' : typeof raw;
    if (actual !== param.type) {
      return { ok: false, error: `Parameter "${param.name}" must be of type ${param.type}, got ${actual}` };
    }
    values[param.name] = raw;
  }
  return { ok: true, values };
}

async function dispatch(
  cfg: AppConfig,
  op: string,
  args: Record<string, unknown>
): Promise<OpResult> {
  const handler: OpHandler | undefined = OP_HANDLERS[op];
  if (!handler) return { ok: false, error: `Unknown operation: ${op}` };
  return handler(cfg, args);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: AppConfig
): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    const cors = corsHeaders(req, cfg);
    res.writeHead(204, cors || {});
    res.end();
    return;
  }

  logger.info('Request', { method, path });

  // Public endpoints
  if (method === 'GET' && path === '/health') {
    sendJson(req, res, cfg, 200, { ok: true, service: 'github-connector' });
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

  // Authenticated endpoints
  if (method === 'POST' && (path === '/invoke' || TOOL_MAP[path.slice(1)])) {
    if (!authenticate(req, cfg)) {
      sendJson(req, res, cfg, 401, { ok: false, error: 'Unauthorized: invalid or missing bearer token' });
      return;
    }

    const identity = resolveConnectorIdentity(req, cfg);
    if (cfg.hmacSecret && !identity.verified) {
      sendJson(req, res, cfg, 401, {
        ok: false,
        error: 'Unauthorized: missing or invalid X-Connector-User-Sig',
        code: 'IDENTITY_UNVERIFIED',
      });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, DEFAULT_BODY_LIMIT);
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
      op = path.slice(1);
      const parsed = (body || {}) as Record<string, unknown>;
      args = parsed;
      bodyUserId = parsed.userId as string | undefined;
    }

    let userId: string | undefined;
    if (identity.verified && identity.userId) {
      userId = identity.userId;
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

    args = { ...args, userId };

    const validated = validateArgs(op, args);
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

  sendJson(req, res, cfg, 404, { ok: false, error: `Not found: ${method} ${path}` });
}

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
    logger.info('github-connector listening', { port: cfg.port, logLevel: cfg.logLevel });
  });

  const shutdown = (sig: string) => {
    logger.info(`Received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer();
}
