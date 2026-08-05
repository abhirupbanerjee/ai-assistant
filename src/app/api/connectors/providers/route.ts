import { NextResponse } from 'next/server';
import { CONNECTOR_PROVIDERS } from '@/lib/connectors/provider-meta';

export const dynamic = 'force-dynamic';

/**
 * GET /api/connectors/providers
 *
 * Returns the public metadata for all connector providers.
 * Internal fields (healthUrl, toolsUrl) are omitted.
 */
export async function GET() {
  const providers = CONNECTOR_PROVIDERS.map(
    ({ healthUrl: _healthUrl, toolsUrl: _toolsUrl, ...rest }) => rest
  );

  return NextResponse.json({ providers });
}
