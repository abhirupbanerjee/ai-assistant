/**
 * Enabled Models Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 *
 * Phase 0 — Catalog-Driven Model Discovery:
 * When MODEL_CATALOG_READS is "on" (default), read queries are retargeted to
 * model_catalog + organization_deployment. When "off", the legacy
 * enabled_models path is used. The write-through mirror (§7.3 item 5) keeps
 * both paths byte-current so the flag can be toggled at any time.
 */

import { getDb, sql, transaction } from '../kysely';
import { getProvider } from './llm-providers';

// Re-export types from sync module
export type {
  EnabledModel,
  CreateEnabledModelInput,
  UpdateEnabledModelInput,
  CapabilityScores,
} from '../enabled-models';

import type {
  EnabledModel,
  CreateEnabledModelInput,
  UpdateEnabledModelInput,
  CapabilityScores,
} from '../enabled-models';

// ============ Model Catalog Read Flag (Phase 0) ============

/**
 * Returns true when MODEL_CATALOG_READS is "on" (default) or unset.
 * Set MODEL_CATALOG_READS=off to restore the legacy enabled_models read path.
 */
function isModelCatalogReads(): boolean {
  const flag = process.env.MODEL_CATALOG_READS;
  return flag !== 'off';
}

// ============ Legacy Row Mapper (enabled_models) ============

interface EnabledModelRow {
  id: string;
  provider_id: string;
  display_name: string;
  tool_capable: number;
  vision_capable: number;
  parallel_tool_capable: number;
  thinking_capable: number;
  forced_tool_capable: number;
  capability_tier: string;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  is_default: number;
  enabled: number;
  provider_enabled?: number;
  sort_order: number;
  capability_scores: unknown | null;
  created_at: string;
  updated_at: string;
}

