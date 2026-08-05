/**
 * Configuration for the connector microservice.
 *
 * All values come from environment variables.
 * Copy this file into your connector and customize the env vars.
 */

export interface AppConfig {
  /** HTTP port to listen on. */
  port: number;
  /** Static bearer token that clients must present in `Authorization: Bearer <token>`. */
  bearerToken: string;
  /**
   * Optional HMAC secret shared with the app (CONNECTOR_HMAC_SECRET).
   * When set, the connector verifies the X-Connector-User-Sig header on
   * every /invoke request and trusts the X-Connector-User-Id header.
   * When unset, falls back to body userId (Phase 1 / shared identity mode).
   */
  hmacSecret: string | null;
  /**
   * Base URL of the AI-assistant app (e.g. https://assistant.example.com).
   * Used to call the internal vault endpoint (/api/connectors/vault/tokens).
   */
  appBaseUrl: string | null;
  /** Request timeout for outbound API calls, in ms. */
  apiTimeoutMs: number;
  /** Comma-separated list of allowed CORS origins (default: * ). */
  corsOrigins: string[];
  /** Log level: 'debug' | 'info' | 'warn' | 'error'. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  const bearerToken = process.env.CONNECTOR_BEARER_TOKEN;
  if (!bearerToken || bearerToken.length < 16) {
    throw new Error(
      'CONNECTOR_BEARER_TOKEN must be set and at least 16 characters long.'
    );
  }

  return {
    port: parseInt(process.env.PORT || '8090', 10),
    bearerToken,
    hmacSecret: process.env.CONNECTOR_HMAC_SECRET || null,
    appBaseUrl: (process.env.APP_BASE_URL || null)?.replace(/\/+$/, '') || null,
    apiTimeoutMs: parseInt(process.env.API_TIMEOUT_MS || '30000', 10),
    corsOrigins: parseList(process.env.CORS_ORIGINS, ['*']),
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',
  };
}
