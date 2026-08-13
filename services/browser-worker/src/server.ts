/**
 * HTTP server for the browser-worker sidecar.
 *
 * Internal-only service: every endpoint except /health requires
 * `Authorization: Bearer <BROWSER_WORKER_SHARED_SECRET>`. The app is the only
 * caller; user identity and authorization are enforced app-side.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { loadConfig, WorkerConfig } from './config';
import { logger, setLogLevel } from './logger';
import { BrowserSessionManager } from './playwright';
import type { Action, StreamEvent } from './types';

const config: WorkerConfig = loadConfig();
setLogLevel(config.logLevel);

const manager = new BrowserSessionManager(config.sessionTtlMs);

// ============ Helpers ============

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return false;
  const token = header.slice('Bearer '.length).trim();
  return safeEqual(token, config.sharedSecret);
}

function readJsonBody(req: http.IncomingMessage, maxBytes = 2_000_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
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
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch {
        reject(new Error('Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message, code: status });
}

/** Extract `/sessions/<id>[/<op>]` route parts. */
function parseSessionPath(pathname: string): { id: string; op: string | null } | null {
  const m = pathname.match(/^\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]), op: m[2] ?? null };
}

// ============ SSE stream ============

function handleStream(res: http.ServerResponse, sessionId: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const emit = (event: StreamEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const sendState = (): void => {
    try {
      const snap = manager.getSnapshot(sessionId);
      emit({ type: 'state', state: snap.state, checkpoint: snap.checkpoint, url: snap.url, title: snap.title });
    } catch {
      /* session gone; interval/cleanup handles it */
    }
  };

  const sendFrame = async (): Promise<void> => {
    try {
      const dataUrl = await manager.getFrame(sessionId);
      emit({ type: 'frame', dataUrl });
    } catch {
      /* ignore transient screenshot errors */
    }
  };

  const onState = (sid: string): void => {
    if (sid === sessionId) sendState();
  };

  manager.on('state', onState);
  sendState();
  void sendFrame();

  const frameTimer = setInterval(() => {
    void sendFrame();
  }, Math.max(config.screenshotIntervalMs, 250));

  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  res.on('close', () => {
    clearInterval(frameTimer);
    clearInterval(keepAlive);
    manager.off('state', onState);
  });
}

// ============ Routing ============

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!isAuthorized(req)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  try {
    if (req.method === 'POST' && url.pathname === '/sessions') {
      const body = await readJsonBody(req);
      const sessionId = String(body.sessionId || '');
      if (!sessionId) {
        sendError(res, 400, 'sessionId is required');
        return;
      }
      const allowlist = Array.isArray(body.allowlist)
        ? (body.allowlist as unknown[]).map(String)
        : config.defaultAllowlist;
      const snapshot = await manager.createSession(sessionId, allowlist);
      sendJson(res, 201, snapshot);
      return;
    }

    const parsed = parseSessionPath(url.pathname);
    if (!parsed) {
      sendError(res, 404, 'Not found');
      return;
    }
    const { id, op } = parsed;

    if (req.method === 'DELETE' && op === null) {
      await manager.terminate(id);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === 'GET' && op === 'stream') {
      handleStream(res, id);
      return;
    }

    if (req.method === 'POST' && op === 'observe') {
      const body = await readJsonBody(req);
      const observation = await manager.observe(id, Boolean(body.includeScreenshot));
      sendJson(res, 200, observation);
      return;
    }

    if (req.method === 'POST' && op === 'action') {
      const body = await readJsonBody(req);
      const action = body.action as Action;
      const confirmToken = typeof body.confirmToken === 'string' ? body.confirmToken : undefined;
      if (!action || typeof action.type !== 'string') {
        sendError(res, 400, 'action is required');
        return;
      }
      const result = await manager.executeAction(id, action, confirmToken);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && op === 'takeover') {
      sendJson(res, 200, await manager.takeover(id));
      return;
    }

    if (req.method === 'POST' && op === 'resume') {
      sendJson(res, 200, await manager.resume(id));
      return;
    }

    sendError(res, 404, 'Not found');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Unknown session') ? 404 : 500;
    logger.warn('Request failed', { method: req.method, path: url.pathname, err: message });
    sendError(res, status, message);
  }
}

// ============ Bootstrap ============

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(config.port, () => {
  logger.info('Browser worker listening', { port: config.port });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutting down', { signal });
  server.close();
  await manager.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
