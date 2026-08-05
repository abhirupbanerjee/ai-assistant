/**
 * GitHub OAuth "Connect GitHub" — start endpoint.
 *
 * Redirects the user to GitHub's OAuth authorize screen with:
 *   - state (random nonce stored in a short-lived cookie)
 *   - Scopes: repo, read:org, workflow, user:email
 *
 * GitHub tokens never expire and there is no refresh token.
 *
 * Authentication: session-based via `getCurrentUser()`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getCurrentUser } from '@/lib/auth';

/** Base64url-encode a Buffer without padding. */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const dynamic = 'force-dynamic';

/** Scopes requested for the GitHub connector. */
const CONNECTOR_SCOPES = [
  'repo',
  'read:org',
  'workflow',
  'user:email',
].join(',');

/** Cookie names for the OAuth round-trip state. */
const STATE_COOKIE = 'ghconn_state';
const REDIRECT_COOKIE = 'ghconn_redirect';

/** Cookie lifetime — 10 minutes. */
const COOKIE_MAX_AGE = 600;

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

  // ── 2. Validate GitHub OAuth env vars ────────────────────────────────────
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'GitHub OAuth is not configured (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing)', code: 'PROVIDER_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  // ── 3. Generate state nonce ──────────────────────────────────────────────
  const state = b64url(randomBytes(24));

  const redirectUri = `${getAppBaseUrl(request)}/api/connectors/github/callback`;

  // ── 4. Build the GitHub OAuth authorization URL ──────────────────────────
  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', CONNECTOR_SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('allow_signup', 'false');

  // Optional post-connect redirect target.
  const returnTo = request.nextUrl.searchParams.get('redirect') || '/profile';

  // ── 5. Set short-lived cookies + redirect to GitHub ──────────────────────
  const response = NextResponse.redirect(authUrl.toString());

  const cookieOpts = {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };

  response.cookies.set(STATE_COOKIE, state, cookieOpts);
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  response.cookies.set(REDIRECT_COOKIE, safeReturn, cookieOpts);

  return response;
}
