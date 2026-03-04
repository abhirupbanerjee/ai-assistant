/**
 * Data Sources Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { safeEncrypt, safeDecrypt } from '../../encryption';

// Re-export types from types module
export type {
  DataAPIConfig,
  DataCSVConfig,
  DataSource,
  AuthConfig,
  DataSourceAuditEntry,
  DbDataAPIConfig,
  DbDataCSVConfig,
  DbDataAPICategory,
  DbDataCSVCategory,
  DbDataSourceAudit,
} from '../../../types/data-sources';

import type {
  DataAPIConfig,
  DataCSVConfig,
  DataSource,
  AuthConfig,
  DataSourceAuditEntry,
} from '../../../types/data-sources';

// ============ Helper Functions ============

interface DbAPIRow {
  id: string;
  name: string;
  description: string | null;
  endpoint: string;
  method: string;
  response_format: string;
  authentication: string | null;
  headers: string | null;
  parameters: string | null;
  response_structure: string | null;
  sample_response: string | null;
  openapi_spec: string | null;
  config_method: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_tested: string | null;
  last_error: string | null;
}

interface DbCSVRow {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  original_filename: string | null;
  columns: string | null;
  sample_data: string | null;
  row_count: number;
  file_size: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface DbAuditRow {
  id: number;
  source_type: string;
  source_id: string;
  action: string;
  changed_by: string;
  details: string | null;
  changed_at: string;
}

function mapDbToAPIConfig(row: DbAPIRow, categoryIds: number[]): DataAPIConfig {
  // Parse authentication and decrypt credentials
  let authentication: AuthConfig = { type: 'none' };
  if (row.authentication) {
    try {
      const parsed = JSON.parse(row.authentication);
      authentication = {
        type: parsed.type || 'none',
        credentials: parsed.credentials ? {
          token: parsed.credentials.token ? safeDecrypt(parsed.credentials.token) || undefined : undefined,
          apiKey: parsed.credentials.apiKey ? safeDecrypt(parsed.credentials.apiKey) || undefined : undefined,
          apiKeyHeader: parsed.credentials.apiKeyHeader,
          apiKeyLocation: parsed.credentials.apiKeyLocation,
          username: parsed.credentials.username,
          password: parsed.credentials.password ? safeDecrypt(parsed.credentials.password) || undefined : undefined,
        } : undefined,
      };
    } catch {
      // Keep default if parsing fails
    }
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    endpoint: row.endpoint,
    method: row.method as 'GET' | 'POST',
    responseFormat: row.response_format as 'json' | 'csv',
    authentication,
    headers: row.headers ? JSON.parse(row.headers) : undefined,
    parameters: row.parameters ? JSON.parse(row.parameters) : [],
    responseStructure: row.response_structure ? JSON.parse(row.response_structure) : { jsonPath: '$', dataIsArray: true, fields: [] },
    sampleResponse: row.sample_response ? JSON.parse(row.sample_response) : undefined,
    openApiSpec: row.openapi_spec ? JSON.parse(row.openapi_spec) : undefined,
    configMethod: row.config_method as 'manual' | 'openapi',
    categoryIds,
    status: row.status as 'active' | 'inactive' | 'error' | 'untested',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTested: row.last_tested || undefined,
    lastError: row.last_error || undefined,
  };
}

function mapDbToCSVConfig(row: DbCSVRow, categoryIds: number[]): DataCSVConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    filePath: row.file_path,
    originalFilename: row.original_filename || '',
    columns: row.columns ? JSON.parse(row.columns) : [],
    sampleData: row.sample_data ? JSON.parse(row.sample_data) : [],
    rowCount: row.row_count,
    fileSize: row.file_size,
    categoryIds,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDbToAuditEntry(row: DbAuditRow): DataSourceAuditEntry {
  return {
    id: row.id,
    sourceType: row.source_type as 'api' | 'csv',
    sourceId: row.source_id,
    action: row.action as 'created' | 'updated' | 'tested' | 'deleted',
    changedBy: row.changed_by,
    details: row.details ? JSON.parse(row.details) : undefined,
    changedAt: row.changed_at,
  };
}

// ============ Category Helpers ============

async function getAPICategoryIds(apiId: string): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('data_api_categories')
    .select('category_id')
    .where('api_id', '=', apiId)
    .execute();
  return rows.map(r => r.category_id);
}

async function getCSVCategoryIds(csvId: string): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('data_csv_categories')
    .select('category_id')
    .where('csv_id', '=', csvId)
    .execute();
  return rows.map(r => r.category_id);
}

// ============ API Operations ============

/**
 * Create a new API configuration
 */
