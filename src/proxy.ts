import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

export default async function proxy(req: NextRequest) {
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
    '/((?!api/auth|api/w/|auth/signin|auth/error|e/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons).*)',
  ],
};
