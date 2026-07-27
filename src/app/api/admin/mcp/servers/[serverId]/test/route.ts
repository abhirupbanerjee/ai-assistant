/**
 * Admin MCP Server Test Connection API
 *
 * POST /api/admin/mcp/servers/[serverId]/test
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMcpServer, updateMcpServerHealth } from '@/lib/db/compat/mcp-servers';
import { healthCheckMcpServer } from '@/lib/mcp/client';
import { isMcpEnabled } from '@/lib/mcp/config';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required', code: 'ACCESS_DENIED' }, { status: 403 });
    }

    if (!isMcpEnabled()) {
      return NextResponse.json(
        { error: 'MCP is globally disabled', code: 'MCP_DISABLED' },
        { status: 403 }
      );
    }

    const { serverId } = await params;
    const server = await getMcpServer(serverId);
    if (!server) {
      return NextResponse.json({ error: 'MCP server not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const health = await healthCheckMcpServer(server);

    await updateMcpServerHealth(serverId, {
      healthStatus: health.status,
      toolCount: health.toolCount,
    });

    return NextResponse.json({
      status: health.status,
      toolCount: health.toolCount,
      error: health.error,
    });
  } catch (error) {
    console.error('Failed to test MCP server connection:', error);
    return NextResponse.json(
      { error: 'Failed to test MCP server connection', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