export async function createDataAPI(
  config: Omit<DataAPIConfig, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'lastTested' | 'lastError' | 'status'>,
  createdBy: string
): Promise<DataAPIConfig> {
  const id = uuidv4();

  // Encrypt credentials before storage
  const authForStorage = config.authentication ? {
    type: config.authentication.type,
    credentials: config.authentication.credentials ? {
      token: config.authentication.credentials.token ? safeEncrypt(config.authentication.credentials.token) : undefined,
      apiKey: config.authentication.credentials.apiKey ? safeEncrypt(config.authentication.credentials.apiKey) : undefined,
      apiKeyHeader: config.authentication.credentials.apiKeyHeader,
      apiKeyLocation: config.authentication.credentials.apiKeyLocation,
      username: config.authentication.credentials.username,
      password: config.authentication.credentials.password ? safeEncrypt(config.authentication.credentials.password) : undefined,
    } : undefined,
  } : { type: 'none' };

  return transaction(async (trx) => {
    await trx
      .insertInto('data_api_configs')
      .values({
        id,
        name: config.name,
        description: config.description || null,
        endpoint: config.endpoint,
        method: config.method,
        response_format: config.responseFormat,
        authentication: JSON.stringify(authForStorage),
        headers: config.headers ? JSON.stringify(config.headers) : null,
        parameters: JSON.stringify(config.parameters || []),
        response_structure: JSON.stringify(config.responseStructure),
        sample_response: config.sampleResponse ? JSON.stringify(config.sampleResponse) : null,
        openapi_spec: config.openApiSpec ? JSON.stringify(config.openApiSpec) : null,
        config_method: config.configMethod,
        status: 'untested',
        created_by: createdBy,
      })
      .execute();

    // Set categories
    if (config.categoryIds && config.categoryIds.length > 0) {
      for (const categoryId of config.categoryIds) {
        await trx
          .insertInto('data_api_categories')
          .values({ api_id: id, category_id: categoryId })
          .execute();
      }
    }

    // Log audit
    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'api',
        source_id: id,
        action: 'created',
        changed_by: createdBy,
        details: JSON.stringify({ name: config.name }),
      })
      .execute();

    return (await getDataAPI(id))!;
  });
}

/**
 * Get a single API configuration by ID
 */
export async function getDataAPI(id: string): Promise<DataAPIConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('data_api_configs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!row) return undefined;
  const categoryIds = await getAPICategoryIds(id);
  return mapDbToAPIConfig(row as unknown as DbAPIRow, categoryIds);
}

/**
 * Get a single API configuration by name
 */
export async function getDataAPIByName(name: string): Promise<DataAPIConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('data_api_configs')
    .selectAll()
    .where('name', '=', name)
    .executeTakeFirst();

  if (!row) return undefined;
  const categoryIds = await getAPICategoryIds(row.id);
  return mapDbToAPIConfig(row as unknown as DbAPIRow, categoryIds);
}

/**
 * Get all API configurations
 */
export async function getAllDataAPIs(): Promise<DataAPIConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('data_api_configs')
    .selectAll()
    .orderBy('name')
    .execute();

  const results: DataAPIConfig[] = [];
  for (const row of rows) {
    const categoryIds = await getAPICategoryIds(row.id);
    results.push(mapDbToAPIConfig(row as unknown as DbAPIRow, categoryIds));
  }
  return results;
}

/**
 * Get APIs accessible to specific categories
 */
export async function getDataAPIsForCategories(categoryIds: number[]): Promise<DataAPIConfig[]> {
  if (categoryIds.length === 0) return [];

  const db = await getDb();
  const rows = await db
    .selectFrom('data_api_configs as a')
    .innerJoin('data_api_categories as ac', 'a.id', 'ac.api_id')
    .selectAll('a')
    .where('ac.category_id', 'in', categoryIds)
    .where('a.status', '=', 'active')
    .groupBy('a.id')
    .orderBy('a.name')
    .execute();

  const results: DataAPIConfig[] = [];
  for (const row of rows) {
    const apiCategoryIds = await getAPICategoryIds(row.id);
    results.push(mapDbToAPIConfig(row as unknown as DbAPIRow, apiCategoryIds));
  }
  return results;
}

/**
 * Update an API configuration
 */
