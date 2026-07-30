/**
 * MCP Tool Source
 *
 * Models MCP tools as a dynamic tool source following the agent-as-tool dispatch
 * contract:
 *   - isMcpTool(name)
 *   - getMcpToolDefinitions(categoryIds?)
 *   - executeMcpTool(name, args)
 *
 * Discovered tools are cached in memory and mirrored to tool_configs rows so the
 * existing enable/disable/description-override machinery works transparently.
 */

import type { OpenAI } from 'openai';
import type { McpRegisteredTool, McpServerConfig } from './types';
import {
  isMcpEnabled,
  MCP_TOOL_PREFIX,
  MAX_MCP_TOOLS_TOTAL,
  MAX_MCP_TOOLS_PER_SERVER,
  MAX_MCP_DESCRIPTION_LENGTH,
  MAX_MCP_SCHEMA_JSON_BYTES,
} from './config';
import { listMcpServerTools, callMcpTool, mcpResultToString, healthCheckMcpServer } from './client';
import { convertMcpSchemaToOpenAI, estimateSchemaSize, logSchemaWarnings } from './schema-converter';
import {
  listMcpServers,
  updateMcpServerHealth,
  getMcpServer,
  getToolConfig,
  isToolEnabled,
  getDescriptionOverride,
  createToolConfig,
  updateToolConfig,
} from '@/lib/db/compat';
import { AVAILABLE_TOOLS } from '@/lib/tools';
import { toolsLogger as logger } from '@/lib/logger';

// In-memory registry of discovered MCP tools keyed by prefixed name.
const mcpToolRegistry = new Map<string, McpRegisteredTool>();

// Phase 6 optimization: cache discovery results to avoid redundant re-discovery
// within a single request. MCP server config changes are rare; a 30s TTL is
// acceptable staleness. Only skip when the last discovery found 0 servers.
let lastDiscoveryTime = 0;
let lastDiscoveryServerCount = 0;
const MCP_DISCOVERY_CACHE_MS = 30_000;

/**
 * Check whether a tool name refers to an MCP tool.
 */
export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

/**
 * Build the prefixed tool name from server ID and original tool name.
 */
