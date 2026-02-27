/**
 * Function API Configuration Database Operations
 *
 * CRUD operations for function_api_configs and function_api_categories tables.
 * Supports OpenAI-format function calling schema configurations.
 */

import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne, queryAll, transaction } from './index';
import { safeEncrypt, safeDecrypt } from '../encryption';
import type OpenAI from 'openai';
import type {
  FunctionAPIConfig,
  FunctionAPIAuthType,
  FunctionAPIStatus,
  EndpointMapping,
  DbFunctionAPIConfig,
  DbFunctionAPICategory,
  CreateFunctionAPIRequest,
  UpdateFunctionAPIRequest,
} from '../../types/function-api';

// ===== Mappers =====

/**
 * Map database row to FunctionAPIConfig
 */
function mapDbToFunctionAPIConfig(row: DbFunctionAPIConfig, categoryIds: number[]): FunctionAPIConfig {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTested: row.last_tested || undefined,
    lastError: row.last_error || undefined,
  };
}

// ===== Category Helpers =====

/**
 * Get category IDs for a Function API
 */
function getFunctionAPICategoryIds(apiId: string): number[] {
  const rows = queryAll<DbFunctionAPICategory>(
    'SELECT category_id FROM function_api_categories WHERE api_id = ?',
    [apiId]
  );
  return rows.map(r => r.category_id);
}

/**
 * Update category mappings for a Function API
 */
function updateFunctionAPICategories(apiId: string, categoryIds: number[]): void {
  // Delete existing mappings
  execute('DELETE FROM function_api_categories WHERE api_id = ?', [apiId]);

  // Insert new mappings
  for (const categoryId of categoryIds) {
    execute(
      'INSERT INTO function_api_categories (api_id, category_id) VALUES (?, ?)',
      [apiId, categoryId]
    );
  }
}

// ===== CRUD Operations =====

/**
 * Create a new Function API configuration
 */
export function createFunctionAPIConfig(
  config: CreateFunctionAPIRequest,
  createdBy: string
): FunctionAPIConfig {
  const id = uuidv4();

  return transaction(() => {
    execute(
      `INSERT INTO function_api_configs (
        id, name, description, base_url, auth_type, auth_header, auth_credentials,
        default_headers, tools_schema, endpoint_mappings, timeout_seconds,
        cache_ttl_seconds, is_enabled, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', ?)`,
      [
        id,
        config.name,
        config.description || null,
        config.baseUrl,
        config.authType,
        config.authHeader || null,
        config.authCredentials ? safeEncrypt(config.authCredentials) : null,
        config.defaultHeaders ? JSON.stringify(config.defaultHeaders) : null,
        JSON.stringify(config.toolsSchema),
        JSON.stringify(config.endpointMappings),
        config.timeoutSeconds || 30,
        config.cacheTTLSeconds || 3600,
        config.isEnabled !== false ? 1 : 0,
        createdBy,
      ]
    );

    // Add category mappings
    updateFunctionAPICategories(id, config.categoryIds);

    return getFunctionAPIConfig(id)!;
  });
}

/**
 * Get a Function API configuration by ID
 */
export function getFunctionAPIConfig(id: string): FunctionAPIConfig | undefined {
  const row = queryOne<DbFunctionAPIConfig>(
    'SELECT * FROM function_api_configs WHERE id = ?',
    [id]
  );

  if (!row) return undefined;

  const categoryIds = getFunctionAPICategoryIds(id);
  return mapDbToFunctionAPIConfig(row, categoryIds);
}

/**
 * Get a Function API configuration by name
 */
export function getFunctionAPIConfigByName(name: string): FunctionAPIConfig | undefined {
  const row = queryOne<DbFunctionAPIConfig>(
    'SELECT * FROM function_api_configs WHERE name = ?',
    [name]
  );

  if (!row) return undefined;

  const categoryIds = getFunctionAPICategoryIds(row.id);
  return mapDbToFunctionAPIConfig(row, categoryIds);
}

/**
 * Get all Function API configurations
 */
