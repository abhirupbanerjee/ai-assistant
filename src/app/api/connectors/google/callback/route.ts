/**
 * Google OAuth "Connect your Drive" — callback endpoint.
 *
 * Google redirects here after the user consents. This route:
 *   1. Verifies the session (must match the user who started the flow).
 *   2. Validates the `state` parameter against the short-lived cookie set by /start.
 *   3. Exchanges the authorization code (with the PKCE verifier) for
 *      access + refresh tokens.
 *   4. Optionally fetches the user's profile email for a display label.
 *   5. Stores the encrypted tokens in `user_connected_accounts` via the compat
 *      module (`upsertConnectedAccount`).
 *   6. Clears the round-trip cookies and redirects to the post-connect page.
 *
 * On any error the user is redirected to the profile page with an
 * `?google_error=...` query param so the UI can surface a message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

/** Cookie names — must match /start. */
const STATE_COOKIE = 'gconn_state';
const VERIFIER_COOKIE = 'gconn_verifier';
const REDIRECT_COOKIE = 'gconn_redirect';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Scopes — must match /start so the stored scope string is accurate. */
const CONNECTOR_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'openid',
  'email',
  'profile',
].join(' ');

/** Redirect to the profile page with an error flag (cleans cookies). */
function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const url = new URL('/profile', baseUrl);
  url.searchParams.set('google_error', reason);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  email?: string;
  name?: string;
  picture?: string;
}

export async function GET(request: NextRequest) {
  // ── 1. Require an authenticated session ──────────────────────────────────
  const user = await getCurrentUser();
  if (!user) {
    return errorRedirect(request, 'auth_required');
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const oauthError = request.nextUrl.searchParams.get('error');

  // Google may redirect with ?error=access_denied if the user cancels.
  if (oauthError) {
    return errorRedirect(request, oauthError);
  }

  if (!code || !state) {
    return errorRedirect(request, 'missing_params');
  }

  // ── 2. Validate state against the cookie ─────────────────────────────────
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  const verifier = request.cookies.get(VERIFIER_COOKIE)?.value;

  if (!cookieState || !verifier) {
    return errorRedirect(request, 'expired_state');
  }

  if (cookieState !== state) {
    return errorRedirect(request, 'state_mismatch');
  }

  // ── 3. Validate Google OAuth env vars ────────────────────────────────────
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorRedirect(request, 'provider_not_configured');
  }

  const appBaseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const redirectUri = `${appBaseUrl}/api/connectors/google/callback`;

  // ── 4. Exchange the authorization code for tokens ────────────────────────
  let tokenRes: GoogleTokenResponse;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    tokenRes = (await response.json()) as GoogleTokenResponse;
  } catch {
    return errorRedirect(request, 'token_exchange_failed');
  }

  if (tokenRes.error || !tokenRes.access_token) {
    // If the token exchange fails (e.g. reused code), surface a clear reason.
    return errorRedirect(request, tokenRes.error || 'no_access_token');
  }

  // ── 5. Fetch the user's profile for a display label ──────────────────────
  let displayName: string | undefined;
  try {
    const uiRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenRes.access_token}` },
    });
    if (uiRes.ok) {
      const userInfo = (await uiRes.json()) as GoogleUserInfo;
      displayName = userInfo.email || userInfo.name;
    }
  } catch {
    // Non-fatal — displayName is optional.
  }

  // ── 6. Compute token expiry (ISO 8601 string, per project convention) ────
  let tokenExpiry: string | undefined;
  if (typeof tokenRes.expires_in === 'number' && tokenRes.expires_in > 0) {
    tokenExpiry = new Date(Date.now() + tokenRes.expires_in * 1000).toISOString();
  }

  // ── 7. Store the encrypted tokens in the vault ───────────────────────────
  try {
    await upsertConnectedAccount({
      provider: 'google',
      userEmail: user.email,
      displayName: displayName || user.email,
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token || undefined,
      scopes: tokenRes.scope || CONNECTOR_SCOPES,
      tokenExpiry,
    });
  } catch (err) {
    console.error('[connectors/google/callback] Failed to store tokens:', err);
    return errorRedirect(request, 'vault_store_failed');
  }

  // ── 8. Clear round-trip cookies + redirect to the post-connect page ──────
  const returnTo = request.cookies.get(REDIRECT_COOKIE)?.value || '/profile';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  const successUrl = new URL(safeReturn, appBaseUrl);
  successUrl.searchParams.set('google_connected', '1');

  const res = NextResponse.redirect(successUrl.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}
