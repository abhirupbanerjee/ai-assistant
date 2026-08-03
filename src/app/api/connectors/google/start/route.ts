/**
 * Google OAuth "Connect your Drive" — start endpoint.
 *
 * Redirects the user to Google's OAuth 2.0 consent screen with:
 *   - PKCE (code_challenge / code_challenge_method=S256)
 *   - state (random nonce stored in a short-lived cookie to bind the callback)
 *   - access_type=offline + prompt=consent (forces a refresh token even if the
 *     user has previously consented to the login-flow scopes)
 *   - Drive + Sheets scopes (separate, broader than the login-flow Google provider)
 *
 * Authentication: session-based via `getCurrentUser()`.  Although
 * `api/connectors/*` is excluded from the middleware auth check (so the vault
 * endpoint can authenticate via HMAC), the connect routes MUST verify a user
 * session — they need to know *which* user is connecting.
 *
 * This is intentionally a **separate** consent from the NextAuth login flow
 * (§5.1): the login provider uses minimal `openid email profile` scopes, while
 * the connector consent requests Drive/Sheets access with offline tokens.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getCurrentUser } from '@/lib/auth';

/** Base64url-encode a Buffer without padding (RFC 7636 §4.2). */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const dynamic = 'force-dynamic';

/** Scopes requested for the Drive connector (separate from login scopes). */
const CONNECTOR_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'openid',
  'email',
  'profile',
].join(' ');

/** Cookie names for the OAuth round-trip state (PKCE verifier + state nonce). */
const STATE_COOKIE = 'gconn_state';
const VERIFIER_COOKIE = 'gconn_verifier';
const REDIRECT_COOKIE = 'gconn_redirect'; // optional post-connect landing path

/** Cookie lifetime — 10 minutes is plenty for an OAuth round-trip. */
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
  // Prefer the explicit NEXTAUTH_URL (same env used by NextAuth + workspace validator).
  const envUrl = process.env.NEXTAUTH_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');
  // Fall back to the request origin so the flow works even without NEXTAUTH_URL.
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

  // ── 2. Validate Google OAuth env vars ────────────────────────────────────
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing)', code: 'PROVIDER_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  // ── 3. Generate PKCE + state ─────────────────────────────────────────────
  const { verifier, challenge } = generatePkce();
  const state = b64url(randomBytes(24));

  const redirectUri = `${getAppBaseUrl(request)}/api/connectors/google/callback`;

  // ── 4. Build the Google OAuth authorization URL ──────────────────────────
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', CONNECTOR_SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // force refresh token issuance
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  // Optional post-connect redirect target (e.g. /profile) so the callback can
  // send the user back to the page they started from.
  const returnTo = request.nextUrl.searchParams.get('redirect') || '/profile';

  // ── 5. Set short-lived cookies + redirect to Google ──────────────────────
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
  // Sanitize returnTo to an app-relative path (no open redirects).
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  response.cookies.set(REDIRECT_COOKIE, safeReturn, cookieOpts);

  return response;
}
