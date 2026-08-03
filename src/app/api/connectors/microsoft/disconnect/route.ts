/**
 * Microsoft OneDrive — disconnect endpoint.
 *
 * Revokes the stored OAuth tokens with Microsoft (best-effort) and deletes the
 * `user_connected_accounts` row so the connector falls back to the shared
 * app-only identity for this user.
 *
 * Microsoft Entra ID does not expose a single "revoke token" endpoint like
 * Google's `/revoke`. Instead, we invalidate the user's refresh tokens via
 * the Microsoft Graph `revokeSignInSessions` action (best-effort). Even if
 * that call fails, we delete the vault row — the access token will expire
 * naturally (~1h) and the refresh token is destroyed by removing our copy,
 * so the connector can no longer mint new tokens for this user.
 *
 * Authentication: session-based via `getCurrentUser()`.
 *
 * Returns JSON (not a redirect) since this is called via fetch from the
 * Connect/Disconnect UI (§8 Task 8).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { deleteConnectedAccount, getConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  // ── 1. Look up the connected account ──────────────────────────────────────
  let account;
  try {
    account = await getConnectedAccount(user.email, 'microsoft');
  } catch {
    return NextResponse.json(
      { error: 'Failed to look up connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  if (!account) {
    return NextResponse.json(
      { error: 'No Microsoft connection found', code: 'NOT_CONNECTED' },
      { status: 404 }
    );
  }

  // ── 2. Best-effort revoke the user's refresh tokens ───────────────────────
  // Microsoft Graph: POST /me/revokeSignInSessions invalidates all refresh
  // tokens issued to this user. This is a best-effort call — if it fails (e.g.
  // the access token already expired), we still delete the vault row below so
  // the connector cannot mint new tokens.
  if (account.accessToken) {
    try {
      await fetch('https://graph.microsoft.com/v1.0/me/revokeSignInSessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    } catch {
      // Non-fatal — proceed to delete the vault row regardless.
    }
  }

  // ── 3. Delete the vault row ───────────────────────────────────────────────
  try {
    await deleteConnectedAccount(user.email, 'microsoft');
  } catch {
    return NextResponse.json(
      { error: 'Failed to delete connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, disconnected: true });
}

/**
 * GET — returns the current connection status for the authenticated user.
 * Used by the Connect/Disconnect UI to render state without a separate endpoint.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  let account;
  try {
    account = await getConnectedAccount(user.email, 'microsoft');
  } catch {
    return NextResponse.json(
      { error: 'Failed to look up connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  if (!account || account.revoked) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    provider: 'microsoft',
    displayName: account.displayName,
    scopes: account.scopes,
    tokenExpiry: account.tokenExpiry || null,
    lastError: account.lastError || null,
    connectedAt: account.createdAt,
    updatedAt: account.updatedAt,
  });
}