export function getAllFunctionAPIConfigs(): FunctionAPIConfig[] {
  const rows = queryAll<DbFunctionAPIConfig>(
    'SELECT * FROM function_api_configs ORDER BY name'
  );

  return rows.map(row => {
    const categoryIds = getFunctionAPICategoryIds(row.id);
    return mapDbToFunctionAPIConfig(row, categoryIds);
  });
}

/**
 * Get all enabled Function API configurations
 */
export function getEnabledFunctionAPIConfigs(): FunctionAPIConfig[] {
  const rows = queryAll<DbFunctionAPIConfig>(
    `SELECT * FROM function_api_configs
     WHERE is_enabled = 1 AND status IN ('active', 'untested')
     ORDER BY name`
  );

  return rows.map(row => {
    const categoryIds = getFunctionAPICategoryIds(row.id);
    return mapDbToFunctionAPIConfig(row, categoryIds);
  });
}

/**
 * Get Function API configurations accessible to specific categories
 */
export function getFunctionAPIConfigsForCategories(categoryIds: number[]): FunctionAPIConfig[] {
  if (!categoryIds || categoryIds.length === 0) return [];

  const placeholders = categoryIds.map(() => '?').join(',');
  const rows = queryAll<DbFunctionAPIConfig>(
    `SELECT DISTINCT f.* FROM function_api_configs f
     INNER JOIN function_api_categories fc ON f.id = fc.api_id
     WHERE fc.category_id IN (${placeholders})
     AND f.is_enabled = 1
     AND f.status IN ('active', 'untested')
     ORDER BY f.name`,
    categoryIds
  );

  return rows.map(row => {
    const catIds = getFunctionAPICategoryIds(row.id);
    return mapDbToFunctionAPIConfig(row, catIds);
  });
}

/**
 * Update a Function API configuration
 */
export function updateFunctionAPIConfig(
  id: string,
  updates: UpdateFunctionAPIRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _updatedBy: string
): FunctionAPIConfig | undefined {
  const existing = getFunctionAPIConfig(id);
  if (!existing) return undefined;

  return transaction(() => {
    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description || null);
    }
    if (updates.baseUrl !== undefined) {
      setClauses.push('base_url = ?');
      values.push(updates.baseUrl);
    }
    if (updates.authType !== undefined) {
      setClauses.push('auth_type = ?');
      values.push(updates.authType);
    }
    if (updates.authHeader !== undefined) {
      setClauses.push('auth_header = ?');
      values.push(updates.authHeader || null);
    }
    if (updates.authCredentials !== undefined) {
      setClauses.push('auth_credentials = ?');
      values.push(updates.authCredentials ? safeEncrypt(updates.authCredentials) : null);
    }
    if (updates.defaultHeaders !== undefined) {
      setClauses.push('default_headers = ?');
      values.push(updates.defaultHeaders ? JSON.stringify(updates.defaultHeaders) : null);
    }
    if (updates.toolsSchema !== undefined) {
      setClauses.push('tools_schema = ?');
      values.push(JSON.stringify(updates.toolsSchema));
    }
    if (updates.endpointMappings !== undefined) {
      setClauses.push('endpoint_mappings = ?');
      values.push(JSON.stringify(updates.endpointMappings));
    }
    if (updates.timeoutSeconds !== undefined) {
      setClauses.push('timeout_seconds = ?');
      values.push(updates.timeoutSeconds);
    }
    if (updates.cacheTTLSeconds !== undefined) {
      setClauses.push('cache_ttl_seconds = ?');
      values.push(updates.cacheTTLSeconds);
    }
    if (updates.isEnabled !== undefined) {
      setClauses.push('is_enabled = ?');
      values.push(updates.isEnabled ? 1 : 0);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.lastError !== undefined) {
      setClauses.push('last_error = ?');
      values.push(updates.lastError || null);
    }

    values.push(id);

    execute(
      `UPDATE function_api_configs SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    // Update category mappings if provided
    if (updates.categoryIds !== undefined) {
      updateFunctionAPICategories(id, updates.categoryIds);
    }

    return getFunctionAPIConfig(id)!;
  });
}

/**
 * Update the test status of a Function API
 */
export function updateFunctionAPITestStatus(
  id: string,
  success: boolean,
  errorMessage?: string
): void {
  execute(
    `UPDATE function_api_configs
     SET status = ?, last_tested = CURRENT_TIMESTAMP, last_error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [success ? 'active' : 'error', errorMessage || null, id]
  );
}