export async function updateDataAPI(
  id: string,
  updates: Partial<Omit<DataAPIConfig, 'id' | 'createdAt' | 'createdBy'>>,
  updatedBy: string
): Promise<DataAPIConfig | undefined> {
  const existing = await getDataAPI(id);
  if (!existing) return undefined;

  return transaction(async (trx) => {
    const setValues: Record<string, unknown> = {};

    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.description !== undefined) setValues.description = updates.description || null;
    if (updates.endpoint !== undefined) setValues.endpoint = updates.endpoint;
    if (updates.method !== undefined) setValues.method = updates.method;
    if (updates.responseFormat !== undefined) setValues.response_format = updates.responseFormat;
    if (updates.authentication !== undefined) {
      const authForStorage = {
        type: updates.authentication.type,
        credentials: updates.authentication.credentials ? {
          token: updates.authentication.credentials.token ? safeEncrypt(updates.authentication.credentials.token) : undefined,
          apiKey: updates.authentication.credentials.apiKey ? safeEncrypt(updates.authentication.credentials.apiKey) : undefined,
          apiKeyHeader: updates.authentication.credentials.apiKeyHeader,
          apiKeyLocation: updates.authentication.credentials.apiKeyLocation,
          username: updates.authentication.credentials.username,
          password: updates.authentication.credentials.password ? safeEncrypt(updates.authentication.credentials.password) : undefined,
        } : undefined,
      };
      setValues.authentication = JSON.stringify(authForStorage);
    }
    if (updates.headers !== undefined) setValues.headers = updates.headers ? JSON.stringify(updates.headers) : null;
    if (updates.parameters !== undefined) setValues.parameters = JSON.stringify(updates.parameters);
    if (updates.responseStructure !== undefined) setValues.response_structure = JSON.stringify(updates.responseStructure);
    if (updates.sampleResponse !== undefined) setValues.sample_response = updates.sampleResponse ? JSON.stringify(updates.sampleResponse) : null;
    if (updates.status !== undefined) setValues.status = updates.status;
    if (updates.lastTested !== undefined) setValues.last_tested = updates.lastTested;
    if (updates.lastError !== undefined) setValues.last_error = updates.lastError || null;

    if (Object.keys(setValues).length > 0) {
      await trx
        .updateTable('data_api_configs')
        .set(setValues)
        .where('id', '=', id)
        .execute();
    }

    // Update categories if provided
    if (updates.categoryIds !== undefined) {
      await trx
        .deleteFrom('data_api_categories')
        .where('api_id', '=', id)
        .execute();
      for (const categoryId of updates.categoryIds) {
        await trx
          .insertInto('data_api_categories')
          .values({ api_id: id, category_id: categoryId })
          .execute();
      }
    }

    // Log audit
    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'api',
        source_id: id,
        action: 'updated',
        changed_by: updatedBy,
        details: JSON.stringify({ fields: Object.keys(updates) }),
      })
      .execute();

    return (await getDataAPI(id))!;
  });
}

/**
 * Update API status after test
 */
export async function updateAPIStatus(
  id: string,
  status: 'active' | 'inactive' | 'error' | 'untested',
  updatedBy: string,
  error?: string
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('data_api_configs')
    .set({
      status,
      last_tested: new Date().toISOString(),
      last_error: error || null,
    })
    .where('id', '=', id)
    .execute();

  await db
    .insertInto('data_source_audit')
    .values({
      source_type: 'api',
      source_id: id,
      action: 'tested',
      changed_by: updatedBy,
      details: JSON.stringify({ status, error }),
    })
    .execute();
}

/**
 * Delete an API configuration
 */
export async function deleteDataAPI(id: string, deletedBy: string): Promise<boolean> {
  const existing = await getDataAPI(id);
  if (!existing) return false;

  return transaction(async (trx) => {
    // Log audit first
    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'api',
        source_id: id,
        action: 'deleted',
        changed_by: deletedBy,
        details: JSON.stringify({ name: existing.name }),
      })
      .execute();

    // Delete (cascades to data_api_categories)
    await trx
      .deleteFrom('data_api_configs')
      .where('id', '=', id)
      .execute();
    return true;
  });
}

/**
 * Set categories for an API
 */
export async function setAPICategories(apiId: string, categoryIds: number[], updatedBy: string): Promise<void> {
  return transaction(async (trx) => {
    await trx
      .deleteFrom('data_api_categories')
      .where('api_id', '=', apiId)
      .execute();

    for (const categoryId of categoryIds) {
      await trx
        .insertInto('data_api_categories')
        .values({ api_id: apiId, category_id: categoryId })
        .execute();
    }

    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'api',
        source_id: apiId,
        action: 'updated',
        changed_by: updatedBy,
        details: JSON.stringify({ categoryIds }),
      })
      .execute();
  });
}

