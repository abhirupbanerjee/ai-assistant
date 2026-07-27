/**
 * MCP Global Configuration
 *
 * Central source of truth for the MCP_ENABLED kill switch and shared constants.
 * All MCP code paths should import from here so the cutoff is auditable in one
 * place.
 */

/** Prefix for all MCP-exposed tool function names. */
export const MCP_TOOL_PREFIX = 'mcp_';

/** Hard maximum of MCP tools exposed to the LLM across all servers. */
export const MAX_MCP_TOOLS_TOTAL = 32;

/** Hard maximum of MCP tools exposed per individual server. */
export const MAX_MCP_TOOLS_PER_SERVER = 16;

/** Maximum length of an MCP tool description sent to the LLM. */
export const MAX_MCP_DESCRIPTION_LENGTH = 1024;

/** Maximum JSON size of a converted parameter schema; larger schemas are dropped. */
export const MAX_MCP_SCHEMA_JSON_BYTES = 8192;

/** Default timeout for MCP tool calls in milliseconds. */
export const DEFAULT_MCP_TIMEOUT_MS = 30000;

/** Default timeout for MCP server connection/list operations in milliseconds. */
export const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 10000;

/** JSON-RPC protocol version advertised by the client. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * Global hard kill switch for all MCP functionality.
 *
 * When MCP_ENABLED is "false", the system behaves identically to pre-MCP:
 * no server connections, no tool definitions, and execution returns a
 * structured disabled error. Works even if the database is unavailable.
 */
export function isMcpEnabled(): boolean {
  return process.env.MCP_ENABLED !== 'false';
}
