/**
 * Microsoft OneDrive OAuth "Connect your Drive" — callback endpoint.
 *
 * Microsoft Entra ID redirects here after the user consents. This route:
 *   1. Verifies the session (must match the user who started the flow).
 *   2. Validates the `state` parameter against the short-lived cookie set by /start.
 *   3. Exchanges the authorization code (with the PKCE verifier) for
 *      access + refresh tokens via the Microsoft v2.0 token endpoint
 *      (application/x-www-form-urlencoded — not JSON like Google).
 *   4. Fetches the user's Microsoft Graph profile (`/me`) for a display label.
 *   5. Stores the encrypted tokens in `user_connected_accounts` via the compat
 *      module (`upsertConnectedAccount`) with `provider: 'microsoft'`.
 *   6. Clears the round-trip cookies and redirects to the post-connect page.
 *
 * On any error the user is redirected to the profile page with an
 * `?ms_error=...` query param so the UI can surface a message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

/** Cookie names — must match /start. */
const STATE_COOKIE = 'msconn_state';
const VERIFIER_COOKIE = 'msconn_verifier';
const REDIRECT_COOKIE = 'msconn_redirect';

/** Scopes — must match /start so the stored scope string is accurate. */
const CONNECTOR_SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite',
  'https://graph.microsoft.com/Files.Read.All',
  'offline_access',
  'User.Read',
  'email',
].join(' ');

function getTenant(): string {
  return process.env.MS_TENANT_ID || process.env.AZURE_AD_TENANT_ID || 'common';
}

/** Redirect to the profile page with an error flag (cleans cookies). */
function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const url = new URL('/profile', baseUrl);
  url.searchParams.set('ms_error', reason);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}

interface MicrosoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface MicrosoftMe {
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
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
  const oauthErrorDescription = request.nextUrl.searchParams.get('error_description');

  // Microsoft may redirect with ?error=access_denied if the user cancels.
  if (oauthError) {
    return errorRedirect(request, oauthErrorDescription || oauthError);
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

  // ── 3. Validate Microsoft OAuth env vars ─────────────────────────────────
  const clientId = process.env.MS_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;
  if (!clientId) {
    return errorRedirect(request, 'provider_not_configured');
  }
  // For the confidential-client (delegated) flow, a client secret is required.
  // If running as a pure SPA / public client this would be omitted, but our
  // connector uses a confidential client, so we require the secret here.
  if (!clientSecret) {
    return errorRedirect(request, 'provider_not_configured');
  }

  const appBaseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') || request.nextUrl.origin;
  const redirectUri = `${appBaseUrl}/api/connectors/microsoft/callback`;
  const tenant = getTenant();
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

  // ── 4. Exchange the authorization code for tokens ────────────────────────
  let tokenRes: MicrosoftTokenResponse;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      scope: CONNECTOR_SCOPES,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    tokenRes = (await response.json()) as MicrosoftTokenResponse;
  } catch {
    return errorRedirect(request, 'token_exchange_failed');
  }

  if (tokenRes.error || !tokenRes.access_token) {
    return errorRedirect(request, tokenRes.error || 'no_access_token');
  }

  // ── 5. Fetch the user's Graph profile for a display label ────────────────
  let displayName: string | undefined;
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenRes.access_token}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as MicrosoftMe;
      displayName = me.mail || me.userPrincipalName || me.displayName;
    }
  } catch {
    // Non-fatal — displayName is optional.
  }

  // ── 6. Compute token expiry (ISO 8601 string, per project convention) ────
  // Note: Microsoft access tokens are short-lived (~1h). `offline_access` grant
  // yields a refresh_token that the connector uses to mint new access tokens.
  let tokenExpiry: string | undefined;
  if (typeof tokenRes.expires_in === 'number' && tokenRes.expires_in > 0) {
    tokenExpiry = new Date(Date.now() + tokenRes.expires_in * 1000).toISOString();
  }

  // ── 7. Store the encrypted tokens in the vault ───────────────────────────
  try {
    await upsertConnectedAccount({
      provider: 'microsoft',
      userEmail: user.email,
      displayName: displayName || user.email,
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token || undefined,
      scopes: tokenRes.scope || CONNECTOR_SCOPES,
      tokenExpiry,
    });
  } catch (err) {
    console.error('[connectors/microsoft/callback] Failed to store tokens:', err);
    return errorRedirect(request, 'vault_store_failed');
  }

  // ── 8. Clear round-trip cookies + redirect to the post-connect page ──────
  const returnTo = request.cookies.get(REDIRECT_COOKIE)?.value || '/profile';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/profile';
  const successUrl = new URL(safeReturn, appBaseUrl);
  successUrl.searchParams.set('ms_connected', '1');

  const res = NextResponse.redirect(successUrl.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(REDIRECT_COOKIE);
  return res;
}
