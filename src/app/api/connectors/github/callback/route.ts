/**
 * GitHub OAuth "Connect GitHub" — callback endpoint.
 *
 * GitHub redirects here after the user consents. This route:
 *   1. Verifies the session (must match the user who started the flow).
 *   2. Validates the `state` parameter against the cookie set by /start.
 *   3. Exchanges the authorization code for an access token.
 *   4. Fetches the user's GitHub profile for a display label.
 *   5. Stores the encrypted token in `user_connected_accounts`.
 *   6. Clears cookies and redirects to the post-connect page.
 *
 * GitHub tokens never expire — tokenExpiry and refreshToken are null.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

/** Cookie names — must match /start. */
const STATE_COOKIE = 'ghconn_state';
const REDIRECT_COOKIE = 'ghconn_redirect';

const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

/** Scopes — must match /start. */
const CONNECTOR_SCOPES = [
  'repo',
  'read:org',
  'workflow',
  'user:email',
].join(',');

/** Redirect to the profile page with an error flag. */
function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const url = new URL('/profile', baseUrl);
  url.searchParams.set('github_error', reason);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}

interface GitHubTokenResponse {
  access_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string;
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

  // GitHub may redirect with ?error=access_denied if the user cancels.
  if (oauthError) {
    return errorRedirect(request, oauthError);
  }

  if (!code || !state) {
    return errorRedirect(request, 'missing_params');
  }

  // ── 2. Validate state against the cookie ─────────────────────────────────
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;

  if (!cookieState) {
    return errorRedirect(request, 'expired_state');
  }

  if (cookieState !== state) {
    return errorRedirect(request, 'state_mismatch');
  }

  // ── 3. Validate GitHub OAuth env vars ────────────────────────────────────
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorRedirect(request, 'provider_not_configured');
  }

  const appBaseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const redirectUri = `${appBaseUrl}/api/connectors/github/callback`;

  // ── 4. Exchange the authorization code for an access token ───────────────
  let tokenRes: GitHubTokenResponse;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    tokenRes = (await response.json()) as GitHubTokenResponse;
  } catch {
    return errorRedirect(request, 'token_exchange_failed');
  }

  if (tokenRes.error || !tokenRes.access_token) {
    return errorRedirect(request, tokenRes.error || 'no_access_token');
  }

  // ── 5. Fetch the user's GitHub profile for a display label ───────────────
  let displayName: string | undefined;
  try {
    const uiRes = await fetch(USER_URL, {
      headers: {
        Authorization: `Bearer ${tokenRes.access_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ai-assistant',
      },
    });
    if (uiRes.ok) {
      const userInfo = (await uiRes.json()) as GitHubUser;
      displayName = userInfo.login;
    }
  } catch {
    // Non-fatal — displayName is optional.
  }

  // ── 6. Store the encrypted token in the vault ────────────────────────────
  try {
    await upsertConnectedAccount({
      provider: 'github',
      userEmail: user.email,
      displayName: displayName || user.email,
      accessToken: tokenRes.access_token,
      refreshToken: undefined, // GitHub tokens don't expire
      scopes: tokenRes.scope || CONNECTOR_SCOPES,
      tokenExpiry: undefined, // GitHub tokens have no expiry
    });
  } catch (err) {
    console.error('[connectors/github/callback] Failed to store tokens:', err);
    return errorRedirect(request, 'vault_store_failed');
  }

  // ── 7. Clear cookies + redirect to the post-connect page ─────────────────
  const returnTo = request.cookies.get(REDIRECT_COOKIE)?.value || '/profile';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  const successUrl = new URL(safeReturn, appBaseUrl);
  successUrl.searchParams.set('github_connected', '1');

  const res = NextResponse.redirect(successUrl.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}
