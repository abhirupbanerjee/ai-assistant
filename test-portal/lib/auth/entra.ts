import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { getConfig } from "../config";
import { resolvePrincipal, type PortalPrincipal } from "./principal";
import type { OidcTransaction } from "./session";

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function safeReturnTo(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const sentinelOrigin = "https://portal.invalid";
    const resolved = new URL(value, sentinelOrigin);
    return resolved.origin === sentinelOrigin && resolved.pathname.startsWith("/")
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function createOidcTransaction(returnTo: string): OidcTransaction {
  return {
    state: base64Url(randomBytes(32)),
    nonce: base64Url(randomBytes(32)),
    verifier: base64Url(randomBytes(48)),
    returnTo: safeReturnTo(returnTo),
  };
}

export function authorizationUrl(transaction: OidcTransaction): URL {
  const config = getConfig();
  const challenge = base64Url(createHash("sha256").update(transaction.verifier).digest());
  const url = new URL(`https://login.microsoftonline.com/${config.entraTenantId}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: config.entraClientId,
    response_type: "code",
    redirect_uri: new URL("/auth/callback", config.baseUrl).toString(),
    response_mode: "query",
    scope: "openid profile email",
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

export async function exchangeAuthorizationCode(code: string, transaction: OidcTransaction): Promise<PortalPrincipal> {
  const config = getConfig();
  const tokenEndpoint = `https://login.microsoftonline.com/${config.entraTenantId}/oauth2/v2.0/token`;
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.entraClientId,
      client_secret: config.entraClientSecret,
      grant_type: "authorization_code",
      code,
      code_verifier: transaction.verifier,
      redirect_uri: new URL("/auth/callback", config.baseUrl).toString(),
      scope: "openid profile email",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Entra token exchange failed with status ${response.status}`);
  const body = await response.json() as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new Error("Entra token response did not contain an ID token");

  const issuer = `https://login.microsoftonline.com/${config.entraTenantId}/v2.0`;
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${config.entraTenantId}/discovery/v2.0/keys`),
    { timeoutDuration: 5_000, cooldownDuration: 30_000 },
  );
  const { payload } = await jwtVerify(body.id_token, jwks, {
    issuer,
    audience: config.entraClientId,
    algorithms: ["RS256"],
  });
  if (payload.nonce !== transaction.nonce) throw new Error("Entra ID token nonce did not match the login transaction");
  if (payload.tid !== config.entraTenantId || typeof payload.oid !== "string") {
    throw new Error("Entra ID token tenant or object identifier is invalid");
  }
  const email = typeof payload.email === "string"
    ? payload.email
    : typeof payload.preferred_username === "string" ? payload.preferred_username : null;
  return resolvePrincipal({
    objectId: payload.oid,
    tenantId: payload.tid,
    email,
    name: typeof payload.name === "string" ? payload.name : null,
  }, config);
}
