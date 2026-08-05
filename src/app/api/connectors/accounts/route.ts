/**
 * Connected accounts status endpoint.
 *
 * Returns a public-view summary of the authenticated user's connected
 * Google and Microsoft accounts. No tokens are exposed.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listConnectedAccounts } from '@/lib/db/compat';

export const dynamic = 'force-dynamic';

export interface ConnectedAccountsResponse {
  google: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  microsoft: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  github: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  notion: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  slack: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  let accounts;
  try {
    accounts = await listConnectedAccounts(user.email);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to look up connected accounts', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  const google = accounts.find((a) => a.provider === 'google');
  const microsoft = accounts.find((a) => a.provider === 'microsoft');
  const github = accounts.find((a) => a.provider === 'github');
  const notion = accounts.find((a) => a.provider === 'notion');
  const slack = accounts.find((a) => a.provider === 'slack');

  const response: ConnectedAccountsResponse = {
    google: {
      connected: !!google && !google.revoked,
      displayName: google?.displayName,
      revoked: google?.revoked ?? false,
      scopes: google?.scopes,
    },
    microsoft: {
      connected: !!microsoft && !microsoft.revoked,
      displayName: microsoft?.displayName,
      revoked: microsoft?.revoked ?? false,
      scopes: microsoft?.scopes,
    },
    github: {
      connected: !!github && !github.revoked,
      displayName: github?.displayName,
      revoked: github?.revoked ?? false,
      scopes: github?.scopes,
    },
    notion: {
      connected: !!notion && !notion.revoked,
      displayName: notion?.displayName,
      revoked: notion?.revoked ?? false,
      scopes: notion?.scopes,
    },
    slack: {
      connected: !!slack && !slack.revoked,
      displayName: slack?.displayName,
      revoked: slack?.revoked ?? false,
      scopes: slack?.scopes,
    },
  };

  return NextResponse.json(response);
}
