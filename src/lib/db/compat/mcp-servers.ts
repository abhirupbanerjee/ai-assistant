/**
 * MCP Server Configuration Database Operations
 *
 * Uses Kysely query builder for PostgreSQL. Auth tokens are encrypted at rest
 * using the existing encryption utility.
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { encrypt, decrypt } from '@/lib/encryption';
import type { McpServerConfig, McpHealthStatus } from '@/lib/mcp/types';

// ============ Row Types ============

interface DbMcpServer {
  id: string;
  name: string;
  url: string;
  auth_token: string | null;
  enabled: number;
  timeout_ms: number;
  tool_count: number;
  last_health_check: string | null;
  health_status: string;
  created_at: string;
  updated_at: string;
}

export interface McpServerPublicConfig {
  id: string;
  name: string;
  url: string;
  hasAuthToken: boolean;
  enabled: boolean;
  timeoutMs: number;
  toolCount: number;
  lastHealthCheck: string | null;
  healthStatus: McpHealthStatus;
  createdAt: string;
  updatedAt: string;
}

// ============ Mapping ============

function mapRowToConfig(row: DbMcpServer): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authToken: row.auth_token ? decrypt(row.auth_token) : null,
    enabled: row.enabled === 1,
    timeoutMs: row.timeout_ms,
    toolCount: row.tool_count,
    lastHealthCheck: row.last_health_check,
    healthStatus: row.health_status as McpHealthStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToPublicConfig(row: DbMcpServer): McpServerPublicConfig {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    hasAuthToken: !!row.auth_token,
    enabled: row.enabled === 1,
    timeoutMs: row.timeout_ms,
    toolCount: row.tool_count,
    lastHealthCheck: row.last_health_check,
    healthStatus: row.health_status as McpHealthStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encryptToken(token: string | null | undefined): string | null {
  if (!token) return null;
  return encrypt(token);
}

const VALID_SERVER_ID = /^[a-z0-9-]+$/;

function validateMcpServerInput(input: { id?: string; url?: string }): { valid: boolean; error?: string } {
  if (input.id !== undefined && !VALID_SERVER_ID.test(input.id)) {
    return {
      valid: false,
      error: 'Server ID must contain only lowercase letters, numbers, and hyphens (no underscores or spaces).',
    };
  }
  if (input.url !== undefined) {
    try {
      const parsed = new URL(input.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, error: 'Server URL must use http:// or https://.' };
      }
    } catch {
      return { valid: false, error: 'Server URL must be a valid URL.' };
    }
  }
  return { valid: true };
}

// ============ CRUD ============

/**
 * List all MCP server configurations (full, with decrypted tokens).
 */
export async function listMcpServers(): Promise<McpServerConfig[]> {
  const db = await getDb();
  const rows = await db.selectFrom('mcp_servers').selectAll().orderBy('name').execute();
  return rows.map((r) => mapRowToConfig(r as DbMcpServer));
}

/**
 * List all MCP server configurations without exposing decrypted tokens.
 */
export async function listMcpServersPublic(): Promise<McpServerPublicConfig[]> {
  const db = await getDb();
  const rows = await db.selectFrom('mcp_servers').selectAll().orderBy('name').execute();
  return rows.map((r) => mapRowToPublicConfig(r as DbMcpServer));
}

/**
 * Get a single MCP server configuration (full, with decrypted token).
 */
export async function getMcpServer(id: string): Promise<McpServerConfig | undefined> {
  const db = await getDb();
  const row = await db.selectFrom('mcp_servers').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) return undefined;
  return mapRowToConfig(row as DbMcpServer);
}

/**
 * Get a single MCP server configuration without exposing the decrypted token.
 */
export async function getMcpServerPublic(id: string): Promise<McpServerPublicConfig | undefined> {
  const db = await getDb();
  const row = await db.selectFrom('mcp_servers').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) return undefined;
  return mapRowToPublicConfig(row as DbMcpServer);
}

/**
 * Get only the decrypted auth token for a server.
 */
export async function getMcpServerAuthToken(id: string): Promise<string | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('mcp_servers')
    .select('auth_token')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row?.auth_token) return null;
  return decrypt(row.auth_token);
}

/**
 * Create a new MCP server configuration.
 */
export async function createMcpServer(
  input: Omit<McpServerConfig, 'createdAt' | 'updatedAt' | 'toolCount' | 'lastHealthCheck' | 'healthStatus'>
): Promise<McpServerConfig> {
  const validation = validateMcpServerInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const db = await getDb();
  const id = input.id || uuidv4();
  const values = {
    id,
    name: input.name,
    url: input.url,
    auth_token: encryptToken(input.authToken),
    enabled: input.enabled ? 1 : 0,
    timeout_ms: input.timeoutMs,
    tool_count: 0,
    health_status: 'unknown' as const,
  };

  await db.insertInto('mcp_servers').values(values).execute();

  const row = await db.selectFrom('mcp_servers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return mapRowToConfig(row as DbMcpServer);
}

/**
 * Update an MCP server configuration.
 */
export async function updateMcpServer(
  id: string,
  input: Partial<Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<McpServerConfig | undefined> {
  const validation = validateMcpServerInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const db = await getDb();
  const existing = await getMcpServer(id);
  if (!existing) return undefined;

  const set: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.name !== undefined) set.name = input.name;
  if (input.url !== undefined) set.url = input.url;
  if (input.authToken !== undefined) set.auth_token = encryptToken(input.authToken);
  if (input.enabled !== undefined) set.enabled = input.enabled ? 1 : 0;
  if (input.timeoutMs !== undefined) set.timeout_ms = input.timeoutMs;
  if (input.toolCount !== undefined) set.tool_count = input.toolCount;
  if (input.lastHealthCheck !== undefined) set.last_health_check = input.lastHealthCheck;
  if (input.healthStatus !== undefined) set.health_status = input.healthStatus;

  await db.updateTable('mcp_servers').set(set).where('id', '=', id).execute();

  const row = await db.selectFrom('mcp_servers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return mapRowToConfig(row as DbMcpServer);
}

/**
 * Delete an MCP server configuration.
 */
export async function deleteMcpServer(id: string): Promise<boolean> {
  return transaction(async (trx) => {
    const result = await trx.deleteFrom('mcp_servers').where('id', '=', id).executeTakeFirst();
    // Cascade-delete associated tool_configs rows for MCP tools from this server.
    await trx
      .deleteFrom('tool_configs')
      .where('tool_name', 'like', `mcp_${id}_%`)
      .execute();
    return (result.numDeletedRows ?? 0) > 0;
  });
}

/**
 * Bulk enable or disable all MCP servers.
 */
export async function bulkUpdateMcpServersEnabled(enabled: boolean): Promise<number> {
  const db = await getDb();
  const result = await db
    .updateTable('mcp_servers')
    .set({ enabled: enabled ? 1 : 0, updated_at: new Date().toISOString() })
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}

/**
 * Update health status and tool count for a server.
 */
export async function updateMcpServerHealth(
  id: string,
  health: {
    healthStatus: McpHealthStatus;
    toolCount?: number;
    lastHealthCheck?: string;
  }
): Promise<McpServerConfig | undefined> {
  return updateMcpServer(id, {
    healthStatus: health.healthStatus,
    toolCount: health.toolCount,
    lastHealthCheck: health.lastHealthCheck ?? new Date().toISOString(),
  });
}
