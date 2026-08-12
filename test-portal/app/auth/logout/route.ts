import { NextResponse } from "next/server";

import { expiredCookieOptions, sessionCookieName } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.redirect(getConfig().baseUrl, 303);
  response.cookies.set(sessionCookieName, "", expiredCookieOptions());
  return response;
}
