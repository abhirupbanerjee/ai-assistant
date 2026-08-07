/**
 * OneDrive folders bridge.
 *
 * GET /api/onedrive/folders
 * Lists top-level folders from the drive-connector (via ms_drive_list_folders).
 * Requires an authenticated session with a connected Microsoft account.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { buildConnectorIdentityHeaders } from '@/lib/connector-identity';
import { fetchWithSsrfGuard, getSsrfAllowedHosts } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const CONNECTOR_BASE_URL = process.env.DRIVE_CONNECTOR_URL || 'http://drive-connector:8090';

export interface OneDriveFoldersResponse {
  folders: Array<{ id: string; name: string; lastModifiedTime?: string }>;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  const bearerToken = process.env.CONNECTOR_BEARER_TOKEN;
  if (!bearerToken) {
    return NextResponse.json(
      { error: 'Drive connector not configured', code: 'CONNECTOR_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  const url = `${CONNECTOR_BASE_URL}/ms_drive_list_folders`;
  const allowedHosts = getSsrfAllowedHosts();

  try {
    const { response } = await fetchWithSsrfGuard(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearerToken}`,
          ...buildConnectorIdentityHeaders(user.email),
        },
        body: JSON.stringify({ top: 100 }),
        signal: AbortSignal.timeout(30_000),
      },
      { allowedHosts }
    );

    const data = (await response.json()) as {
      ok: boolean;
      data?: OneDriveFoldersResponse;
      error?: string;
      code?: string;
      status?: number;
    };

    if (!response.ok || !data.ok) {
      const code = data.code || 'CONNECTOR_ERROR';
      const status =
        code === 'RECONNECT_REQUIRED' || code === 'INSUFFICIENT_SCOPE'
          ? 401
          : data.status && data.status >= 400
            ? data.status
            : response.status || 502;
      console.warn('[onedrive/folders] connector error', { code, status });
      return NextResponse.json(
        { error: data.error || 'Drive connector request failed', code },
        { status }
      );
    }

    return NextResponse.json(data.data || { folders: [] });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to list OneDrive folders',
        code: 'CONNECTOR_ERROR',
      },
      { status: 502 }
    );
  }
}
