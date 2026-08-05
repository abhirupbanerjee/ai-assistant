/**
 * GitBook — disconnect endpoint.
 *
 * GitBook has a token revocation endpoint (POST /oauth/revoke), so we revoke
 * the access token before deleting the local `user_connected_accounts` row.
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

const REVOKE_URL = 'https://api.gitbook.com/v1/oauth/revoke';

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
    account = await getConnectedAccount(user.email, 'gitbook');
  } catch {
    return NextResponse.json(
      { error: 'Failed to look up connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  if (!account) {
    return NextResponse.json(
      { error: 'No GitBook connection found', code: 'NOT_CONNECTED' },
      { status: 404 }
    );
  }

  // ── 2. Revoke the access token at GitBook ────────────────────────────────
  const clientId = process.env.GITBOOK_CLIENT_ID;
  const clientSecret = process.env.GITBOOK_CLIENT_SECRET;

  if (clientId && clientSecret && account.accessToken) {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: account.accessToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      // Revocation is best-effort — GitBook may return 200 even if token
      // was already expired. We proceed to delete the local row regardless.
    } catch {
      // Non-fatal — proceed with local deletion.
    }
  }

  // ── 3. Delete the vault row ───────────────────────────────────────────────
  try {
    const deleted = await deleteConnectedAccount(user.email, 'gitbook');
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
    account = await getConnectedAccount(user.email, 'gitbook');
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
    provider: 'gitbook',
    displayName: account.displayName,
    scopes: account.scopes,
    tokenExpiry: account.tokenExpiry || null,
    lastError: account.lastError || null,
    connectedAt: account.createdAt,
    updatedAt: account.updatedAt,
  });
}
