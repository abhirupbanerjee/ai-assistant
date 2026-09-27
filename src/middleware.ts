import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

export default async function middleware(req: NextRequest) {
  // Embed routes: skip auth (these are public embeddable chat widgets)
  if (req.nextUrl.pathname.startsWith('/e/')) {
    return NextResponse.next();
  }

  // Landing page: authenticated users → /chat, unauthenticated → show landing
  if (req.nextUrl.pathname === '/') {
    const token = await getToken({ req });
    if (token) return NextResponse.redirect(new URL('/chat', req.url));
    return NextResponse.next();
  }

  // All other protected routes: require auth
  const token = await getToken({ req });
  if (!token) {
    const signInUrl = new URL('/auth/signin', req.url);
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Include /e/ routes (for embed CSP headers) + all protected routes.
    //
    // `api/csp-report` MUST stay excluded: the browser posts CSP violation
    // reports there without credentials, so running the auth check would
    // redirect them to /auth/signin and silently discard all CSP telemetry
    // whenever CSP_REPORT_URI is configured (see report-uri in next.config.ts).
    '/((?!api/auth|api/w/|api/agent-bots|api/branding|api/settings/autonomous|api/settings/display|api/share-target|api/connectors|api/csp-report|auth/signin|auth/error|privacy-policy|service-terms|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons).*)',
  ],
};
