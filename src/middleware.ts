import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

export default async function middleware(req: NextRequest) {
  // Embed routes: set runtime CSP with allowed frame-ancestors, skip auth
  if (req.nextUrl.pathname.startsWith('/e/')) {
    const allowedOrigins = process.env.ALLOWED_EMBED_ORIGINS
      ? process.env.ALLOWED_EMBED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const frameAncestors = allowedOrigins.length > 0
      ? `'self' ${allowedOrigins.join(' ')}`
      : "'self'";

    const response = NextResponse.next();
    response.headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://cloudflareinsights.com",
      `frame-ancestors ${frameAncestors}`,
    ].join('; '));
    return response;
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
    '/((?!api/auth|api/w/|api/branding|auth/signin|auth/error|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons).*)',
  ],
};
