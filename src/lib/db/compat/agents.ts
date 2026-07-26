/**
 * Agent Registry Database Operations - Async Compatibility Layer
 *
 * Phase 1 Agent System foundations (see
 * plans/agent_system_architecture___implementation_plan.md).
 *
 * All operations use the Kysely query builder for async PostgreSQL access.
 * API routes should import from '@/lib/db/compat' and use `await` for all
 * operations. Per the AGENTS.md rule: never call getDb() directly in route
 * handlers — use these compat functions instead.
 */

import { getDb } from '../kysely';
import type { Agent, NewAgent } from '../db-types';

// ============ Types ============

export type AgentRoleFamily =
  | 'planner'
  | 'executor'
  | 'critic'
  | 'researcher'
  | 'presenter';

export type CapabilityTier = 'swarm_full' | 'swarm_limited' | 'unclassified';

/**
 * Application-facing agent shape (camelCase), mapped from the DB row.
 * `toolAllowlist` and `config` are stored as JSONB and surfaced as parsed
 * objects; callers mutate them as plain JS values.
 */
export interface AgentRecord {
  id: string;
  name: string;
  roleFamily: AgentRoleFamily;
  categoryId: number | null;
  modelId: string | null;
  systemPrompt: string;
  toolAllowlist: string[];
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  id: string;
  name: string;
  roleFamily: AgentRoleFamily;
  categoryId?: number | null;
  modelId?: string | null;
  systemPrompt?: string;
  toolAllowlist?: string[];
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  roleFamily?: AgentRoleFamily;
  categoryId?: number | null;
  modelId?: string | null;
  systemPrompt?: string;
  toolAllowlist?: string[];
  config?: Record<string, unknown>;
  enabled?: boolean;
}

// ============ Row Mapper ============

function mapRowToAgent(row: Agent): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    roleFamily: row.role_family as AgentRoleFamily,
    categoryId: row.category_id,
    modelId: row.model_id,
    systemPrompt: row.system_prompt,
    toolAllowlist: Array.isArray(row.tool_allowlist)
      ? (row.tool_allowlist as unknown as string[])
      : [],
    config:
      row.config && typeof row.config === 'object'
        ? (row.config as Record<string, unknown>)
        : {},
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ CRUD Operations ============

/**
 * List all agents (including disabled), ordered by role family then name.
 */
export async function listAgents(): Promise<AgentRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent')
    .selectAll()
    .orderBy('role_family')
    .orderBy('name')
    .execute();
  return rows.map(mapRowToAgent);
}

/**
 * List only enabled agents.
 */
export async function listEnabledAgents(): Promise<AgentRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent')
    .where('enabled', '=', true)
    .selectAll()
    .orderBy('role_family')
    .orderBy('name')
    .execute();
  return rows.map(mapRowToAgent);
}

/**
 * Get agents scoped to a category, falling back to global templates
 * (category_id NULL). This is the pool the swarm planner draws from for a
 * given category — global templates are always available as defaults.
 */
export async function getAgentsForCategory(
  categoryId: number
): Promise<AgentRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent')
    .where('enabled', '=', true)
    .where((eb) =>
      eb.or([
        eb('category_id', '=', categoryId),
        eb('category_id', 'is', null),
      ])
    )
    .selectAll()
    .orderBy('category_id', 'desc') // category-scoped first, then globals
    .orderBy('role_family')
    .orderBy('name')
    .execute();
  return rows.map(mapRowToAgent);
}

/**
 * Get enabled agents filtered by role family (across all categories).
 */
export async function getAgentsByRoleFamily(
  roleFamily: AgentRoleFamily
): Promise<AgentRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent')
    .where('enabled', '=', true)
    .where('role_family', '=', roleFamily)
    .selectAll()
    .orderBy('name')
    .execute();
  return rows.map(mapRowToAgent);
}

/**
 * Get a single agent by id.
 */
export async function getAgentById(id: string): Promise<AgentRecord | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent')
    .where('id', '=', id)
    .selectAll()
    .executeTakeFirst();
  return row ? mapRowToAgent(row) : null;
}

