/**
 * GitBook OAuth "Connect GitBook" — callback endpoint.
 *
 * GitBook redirects here after the user consents. This route:
 *   1. Verifies the session (must match the user who started the flow).
 *   2. Validates the `state` parameter against the cookie set by /start.
 *   3. Exchanges the authorization code for access + refresh tokens.
 *   4. Fetches the user's GitBook profile for a display label.
 *   5. Stores the encrypted token in `user_connected_accounts`.
 *   6. Clears cookies and redirects to the post-connect page.
 *
 * GitBook tokens expire after 1 hour — refresh_token is stored for renewal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

/** Cookie names — must match /start. */
const STATE_COOKIE = 'gbconn_state';
const VERIFIER_COOKIE = 'gbconn_verifier';
const REDIRECT_COOKIE = 'gbconn_redirect';

const TOKEN_URL = 'https://api.gitbook.com/v1/oauth/tokens';
const USER_URL = 'https://api.gitbook.com/v1/user';

/** Redirect to the profile page with an error flag. */
function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const url = new URL('/profile', baseUrl);
  url.searchParams.set('gitbook_error', reason);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}

interface GitBookTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GitBookUser {
  uid?: string;
  display_name?: string;
  email?: string;
  photo_url?: string;
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

  // GitBook may redirect with ?error=access_denied if the user cancels.
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

  // ── 3. Validate GitBook OAuth env vars ───────────────────────────────────
  const clientId = process.env.GITBOOK_CLIENT_ID;
  const clientSecret = process.env.GITBOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorRedirect(request, 'provider_not_configured');
  }

  const appBaseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const redirectUri = `${appBaseUrl}/api/connectors/gitbook/callback`;

  // ── 4. Exchange the authorization code for tokens ────────────────────────
  // GitBook uses standard OAuth 2.0 POST body (client_id + client_secret in body).
  let tokenRes: GitBookTokenResponse;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    tokenRes = (await response.json()) as GitBookTokenResponse;
  } catch {
    return errorRedirect(request, 'token_exchange_failed');
  }

  if (tokenRes.error || !tokenRes.access_token) {
    return errorRedirect(request, tokenRes.error || 'no_access_token');
  }

  // ── 5. Compute token expiry from expires_in seconds ──────────────────────
  let tokenExpiry: string | undefined;
  if (tokenRes.expires_in) {
    const expiresAt = new Date(Date.now() + tokenRes.expires_in * 1000);
    tokenExpiry = expiresAt.toISOString();
  }

  // ── 6. Fetch the user's GitBook profile for a display label ──────────────
  let displayName: string | undefined;
  try {
    const uiRes = await fetch(USER_URL, {
      headers: {
        Authorization: `Bearer ${tokenRes.access_token}`,
      },
    });
    if (uiRes.ok) {
      const userInfo = (await uiRes.json()) as GitBookUser;
      displayName = userInfo.display_name || userInfo.email || undefined;
    }
  } catch {
    // Non-fatal — displayName is optional.
  }

  // ── 7. Store the encrypted tokens in the vault ───────────────────────────
  try {
    await upsertConnectedAccount({
      provider: 'gitbook',
      userEmail: user.email,
      displayName: displayName || user.email,
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      scopes: 'read:spaces,read:content,read:comments',
      tokenExpiry,
    });
  } catch (err) {
    console.error('[connectors/gitbook/callback] Failed to store tokens:', err);
    return errorRedirect(request, 'vault_store_failed');
  }

  // ── 8. Clear cookies + redirect to the post-connect page ─────────────────
  const returnTo = request.cookies.get(REDIRECT_COOKIE)?.value || '/profile';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  const successUrl = new URL(safeReturn, appBaseUrl);
  successUrl.searchParams.set('gitbook_connected', '1');

  const res = NextResponse.redirect(successUrl.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}
