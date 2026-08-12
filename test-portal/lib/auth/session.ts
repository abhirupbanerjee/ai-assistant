import { createHash } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

import { getConfig } from "../config";
import type { PortalPrincipal } from "./principal";

export const sessionCookieName = "test_portal_session";
export const transactionCookieName = "test_portal_oidc_transaction";

export interface OidcTransaction {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

function encryptionKey(): Uint8Array {
  return createHash("sha256").update(getConfig().sessionSecret).digest();
}

function cookieOptions(maxAge: number): Partial<ResponseCookie> {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().secureCookies,
    path: "/",
    maxAge,
  };
}

async function encrypt(payload: Record<string, unknown>, lifetime: string): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(getConfig().baseUrl.origin)
    .setAudience("test-portal")
    .setExpirationTime(lifetime)
    .encrypt(encryptionKey());
}

async function decrypt<T>(token: string): Promise<T> {
  const result = await jwtDecrypt(token, encryptionKey(), {
    issuer: getConfig().baseUrl.origin,
    audience: "test-portal",
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  return result.payload as T;
}

export async function createSession(principal: PortalPrincipal): Promise<string> {
  return encrypt({ principal }, "8h");
}

export async function readSession(token: string | undefined): Promise<PortalPrincipal | null> {
  if (!token) return null;
  try {
    const payload = await decrypt<{ principal?: PortalPrincipal }>(token);
    const principal = payload.principal;
    if (!principal || typeof principal.objectId !== "string" || (principal.role !== "admin" && principal.role !== "user")) {
      return null;
    }
    return principal;
  } catch {
    return null;
  }
}

export async function createTransaction(transaction: OidcTransaction): Promise<string> {
  return encrypt({ transaction }, "10m");
}

export async function readTransaction(token: string | undefined): Promise<OidcTransaction | null> {
  if (!token) return null;
  try {
    const payload = await decrypt<{ transaction?: OidcTransaction }>(token);
    return payload.transaction ?? null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (): Partial<ResponseCookie> => cookieOptions(8 * 60 * 60);
export const transactionCookieOptions = (): Partial<ResponseCookie> => cookieOptions(10 * 60);
export const expiredCookieOptions = (): Partial<ResponseCookie> => cookieOptions(0);