// ============ CSV Operations ============

/**
 * Create a new CSV configuration
 */
export async function createDataCSV(
  config: Omit<DataCSVConfig, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>,
  createdBy: string
): Promise<DataCSVConfig> {
  const id = uuidv4();

  return transaction(async (trx) => {
    await trx
      .insertInto('data_csv_configs')
      .values({
        id,
        name: config.name,
        description: config.description || null,
        file_path: config.filePath,
        original_filename: config.originalFilename || null,
        columns: JSON.stringify(config.columns || []),
        sample_data: JSON.stringify(config.sampleData || []),
        row_count: config.rowCount,
        file_size: config.fileSize,
        created_by: createdBy,
      })
      .execute();

    // Set categories
    if (config.categoryIds && config.categoryIds.length > 0) {
      for (const categoryId of config.categoryIds) {
        await trx
          .insertInto('data_csv_categories')
          .values({ csv_id: id, category_id: categoryId })
          .execute();
      }
    }

    // Log audit
    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'csv',
        source_id: id,
        action: 'created',
        changed_by: createdBy,
        details: JSON.stringify({ name: config.name }),
      })
      .execute();

    return (await getDataCSV(id))!;
  });
}

/**
 * Get a single CSV configuration by ID
 */
export async function getDataCSV(id: string): Promise<DataCSVConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('data_csv_configs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!row) return undefined;
  const categoryIds = await getCSVCategoryIds(id);
  return mapDbToCSVConfig(row as unknown as DbCSVRow, categoryIds);
}

/**
 * Get a single CSV configuration by name
 */
export async function getDataCSVByName(name: string): Promise<DataCSVConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('data_csv_configs')
    .selectAll()
    .where('name', '=', name)
    .executeTakeFirst();

  if (!row) return undefined;
  const categoryIds = await getCSVCategoryIds(row.id);
  return mapDbToCSVConfig(row as unknown as DbCSVRow, categoryIds);
}

/**
 * Get all CSV configurations
 */
export async function getAllDataCSVs(): Promise<DataCSVConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('data_csv_configs')
    .selectAll()
    .orderBy('name')
    .execute();

  const results: DataCSVConfig[] = [];
  for (const row of rows) {
    const categoryIds = await getCSVCategoryIds(row.id);
    results.push(mapDbToCSVConfig(row as unknown as DbCSVRow, categoryIds));
  }
  return results;
}

/**
 * Get CSVs accessible to specific categories
 */
export async function getDataCSVsForCategories(categoryIds: number[]): Promise<DataCSVConfig[]> {
  if (categoryIds.length === 0) return [];

  const db = await getDb();
  const rows = await db
    .selectFrom('data_csv_configs as c')
    .innerJoin('data_csv_categories as cc', 'c.id', 'cc.csv_id')
    .selectAll('c')
    .where('cc.category_id', 'in', categoryIds)
    .groupBy('c.id')
    .orderBy('c.name')
    .execute();

  const results: DataCSVConfig[] = [];
  for (const row of rows) {
    const csvCategoryIds = await getCSVCategoryIds(row.id);
    results.push(mapDbToCSVConfig(row as unknown as DbCSVRow, csvCategoryIds));
  }
  return results;
}

/**
 * Update a CSV configuration
 */
export async function updateDataCSV(
  id: string,
  updates: Partial<Omit<DataCSVConfig, 'id' | 'createdAt' | 'createdBy'>>,
  updatedBy: string
): Promise<DataCSVConfig | undefined> {
  const existing = await getDataCSV(id);
  if (!existing) return undefined;

  return transaction(async (trx) => {
    const setValues: Record<string, unknown> = {};

    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.description !== undefined) setValues.description = updates.description || null;
    if (updates.columns !== undefined) setValues.columns = JSON.stringify(updates.columns);
    if (updates.sampleData !== undefined) setValues.sample_data = JSON.stringify(updates.sampleData);
    if (updates.rowCount !== undefined) setValues.row_count = updates.rowCount;

    if (Object.keys(setValues).length > 0) {
      await trx
        .updateTable('data_csv_configs')
        .set(setValues)
        .where('id', '=', id)
        .execute();
    }

    // Update categories if provided
    if (updates.categoryIds !== undefined) {
      await trx
        .deleteFrom('data_csv_categories')
        .where('csv_id', '=', id)
        .execute();
      for (const categoryId of updates.categoryIds) {
        await trx
          .insertInto('data_csv_categories')
          .values({ csv_id: id, category_id: categoryId })
          .execute();
      }
    }

    // Log audit
    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'csv',
        source_id: id,
        action: 'updated',
        changed_by: updatedBy,
        details: JSON.stringify({ fields: Object.keys(updates) }),
      })
      .execute();

    return (await getDataCSV(id))!;
  });
}

