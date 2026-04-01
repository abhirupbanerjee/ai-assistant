import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

export default async function proxy(req: NextRequest) {
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
    '/((?!api/auth|api/w/|api/branding|auth/signin|auth/error|e/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons).*)',
  ],
};
