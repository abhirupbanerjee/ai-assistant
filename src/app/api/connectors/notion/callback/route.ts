/**
 * Notion OAuth "Connect Notion" — callback endpoint.
 *
 * Notion redirects here after the user consents. This route:
 *   1. Verifies the session (must match the user who started the flow).
 *   2. Validates the `state` parameter against the cookie set by /start.
 *   3. Exchanges the authorization code for an access token (HTTP Basic Auth).
 *   4. Fetches the user's Notion profile for a display label.
 *   5. Stores the encrypted token in `user_connected_accounts`.
 *   6. Clears cookies and redirects to the post-connect page.
 *
 * Notion tokens never expire — tokenExpiry and refreshToken are null.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

/** Cookie names — must match /start. */
const STATE_COOKIE = 'nconn_state';
const VERIFIER_COOKIE = 'nconn_verifier';
const REDIRECT_COOKIE = 'nconn_redirect';

const TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
const USER_URL = 'https://api.notion.com/v1/users/me';

/** Redirect to the profile page with an error flag. */
function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const url = new URL('/profile', baseUrl);
  url.searchParams.set('notion_error', reason);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}

interface NotionTokenResponse {
  access_token?: string;
  token_type?: string;
  bot_id?: string;
  workspace_name?: string;
  workspace_icon?: string;
  workspace_id?: string;
  owner?: {
    type?: string;
    user?: {
      id?: string;
      name?: string;
      avatar_url?: string;
      person?: { email?: string };
    };
  };
  error?: string;
  error_description?: string;
}

interface NotionUser {
  id: string;
  type: string;
  name?: string;
  avatar_url?: string;
  person?: { email?: string };
  bot?: {
    owner?: {
      type?: string;
      user?: {
        id?: string;
        name?: string;
        avatar_url?: string;
        person?: { email?: string };
      };
      workspace?: boolean;
    };
  };
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

  // Notion may redirect with ?error=access_denied if the user cancels.
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

  // ── 3. Validate Notion OAuth env vars ────────────────────────────────────
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorRedirect(request, 'provider_not_configured');
  }

  const appBaseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const redirectUri = `${appBaseUrl}/api/connectors/notion/callback`;

  // ── 4. Exchange the authorization code for an access token ───────────────
  // Notion uses HTTP Basic Auth for token exchange.
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let tokenRes: NotionTokenResponse;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    tokenRes = (await response.json()) as NotionTokenResponse;
  } catch {
    return errorRedirect(request, 'token_exchange_failed');
  }

  if (tokenRes.error || !tokenRes.access_token) {
    return errorRedirect(request, tokenRes.error || 'no_access_token');
  }

  // ── 5. Fetch the user's Notion profile for a display label ───────────────
  let displayName: string | undefined;
  try {
    const uiRes = await fetch(USER_URL, {
      headers: {
        Authorization: `Bearer ${tokenRes.access_token}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (uiRes.ok) {
      const userInfo = (await uiRes.json()) as NotionUser;
      // Try to extract a meaningful name from the bot owner or user info.
      displayName =
        userInfo.bot?.owner?.user?.name ||
        userInfo.name ||
        userInfo.person?.email ||
        undefined;
    }
  } catch {
    // Non-fatal — displayName is optional.
  }

  // ── 6. Store the encrypted token in the vault ────────────────────────────
  try {
    await upsertConnectedAccount({
      provider: 'notion',
      userEmail: user.email,
      displayName: displayName || user.email,
      accessToken: tokenRes.access_token,
      refreshToken: undefined, // Notion tokens don't expire
      scopes: 'read_content,read_comments,read_user',
      tokenExpiry: undefined, // Notion tokens have no expiry
    });
  } catch (err) {
    console.error('[connectors/notion/callback] Failed to store tokens:', err);
    return errorRedirect(request, 'vault_store_failed');
  }

  // ── 7. Clear cookies + redirect to the post-connect page ─────────────────
  const returnTo = request.cookies.get(REDIRECT_COOKIE)?.value || '/profile';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  const successUrl = new URL(safeReturn, appBaseUrl);
  successUrl.searchParams.set('notion_connected', '1');

  const res = NextResponse.redirect(successUrl.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}
