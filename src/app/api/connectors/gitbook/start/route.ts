/**
 * GitBook OAuth "Connect GitBook" — start endpoint.
 *
 * Redirects the user to GitBook's OAuth authorize screen with:
 *   - PKCE (code_challenge / code_challenge_method=S256)
 *   - state (random nonce stored in a short-lived cookie)
 *   - Scopes: read:spaces, read:content, read:comments
 *
 * GitBook tokens expire after 1 hour and are refreshable.
 *
 * Authentication: session-based via `getCurrentUser()`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getCurrentUser } from '@/lib/auth';

/** Base64url-encode a Buffer without padding. */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const dynamic = 'force-dynamic';

/** Cookie names for the OAuth round-trip state. */
const STATE_COOKIE = 'gbconn_state';
const VERIFIER_COOKIE = 'gbconn_verifier';
const REDIRECT_COOKIE = 'gbconn_redirect';

/** Cookie lifetime — 10 minutes. */
const COOKIE_MAX_AGE = 600;

/**
 * Generate a PKCE code verifier (43-128 char random string) and derive the
 * S256 code challenge.
 */
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Resolve the app's public base URL for building the OAuth redirect URI. */
function getAppBaseUrl(request: NextRequest): string {
  const envUrl = process.env.NEXTAUTH_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  // ── 1. Require an authenticated session ──────────────────────────────────
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  // ── 2. Validate GitBook OAuth env vars ───────────────────────────────────
  const clientId = process.env.GITBOOK_CLIENT_ID;
  const clientSecret = process.env.GITBOOK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'GitBook OAuth is not configured (GITBOOK_CLIENT_ID / GITBOOK_CLIENT_SECRET missing)', code: 'PROVIDER_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  // ── 3. Generate PKCE + state ─────────────────────────────────────────────
  const { verifier, challenge } = generatePkce();
  const state = b64url(randomBytes(24));

  const redirectUri = `${getAppBaseUrl(request)}/api/connectors/gitbook/callback`;

  // ── 4. Build the GitBook OAuth authorization URL ─────────────────────────
  const authUrl = new URL('https://app.gitbook.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'read:spaces read:content read:comments');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  // Optional post-connect redirect target.
  const returnTo = request.nextUrl.searchParams.get('redirect') || '/profile';

  // ── 5. Set short-lived cookies + redirect to GitBook ─────────────────────
  const response = NextResponse.redirect(authUrl.toString());

  const cookieOpts = {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };

  response.cookies.set(STATE_COOKIE, state, cookieOpts);
  response.cookies.set(VERIFIER_COOKIE, verifier, cookieOpts);
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  response.cookies.set(REDIRECT_COOKIE, safeReturn, cookieOpts);

  return response;
}
