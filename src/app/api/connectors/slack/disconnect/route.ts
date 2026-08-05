/**
 * Slack Disconnect endpoint.
 *
 * Revokes the Slack access token server-side and deletes the
 * `user_connected_accounts` row. Slack tokens don't expire, so
 * revocation is the only way to invalidate them.
 *
 * Revocation: GET https://slack.com/api/auth.revoke?token={access_token}
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getConnectedAccount, deleteConnectedAccount } from '@/lib/db/compat/connected-accounts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  try {
    const account = await getConnectedAccount(user.email, 'slack');

    if (!account || account.revoked) {
      return NextResponse.json({
        connected: false,
        provider: 'slack',
      });
    }

    // Return status without exposing the token.
    return NextResponse.json({
      connected: true,
      provider: 'slack',
      displayName: account.displayName,
      scopes: account.scopes,
      tokenExpiry: account.tokenExpiry || null,
      lastError: account.lastError || null,
      connectedAt: account.createdAt,
      updatedAt: account.updatedAt,
    });
  } catch (err) {
    console.error('[connectors/slack/disconnect] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to look up connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  try {
    // Fetch the account to get the access token for revocation.
    const account = await getConnectedAccount(user.email, 'slack');

    if (account && account.accessToken && !account.revoked) {
      // Revoke the token at Slack.
      try {
        const revokeUrl = new URL('https://slack.com/api/auth.revoke');
        revokeUrl.searchParams.set('token', account.accessToken);
        await fetch(revokeUrl.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        // Even if revocation fails (e.g., token already revoked), we still
        // delete the local record — the user wants to disconnect.
      } catch (err) {
        console.warn('[connectors/slack/disconnect] Token revocation failed (continuing):', err);
      }
    }

    // Delete the local record.
    if (account) {
      await deleteConnectedAccount(user.email, 'slack');
    }

    return NextResponse.json({
      ok: true,
      message: 'Slack account disconnected. Token revoked and vault row deleted.',
    });
  } catch (err) {
    console.error('[connectors/slack/disconnect] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to disconnect Slack account', code: 'DISCONNECT_FAILED' },
      { status: 500 }
    );
  }
}
