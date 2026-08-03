/**
 * Configuration for the drive-connector microservice.
 *
 * All values come from environment variables. See README for details.
 */

export interface AppConfig {
  /** HTTP port to listen on. */
  port: number;
  /** Static bearer token that clients must present in `Authorization: Bearer <token>`. */
  bearerToken: string;
  /** Absolute path to the Google service-account JSON key file. */
  serviceAccountPath: string;
  /**
   * Optional: raw service-account JSON (overrides SERVICE_ACCOUNT_PATH).
   * Useful for Docker where the key is injected via an env var / secret.
   */
  serviceAccountJson: string | null;
  /** Space-delimited Google API scopes to request for the service account. */
  googleScopes: string[];
  /** Request timeout for outbound Google API calls, in ms. */
  googleTimeoutMs: number;
  /** Comma-separated list of allowed CORS origins (default: * ). */
  corsOrigins: string[];
  /**
   * Optional HMAC secret shared with the app (CONNECTOR_HMAC_SECRET).
   * When set, the connector verifies the X-Connector-User-Sig header on
   * every /invoke request and trusts the X-Connector-User-Id header —
   * ignoring any userId in the body (which is LLM-controlled and spoofable).
   * When unset, the connector falls back to the body userId (Phase 1 mode).
   */
  hmacSecret: string | null;
  /**
   * Base URL of the AI-assistant app (e.g. https://assistant.example.com).
   * Used to call the internal vault endpoint (/api/connectors/vault/tokens)
   * to fetch per-user OAuth tokens. Required for Phase 2 per-user mode.
   * When unset, the connector only operates in shared service-account mode.
   */
  appBaseUrl: string | null;
  // ── Microsoft Graph (Phase 2 — per-user OneDrive) ─────────────────────────
  /** Azure AD app (client) ID for the connector's app registration. */
  msClientId: string | null;
  /** Azure AD app client secret. */
  msClientSecret: string | null;
  /** Azure AD tenant ID (or 'common' for multi-tenant). */
  msTenantId: string | null;
  /** Microsoft Graph scopes for the app-only (client-credentials) fallback. */
  msGraphScopes: string[];
  /** Request timeout for outbound Microsoft Graph calls, in ms. */
  msGraphTimeoutMs: number;
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
    serviceAccountPath:
      process.env.SERVICE_ACCOUNT_PATH || '/run/secrets/gcp-service-account.json',
    serviceAccountJson: process.env.SERVICE_ACCOUNT_JSON || null,
    googleScopes: parseList(
      process.env.GOOGLE_SCOPES,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/documents.readonly',
      ]
    ),
    googleTimeoutMs: parseInt(process.env.GOOGLE_TIMEOUT_MS || '30000', 10),
    corsOrigins: parseList(process.env.CORS_ORIGINS, ['*']),
    hmacSecret: process.env.CONNECTOR_HMAC_SECRET || null,
    appBaseUrl: (process.env.APP_BASE_URL || null)?.replace(/\/+$/, '') || null,
    msClientId: process.env.MS_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID || null,
    msClientSecret: process.env.MS_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET || null,
    msTenantId: process.env.MS_TENANT_ID || process.env.AZURE_AD_TENANT_ID || null,
    msGraphScopes: parseList(process.env.MS_GRAPH_SCOPES, ['https://graph.microsoft.com/.default']),
    msGraphTimeoutMs: parseInt(process.env.MS_GRAPH_TIMEOUT_MS || '30000', 10),
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',
  };
}

/** Default Google API scopes (re-exported for tool definitions). */
export const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
];
