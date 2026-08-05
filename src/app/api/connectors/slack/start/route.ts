/**
 * Slack OAuth "Connect Slack" — start endpoint.
 *
 * Redirects the user to Slack's OAuth authorize screen with:
 *   - state (random nonce stored in a short-lived cookie)
 *   - Scopes: channels:read, channels:history, search:read, users:read, team:read
 *
 * Slack tokens never expire and do not use PKCE.
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

/** Scopes requested for the Slack connector. */
const CONNECTOR_SCOPES = [
  'channels:read',
  'channels:history',
  'search:read',
  'users:read',
  'team:read',
];

/** Cookie names for the OAuth round-trip state. */
const STATE_COOKIE = 'sconn_state';
const REDIRECT_COOKIE = 'sconn_redirect';

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

  // ── 2. Validate Slack OAuth env vars ────────────────────────────────────
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Slack OAuth is not configured (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET missing)', code: 'PROVIDER_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  // ── 3. Generate state nonce ──────────────────────────────────────────────
  const state = b64url(randomBytes(24));

  const redirectUri = `${getAppBaseUrl(request)}/api/connectors/slack/callback`;

  // ── 4. Build the Slack OAuth authorization URL ──────────────────────────
  const authUrl = new URL('https://slack.com/oauth/v2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', CONNECTOR_SCOPES.join(','));
  authUrl.searchParams.set('state', state);

  // Optional post-connect redirect target.
  const returnTo = request.nextUrl.searchParams.get('redirect') || '/profile';

  // ── 5. Set short-lived cookies + redirect to Slack ──────────────────────
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
