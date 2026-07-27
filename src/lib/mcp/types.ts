/**
 * MCP Type Definitions
 *
 * Lightweight TypeScript interfaces for the Model Context Protocol JSON-RPC
 * messages used in this implementation. We intentionally do not depend on the
 * official @modelcontextprotocol/sdk to keep the bundle small and the transport
 * transparent.
 */

import type { OpenAI } from 'openai';

/** Server configuration as stored in the database. */
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  authToken: string | null;
  enabled: boolean;
  timeoutMs: number;
  toolCount: number;
  lastHealthCheck: string | null;
  healthStatus: McpHealthStatus;
  createdAt: string;
  updatedAt: string;
}

/** Server health status values. */
export type McpHealthStatus = 'connected' | 'disconnected' | 'error' | 'unknown';

/** A tool discovered from an MCP server. */
export interface McpToolDefinition {
  /** Original tool name on the MCP server. */
  originalName: string;
  /** Prefixed tool name used by the LLM and internal routing. */
  prefixedName: string;
  /** Human-readable description. */
  description: string;
  /** MCP input schema in JSON Schema format. */
  inputSchema: Record<string, unknown>;
  /** Owning server ID. */
  serverId: string;
}

/** Runtime representation of a discovered MCP tool, including its OpenAI definition. */
export interface McpRegisteredTool {
  originalName: string;
  prefixedName: string;
  serverId: string;
  description: string;
  definition: OpenAI.Chat.ChatCompletionFunctionTool;
}

/** JSON-RPC request envelope. */
export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC response envelope. */
export interface McpJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: McpJsonRpcError;
}

/** JSON-RPC error object. */
export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Result of the MCP initialize method. */
export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: {
    name: string;
    version?: string;
  };
}

/** Result of the MCP tools/list method. */
export interface McpListToolsResult {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

/** Result of the MCP tools/call method. */
export interface McpCallToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType?: string }
    | { type: 'resource'; resource: unknown }
  >;
  isError?: boolean;
}

/** Normalized result returned by executeMcpTool. */
export interface McpToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
  errorCode?: string;
}
