/**
 * Configuration for the browser-worker sidecar. All values come from env vars.
 */

export interface WorkerConfig {
  /** HTTP port to listen on. */
  port: number;
  /** Shared secret clients must present as `Authorization: Bearer <secret>`. */
  sharedSecret: string;
  /** Fallback allowlist when a session is created without one. */
  defaultAllowlist: string[];
  /** Idle TTL per session in ms. */
  sessionTtlMs: number;
  /** Screenshot cadence for SSE streams in ms. */
  screenshotIntervalMs: number;
  /** Log level. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(): WorkerConfig {
  const sharedSecret = process.env.BROWSER_WORKER_SHARED_SECRET;
  if (!sharedSecret || sharedSecret.length < 16) {
    throw new Error(
      'BROWSER_WORKER_SHARED_SECRET must be set and at least 16 characters long.'
    );
  }

  return {
    port: parseInt(process.env.PORT || '8780', 10),
    sharedSecret,
    defaultAllowlist: parseList(process.env.BROWSER_ALLOWLIST, []),
    sessionTtlMs: parseInt(process.env.BROWSER_SESSION_TTL_MS || '900000', 10),
    screenshotIntervalMs: parseInt(process.env.BROWSER_SCREENSHOT_INTERVAL_MS || '1000', 10),
    logLevel: (process.env.LOG_LEVEL as WorkerConfig['logLevel']) || 'info',
  };
}
