export interface PortalConfig {
  nodeEnv: "development" | "test" | "production";
  baseUrl: URL;
  secureCookies: boolean;
  databaseUrl: string;
  databaseSsl: boolean;
  entraTenantId: string;
  entraClientId: string;
  entraClientSecret: string;
  sessionSecret: string;
  adminEmails: ReadonlySet<string>;
  adminObjectIds: ReadonlySet<string>;
}

let cachedConfig: PortalConfig | undefined;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required portal configuration: ${name}`);
  return value;
}

function commaSeparated(value: string | undefined, normalize: (item: string) => string): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => normalize(item.trim()))
      .filter(Boolean),
  );
}

export function parseConfig(env: NodeJS.ProcessEnv): PortalConfig {
  const nodeEnv = env.NODE_ENV === "production" || env.NODE_ENV === "test"
    ? env.NODE_ENV
    : "development";
  const baseUrl = new URL(required(env, "PORTAL_BASE_URL"));
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/") {
    throw new Error("PORTAL_BASE_URL must be an origin without credentials, path, query, or fragment");
  }
  const allowInsecureLocalDevelopment = env.PORTAL_ALLOW_INSECURE_LOCAL_DEVELOPMENT === "true";
  const isLocalOrigin = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
  if (nodeEnv === "production" && baseUrl.protocol !== "https:" && !(allowInsecureLocalDevelopment && isLocalOrigin)) {
    throw new Error("PORTAL_BASE_URL must use HTTPS in production");
  }

  const sessionSecret = required(env, "PORTAL_SESSION_SECRET");
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("PORTAL_SESSION_SECRET must contain at least 32 bytes");
  }

  const entraTenantId = required(env, "ENTRA_TENANT_ID");
  const entraClientId = required(env, "ENTRA_CLIENT_ID");
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!guid.test(entraTenantId) || !guid.test(entraClientId)) {
    throw new Error("ENTRA_TENANT_ID and ENTRA_CLIENT_ID must be GUIDs");
  }

  const adminEmails = commaSeparated(env.PORTAL_ADMIN_EMAILS, (value) => value.toLowerCase());
  const adminObjectIds = commaSeparated(env.PORTAL_ADMIN_OBJECT_IDS, (value) => value.toLowerCase());
  if (nodeEnv === "production" && adminEmails.size === 0 && adminObjectIds.size === 0) {
    throw new Error("At least one portal administrator must be configured in production");
  }

  return {
    nodeEnv,
    baseUrl,
    secureCookies: baseUrl.protocol === "https:",
    databaseUrl: required(env, "DATABASE_URL"),
    databaseSsl: env.DATABASE_SSL !== "false",
    entraTenantId: entraTenantId.toLowerCase(),
    entraClientId: entraClientId.toLowerCase(),
    entraClientSecret: required(env, "ENTRA_CLIENT_SECRET"),
    sessionSecret,
    adminEmails,
    adminObjectIds,
  };
}

export function getConfig(): PortalConfig {
  cachedConfig ??= parseConfig(process.env);
  return cachedConfig;
}

export function clearConfigCacheForTests(): void {
  cachedConfig = undefined;
}