export function buildMcpToolName(serverId: string, originalName: string): string {
  // Normalize original name: replace slashes and dots with underscores so it
  // remains a valid OpenAI function name.
  const safeOriginal = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${MCP_TOOL_PREFIX}${serverId}_${safeOriginal}`;
}

/**
 * Parse a prefixed MCP tool name back into server ID and original name.
 */
export function parseMcpToolName(prefixedName: string): { serverId: string; originalName: string } | null {
  if (!isMcpTool(prefixedName)) return null;
  const rest = prefixedName.slice(MCP_TOOL_PREFIX.length);
  const underscoreIdx = rest.indexOf('_');
  if (underscoreIdx === -1) return null;
  return {
    serverId: rest.slice(0, underscoreIdx),
    originalName: rest.slice(underscoreIdx + 1),
  };
}

/**
 * Refresh the in-memory registry by discovering tools from all enabled MCP servers.
 */
export async function refreshMcpTools(): Promise<void> {
  if (!isMcpEnabled()) {
    mcpToolRegistry.clear();
    return;
  }

  // Fast-path: if we discovered recently and no servers existed, skip
  // re-discovery for the cache window. Server config changes are rare.
  const now = Date.now();
  if (now - lastDiscoveryTime < MCP_DISCOVERY_CACHE_MS) {
    if (lastDiscoveryServerCount === 0) {
      // No servers last time — still no servers. Skip.
      return;
    }
    // Servers existed — re-discover to pick up tool changes.
  }

  mcpToolRegistry.clear();

  let servers: McpServerConfig[];
  try {
    servers = await listMcpServers();
  } catch (error) {
    logger.error('Failed to load MCP servers for tool discovery', { error: String(error) });
    return;
  }

  // Track for next cache window
  lastDiscoveryTime = Date.now();
  lastDiscoveryServerCount = servers.length;

  for (const server of servers) {
    if (!server.enabled) continue;

    try {
      const result = await listMcpServerTools(server);
      let serverToolCount = 0;

      for (const tool of result.tools || []) {
        if (serverToolCount >= MAX_MCP_TOOLS_PER_SERVER) {
          logger.warn(`MCP server ${server.id} exceeds per-server tool cap (${MAX_MCP_TOOLS_PER_SERVER}); truncating`);
          break;
        }

        const prefixedName = buildMcpToolName(server.id, tool.name);

        // Skip collisions with built-in tools.
        if (prefixedName in AVAILABLE_TOOLS) {
          logger.warn(`MCP tool ${prefixedName} collides with built-in tool; skipping`);
          continue;
        }

        const conversion = convertMcpSchemaToOpenAI(tool.inputSchema || {});
        logSchemaWarnings(prefixedName, conversion.warnings);

        const schemaSize = estimateSchemaSize(conversion.parameters as Record<string, unknown>);
        if (schemaSize > MAX_MCP_SCHEMA_JSON_BYTES) {
          logger.warn(`MCP tool ${prefixedName} schema exceeds size limit (${schemaSize} bytes); skipping`);
          continue;
        }

        const description = (tool.description || `MCP tool ${tool.name}`).slice(0, MAX_MCP_DESCRIPTION_LENGTH);

        const definition: OpenAI.Chat.ChatCompletionFunctionTool = {
          type: 'function',
          function: {
            name: prefixedName,
            description,
            parameters: conversion.parameters,
          },
        };

        mcpToolRegistry.set(prefixedName, {
          originalName: tool.name,
          prefixedName,
          serverId: server.id,
          description,
          definition,
        });

        serverToolCount++;

        // Ensure a tool_configs row exists for this MCP tool.
        await ensureMcpToolConfig(prefixedName, server.id, tool.name);
      }

      await updateMcpServerHealth(server.id, {
        healthStatus: 'connected',
        toolCount: serverToolCount,
      });
    } catch (error) {
      logger.error(`Failed to discover MCP tools from server ${server.id}`, { error: String(error) });
      await updateMcpServerHealth(server.id, {
        healthStatus: 'error',
        toolCount: 0,
      });
    }
  }

  logger.info(`MCP tool discovery complete: ${mcpToolRegistry.size} tools registered`);
}

/**
 * Ensure a tool_configs row exists for an MCP tool.
 */
async function ensureMcpToolConfig(prefixedName: string, serverId: string, originalName: string): Promise<void> {
  const existing = await getToolConfig(prefixedName).catch(() => undefined);
  if (existing) {
    // Update tool_type if the row predates this migration.
    if (existing.config?.toolType !== 'mcp') {
      await updateToolConfig(
        prefixedName,
        {
          config: {
            ...existing.config,
            toolType: 'mcp',
            serverId,
            originalName,
            subagentSafe: existing.config?.subagentSafe ?? false,
            isTerminal: existing.config?.isTerminal ?? false,
          },
          toolType: 'mcp',
        },
        'system'
      );
    }
    return;
  }

  await createToolConfig(
    prefixedName,
    {
      toolType: 'mcp',
      serverId,
      originalName,
      subagentSafe: false,
      isTerminal: false,
    },
    true,
    'system',
    'mcp'
  );
}

/**
 * Get OpenAI function-tool definitions for all enabled MCP tools.
 *
 * Respects description overrides from tool_configs and applies global/per-server
 * context caps.
 */
export async function getMcpToolDefinitions(): Promise<OpenAI.Chat.ChatCompletionFunctionTool[]> {
  if (!isMcpEnabled()) return [];

  // Lazy discovery if registry is empty.
  if (mcpToolRegistry.size === 0) {
    await refreshMcpTools();
  }

  const definitions: OpenAI.Chat.ChatCompletionFunctionTool[] = [];
  let totalCount = 0;

  for (const tool of mcpToolRegistry.values()) {
    if (totalCount >= MAX_MCP_TOOLS_TOTAL) {
      logger.warn(`MCP tool list exceeds global cap (${MAX_MCP_TOOLS_TOTAL}); truncating`);
      break;
    }

    const enabled = await isToolEnabled(tool.prefixedName).catch(() => false);
    if (!enabled) continue;

    const override = await getDescriptionOverride(tool.prefixedName).catch(() => null);
    if (override) {
      definitions.push({
        ...tool.definition,
        function: {
          ...tool.definition.function,
          description: override.slice(0, MAX_MCP_DESCRIPTION_LENGTH),
        },
      });
    } else {
      definitions.push(tool.definition);
    }

    totalCount++;
  }

  return definitions;
}

/**
 * Execute an MCP tool call.
 */
export async function executeMcpTool(name: string, args: string): Promise<string> {
  if (!isMcpEnabled()) {
    return JSON.stringify({
      success: false,
      error: 'MCP is globally disabled via MCP_ENABLED',
      errorCode: 'MCP_DISABLED',
    });
  }

  const parsedName = parseMcpToolName(name);
  if (!parsedName) {
    return JSON.stringify({
      success: false,
      error: `Invalid MCP tool name: ${name}`,
      errorCode: 'INVALID_MCP_TOOL_NAME',
    });
  }

  const { serverId, originalName } = parsedName;

  const server = await getMcpServer(serverId).catch(() => undefined);
  if (!server) {
    return JSON.stringify({
      success: false,
      error: `MCP server not found: ${serverId}`,
      errorCode: 'MCP_SERVER_NOT_FOUND',
    });
  }

  if (!server.enabled) {
    return JSON.stringify({
      success: false,
      error: `MCP server is disabled: ${serverId}`,
      errorCode: 'MCP_SERVER_DISABLED',
    });
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(args);
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Invalid JSON arguments for MCP tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      errorCode: 'INVALID_JSON_ARGUMENTS',
    });
  }

  try {
    const result = await callMcpTool(server, originalName, parsedArgs);
    const output = mcpResultToString(result);
    return output;
  } catch (error) {
    logger.error(`MCP tool execution error [${name}]`, { error: String(error) });
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'MCP_EXECUTION_ERROR',
    });
  }
}

/**
 * Get metadata for a registered MCP tool.
 */
export function getMcpToolMetadata(name: string): McpRegisteredTool | undefined {
  return mcpToolRegistry.get(name);
}

/**
 * Get all registered MCP tools.
 */
export function getAllMcpTools(): McpRegisteredTool[] {
  return Array.from(mcpToolRegistry.values());
}

/**
 * Resolve whether an MCP tool is safe for subagent use.
 */
export async function isMcpToolSubagentSafe(name: string): Promise<boolean> {
  const config = await getToolConfig(name).catch(() => undefined);
  if (!config) return false;
  return config.config?.subagentSafe === true;
}

/**
 * Check whether an MCP tool should be treated as terminal.
 */
export async function isMcpToolTerminal(name: string): Promise<boolean> {
  const config = await getToolConfig(name).catch(() => undefined);
  if (!config) return false;
  return config.config?.isTerminal === true;
}

/**
 * Run a health check against an MCP server and update its DB state.
 */
export async function checkMcpServerHealth(serverId: string): Promise<{
  status: 'connected' | 'error';
  toolCount: number;
  error?: string;
}> {
  const server = await getMcpServer(serverId).catch(() => undefined);
  if (!server) {
    return { status: 'error', toolCount: 0, error: 'Server not found' };
  }

  const result = await healthCheckMcpServer(server);
  await updateMcpServerHealth(serverId, {
    healthStatus: result.status,
    toolCount: result.toolCount,
  });
  return result;
}
