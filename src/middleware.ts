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
    // Include /e/ routes (for embed CSP headers) + all protected routes
    '/((?!api/auth|api/w/|api/agent-bots|api/branding|api/settings/autonomous|api/settings/display|api/share-target|api/connectors|auth/signin|auth/error|privacy-policy|service-terms|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons).*)',
  ],
};
