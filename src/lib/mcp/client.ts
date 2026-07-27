/**
 * MCP HTTP+SSE Client
 *
 * Implements a lightweight JSON-RPC over HTTP+SSE client for the Model Context
 * Protocol. Connections are established lazily and cached per server so that
 * concurrent tool calls do not trigger duplicate handshakes.
 *
 * This module intentionally does not depend on @modelcontextprotocol/sdk to
 * keep the bundle small and the transport transparent.
 */

import type {
  McpCallToolResult,
  McpInitializeResult,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpListToolsResult,
  McpServerConfig,
} from './types';
import {
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
} from './config';
import { toolsLogger as logger } from '@/lib/logger';

let idCounter = 1;
function nextId(): number {
  return idCounter++;
}

interface ActiveConnection {
  serverId: string;
  server: McpServerConfig;
  sessionId: string | null;
  initialized: boolean;
}

const connections = new Map<string, Promise<ActiveConnection> | ActiveConnection>();

function buildHeaders(server: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
  if (server.authToken) {
    headers.Authorization = `Bearer ${server.authToken}`;
  }
  return headers;
}

async function postJson<T>(
  server: McpServerConfig,
  body: McpJsonRpcRequest,
  timeoutMs: number
): Promise<McpJsonRpcResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: buildHeaders(server),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }

    const data = (await res.json()) as McpJsonRpcResponse<T>;
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`MCP request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function initialize(server: McpServerConfig): Promise<ActiveConnection> {
  const request: McpJsonRpcRequest = {
    jsonrpc: '2.0',
    id: nextId(),
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'ai-assistant',
        version: '1.0.0',
      },
    },
  };

  const response = await postJson<McpInitializeResult>(
    server,
    request,
    server.timeoutMs > 0 ? server.timeoutMs : DEFAULT_MCP_CONNECT_TIMEOUT_MS
  );

  if (response.error) {
    throw new Error(`MCP initialize failed: ${response.error.message} (code ${response.error.code})`);
  }

  // Send initialized notification
  try {
    await fetch(server.url, {
      method: 'POST',
      headers: buildHeaders(server),
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
  } catch (err) {
    logger.warn(`Failed to send initialized notification to ${server.id}`, { error: String(err) });
  }

  return {
    serverId: server.id,
    server,
    sessionId: null,
    initialized: true,
  };
}

/**
 * Ensure a connection is established for the given server.
 * Returns a cached connection or creates one.
 */
async function ensureConnection(server: McpServerConfig): Promise<ActiveConnection> {
  const existing = connections.get(server.id);
  if (existing) {
    return existing;
  }

  const promise = initialize(server).catch((error) => {
    connections.delete(server.id);
    throw error;
  });

  connections.set(server.id, promise);
  const conn = await promise;
  connections.set(server.id, conn);
  return conn;
}

/**
 * List tools exposed by an MCP server.
 */
export async function listMcpServerTools(server: McpServerConfig): Promise<McpListToolsResult> {
  const conn = await ensureConnection(server);
  const request: McpJsonRpcRequest = {
    jsonrpc: '2.0',
    id: nextId(),
    method: 'tools/list',
    params: {},
  };

  const response = await postJson<McpListToolsResult>(
    conn.server,
    request,
    conn.server.timeoutMs > 0 ? conn.server.timeoutMs : DEFAULT_MCP_TIMEOUT_MS
  );

  if (response.error) {
    throw new Error(`tools/list failed: ${response.error.message} (code ${response.error.code})`);
  }

  if (!response.result) {
    return { tools: [] };
  }

  return response.result;
}

/**
 * Call a tool on an MCP server.
 */
export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpCallToolResult> {
  const conn = await ensureConnection(server);
  const request: McpJsonRpcRequest = {
    jsonrpc: '2.0',
    id: nextId(),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const response = await postJson<McpCallToolResult>(
    conn.server,
    request,
    conn.server.timeoutMs > 0 ? conn.server.timeoutMs : DEFAULT_MCP_TIMEOUT_MS
  );

  if (response.error) {
    throw new Error(`tools/call failed: ${response.error.message} (code ${response.error.code})`);
  }

  if (!response.result) {
    return { content: [] };
  }

  return response.result;
}

/**
 * Perform a lightweight health check on an MCP server by calling tools/list.
 */
export async function healthCheckMcpServer(server: McpServerConfig): Promise<{
  status: 'connected' | 'error';
  toolCount: number;
  error?: string;
}> {
  try {
    const result = await listMcpServerTools(server);
    return { status: 'connected', toolCount: result.tools?.length ?? 0 };
  } catch (error) {
    return {
      status: 'error',
      toolCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Disconnect a cached MCP server connection.
 */
export async function disconnectMcpServer(serverId: string): Promise<void> {
  const conn = connections.get(serverId);
  if (!conn) return;

  connections.delete(serverId);

  try {
    const resolved = conn instanceof Promise ? await conn : conn;
    // Best-effort shutdown notification
    await fetch(resolved.server.url, {
      method: 'POST',
      headers: buildHeaders(resolved.server),
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/closed',
      }),
    }).catch(() => {
      // ignore
    });
  } catch {
    // ignore
  }
}

/**
 * Disconnect all cached MCP connections.
 */
export async function disconnectAllMcpServers(): Promise<void> {
  const ids = Array.from(connections.keys());
  await Promise.all(ids.map(disconnectMcpServer));
}

/**
 * Convert an MCP call tool result to a plain string suitable for the LLM.
 */
export function mcpResultToString(result: McpCallToolResult): string {
  if (!result.content || result.content.length === 0) {
    return result.isError ? '{"success":false,"error":"Tool returned no content"}' : '';
  }

  const textParts: string[] = [];
  for (const part of result.content) {
    if (part.type === 'text') {
      textParts.push(part.text);
    } else if (part.type === 'image') {
      textParts.push(`[Image: ${part.mimeType || 'unknown'}]`);
    } else if (part.type === 'resource') {
      textParts.push('[Resource]');
    }
  }

  const output = textParts.join('\n');
  if (result.isError) {
    return JSON.stringify({ success: false, error: output || 'Tool reported an error' });
  }
  return output;
}
