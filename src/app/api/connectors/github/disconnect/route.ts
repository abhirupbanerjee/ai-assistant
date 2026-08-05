/**
 * GitHub Disconnect endpoint.
 *
 * Revokes the GitHub access token server-side and deletes the
 * `user_connected_accounts` row. GitHub tokens don't expire, so
 * revocation is the only way to invalidate them.
 *
 * Revocation: DELETE https://api.github.com/applications/{client_id}/grant
 * with Basic auth (client_id:client_secret) and { access_token } in body.
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
    const account = await getConnectedAccount(user.email, 'github');

    if (!account || account.revoked) {
      return NextResponse.json({
        connected: false,
        provider: 'github',
      });
    }

    // Return status without exposing the token.
    return NextResponse.json({
      connected: true,
      provider: 'github',
      displayName: account.displayName,
      scopes: account.scopes,
      tokenExpiry: account.tokenExpiry || null,
      lastError: account.lastError || null,
      connectedAt: account.createdAt,
      updatedAt: account.updatedAt,
    });
  } catch (err) {
    console.error('[connectors/github/disconnect] GET error:', err);
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

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'GitHub OAuth is not configured', code: 'PROVIDER_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  try {
    // Fetch the account to get the access token for revocation.
    const account = await getConnectedAccount(user.email, 'github');

    if (account && account.accessToken && !account.revoked) {
      // Revoke the token at GitHub.
      try {
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        await fetch(
          `https://api.github.com/applications/${clientId}/grant`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Basic ${auth}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'ai-assistant',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ access_token: account.accessToken }),
          }
        );
        // Even if revocation fails (e.g., token already revoked), we still
        // delete the local record — the user wants to disconnect.
      } catch (err) {
        console.warn('[connectors/github/disconnect] Token revocation failed (continuing):', err);
      }
    }

    // Delete the local record.
    if (account) {
      await deleteConnectedAccount(user.email, 'github');
    }

    return NextResponse.json({
      ok: true,
      message: 'GitHub account disconnected. Token revoked and vault row deleted.',
    });
  } catch (err) {
    console.error('[connectors/github/disconnect] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to disconnect GitHub account', code: 'DISCONNECT_FAILED' },
      { status: 500 }
    );
  }
}
