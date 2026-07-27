/**
 * Admin MCP Server Refresh Tools API
 *
 * POST /api/admin/mcp/servers/[serverId]/refresh
 * Rediscovers tools from the server and syncs tool_configs rows.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMcpServer, updateMcpServerHealth } from '@/lib/db/compat/mcp-servers';
import { listMcpServerTools } from '@/lib/mcp/client';
import { refreshMcpTools } from '@/lib/mcp/mcp-tools';
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

    if (!server.enabled) {
      return NextResponse.json(
        { error: 'MCP server is disabled', code: 'MCP_SERVER_DISABLED' },
        { status: 403 }
      );
    }

    try {
      const result = await listMcpServerTools(server);
      await updateMcpServerHealth(serverId, {
        healthStatus: 'connected',
        toolCount: result.tools?.length ?? 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await updateMcpServerHealth(serverId, {
        healthStatus: 'error',
        toolCount: 0,
      });
      return NextResponse.json(
        { error: `Failed to refresh tools: ${message}`, code: 'MCP_REFRESH_ERROR' },
        { status: 502 }
      );
    }

    // Full registry refresh ensures this server's tools are synced to tool_configs.
    await refreshMcpTools();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to refresh MCP server tools:', error);
    return NextResponse.json(
      { error: 'Failed to refresh MCP server tools', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
