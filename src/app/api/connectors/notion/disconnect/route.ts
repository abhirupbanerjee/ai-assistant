/**
 * Notion — disconnect endpoint.
 *
 * Notion does not have a token revocation endpoint, so we simply delete the
 * local `user_connected_accounts` row. The user's intent is to disconnect.
 *
 * Authentication: session-based via `getCurrentUser()`.
 *
 * Returns JSON (not a redirect) since this is called via fetch from the
 * Connect/Disconnect UI.
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

  // ── 1. Look up the connected account ─────────────────────────────────────
  let account;
  try {
    account = await getConnectedAccount(user.email, 'notion');
  } catch {
    return NextResponse.json(
      { error: 'Failed to look up connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  if (!account) {
    return NextResponse.json(
      { error: 'No Notion connection found', code: 'NOT_CONNECTED' },
      { status: 404 }
    );
  }

  // ── 2. Delete the vault row ───────────────────────────────────────────────
  // Notion does not have a token revocation endpoint, so we simply delete.
  try {
    const deleted = await deleteConnectedAccount(user.email, 'notion');
    if (!deleted) {
      // Row may have been removed by a concurrent call — treat as success.
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
    account = await getConnectedAccount(user.email, 'notion');
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
    provider: 'notion',
    displayName: account.displayName,
    scopes: account.scopes,
    tokenExpiry: account.tokenExpiry || null,
    lastError: account.lastError || null,
    connectedAt: account.createdAt,
    updatedAt: account.updatedAt,
  });
}
