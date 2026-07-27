/**
 * Admin MCP Servers Bulk Update API
 *
 * PATCH /api/admin/mcp/servers/bulk
 * Body: { "enabled": boolean }
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { bulkUpdateMcpServersEnabled } from '@/lib/db/compat/mcp-servers';
import { isMcpEnabled } from '@/lib/mcp/config';

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required', code: 'ACCESS_DENIED' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled boolean is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const { enabled } = body as { enabled: boolean };
    const updatedCount = await bulkUpdateMcpServersEnabled(enabled);

    return NextResponse.json({
      success: true,
      updatedCount,
      mcpEnabled: isMcpEnabled(),
    });
  } catch (error) {
    console.error('Failed to bulk update MCP servers:', error);
    return NextResponse.json(
      { error: 'Failed to bulk update MCP servers', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
