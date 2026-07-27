/**
 * Admin MCP Server Detail API
 *
 * GET    /api/admin/mcp/servers/[serverId] - Get server config + discovered tools
 * PATCH  /api/admin/mcp/servers/[serverId] - Update server config
 * DELETE /api/admin/mcp/servers/[serverId] - Delete server config
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getMcpServer,
  getMcpServerPublic,
  updateMcpServer,
  deleteMcpServer,
} from '@/lib/db/compat/mcp-servers';
import { listMcpServerTools } from '@/lib/mcp/client';
import { isMcpEnabled } from '@/lib/mcp/config';
import type { McpServerConfig } from '@/lib/mcp/types';

interface UpdateMcpServerBody {
  name?: string;
  url?: string;
  authToken?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

function validateUpdateBody(body: unknown): { valid: false; error: string } | { valid: true; data: UpdateMcpServerBody } {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Request body must be an object' };
  }

  const b = body as Record<string, unknown>;
  const data: UpdateMcpServerBody = {};

  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || b.name.trim().length === 0) {
      return { valid: false, error: 'name must be a non-empty string' };
    }
    data.name = b.name.trim();
  }

  if (b.url !== undefined) {
    if (typeof b.url !== 'string' || b.url.trim().length === 0) {
      return { valid: false, error: 'url must be a non-empty string' };
    }
    data.url = b.url.trim();
  }

  if (b.authToken !== undefined) {
    data.authToken = typeof b.authToken === 'string' ? b.authToken : undefined;
  }

  if (b.timeoutMs !== undefined) {
    if (typeof b.timeoutMs !== 'number' || b.timeoutMs < 1000 || b.timeoutMs > 300000) {
      return { valid: false, error: 'timeoutMs must be between 1000 and 300000' };
    }
    data.timeoutMs = b.timeoutMs;
  }

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') {
      return { valid: false, error: 'enabled must be a boolean' };
    }
    data.enabled = b.enabled;
  }

  return { valid: true, data };
}

async function authorize(request: Request): Promise<ReturnType<typeof getCurrentUser>> {
  return getCurrentUser();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const user = await authorize(_request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required', code: 'ACCESS_DENIED' }, { status: 403 });
    }

    const { serverId } = await params;
    const server = await getMcpServerPublic(serverId);
    if (!server) {
      return NextResponse.json({ error: 'MCP server not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    let tools: { name: string; description?: string }[] = [];
    if (isMcpEnabled() && server.enabled) {
      try {
        // Use the full (private) config so the auth token is available for
        // servers that require authentication. The public config is still
        // used for the response body so the token never leaves the server.
        const fullServer = await getMcpServer(serverId);
        if (fullServer) {
          const result = await listMcpServerTools(fullServer);
          tools = (result.tools || []).map(t => ({
            name: t.name,
            description: t.description,
          }));
        }
      } catch (error) {
        console.error(`Failed to list tools for MCP server ${serverId}:`, error);
      }
    }

    return NextResponse.json({ server, tools, mcpEnabled: isMcpEnabled() });
  } catch (error) {
    console.error('Failed to fetch MCP server:', error);
    return NextResponse.json(
      { error: 'Failed to fetch MCP server', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const user = await authorize(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required', code: 'ACCESS_DENIED' }, { status: 403 });
    }

    const { serverId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const validation = validateUpdateBody(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error, code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const update = validation.data;
    const server = await updateMcpServer(serverId, update as Partial<McpServerConfig>);
    if (!server) {
      return NextResponse.json({ error: 'MCP server not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ server });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update MCP server';
    console.error('Failed to update MCP server:', error);
    return NextResponse.json(
      { error: message, code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const user = await authorize(_request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required', code: 'ACCESS_DENIED' }, { status: 403 });
    }

    const { serverId } = await params;
    const deleted = await deleteMcpServer(serverId);

    if (!deleted) {
      return NextResponse.json({ error: 'MCP server not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete MCP server:', error);
    return NextResponse.json(
      { error: 'Failed to delete MCP server', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