/**
 * Delete a CSV configuration
 */
export async function deleteDataCSV(id: string, deletedBy: string): Promise<boolean> {
  const existing = await getDataCSV(id);
  if (!existing) return false;

  return transaction(async (trx) => {
    // Log audit first
    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'csv',
        source_id: id,
        action: 'deleted',
        changed_by: deletedBy,
        details: JSON.stringify({ name: existing.name }),
      })
      .execute();

    // Delete (cascades to data_csv_categories)
    await trx
      .deleteFrom('data_csv_configs')
      .where('id', '=', id)
      .execute();
    return true;
  });
}

/**
 * Set categories for a CSV
 */
export async function setCSVCategories(csvId: string, categoryIds: number[], updatedBy: string): Promise<void> {
  return transaction(async (trx) => {
    await trx
      .deleteFrom('data_csv_categories')
      .where('csv_id', '=', csvId)
      .execute();

    for (const categoryId of categoryIds) {
      await trx
        .insertInto('data_csv_categories')
        .values({ csv_id: csvId, category_id: categoryId })
        .execute();
    }

    await trx
      .insertInto('data_source_audit')
      .values({
        source_type: 'csv',
        source_id: csvId,
        action: 'updated',
        changed_by: updatedBy,
        details: JSON.stringify({ categoryIds }),
      })
      .execute();
  });
}

// ============ Unified Operations ============

/**
 * Get all data sources for specific categories
 */
export async function getAllDataSourcesForCategories(categoryIds: number[]): Promise<DataSource[]> {
  const apis = await getDataAPIsForCategories(categoryIds);
  const csvs = await getDataCSVsForCategories(categoryIds);

  const sources: DataSource[] = [
    ...apis.map(config => ({ type: 'api' as const, config })),
    ...csvs.map(config => ({ type: 'csv' as const, config })),
  ];

  return sources.sort((a, b) => a.config.name.localeCompare(b.config.name));
}

/**
 * Get a data source by name
 */
export async function getDataSourceByName(name: string): Promise<DataSource | undefined> {
  const api = await getDataAPIByName(name);
  if (api) return { type: 'api', config: api };

  const csv = await getDataCSVByName(name);
  if (csv) return { type: 'csv', config: csv };

  return undefined;
}

/**
 * Get all data sources (for admin)
 */
export async function getAllDataSources(): Promise<DataSource[]> {
  const apis = await getAllDataAPIs();
  const csvs = await getAllDataCSVs();

  const sources: DataSource[] = [
    ...apis.map(config => ({ type: 'api' as const, config })),
    ...csvs.map(config => ({ type: 'csv' as const, config })),
  ];

  return sources.sort((a, b) => a.config.name.localeCompare(b.config.name));
}

// ============ Audit Operations ============

/**
 * Log a data source change
 */
export async function logDataSourceChange(
  sourceType: 'api' | 'csv',
  sourceId: string,
  action: 'created' | 'updated' | 'tested' | 'deleted',
  changedBy: string,
  details?: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  await db
    .insertInto('data_source_audit')
    .values({
      source_type: sourceType,
      source_id: sourceId,
      action,
      changed_by: changedBy,
      details: details ? JSON.stringify(details) : null,
    })
    .execute();
}

/**
 * Get audit history for a data source
 */
export async function getDataSourceAuditHistory(
  sourceType: 'api' | 'csv',
  sourceId: string,
  limit: number = 50
): Promise<DataSourceAuditEntry[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('data_source_audit')
    .selectAll()
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .orderBy('changed_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => mapDbToAuditEntry(row as unknown as DbAuditRow));
}

/**
 * Get all audit history (for admin)
 */
export async function getAllDataSourceAuditHistory(limit: number = 100): Promise<DataSourceAuditEntry[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('data_source_audit')
    .selectAll()
    .orderBy('changed_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => mapDbToAuditEntry(row as unknown as DbAuditRow));
}
