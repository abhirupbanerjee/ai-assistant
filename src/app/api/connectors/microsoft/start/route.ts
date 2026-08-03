/**
 * Microsoft OneDrive OAuth "Connect your Drive" — start endpoint.
 *
 * Redirects the user to Microsoft's OAuth 2.0 v2.0 consent endpoint with:
 *   - PKCE (code_challenge / code_challenge_method=S256)
 *   - state (random nonce stored in a short-lived cookie to bind the callback)
 *   - Microsoft Graph scopes (Files.ReadWrite, User.Read)
 *   - prompt=select_account (lets the user pick which MSA/work account to use)
 *
 * Authentication: session-based via `getCurrentUser()`.
 *
 * This is a **separate** consent from the NextAuth login flow (§5.1): the
 * login provider uses minimal `openid email profile` scopes, while the
 * connector consent requests OneDrive file access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Microsoft Graph scopes requested for the OneDrive connector. */
const CONNECTOR_SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite',
  'https://graph.microsoft.com/Files.Read.All',
  'offline_access',
  'User.Read',
  'email',
].join(' ');

/** Cookie names for the OAuth round-trip state. */
const STATE_COOKIE = 'msconn_state';
const VERIFIER_COOKIE = 'msconn_verifier';
const REDIRECT_COOKIE = 'msconn_redirect';

/** Cookie lifetime — 10 minutes. */
const COOKIE_MAX_AGE = 600;

/** Base64url-encode a Buffer without padding (RFC 7636 §4.2). */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function getTenant(): string {
  // Use 'common' for multi-tenant (allows both personal MSA and work/school).
  // Override with MS_TENANT_ID for single-tenant deployments.
  return process.env.MS_TENANT_ID || process.env.AZURE_AD_TENANT_ID || 'common';
}

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

  // ── 2. Validate Microsoft OAuth env vars ──────────────────────────────────
  const clientId = process.env.MS_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'Microsoft OAuth is not configured (MS_CLIENT_ID or AZURE_AD_CLIENT_ID missing)', code: 'PROVIDER_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  // ── 3. Generate PKCE + state ─────────────────────────────────────────────
  const { verifier, challenge } = generatePkce();
  const state = b64url(randomBytes(24));

  const redirectUri = `${getAppBaseUrl(request)}/api/connectors/microsoft/callback`;
  const tenant = getTenant();

  // ── 4. Build the Microsoft OAuth authorization URL ───────────────────────
  const authUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', CONNECTOR_SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  // prompt=select_account lets the user pick which account to connect.
  authUrl.searchParams.set('prompt', 'select_account');

  const returnTo = request.nextUrl.searchParams.get('redirect') || '/profile';

  // ── 5. Set short-lived cookies + redirect to Microsoft ───────────────────
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
