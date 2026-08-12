import { NextRequest, NextResponse } from "next/server";

import { authorizationUrl, createOidcTransaction, safeReturnTo } from "@/lib/auth/entra";
import { createTransaction, transactionCookieName, transactionCookieOptions } from "@/lib/auth/session";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestedReturnTo = request.nextUrl.searchParams.get("returnTo");
  const normalizedReturnTo = safeReturnTo(requestedReturnTo);
  const transaction = createOidcTransaction(normalizedReturnTo);
  const response = NextResponse.redirect(authorizationUrl(transaction));
  response.cookies.set(transactionCookieName, await createTransaction(transaction), transactionCookieOptions());
  return response;
}
