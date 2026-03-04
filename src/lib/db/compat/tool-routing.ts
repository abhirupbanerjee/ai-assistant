/**
 * Tool Routing Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import type {
  ToolRoutingRule,
  ToolRoutingRuleInput,
} from '@/types/tool-routing';

// ============================================================================
// Re-export types
// ============================================================================

export type { ToolRoutingRule, ToolRoutingRuleInput };

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get all active routing rules, optionally filtered by category
 */
export async function getActiveRoutingRules(
  categoryIds?: number[]
): Promise<ToolRoutingRule[]> {
  const { getDb } = await import('../kysely');
  const db = await getDb();

  let query = db
    .selectFrom('tool_routing_rules')
    .selectAll()
    .where('is_active', '=', 1)
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'asc');

  const rows = await query.execute();

  let rules = rows.map(mapDbToRoutingRule);

  // Filter by category if provided
  if (categoryIds && categoryIds.length > 0) {
    rules = rules.filter((rule) => {
      if (rule.categoryIds === null) return true;
      return rule.categoryIds.some((id) => categoryIds.includes(id));
    });
  }

  return rules;
}

/**
 * Get all routing rules (for admin)
 */
export async function getAllRoutingRules(): Promise<ToolRoutingRule[]> {
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const rows = await db
    .selectFrom('tool_routing_rules')
    .selectAll()
    .orderBy('tool_name', 'asc')
    .orderBy('priority', 'asc')
    .execute();

  return rows.map(mapDbToRoutingRule);
}

/**
 * Get routing rule by ID
 */
export async function getRoutingRuleById(
  id: string
): Promise<ToolRoutingRule | undefined> {
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const row = await db
    .selectFrom('tool_routing_rules')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapDbToRoutingRule(row) : undefined;
}

/**
 * Get routing rules by tool name
 */
export async function getRoutingRulesByTool(
  toolName: string
): Promise<ToolRoutingRule[]> {
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const rows = await db
    .selectFrom('tool_routing_rules')
    .selectAll()
    .where('tool_name', '=', toolName)
    .orderBy('priority', 'asc')
    .execute();

  return rows.map(mapDbToRoutingRule);
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Create a new routing rule
 */
export async function createRoutingRule(
  input: ToolRoutingRuleInput,
  createdBy: string
): Promise<ToolRoutingRule> {
  const { v4: uuidv4 } = await import('uuid');
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const id = uuidv4();

  await db
    .insertInto('tool_routing_rules')
    .values({
      id,
      tool_name: input.toolName,
      rule_name: input.ruleName,
      rule_type: input.ruleType,
      patterns: JSON.stringify(input.patterns),
      force_mode: input.forceMode || 'required',
      priority: input.priority || 100,
      category_ids: input.categoryIds ? JSON.stringify(input.categoryIds) : null,
      is_active: input.isActive !== false ? 1 : 0,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .execute();

  const result = await getRoutingRuleById(id);
  return result!;
}

/**
 * Update a routing rule
 */
export async function updateRoutingRule(
  id: string,
  updates: Partial<ToolRoutingRuleInput>,
  updatedBy: string
): Promise<ToolRoutingRule | undefined> {
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const existing = await getRoutingRuleById(id);
  if (!existing) return undefined;

  const updateData: Record<string, unknown> = {
    updated_at: new Date(),
    updated_by: updatedBy,
  };

  if (updates.toolName !== undefined) {
    updateData.tool_name = updates.toolName;
  }
  if (updates.ruleName !== undefined) {
    updateData.rule_name = updates.ruleName;
  }
  if (updates.ruleType !== undefined) {
    updateData.rule_type = updates.ruleType;
  }
  if (updates.patterns !== undefined) {
    updateData.patterns = JSON.stringify(updates.patterns);
  }
  if (updates.forceMode !== undefined) {
    updateData.force_mode = updates.forceMode;
  }
  if (updates.priority !== undefined) {
    updateData.priority = updates.priority;
  }
  if (updates.categoryIds !== undefined) {
    updateData.category_ids = updates.categoryIds
      ? JSON.stringify(updates.categoryIds)
      : null;
  }
  if (updates.isActive !== undefined) {
    updateData.is_active = updates.isActive ? 1 : 0;
  }

  await db
    .updateTable('tool_routing_rules')
    .set(updateData)
    .where('id', '=', id)
    .execute();

  return getRoutingRuleById(id);
}

/**
 * Delete a routing rule
 */
export async function deleteRoutingRule(id: string): Promise<boolean> {
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const result = await db
    .deleteFrom('tool_routing_rules')
    .where('id', '=', id)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

// ============================================================================
// Helper Functions
// ============================================================================

interface DbToolRoutingRow {
  id: string;
  tool_name: string;
  rule_name: string;
  rule_type: string;
  patterns: string;
  force_mode: string;
  priority: number;
  category_ids: string | null;
  is_active: number | boolean;
  created_at: string | Date;
  updated_at: string | Date;
  created_by: string;
  updated_by: string;
}

function mapDbToRoutingRule(row: DbToolRoutingRow): ToolRoutingRule {
  return {
    id: row.id,
    toolName: row.tool_name,
    ruleName: row.rule_name,
    ruleType: row.rule_type as 'keyword' | 'regex',
    patterns: typeof row.patterns === 'string' ? JSON.parse(row.patterns) : row.patterns,
    forceMode: row.force_mode as 'required' | 'preferred',
    priority: row.priority,
    categoryIds: row.category_ids
      ? typeof row.category_ids === 'string'
        ? JSON.parse(row.category_ids)
        : row.category_ids
      : null,
    isActive: row.is_active === true || row.is_active === (1 as unknown as boolean),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if any routing rules exist
 */
export async function hasRoutingRules(): Promise<boolean> {
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const result = await db
    .selectFrom('tool_routing_rules')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst();

  return (result?.count || 0) > 0;
}

/**
 * Seed default routing rules if none exist
 */
export async function seedDefaultRoutingRules(
  createdBy: string = 'system'
): Promise<void> {
  // Check if migration to skills has happened
  const { getDb } = await import('../kysely');
  const db = await getDb();

  const skillsWithToolRouting = await db
    .selectFrom('skills')
    .select(db.fn.count<number>('id').as('count'))
    .where('tool_name', 'is not', null)
    .executeTakeFirst();

  if ((skillsWithToolRouting?.count || 0) > 0) {
    console.log('[ToolRouting] Skipping seed - tool routing has been migrated to skills');
    return;
  }

  // Get default rules from sync module (they're just data, not DB calls)
  const DEFAULT_ROUTING_RULES = await import('../tool-routing').then(m => m.DEFAULT_ROUTING_RULES || []);

  for (const rule of DEFAULT_ROUTING_RULES) {
    // Check if rule with same name already exists
    const existing = await db
      .selectFrom('tool_routing_rules')
      .select('id')
      .where('rule_name', '=', rule.ruleName)
      .executeTakeFirst();

    if (!existing) {
      await createRoutingRule(rule, createdBy);
      console.log(`[ToolRouting] Created default rule: ${rule.ruleName}`);
    }
  }
}
