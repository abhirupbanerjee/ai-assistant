import { NextRequest, NextResponse } from "next/server";

import { readSession, sessionCookieName } from "@/lib/auth/session";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const principal = await readSession(request.cookies.get(sessionCookieName)?.value);
  if (principal) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication is required", code: "AUTH_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const login = new URL("/auth/login", request.url);
  login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/workspaces/:path*", "/agents/:path*", "/api/portal/:path*"],
};
