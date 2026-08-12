import { cookies } from "next/headers";

import { assertAdmin, type PortalPrincipal } from "./principal";
import { readSession, sessionCookieName } from "./session";

export async function getPrincipal(): Promise<PortalPrincipal | null> {
  const cookieStore = await cookies();
  return readSession(cookieStore.get(sessionCookieName)?.value);
}

export async function requirePrincipal(): Promise<PortalPrincipal> {
  const principal = await getPrincipal();
  if (!principal) throw new Error("AUTH_REQUIRED");
  return principal;
}

export async function requireAdmin(): Promise<PortalPrincipal> {
  const principal = await requirePrincipal();
  assertAdmin(principal);
  return principal;
}
