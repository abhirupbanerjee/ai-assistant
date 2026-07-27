/**
 * Admin MCP Servers API
 *
 * GET  /api/admin/mcp/servers - List all MCP server configurations
 * POST /api/admin/mcp/servers - Create a new MCP server configuration
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  listMcpServersPublic,
  createMcpServer,
} from '@/lib/db/compat/mcp-servers';
import { isMcpEnabled } from '@/lib/mcp/config';
import type { McpServerConfig } from '@/lib/mcp/types';

interface CreateMcpServerBody {
  id?: string;
  name: string;
  url: string;
  authToken?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

function validateCreateBody(body: unknown): { valid: false; error: string } | { valid: true; data: CreateMcpServerBody } {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Request body must be an object' };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || b.name.trim().length === 0) {
    return { valid: false, error: 'name is required and must be a non-empty string' };
  }
  if (typeof b.url !== 'string' || b.url.trim().length === 0) {
    return { valid: false, error: 'url is required and must be a non-empty string' };
  }

  return {
    valid: true,
    data: {
      id: typeof b.id === 'string' ? b.id : undefined,
      name: b.name.trim(),
      url: b.url.trim(),
      authToken: typeof b.authToken === 'string' ? b.authToken : undefined,
      timeoutMs: typeof b.timeoutMs === 'number' ? b.timeoutMs : undefined,
      enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
    },
  };
}

/**
 * GET /api/admin/mcp/servers
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required', code: 'ACCESS_DENIED' }, { status: 403 });
    }

    const servers = await listMcpServersPublic();

    return NextResponse.json({
      servers,
      mcpEnabled: isMcpEnabled(),
    });
  } catch (error) {
    console.error('Failed to fetch MCP servers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch MCP servers', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/mcp/servers
 */
export async function POST(request: Request) {
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

    const validation = validateCreateBody(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error, code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const input = validation.data;

    const server = await createMcpServer({
      id: input.id,
      name: input.name,
      url: input.url,
      authToken: input.authToken ?? null,
      enabled: input.enabled ?? true,
      timeoutMs: input.timeoutMs ?? 30000,
    } as McpServerConfig);

    return NextResponse.json({ server }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create MCP server';
    console.error('Failed to create MCP server:', error);
    return NextResponse.json(
      { error: message, code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