/**
 * Delete a Function API configuration
 */
export function deleteFunctionAPIConfig(id: string): boolean {
  const existing = getFunctionAPIConfig(id);
  if (!existing) return false;

  return transaction(() => {
    // Category mappings will be deleted via ON DELETE CASCADE
    execute('DELETE FROM function_api_configs WHERE id = ?', [id]);
    return true;
  });
}

// ===== Function Lookup Helpers =====

/**
 * Find which Function API config contains a specific function name
 * Returns the config and endpoint mapping for the function
 */
export function findConfigForFunction(
  functionName: string,
  categoryIds?: number[]
): { config: FunctionAPIConfig; endpoint: EndpointMapping } | undefined {
  // Get enabled configs, optionally filtered by category
  const configs = categoryIds
    ? getFunctionAPIConfigsForCategories(categoryIds)
    : getEnabledFunctionAPIConfigs();

  for (const config of configs) {
    const endpoint = config.endpointMappings[functionName];
    if (endpoint) {
      return { config, endpoint };
    }
  }

  return undefined;
}

/**
 * Get all function names from enabled Function APIs for specific categories
 */
export function getAllFunctionNamesForCategories(categoryIds: number[]): string[] {
  const configs = getFunctionAPIConfigsForCategories(categoryIds);
  const functionNames: string[] = [];

  for (const config of configs) {
    functionNames.push(...Object.keys(config.endpointMappings));
  }

  return functionNames;
}

/**
 * Get all OpenAI tool definitions from enabled Function APIs for specific categories
 */
export function getToolDefinitionsForCategories(
  categoryIds: number[]
): OpenAI.Chat.ChatCompletionFunctionTool[] {
  const configs = getFunctionAPIConfigsForCategories(categoryIds);
  return configs.flatMap(config => config.toolsSchema);
}

// ===== Validation Helpers =====

/**
 * Validate that a tools schema is in valid OpenAI format
 */
export function validateToolsSchema(
  schema: unknown
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(schema)) {
    errors.push('Schema must be an array of tool definitions');
    return { valid: false, errors };
  }

  for (let i = 0; i < schema.length; i++) {
    const tool = schema[i] as Record<string, unknown>;

    if (tool.type !== 'function') {
      errors.push(`Tool ${i}: type must be "function"`);
    }

    if (!tool.function || typeof tool.function !== 'object') {
      errors.push(`Tool ${i}: missing "function" object`);
      continue;
    }

    const func = tool.function as Record<string, unknown>;

    if (!func.name || typeof func.name !== 'string') {
      errors.push(`Tool ${i}: function must have a "name" string`);
    }

    if (!func.description || typeof func.description !== 'string') {
      errors.push(`Tool ${i}: function must have a "description" string`);
    }

    if (func.parameters && typeof func.parameters !== 'object') {
      errors.push(`Tool ${i}: "parameters" must be an object`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that endpoint mappings cover all functions in the schema
 */
export function validateEndpointMappings(
  schema: OpenAI.Chat.ChatCompletionFunctionTool[],
  mappings: Record<string, EndpointMapping>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const functionNames = schema.map(t => t.function.name);

  for (const name of functionNames) {
    if (!mappings[name]) {
      errors.push(`Missing endpoint mapping for function: ${name}`);
    }
  }

  for (const [name, mapping] of Object.entries(mappings)) {
    if (!functionNames.includes(name)) {
      errors.push(`Endpoint mapping for unknown function: ${name}`);
    }

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(mapping.method)) {
      errors.push(`Invalid method for ${name}: ${mapping.method}`);
    }

    if (!mapping.path || !mapping.path.startsWith('/')) {
      errors.push(`Invalid path for ${name}: ${mapping.path}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
