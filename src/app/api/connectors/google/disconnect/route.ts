/**
 * Google Drive — disconnect endpoint.
 *
 * Revokes the stored OAuth tokens with Google (best-effort) and deletes the
 * `user_connected_accounts` row so the connector falls back to the shared
 * service-account identity for this user.
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

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  // ── 1. Look up the connected account to get the access token for revocation ─
  let account;
  try {
    account = await getConnectedAccount(user.email, 'google');
  } catch {
    return NextResponse.json(
      { error: 'Failed to look up connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  if (!account) {
    return NextResponse.json(
      { error: 'No Google connection found', code: 'NOT_CONNECTED' },
      { status: 404 }
    );
  }

  // ── 2. Best-effort revoke the token at Google ─────────────────────────────
  // We revoke the access token (refresh tokens granted by the same client are
  // also invalidated).  If this fails, we still delete the vault row — the
  // token will expire naturally, and the user's intent is to disconnect.
  if (account.accessToken) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(account.accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      // Non-fatal — proceed to delete the vault row regardless.
    }
  }

  // ── 3. Delete the vault row ───────────────────────────────────────────────
  try {
    const deleted = await deleteConnectedAccount(user.email, 'google');
    if (!deleted) {
      // Row may have been removed by a concurrent call — treat as success
      // since the end state (no connection) is what the user wants.
    }
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
    account = await getConnectedAccount(user.email, 'google');
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
    provider: 'google',
    displayName: account.displayName,
    scopes: account.scopes,
    tokenExpiry: account.tokenExpiry || null,
    lastError: account.lastError || null,
    connectedAt: account.createdAt,
    updatedAt: account.updatedAt,
  });
}
