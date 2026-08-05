/**
 * Slack OAuth "Connect Slack" — callback endpoint.
 *
 * Slack redirects here after the user consents. This route:
 *   1. Verifies the session (must match the user who started the flow).
 *   2. Validates the `state` parameter against the cookie set by /start.
 *   3. Exchanges the authorization code for an access token.
 *   4. Fetches the user's Slack profile for a display label.
 *   5. Stores the encrypted token in `user_connected_accounts`.
 *   6. Clears cookies and redirects to the post-connect page.
 *
 * Slack tokens never expire — tokenExpiry and refreshToken are null.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

/** Cookie names — must match /start. */
const STATE_COOKIE = 'sconn_state';
const REDIRECT_COOKIE = 'sconn_redirect';

const TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const USER_INFO_URL = 'https://slack.com/api/users.info';

/** Scopes — must match /start. */
const CONNECTOR_SCOPES = [
  'channels:read',
  'channels:history',
  'search:read',
  'users:read',
  'team:read',
].join(',');

/** Redirect to the profile page with an error flag. */
function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const url = new URL('/profile', baseUrl);
  url.searchParams.set('slack_error', reason);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}

interface SlackTokenResponse {
  ok: boolean;
  access_token?: string;
  scope?: string;
  team?: { name: string };
  authed_user?: { id: string };
  error?: string;
}

interface SlackUserInfoResponse {
  ok: boolean;
  user?: {
    id: string;
    real_name?: string;
    name?: string;
  };
  error?: string;
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

  // Slack may redirect with ?error=access_denied if the user cancels.
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

  // ── 3. Validate Slack OAuth env vars ────────────────────────────────────
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorRedirect(request, 'provider_not_configured');
  }

  const appBaseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const redirectUri = `${appBaseUrl}/api/connectors/slack/callback`;

  // ── 4. Exchange the authorization code for an access token ───────────────
  let tokenRes: SlackTokenResponse;
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

    tokenRes = (await response.json()) as SlackTokenResponse;
  } catch {
    return errorRedirect(request, 'token_exchange_failed');
  }

  if (!tokenRes.ok || !tokenRes.access_token) {
    return errorRedirect(request, tokenRes.error || 'no_access_token');
  }

  // ── 5. Fetch the user's Slack profile for a display label ───────────────
  let displayName: string | undefined;
  if (tokenRes.authed_user?.id) {
    try {
      const uiParams = new URLSearchParams({ user: tokenRes.authed_user.id });
      const uiRes = await fetch(`${USER_INFO_URL}?${uiParams.toString()}`, {
        headers: {
          Authorization: `Bearer ${tokenRes.access_token}`,
          Accept: 'application/json',
        },
      });
      if (uiRes.ok) {
        const userInfo = (await uiRes.json()) as SlackUserInfoResponse;
        if (userInfo.ok && userInfo.user) {
          displayName = userInfo.user.real_name || userInfo.user.name || 'Slack User';
        }
      }
    } catch {
      // Non-fatal — displayName is optional.
    }
  }

  if (!displayName) {
    displayName = tokenRes.team?.name ? `${tokenRes.team.name} User` : 'Slack User';
  }

  // ── 6. Store the encrypted token in the vault ────────────────────────────
  try {
    await upsertConnectedAccount({
      provider: 'slack',
      userEmail: user.email,
      displayName: displayName || user.email,
      accessToken: tokenRes.access_token,
      refreshToken: undefined, // Slack tokens don't expire
      scopes: tokenRes.scope || CONNECTOR_SCOPES,
      tokenExpiry: undefined, // Slack tokens have no expiry
    });
  } catch (err) {
    console.error('[connectors/slack/callback] Failed to store tokens:', err);
    return errorRedirect(request, 'vault_store_failed');
  }

  // ── 7. Clear cookies + redirect to the post-connect page ─────────────────
  const returnTo = request.cookies.get(REDIRECT_COOKIE)?.value || '/profile';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  const successUrl = new URL(safeReturn, appBaseUrl);
  successUrl.searchParams.set('slack_connected', '1');

  const res = NextResponse.redirect(successUrl.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}