/**
 * Create a new agent. Throws on id collision (caller should check getAgentById
 * first or handle the unique-constraint rejection).
 */
export async function createAgent(
  input: CreateAgentInput
): Promise<AgentRecord> {
  const db = await getDb();
  const newRow: NewAgent = {
    id: input.id,
    name: input.name,
    role_family: input.roleFamily,
    category_id: input.categoryId ?? null,
    model_id: input.modelId ?? null,
    system_prompt: input.systemPrompt ?? '',
    tool_allowlist: input.toolAllowlist ?? [],
    config: input.config ?? {},
    enabled: input.enabled ?? true,
  };
  const row = await db
    .insertInto('agent')
    .values(newRow)
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapRowToAgent(row);
}

/**
 * Update an agent. Only the provided fields are mutated.
 */
export async function updateAgent(
  id: string,
  input: UpdateAgentInput
): Promise<AgentRecord | null> {
  const db = await getDb();
  const patch: Partial<NewAgent> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.roleFamily !== undefined) patch.role_family = input.roleFamily;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.modelId !== undefined) patch.model_id = input.modelId;
  if (input.systemPrompt !== undefined) patch.system_prompt = input.systemPrompt;
  if (input.toolAllowlist !== undefined) patch.tool_allowlist = input.toolAllowlist;
  if (input.config !== undefined) patch.config = input.config;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const row = await db
    .updateTable('agent')
    .set(patch)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
  return row ? mapRowToAgent(row) : null;
}

/**
 * Delete an agent permanently. Template agents (id LIKE 'tpl-%') should not be
 * deleted via the UI; disable them instead. This function does not enforce
 * that — the admin UI is responsible for guarding template rows.
 */
export async function deleteAgent(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('agent').where('id', '=', id).executeTakeFirst();
  return Number(result?.numDeletedRows ?? 0) > 0;
}

/**
 * Disable an agent without deleting it (soft-delete).
 */
export async function disableAgent(id: string): Promise<AgentRecord | null> {
  return updateAgent(id, { enabled: false });
}

// ============ Capability Tier Lookup ============

/**
 * Look up the capability tier for a model id. Returns 'unclassified' for
 * unknown models, which the gate treats as swarm-ineligible.
 */
export async function getModelCapabilityTier(
  modelId: string
): Promise<CapabilityTier> {
  const db = await getDb();
  const row = await db
    .selectFrom('enabled_models')
    .where('id', '=', modelId)
    .select('capability_tier')
    .executeTakeFirst();
  return (row?.capability_tier as CapabilityTier) ?? 'unclassified';
}

/**
 * Is the given model eligible to participate in swarm runs?
 * `unclassified` models are never swarm-eligible (conservative default).
 */
export async function isSwarmEligible(modelId: string): Promise<boolean> {
  const tier = await getModelCapabilityTier(modelId);
  return tier === 'swarm_full' || tier === 'swarm_limited';
}

/**
 * Can the given model fill the planner or critic role?
 * Only `swarm_full` models may plan or critique; `swarm_limited` is restricted
 * to executor/researcher/presenter.
 */
export async function canFillPlannerOrCriticRole(
  modelId: string
): Promise<boolean> {
  const tier = await getModelCapabilityTier(modelId);
  return tier === 'swarm_full';
}

/**
 * Bulk-fetch capability tiers for a set of model ids, returning a map.
 * Useful when the orchestrator needs to filter a candidate pool in one pass.
 */
export async function getCapabilityTiersForModels(
  modelIds: string[]
): Promise<Record<string, CapabilityTier>> {
  if (modelIds.length === 0) return {};
  const db = await getDb();
  const rows = await db
    .selectFrom('enabled_models')
    .where('id', 'in', modelIds)
    .select(['id', 'capability_tier'])
    .execute();
  const result: Record<string, CapabilityTier> = {};
  for (const id of modelIds) {
    result[id] = 'unclassified';
  }
  for (const row of rows) {
    result[row.id] = row.capability_tier as CapabilityTier;
  }
  return result;
}
