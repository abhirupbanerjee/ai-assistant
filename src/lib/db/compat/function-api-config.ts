/**
 * Function API Config Compatibility Layer
 *
 * Provides async interface for Function API configuration operations.
 * Supports both SQLite and PostgreSQL.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../kysely';
import { safeEncrypt, safeDecrypt } from '../../encryption';
import type OpenAI from 'openai';
import type {
  FunctionAPIConfig,
  FunctionAPIAuthType,
  FunctionAPIStatus,
  EndpointMapping,
  CreateFunctionAPIRequest,
  UpdateFunctionAPIRequest,
} from '@/types/function-api';

// Re-export types
export type {
  FunctionAPIConfig,
  FunctionAPIAuthType,
  FunctionAPIStatus,
  EndpointMapping,
  DbFunctionAPIConfig,
  DbFunctionAPICategory,
  CreateFunctionAPIRequest,
  UpdateFunctionAPIRequest,
} from '@/types/function-api';

// ============ Row Mapper ============

interface PgFunctionAPIRow {
  id: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_type: string;
  auth_header: string | null;
  auth_credentials: string | null;
  default_headers: string | null;
  tools_schema: string;
  endpoint_mappings: string;
  timeout_seconds: number;
  cache_ttl_seconds: number;
  is_enabled: number;
  status: string;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
  last_tested: string | Date | null;
  last_error: string | null;
}

function mapPgToFunctionAPIConfig(row: PgFunctionAPIRow, categoryIds: number[]): FunctionAPIConfig {
  const toIso = (v: string | Date | null | undefined) =>
    v instanceof Date ? v.toISOString() : (v ?? undefined);

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    baseUrl: row.base_url,
    authType: row.auth_type as FunctionAPIAuthType,
    authHeader: row.auth_header || undefined,
    authCredentials: row.auth_credentials ? safeDecrypt(row.auth_credentials) || undefined : undefined,
    defaultHeaders: row.default_headers ? JSON.parse(row.default_headers) : undefined,
    toolsSchema: JSON.parse(row.tools_schema),
    endpointMappings: JSON.parse(row.endpoint_mappings),
    timeoutSeconds: row.timeout_seconds,
    cacheTTLSeconds: row.cache_ttl_seconds,
    isEnabled: row.is_enabled === 1,
    status: row.status as FunctionAPIStatus,
    categoryIds,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    lastTested: toIso(row.last_tested),
    lastError: row.last_error || undefined,
  };
}

// ============ Helper: Get category IDs for an API ============

async function getPgCategoryIds(apiId: string): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('function_api_categories')
    .select('category_id')
    .where('api_id', '=', apiId)
    .execute();
  return rows.map(r => r.category_id);
}

async function setPgCategoryIds(apiId: string, categoryIds: number[]): Promise<void> {
  const db = await getDb();
  await db.deleteFrom('function_api_categories').where('api_id', '=', apiId).execute();
  if (categoryIds.length > 0) {
    await db
      .insertInto('function_api_categories')
      .values(categoryIds.map(cid => ({ api_id: apiId, category_id: cid })))
      .execute();
  }
}

// ============ CRUD Operations ============

export async function createFunctionAPIConfig(
  config: CreateFunctionAPIRequest,
  createdBy: string
): Promise<FunctionAPIConfig> {
  const db = await getDb();
  const id = uuidv4();

  await db
    .insertInto('function_api_configs')
    .values({
      id,
      name: config.name,
      description: config.description || null,
      base_url: config.baseUrl,
      auth_type: config.authType,
      auth_header: config.authHeader || null,
      auth_credentials: config.authCredentials ? safeEncrypt(config.authCredentials) : null,
      default_headers: config.defaultHeaders ? JSON.stringify(config.defaultHeaders) : null,
      tools_schema: JSON.stringify(config.toolsSchema),
      endpoint_mappings: JSON.stringify(config.endpointMappings),
      timeout_seconds: config.timeoutSeconds || 30,
      cache_ttl_seconds: config.cacheTTLSeconds || 3600,
      is_enabled: config.isEnabled !== false ? 1 : 0,
      status: 'untested',
      created_by: createdBy,
    })
    .execute();

  await setPgCategoryIds(id, config.categoryIds);

  return (await getFunctionAPIConfig(id))!;
}

export async function getFunctionAPIConfig(id: string): Promise<FunctionAPIConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('function_api_configs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!row) return undefined;

  const categoryIds = await getPgCategoryIds(id);
  return mapPgToFunctionAPIConfig(row as unknown as PgFunctionAPIRow, categoryIds);
}

export async function getFunctionAPIConfigByName(name: string): Promise<FunctionAPIConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('function_api_configs')
    .selectAll()
    .where('name', '=', name)
    .executeTakeFirst();

  if (!row) return undefined;

  const categoryIds = await getPgCategoryIds(row.id);
  return mapPgToFunctionAPIConfig(row as unknown as PgFunctionAPIRow, categoryIds);
}

export async function getAllFunctionAPIConfigs(): Promise<FunctionAPIConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('function_api_configs')
    .selectAll()
    .orderBy('name', 'asc')
    .execute();

  return Promise.all(
    rows.map(async row => {
      const categoryIds = await getPgCategoryIds(row.id);
      return mapPgToFunctionAPIConfig(row as unknown as PgFunctionAPIRow, categoryIds);
    })
  );
}

export async function getEnabledFunctionAPIConfigs(): Promise<FunctionAPIConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('function_api_configs')
    .selectAll()
    .where('is_enabled', '=', 1)
    .where('status', 'in', ['active', 'untested'])
    .orderBy('name', 'asc')
    .execute();

  return Promise.all(
    rows.map(async row => {
      const categoryIds = await getPgCategoryIds(row.id);
      return mapPgToFunctionAPIConfig(row as unknown as PgFunctionAPIRow, categoryIds);
    })
  );
}

export async function getFunctionAPIConfigsForCategories(
  categoryIds: number[]
): Promise<FunctionAPIConfig[]> {
  if (!categoryIds || categoryIds.length === 0) return [];

  const db = await getDb();
  const rows = await db
    .selectFrom('function_api_configs as f')
    .innerJoin('function_api_categories as fc', 'f.id', 'fc.api_id')
    .selectAll('f')
    .where('fc.category_id', 'in', categoryIds)
    .where('f.is_enabled', '=', 1)
    .where('f.status', 'in', ['active', 'untested'])
    .orderBy('f.name', 'asc')
    .execute();

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = rows.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  return Promise.all(
    unique.map(async row => {
      const catIds = await getPgCategoryIds(row.id);
      return mapPgToFunctionAPIConfig(row as unknown as PgFunctionAPIRow, catIds);
    })
  );
}

export async function updateFunctionAPIConfig(
  id: string,
  updates: UpdateFunctionAPIRequest,
  _updatedBy: string
): Promise<FunctionAPIConfig | undefined> {
  const db = await getDb();
  const existing = await getFunctionAPIConfig(id);
  if (!existing) return undefined;

  const updateData: Record<string, unknown> = { updated_at: new Date() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description || null;
  if (updates.baseUrl !== undefined) updateData.base_url = updates.baseUrl;
  if (updates.authType !== undefined) updateData.auth_type = updates.authType;
  if (updates.authHeader !== undefined) updateData.auth_header = updates.authHeader || null;
  if (updates.authCredentials !== undefined) {
    updateData.auth_credentials = updates.authCredentials ? safeEncrypt(updates.authCredentials) : null;
  }
  if (updates.defaultHeaders !== undefined) {
    updateData.default_headers = updates.defaultHeaders ? JSON.stringify(updates.defaultHeaders) : null;
  }
  if (updates.toolsSchema !== undefined) updateData.tools_schema = JSON.stringify(updates.toolsSchema);
  if (updates.endpointMappings !== undefined) updateData.endpoint_mappings = JSON.stringify(updates.endpointMappings);
  if (updates.timeoutSeconds !== undefined) updateData.timeout_seconds = updates.timeoutSeconds;
  if (updates.cacheTTLSeconds !== undefined) updateData.cache_ttl_seconds = updates.cacheTTLSeconds;
  if (updates.isEnabled !== undefined) updateData.is_enabled = updates.isEnabled ? 1 : 0;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.lastError !== undefined) updateData.last_error = updates.lastError || null;

  await db.updateTable('function_api_configs').set(updateData).where('id', '=', id).execute();

  if (updates.categoryIds !== undefined) {
    await setPgCategoryIds(id, updates.categoryIds);
  }

  return getFunctionAPIConfig(id);
}

export async function updateFunctionAPITestStatus(
  id: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('function_api_configs')
    .set({
      status: success ? 'active' : 'error',
      last_tested: new Date().toISOString(),
      last_error: errorMessage || null,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .execute();
}

export async function deleteFunctionAPIConfig(id: string): Promise<boolean> {
  const db = await getDb();
  // Categories are deleted via ON DELETE CASCADE in the schema
  const result = await db
    .deleteFrom('function_api_configs')
    .where('id', '=', id)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

// ============ Function Lookup Helpers ============

export async function findConfigForFunction(
  functionName: string,
  categoryIds?: number[]
): Promise<{ config: FunctionAPIConfig; endpoint: EndpointMapping } | undefined> {
  const configs = categoryIds
    ? await getFunctionAPIConfigsForCategories(categoryIds)
    : await getEnabledFunctionAPIConfigs();

  for (const config of configs) {
    const endpoint = config.endpointMappings[functionName];
    if (endpoint) return { config, endpoint };
  }

  return undefined;
}

export async function getAllFunctionNamesForCategories(categoryIds: number[]): Promise<string[]> {
  const configs = await getFunctionAPIConfigsForCategories(categoryIds);
  return configs.flatMap(config => Object.keys(config.endpointMappings));
}

export async function getToolDefinitionsForCategories(
  categoryIds: number[]
): Promise<OpenAI.Chat.ChatCompletionFunctionTool[]> {
  const configs = await getFunctionAPIConfigsForCategories(categoryIds);
  return configs.flatMap(config => config.toolsSchema);
}

// ============ Validation Helpers (no DB dependency) ============

export {
  validateToolsSchema,
  validateEndpointMappings,
} from '../utils';