function mapRowToModel(row: EnabledModelRow): EnabledModel {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    toolCapable: row.tool_capable === 1,
    visionCapable: row.vision_capable === 1,
    parallelToolCapable: row.parallel_tool_capable === 1,
    thinkingCapable: row.thinking_capable === 1,
    forcedToolCapable: row.forced_tool_capable === 1,
    capabilityTier: (row.capability_tier as 'swarm_full' | 'swarm_limited' | 'unclassified') || 'unclassified',
    maxInputTokens: row.max_input_tokens,
    maxOutputTokens: row.max_output_tokens,
    inputCostPer1M: row.input_cost_per_1m == null ? row.input_cost_per_1m : Number(row.input_cost_per_1m),
    outputCostPer1M: row.output_cost_per_1m == null ? row.output_cost_per_1m : Number(row.output_cost_per_1m),
    isDefault: row.is_default === 1,
    enabled: row.enabled === 1,
    providerEnabled: row.provider_enabled !== undefined ? row.provider_enabled === 1 : undefined,
    sortOrder: row.sort_order,
    capabilityScores: row.capability_scores as CapabilityScores | null ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ Catalog Row Mapper (model_catalog + organization_deployment) ============

/**
 * Row shape from joining model_catalog (mc) + organization_deployment (od) + providers (p).
 * All LLM catalog rows have capability_id = 'llm' (plan §7.3 item 2).
 */
interface CatalogJoinRow {
  // model_catalog fields
  mc_id: string;
  mc_provider_id: string;
  mc_capabilities: unknown;
  mc_max_input_tokens: number | null;
  mc_max_output_tokens: number | null;
  mc_input_cost_per_1m: number | null;
  mc_output_cost_per_1m: number | null;
  mc_capability_tier: string;
  mc_capability_scores: unknown | null;
  mc_status: string;
  mc_created_at: string;
  mc_updated_at: string;
  // organization_deployment fields
  od_enabled: boolean | null;
  od_is_default_for_capability: boolean | null;
  od_sort_order: number | null;
  // providers
  p_enabled: boolean | null;
}

/**
 * Map a catalog join row to the same EnabledModel interface.
 * The capabilities JSONB stores { tool_capable, vision_capable, ... } as booleans.
 * Preserves the `?? true` default for forcedToolCapable (plan risk assessment item 1).
 */
function mapCatalogRowToModel(row: CatalogJoinRow): EnabledModel {
  const caps = (row.mc_capabilities ?? {}) as Record<string, boolean>;
  return {
    id: row.mc_id,
    providerId: row.mc_provider_id,
    displayName: row.mc_id, // catalog has no display_name column; use id (legacy display_name is derived from model name)
    toolCapable: caps.tool_capable ?? false,
    visionCapable: caps.vision_capable ?? false,
    parallelToolCapable: caps.parallel_tool_capable ?? false,
    thinkingCapable: caps.thinking_capable ?? false,
    forcedToolCapable: caps.forced_tool_capable ?? true, // preserve legacy default (line 454 original)
    capabilityTier: (row.mc_capability_tier as 'swarm_full' | 'swarm_limited' | 'unclassified') || 'unclassified',
    maxInputTokens: row.mc_max_input_tokens,
    maxOutputTokens: row.mc_max_output_tokens,
    inputCostPer1M: row.mc_input_cost_per_1m == null ? row.mc_input_cost_per_1m : Number(row.mc_input_cost_per_1m),
    outputCostPer1M: row.mc_output_cost_per_1m == null ? row.mc_output_cost_per_1m : Number(row.mc_output_cost_per_1m),
    isDefault: row.od_is_default_for_capability === true,
    enabled: row.od_enabled === true,
    providerEnabled: row.p_enabled !== null && row.p_enabled !== undefined ? row.p_enabled : undefined,
    sortOrder: row.od_sort_order ?? 9900,
    capabilityScores: row.mc_capability_scores as CapabilityScores | null ?? null,
    createdAt: row.mc_created_at,
    updatedAt: row.mc_updated_at,
  };
}

// ============ CRUD Operations ============

/**
 * Get all enabled models (including disabled ones).
 * Flag-on: reads from model_catalog + organization_deployment (capability_id='llm').
 * Flag-off: reads from enabled_models (legacy).
 */
export async function getAllEnabledModels(): Promise<EnabledModel[]> {
  const db = await getDb();

  if (isModelCatalogReads()) {
    const rows = await sql`
      SELECT
        mc.id           AS mc_id,
        mc.provider_id  AS mc_provider_id,
        mc.capabilities AS mc_capabilities,
        mc.max_input_tokens  AS mc_max_input_tokens,
        mc.max_output_tokens AS mc_max_output_tokens,
        mc.input_cost_per_1m  AS mc_input_cost_per_1m,
        mc.output_cost_per_1m AS mc_output_cost_per_1m,
        mc.capability_tier    AS mc_capability_tier,
        mc.capability_scores  AS mc_capability_scores,
        mc.status        AS mc_status,
        mc.created_at    AS mc_created_at,
        mc.updated_at    AS mc_updated_at,
        od.enabled       AS od_enabled,
        od.is_default_for_capability AS od_is_default_for_capability,
        od.sort_order    AS od_sort_order,
        p.enabled        AS p_enabled
      FROM model_catalog mc
      LEFT JOIN organization_deployment od
        ON od.catalog_id = mc.id AND od.org_id IS NULL
      LEFT JOIN providers p ON p.id = mc.provider_id
      WHERE mc.capability_id = 'llm'
      ORDER BY COALESCE(od.sort_order, 9900), mc.id
    `.execute(db);
    return rows.rows.map((row: unknown) => mapCatalogRowToModel(row as unknown as CatalogJoinRow));
  }

  // Legacy path (flag-off)
  const rows = await db
    .selectFrom('enabled_models as m')
    .leftJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select([
      'm.id',
      'm.provider_id',
      'm.display_name',
      'm.tool_capable',
      'm.vision_capable',
      'm.parallel_tool_capable',
      'm.thinking_capable',
      'm.forced_tool_capable',
      'm.max_input_tokens',
      'm.max_output_tokens',
      'm.input_cost_per_1m',
      'm.output_cost_per_1m',
      'm.is_default',
      'm.enabled',
      'm.sort_order',
      'm.created_at',
      'm.updated_at',
      'p.enabled as provider_enabled',
    ])
    .orderBy('m.sort_order')
    .orderBy('m.display_name')
    .execute();

  return rows.map((row) => mapRowToModel(row as unknown as EnabledModelRow));
}

/**
 * Get only active (enabled=1) models from enabled providers.
 * Models are only active if BOTH the model AND its provider are enabled.
 * Flag-on: reads from model_catalog (status='active') + organization_deployment (enabled=true) + providers (enabled=true).
 * Flag-off: reads from enabled_models (legacy).
 */
export async function getActiveModels(): Promise<EnabledModel[]> {
  const db = await getDb();

  if (isModelCatalogReads()) {
    const rows = await sql`
      SELECT
        mc.id           AS mc_id,
        mc.provider_id  AS mc_provider_id,
        mc.capabilities AS mc_capabilities,
        mc.max_input_tokens  AS mc_max_input_tokens,
        mc.max_output_tokens AS mc_max_output_tokens,
        mc.input_cost_per_1m  AS mc_input_cost_per_1m,
        mc.output_cost_per_1m AS mc_output_cost_per_1m,
        mc.capability_tier    AS mc_capability_tier,
        mc.capability_scores  AS mc_capability_scores,
        mc.status        AS mc_status,
        mc.created_at    AS mc_created_at,
        mc.updated_at    AS mc_updated_at,
        od.enabled       AS od_enabled,
        od.is_default_for_capability AS od_is_default_for_capability,
        od.sort_order    AS od_sort_order,
        p.enabled        AS p_enabled
      FROM model_catalog mc
      INNER JOIN organization_deployment od
        ON od.catalog_id = mc.id AND od.org_id IS NULL AND od.enabled = TRUE
      INNER JOIN providers p ON p.id = mc.provider_id AND p.enabled = TRUE
      WHERE mc.capability_id = 'llm'
        AND mc.status = 'active'
      ORDER BY od.sort_order, mc.id
    `.execute(db);
    return rows.rows.map((row: unknown) => mapCatalogRowToModel(row as unknown as CatalogJoinRow));
  }

  // Legacy path (flag-off)
  const rows = await db
    .selectFrom('enabled_models as m')
    .innerJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select([
      'm.id',
      'm.provider_id',
      'm.display_name',
      'm.tool_capable',
      'm.vision_capable',
      'm.parallel_tool_capable',
      'm.thinking_capable',
      'm.forced_tool_capable',
      'm.max_input_tokens',
      'm.max_output_tokens',
      'm.input_cost_per_1m',
      'm.output_cost_per_1m',
      'm.is_default',
      'm.enabled',
      'm.sort_order',
      'm.created_at',
      'm.updated_at',
    ])
    .where('m.enabled', '=', 1)
    .where('p.enabled', '=', 1)
    .orderBy('m.sort_order')
    .orderBy('m.display_name')
    .execute();

  return rows.map((row) => mapRowToModel(row as unknown as EnabledModelRow));
}

/**
 * Get models by provider.
 * Flag-on: reads from model_catalog filtered by provider_id (capability_id='llm').
 * Flag-off: reads from enabled_models (legacy).
 */
export async function getModelsByProvider(providerId: string): Promise<EnabledModel[]> {
  const db = await getDb();

  if (isModelCatalogReads()) {
    const rows = await sql`
      SELECT
        mc.id           AS mc_id,
        mc.provider_id  AS mc_provider_id,
        mc.capabilities AS mc_capabilities,
        mc.max_input_tokens  AS mc_max_input_tokens,
        mc.max_output_tokens AS mc_max_output_tokens,
        mc.input_cost_per_1m  AS mc_input_cost_per_1m,
        mc.output_cost_per_1m AS mc_output_cost_per_1m,
        mc.capability_tier    AS mc_capability_tier,
        mc.capability_scores  AS mc_capability_scores,
        mc.status        AS mc_status,
        mc.created_at    AS mc_created_at,
        mc.updated_at    AS mc_updated_at,
        od.enabled       AS od_enabled,
        od.is_default_for_capability AS od_is_default_for_capability,
        od.sort_order    AS od_sort_order,
        p.enabled        AS p_enabled
      FROM model_catalog mc
      LEFT JOIN organization_deployment od
        ON od.catalog_id = mc.id AND od.org_id IS NULL
      LEFT JOIN providers p ON p.id = mc.provider_id
      WHERE mc.capability_id = 'llm' AND mc.provider_id = ${providerId}
      ORDER BY COALESCE(od.sort_order, 9900), mc.id
    `.execute(db);
    return rows.rows.map((row: unknown) => mapCatalogRowToModel(row as unknown as CatalogJoinRow));
  }

  // Legacy path (flag-off)
  const rows = await db
    .selectFrom('enabled_models')
    .selectAll()
    .where('provider_id', '=', providerId)
    .orderBy('sort_order')
    .orderBy('display_name')
    .execute();

  return rows.map((row) => mapRowToModel(row as unknown as EnabledModelRow));
}

/**
 * Get a single model by ID.
 * Flag-on: reads from model_catalog (any status — retired models still resolve for bound threads/agents).
 * Flag-off: reads from enabled_models (legacy).
 */
export async function getEnabledModel(id: string): Promise<EnabledModel | null> {
  const db = await getDb();

  if (isModelCatalogReads()) {
    const rows = await sql`
      SELECT
        mc.id           AS mc_id,
        mc.provider_id  AS mc_provider_id,
        mc.capabilities AS mc_capabilities,
        mc.max_input_tokens  AS mc_max_input_tokens,
        mc.max_output_tokens AS mc_max_output_tokens,
        mc.input_cost_per_1m  AS mc_input_cost_per_1m,
        mc.output_cost_per_1m AS mc_output_cost_per_1m,
        mc.capability_tier    AS mc_capability_tier,
        mc.capability_scores  AS mc_capability_scores,
        mc.status        AS mc_status,
        mc.created_at    AS mc_created_at,
        mc.updated_at    AS mc_updated_at,
        od.enabled       AS od_enabled,
        od.is_default_for_capability AS od_is_default_for_capability,
        od.sort_order    AS od_sort_order,
        p.enabled        AS p_enabled
      FROM model_catalog mc
      LEFT JOIN organization_deployment od
        ON od.catalog_id = mc.id AND od.org_id IS NULL
      LEFT JOIN providers p ON p.id = mc.provider_id
      WHERE mc.capability_id = 'llm' AND mc.id = ${id}
      LIMIT 1
    `.execute(db);
    if (rows.rows.length === 0) return null;
    return mapCatalogRowToModel(rows.rows[0] as unknown as CatalogJoinRow);
  }

  // Legacy path (flag-off)
  const row = await db
    .selectFrom('enabled_models')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapRowToModel(row as unknown as EnabledModelRow) : null;
}

/**
 * Get the default model (must be from an enabled provider).
 * Flag-on: reads the single global default from organization_deployment (is_default_for_capability=true, org_id=NULL)
 *   joined with model_catalog (status='active') + providers (enabled=true).
 *   The partial unique index idx_org_deployment_global_default enforces exactly one global default for 'llm'.
 * Flag-off: reads from enabled_models where is_default=1 and enabled=1 (legacy).
 */
export async function getDefaultModel(): Promise<EnabledModel | null> {
  const db = await getDb();

  if (isModelCatalogReads()) {
    const rows = await sql`
      SELECT
        mc.id           AS mc_id,
        mc.provider_id  AS mc_provider_id,
        mc.capabilities AS mc_capabilities,
        mc.max_input_tokens  AS mc_max_input_tokens,
        mc.max_output_tokens AS mc_max_output_tokens,
        mc.input_cost_per_1m  AS mc_input_cost_per_1m,
        mc.output_cost_per_1m AS mc_output_cost_per_1m,
        mc.capability_tier    AS mc_capability_tier,
        mc.capability_scores  AS mc_capability_scores,
        mc.status        AS mc_status,
        mc.created_at    AS mc_created_at,
        mc.updated_at    AS mc_updated_at,
        od.enabled       AS od_enabled,
        od.is_default_for_capability AS od_is_default_for_capability,
        od.sort_order    AS od_sort_order,
        p.enabled        AS p_enabled
      FROM model_catalog mc
      INNER JOIN organization_deployment od
        ON od.catalog_id = mc.id AND od.org_id IS NULL
        AND od.is_default_for_capability = TRUE AND od.enabled = TRUE
        AND od.capability_id = 'llm'
      INNER JOIN providers p ON p.id = mc.provider_id AND p.enabled = TRUE
      WHERE mc.capability_id = 'llm' AND mc.status = 'active'
      LIMIT 1
    `.execute(db);
    if (rows.rows.length === 0) return null;
    return mapCatalogRowToModel(rows.rows[0] as unknown as CatalogJoinRow);
  }

  // Legacy path (flag-off)
  const row = await db
    .selectFrom('enabled_models as m')
    .innerJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select([
      'm.id',
      'm.provider_id',
      'm.display_name',
      'm.tool_capable',
      'm.vision_capable',
      'm.parallel_tool_capable',
      'm.thinking_capable',
      'm.forced_tool_capable',
      'm.max_input_tokens',
      'm.max_output_tokens',
      'm.input_cost_per_1m',
      'm.output_cost_per_1m',
      'm.is_default',
      'm.enabled',
      'm.sort_order',
      'm.created_at',
      'm.updated_at',
    ])
    .where('m.is_default', '=', 1)
    .where('m.enabled', '=', 1)
    .where('p.enabled', '=', 1)
    .executeTakeFirst();

  return row ? mapRowToModel(row as unknown as EnabledModelRow) : null;
}

// ============ Write-Through Mirror Helpers (Phase 0) ============

/**
 * Build the capabilities JSONB object from boolean fields.
 * Stored as { tool_capable, vision_capable, parallel_tool_capable, thinking_capable, forced_tool_capable }.
 */
function buildCapabilitiesJson(input: {
  toolCapable?: boolean;
  visionCapable?: boolean;
  parallelToolCapable?: boolean;
  thinkingCapable?: boolean;
  forcedToolCapable?: boolean;
}): Record<string, boolean> {
  return {
    tool_capable: input.toolCapable ?? false,
    vision_capable: input.visionCapable ?? false,
    parallel_tool_capable: input.parallelToolCapable ?? false,
    thinking_capable: input.thinkingCapable ?? false,
    forced_tool_capable: input.forcedToolCapable !== false, // preserve default-true
  };
}

/**
 * Create a new enabled model.
 * Write-through mirror: transactionally inserts into both enabled_models (legacy)
 * AND model_catalog + organization_deployment (catalog path).
 */
export async function createEnabledModel(input: CreateEnabledModelInput): Promise<EnabledModel> {
  // Validate provider exists
  const provider = await getProvider(input.providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${input.providerId}`);
  }

  const db = await getDb();

  // Get max sort order
  const maxOrder = await db
    .selectFrom('enabled_models')
    .select(db.fn.max<number>('sort_order').as('max_order'))
    .executeTakeFirst();
  const sortOrder = input.sortOrder ?? ((maxOrder?.max_order ?? 0) + 1);
  const isDefault = input.isDefault ?? false;
  const enabled = input.enabled !== false;
  const caps = buildCapabilitiesJson(input);

  await transaction(async (trx) => {
    // 1. Legacy write (always — keeps flag-off path working)
    await trx
      .insertInto('enabled_models')
      .values({
        id: input.id,
        provider_id: input.providerId,
        display_name: input.displayName,
        tool_capable: caps.tool_capable ? 1 : 0,
        vision_capable: caps.vision_capable ? 1 : 0,
        parallel_tool_capable: caps.parallel_tool_capable ? 1 : 0,
        thinking_capable: caps.thinking_capable ? 1 : 0,
        forced_tool_capable: caps.forced_tool_capable ? 1 : 0,
        capability_tier: input.capabilityTier || 'unclassified',
        max_input_tokens: input.maxInputTokens || null,
        max_output_tokens: input.maxOutputTokens || null,
        input_cost_per_1m: input.inputCostPer1M ?? null,
        output_cost_per_1m: input.outputCostPer1M ?? null,
        is_default: isDefault ? 1 : 0,
        enabled: enabled ? 1 : 0,
        sort_order: sortOrder,
      })
      .execute();

    // 2. Catalog write-through mirror (model_catalog upsert)
    await sql`
      INSERT INTO model_catalog (id, provider_id, capability_id, capabilities, max_input_tokens, max_output_tokens, input_cost_per_1m, output_cost_per_1m, capability_tier, capability_scores, status, created_at, updated_at)
      VALUES (
        ${input.id},
        ${input.providerId},
        'llm',
        ${JSON.stringify(caps)}::jsonb,
        ${input.maxInputTokens || null},
        ${input.maxOutputTokens || null},
        ${input.inputCostPer1M ?? null},
        ${input.outputCostPer1M ?? null},
        ${input.capabilityTier || 'unclassified'},
        NULL::jsonb,
        'active',
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        capabilities = EXCLUDED.capabilities,
        max_input_tokens = EXCLUDED.max_input_tokens,
        max_output_tokens = EXCLUDED.max_output_tokens,
        input_cost_per_1m = EXCLUDED.input_cost_per_1m,
        output_cost_per_1m = EXCLUDED.output_cost_per_1m,
        capability_tier = EXCLUDED.capability_tier,
        capability_scores = EXCLUDED.capability_scores,
        updated_at = NOW()
    `.execute(trx);

    // 3. Organization deployment upsert (org_id=NULL = global)
    //    If this is the new default, clear other defaults first
    if (isDefault) {
      await sql`
        UPDATE organization_deployment
        SET is_default_for_capability = FALSE, updated_at = NOW()
        WHERE org_id IS NULL AND capability_id = 'llm' AND is_default_for_capability = TRUE
      `.execute(trx);
    }

    await sql`
      INSERT INTO organization_deployment (catalog_id, org_id, capability_id, enabled, is_default_for_capability, sort_order, created_at, updated_at)
      VALUES (
        ${input.id},
        NULL,
        'llm',
        ${enabled},
        ${isDefault},
        ${sortOrder},
        NOW(),
        NOW()
      )
      ON CONFLICT (catalog_id, org_id, capability_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        is_default_for_capability = EXCLUDED.is_default_for_capability,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `.execute(trx);
  });

  // Invalidate quality score cache so next auto-selection uses fresh data
  import('@/lib/model-quality').then(m => m.invalidateQualityCache()).catch(() => {});

  return (await getEnabledModel(input.id))!;
}

/**
 * Create multiple enabled models in a batch
 */
export async function createEnabledModelsBatch(inputs: CreateEnabledModelInput[]): Promise<EnabledModel[]> {
  const results: EnabledModel[] = [];

  for (const input of inputs) {
    // Skip if model already exists
    if (await getEnabledModel(input.id)) {
      continue;
    }
    results.push(await createEnabledModel(input));
  }

  return results;
}

/**
 * Update an existing model.
 * Write-through mirror: transactionally updates both enabled_models (legacy)
 * AND model_catalog + organization_deployment (catalog path).
 */
export async function updateEnabledModel(id: string, input: UpdateEnabledModelInput): Promise<EnabledModel | null> {
  const existing = await getEnabledModel(id);
  if (!existing) return null;

  const updateObj: Record<string, unknown> = {};

  if (input.displayName !== undefined) {
    updateObj.display_name = input.displayName;
  }
  if (input.toolCapable !== undefined) {
    updateObj.tool_capable = input.toolCapable ? 1 : 0;
  }
  if (input.visionCapable !== undefined) {
    updateObj.vision_capable = input.visionCapable ? 1 : 0;
  }
  if (input.parallelToolCapable !== undefined) {
    updateObj.parallel_tool_capable = input.parallelToolCapable ? 1 : 0;
  }
  if (input.thinkingCapable !== undefined) {
    updateObj.thinking_capable = input.thinkingCapable ? 1 : 0;
  }
  if (input.forcedToolCapable !== undefined) {
    updateObj.forced_tool_capable = input.forcedToolCapable ? 1 : 0;
  }
  if (input.capabilityTier !== undefined) {
    updateObj.capability_tier = input.capabilityTier;
  }
  if (input.maxInputTokens !== undefined) {
    updateObj.max_input_tokens = input.maxInputTokens || null;
  }
  if (input.maxOutputTokens !== undefined) {
    updateObj.max_output_tokens = input.maxOutputTokens || null;
  }
  if (input.inputCostPer1M !== undefined) {
    updateObj.input_cost_per_1m = input.inputCostPer1M ?? null;
  }
  if (input.outputCostPer1M !== undefined) {
    updateObj.output_cost_per_1m = input.outputCostPer1M ?? null;
  }
  if (input.isDefault !== undefined) {
    updateObj.is_default = input.isDefault ? 1 : 0;
  }
  if (input.enabled !== undefined) {
    updateObj.enabled = input.enabled ? 1 : 0;
  }
  if (input.sortOrder !== undefined) {
    updateObj.sort_order = input.sortOrder;
  }
  if (input.capabilityScores !== undefined) {
    updateObj.capability_scores = input.capabilityScores ? JSON.stringify(input.capabilityScores) : null;
  }

  if (Object.keys(updateObj).length === 0) return existing;

  // Build catalog mirror update fragments from the same input
  const catalogSetClauses: string[] = ['updated_at = NOW()'];
  const catalogParams: unknown[] = [];
  let paramIdx = 1;

  if (input.toolCapable !== undefined || input.visionCapable !== undefined ||
      input.parallelToolCapable !== undefined || input.thinkingCapable !== undefined ||
      input.forcedToolCapable !== undefined) {
    const mergedCaps = buildCapabilitiesJson({
      toolCapable: input.toolCapable ?? existing.toolCapable,
      visionCapable: input.visionCapable ?? existing.visionCapable,
      parallelToolCapable: input.parallelToolCapable ?? existing.parallelToolCapable,
      thinkingCapable: input.thinkingCapable ?? existing.thinkingCapable,
      forcedToolCapable: input.forcedToolCapable ?? existing.forcedToolCapable,
    });
    catalogSetClauses.push(`capabilities = $${paramIdx}::jsonb`);
    catalogParams.push(JSON.stringify(mergedCaps));
    paramIdx++;
  }
  if (input.maxInputTokens !== undefined) {
    catalogSetClauses.push(`max_input_tokens = $${paramIdx}`);
    catalogParams.push(input.maxInputTokens || null);
    paramIdx++;
  }
  if (input.maxOutputTokens !== undefined) {
    catalogSetClauses.push(`max_output_tokens = $${paramIdx}`);
    catalogParams.push(input.maxOutputTokens || null);
    paramIdx++;
  }
  if (input.inputCostPer1M !== undefined) {
    catalogSetClauses.push(`input_cost_per_1m = $${paramIdx}`);
    catalogParams.push(input.inputCostPer1M ?? null);
    paramIdx++;
  }
  if (input.outputCostPer1M !== undefined) {
    catalogSetClauses.push(`output_cost_per_1m = $${paramIdx}`);
    catalogParams.push(input.outputCostPer1M ?? null);
    paramIdx++;
  }
  if (input.capabilityTier !== undefined) {
    catalogSetClauses.push(`capability_tier = $${paramIdx}`);
    catalogParams.push(input.capabilityTier);
    paramIdx++;
  }
  if (input.capabilityScores !== undefined) {
    catalogSetClauses.push(`capability_scores = $${paramIdx}::jsonb`);
    catalogParams.push(input.capabilityScores ? JSON.stringify(input.capabilityScores) : null);
    paramIdx++;
  }

  // organization_deployment update fragments
  const odSetClauses: string[] = ['updated_at = NOW()'];
  const odParams: unknown[] = [];
  let odIdx = 1;

  if (input.enabled !== undefined) {
    odSetClauses.push(`enabled = $${odIdx}`);
    odParams.push(input.enabled);
    odIdx++;
  }
  if (input.sortOrder !== undefined) {
    odSetClauses.push(`sort_order = $${odIdx}`);
    odParams.push(input.sortOrder);
    odIdx++;
  }
  if (input.isDefault !== undefined) {
    odSetClauses.push(`is_default_for_capability = $${odIdx}`);
    odParams.push(input.isDefault);
    odIdx++;
  }

  const isDefault = input.isDefault ?? false;

  await transaction(async (trx) => {
    // 1. Legacy update (always)
    if (isDefault) {
      await trx
        .updateTable('enabled_models')
        .set({ is_default: 0 })
        .where('id', '!=', id)
        .execute();
    }
    await trx
      .updateTable('enabled_models')
      .set(updateObj)
      .where('id', '=', id)
      .execute();

    // 2. Catalog mirror update
    if (catalogSetClauses.length > 1) {
      catalogParams.push(id);
      const catalogQuery = `UPDATE model_catalog SET ${catalogSetClauses.join(', ')} WHERE id = $${paramIdx}`;
      await sql.raw(catalogQuery).execute(trx);
    }

    // 3. Organization deployment mirror update
    if (isDefault) {
      await sql`
        UPDATE organization_deployment
        SET is_default_for_capability = FALSE, updated_at = NOW()
        WHERE org_id IS NULL AND capability_id = 'llm' AND is_default_for_capability = TRUE AND catalog_id != ${id}
      `.execute(trx);
    }
    if (odSetClauses.length > 1) {
      odParams.push(id);
      const odQuery = `UPDATE organization_deployment SET ${odSetClauses.join(', ')} WHERE org_id IS NULL AND capability_id = 'llm' AND catalog_id = $${odIdx}`;
      await sql.raw(odQuery).execute(trx);
    }
  });

  // Invalidate quality score cache when model enabled/disabled status changes
  if (input.enabled !== undefined) {
    import('@/lib/model-quality').then(m => m.invalidateQualityCache()).catch(() => {});
  }

  return getEnabledModel(id);
}

/**
 * Delete/remove an enabled model.
 * Write-through mirror: transactionally deletes from both enabled_models (legacy)
 * AND organization_deployment + model_catalog (catalog path).
 * Note: model_catalog rows are marked status='retired' rather than hard-deleted,
 * so bound threads/agents can still resolve them (plan §4 seed-time status mapping).
 */
export async function deleteEnabledModel(id: string): Promise<boolean> {
  const existing = await getEnabledModel(id);
  if (!existing) return false;

  await transaction(async (trx) => {
    // 1. Legacy delete (always)
    await trx
      .deleteFrom('enabled_models')
      .where('id', '=', id)
      .execute();

    // 2. Catalog mirror: delete deployment, retire catalog entry
    await sql`
      DELETE FROM organization_deployment
      WHERE catalog_id = ${id} AND org_id IS NULL AND capability_id = 'llm'
    `.execute(trx);

    await sql`
      UPDATE model_catalog
      SET status = 'retired', updated_at = NOW()
      WHERE id = ${id} AND capability_id = 'llm'
    `.execute(trx);
  });

  // Invalidate quality score cache so removed model is excluded
  import('@/lib/model-quality').then(m => m.invalidateQualityCache()).catch(() => {});

  return true;
}

/**
 * Delete multiple models by IDs.
 * Write-through mirror: same logic as deleteEnabledModel, batched in a single transaction.
 */
export async function deleteEnabledModelsBatch(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  let deletedCount = 0;

  await transaction(async (trx) => {
    // 1. Legacy batch delete (always)
    const result = await trx
      .deleteFrom('enabled_models')
      .where('id', 'in', ids)
      .executeTakeFirst();
    deletedCount = Number(result.numDeletedRows || 0);

    // 2. Catalog mirror: delete deployments, retire catalog entries
    await sql`
      DELETE FROM organization_deployment
      WHERE catalog_id = ANY(${ids}::text[]) AND org_id IS NULL AND capability_id = 'llm'
    `.execute(trx);

    await sql`
      UPDATE model_catalog
      SET status = 'retired', updated_at = NOW()
      WHERE id = ANY(${ids}::text[]) AND capability_id = 'llm'
    `.execute(trx);
  });

  return deletedCount;
}

/**
 * Set a model as the default
 * Clears default from other models
 */
export async function setDefaultModel(id: string): Promise<EnabledModel | null> {
  return updateEnabledModel(id, { isDefault: true });
}

/**
 * Disable a model (hide from dropdown but keep config)
 */
export async function disableModel(id: string): Promise<EnabledModel | null> {
  return updateEnabledModel(id, { enabled: false });
}

/**
 * Enable a model (show in dropdown)
 */
export async function enableModel(id: string): Promise<EnabledModel | null> {
  return updateEnabledModel(id, { enabled: true });
}

/**
 * Check if a model supports tool/function calling
 */
export async function isModelToolCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.toolCapable ?? false;
}

/**
 * Check if a model supports vision/images
 */
export async function isModelVisionCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.visionCapable ?? false;
}

/**
 * Check if a model supports parallel tool execution
 */
export async function isModelParallelToolCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.parallelToolCapable ?? false;
}

/**
 * Check if a model supports thinking/reasoning content
 */
export async function isModelThinkingCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.thinkingCapable ?? false;
}

/**
 * Check if a model supports forced tool choice (required / specific function)
 */
export async function isModelForcedToolCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.forcedToolCapable ?? true;
}

/**
 * Get all tool-capable model IDs (from enabled providers only)
 * Flag-on: reads from model_catalog where capabilities->>'tool_capable' = 'true',
 *   joined with organization_deployment (enabled=true) + providers (enabled=true).
 * Flag-off: reads from enabled_models (legacy).
 */
export async function getToolCapableModelIds(): Promise<Set<string>> {
  const db = await getDb();

  if (isModelCatalogReads()) {
    const rows = await sql`
      SELECT mc.id
      FROM model_catalog mc
      INNER JOIN organization_deployment od
        ON od.catalog_id = mc.id AND od.org_id IS NULL AND od.enabled = TRUE
      INNER JOIN providers p ON p.id = mc.provider_id AND p.enabled = TRUE
      WHERE mc.capability_id = 'llm'
        AND mc.status = 'active'
        AND mc.capabilities->>'tool_capable' = 'true'
    `.execute(db);
    return new Set(rows.rows.map((r: unknown) => (r as { id: string }).id));
  }

  // Legacy path (flag-off)
  const rows = await db
    .selectFrom('enabled_models as m')
    .innerJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select('m.id')
    .where('m.tool_capable', '=', 1)
    .where('m.enabled', '=', 1)
    .where('p.enabled', '=', 1)
    .execute();

  return new Set(rows.map((r) => r.id));
}

/**
 * Update sort order for models (drag-and-drop reorder).
 * Write-through mirror: transactionally updates sort_order in both enabled_models (legacy)
 * AND organization_deployment (catalog path).
 */
export async function updateModelSortOrder(modelIds: string[]): Promise<void> {
  await transaction(async (trx) => {
    for (let i = 0; i < modelIds.length; i++) {
      // 1. Legacy update
      await trx
        .updateTable('enabled_models')
        .set({ sort_order: i })
        .where('id', '=', modelIds[i])
        .execute();

      // 2. Catalog mirror update
      await sql`
        UPDATE organization_deployment
        SET sort_order = ${i}, updated_at = NOW()
        WHERE catalog_id = ${modelIds[i]} AND org_id IS NULL AND capability_id = 'llm'
      `.execute(trx);
    }
  });
}

// ============ Migration / Seeding ============

/**
 * Check if any models exist in the database
 * Flag-on: checks model_catalog rows with capability_id='llm'.
 * Flag-off: checks enabled_models (legacy).
 */
export async function hasEnabledModels(): Promise<boolean> {
  const db = await getDb();

  if (isModelCatalogReads()) {
    const count = await sql`
      SELECT COUNT(*)::int AS count
      FROM model_catalog
      WHERE capability_id = 'llm'
    `.execute(db);
    return ((count.rows[0] as { count: number })?.count ?? 0) > 0;
  }

  // Legacy path (flag-off)
  const count = await db
    .selectFrom('enabled_models')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst();

  return (count?.count ?? 0) > 0;
}

/**
 * Seed models from config (for migration)
 * This is called during app initialization to migrate from YAML to DB
 */
export async function seedModelsFromConfig(models: CreateEnabledModelInput[]): Promise<void> {
  if (await hasEnabledModels()) {
    console.log('[Enabled Models] Models already exist, skipping seed (PostgreSQL)');
    return;
  }

  console.log(`[Enabled Models] Seeding ${models.length} models from config... (PostgreSQL)`);

  for (const model of models) {
    try {
      await createEnabledModel(model);
    } catch (error) {
      console.warn(`[Enabled Models] Failed to seed model ${model.id}:`, error);
    }
  }

  console.log('[Enabled Models] Seed complete (PostgreSQL)');
}

// ============ Deprecated Models Detection ============

/**
 * Find models that are enabled but not in the provided list of available models
 * Used to detect deprecated/removed models from providers
 */
export async function findDeprecatedModels(availableModelIds: string[]): Promise<EnabledModel[]> {
  const enabledModels = await getAllEnabledModels();
  const availableSet = new Set(availableModelIds);

  return enabledModels.filter((m) => !availableSet.has(m.id));
}

// ============ Model Capability Refresh ============

/**
 * Refresh a single model's capabilities using current detection patterns
 * Updates toolCapable, visionCapable, and maxInputTokens from model-discovery
 */
export async function refreshModelCapabilities(modelId: string): Promise<EnabledModel | null> {
  const model = await getEnabledModel(modelId);
  if (!model) return null;

  // Import capability detection from model-discovery (dynamic to avoid circular deps)
  const { isToolCapable, isVisionCapable, isParallelToolCapable, isThinkingCapable, getContextWindow } = await import('../../services/model-discovery');

  const newTokens = getContextWindow(modelId);

  const { isForcedToolCapable } = await import('../../services/model-discovery');
  return updateEnabledModel(modelId, {
    toolCapable: isToolCapable(modelId),
    visionCapable: isVisionCapable(modelId),
    parallelToolCapable: isParallelToolCapable(modelId),
    thinkingCapable: isThinkingCapable(modelId),
    forcedToolCapable: isForcedToolCapable(modelId),
    maxInputTokens: newTokens ?? model.maxInputTokens ?? undefined,
  });
}

/**
 * Refresh capabilities for all enabled models
 * Returns count of updated models and the refreshed model list
 */
export async function refreshAllModelCapabilities(): Promise<{ updated: number; models: EnabledModel[] }> {
  const models = await getAllEnabledModels();
  const refreshed: EnabledModel[] = [];

  for (const model of models) {
    const updated = await refreshModelCapabilities(model.id);
    if (updated) refreshed.push(updated);
  }

  return { updated: refreshed.length, models: refreshed };
}
