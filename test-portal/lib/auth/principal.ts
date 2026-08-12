import type { PortalConfig } from "../config";

export type PortalRole = "admin" | "user";

export interface PortalPrincipal {
  objectId: string;
  tenantId: string;
  email: string | null;
  name: string | null;
  role: PortalRole;
}

export interface EntraIdentity {
  objectId: string;
  tenantId: string;
  email?: string | null;
  name?: string | null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export function resolvePrincipal(identity: EntraIdentity, config: PortalConfig): PortalPrincipal {
  const objectId = identity.objectId.trim().toLowerCase();
  const tenantId = identity.tenantId.trim().toLowerCase();
  if (!objectId || tenantId !== config.entraTenantId) {
    throw new Error("Entra identity is missing an object ID or belongs to an unexpected tenant");
  }
  const email = normalizeEmail(identity.email);
  const isAdmin = config.adminObjectIds.has(objectId) || (email !== null && config.adminEmails.has(email));
  return {
    objectId,
    tenantId,
    email,
    name: identity.name?.trim() || null,
    role: isAdmin ? "admin" : "user",
  };
}

export function assertAdmin(principal: PortalPrincipal): void {
  if (principal.role !== "admin") throw new AuthorizationError("Administrator access is required");
}

export class AuthorizationError extends Error {
  readonly code = "ACCESS_DENIED";
  readonly status = 403;
}
