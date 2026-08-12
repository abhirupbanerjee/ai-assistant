import { NextRequest, NextResponse } from "next/server";

import { exchangeAuthorizationCode } from "@/lib/auth/entra";
import {
  createSession,
  expiredCookieOptions,
  readTransaction,
  sessionCookieName,
  sessionCookieOptions,
  transactionCookieName,
} from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const transaction = await readTransaction(request.cookies.get(transactionCookieName)?.value);

  if (error || !code || !state || !transaction || state !== transaction.state) {
    const response = NextResponse.redirect(new URL("/?authError=invalid_callback", getConfig().baseUrl));
    response.cookies.set(transactionCookieName, "", expiredCookieOptions());
    return response;
  }

  try {
    const principal = await exchangeAuthorizationCode(code, transaction);
    const response = NextResponse.redirect(new URL(transaction.returnTo, getConfig().baseUrl));
    response.cookies.set(sessionCookieName, await createSession(principal), sessionCookieOptions());
    response.cookies.set(transactionCookieName, "", expiredCookieOptions());
    return response;
  } catch (exchangeError) {
    console.error("[auth] Entra callback failed", {
      message: exchangeError instanceof Error ? exchangeError.message : "Unknown authentication error",
    });
    const response = NextResponse.redirect(new URL("/?authError=authentication_failed", getConfig().baseUrl));
    response.cookies.set(transactionCookieName, "", expiredCookieOptions());
    return response;
  }
}
