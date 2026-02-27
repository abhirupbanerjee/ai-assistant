/**
 * Skills Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers for skills operations that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder (TODO: implement during full migration)
 *
 * NOTE: Currently delegates all operations to sync SQLite functions.
 * This ensures consistency with how skills are stored (always SQLite via the sync module)
 * and fixes the backup export issue where compat layer was querying PostgreSQL
 * while actual data was in SQLite.
 */

import * as sync from '../skills';
import type {
  Skill,
  SkillWithCategories,
  CreateSkillInput,
  TriggerType,
  MatchType,
  ForceMode,
  DataSourceFilter,
  SkillComplianceConfig,
  ResolvedSkills,
} from '../../skills/types';

// Re-export all types from skills/types
export type {
  Skill,
  SkillWithCategories,
  CreateSkillInput,
  TriggerType,
  MatchType,
  ForceMode,
  DataSourceFilter,
  SkillComplianceConfig,
  ResolvedSkills,
};

// ============ Read Operations ============

/**
 * Get skill by ID with linked categories
 */
export async function getSkillById(id: number): Promise<SkillWithCategories | null> {
  // Skills module uses SQLite - delegate to sync
  return sync.getSkillById(id);
}

/**
 * Get all skills with optional filters
 */
export async function getAllSkills(filters?: {
  trigger_type?: TriggerType;
  is_active?: boolean;
  category_id?: number;
}): Promise<Skill[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getAllSkills(filters);
}

/**
 * Get skills by trigger type
 */
export async function getSkillsByTrigger(trigger_type: TriggerType): Promise<Skill[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getSkillsByTrigger(trigger_type);
}

/**
 * Get index skills for given categories
 * Index skills are broader domain expertise skills (one per category)
 */
export async function getIndexSkillsForCategories(categoryIds: number[]): Promise<Skill[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getIndexSkillsForCategories(categoryIds);
}

/**
 * Get all keyword-triggered skills (active only)
 */
export async function getKeywordSkills(): Promise<Skill[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getKeywordSkills();
}

/**
 * Get categories linked to a skill
 */
export async function getCategoriesForSkill(skillId: number): Promise<{ id: number; name: string }[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getCategoriesForSkill(skillId);
}

/**
 * Check if any skill with a specific tool matches a message
 * Used to replace hardcoded keyword patterns with database-driven config
 */
export async function wouldToolSkillMatch(toolName: string, message: string): Promise<boolean> {
  // Skills module uses SQLite - delegate to sync
  return sync.wouldToolSkillMatch(toolName, message);
}

/**
 * Get skills by tool name (for checking keywords for a specific tool)
 */
export async function getSkillsByTool(toolName: string): Promise<Skill[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getSkillsByTool(toolName);
}

/**
 * Get all skills with their categories
 */
export async function getAllSkillsWithCategories(): Promise<SkillWithCategories[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getAllSkillsWithCategories();
}

/**
 * Get all keyword-triggered skills that have tool routing configured
 * Used by the resolver to determine tool_choice based on matched skills
 */
export async function getSkillsWithToolRouting(): Promise<Skill[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getSkillsWithToolRouting();
}

/**
 * Get skills that match a specific tool
 * Useful for finding all skills that trigger a particular tool
 */
export async function getSkillsForTool(toolName: string): Promise<Skill[]> {
  // Skills module uses SQLite - delegate to sync
  return sync.getSkillsForTool(toolName);
}

/**
 * Check if tool routing migration has been completed
 */
export async function isToolRoutingMigrated(): Promise<boolean> {
  // Skills module uses SQLite - delegate to sync
  return sync.isToolRoutingMigrated();
}

// ============ Write Operations ============

/**
 * Create a new skill
 */
export async function createSkill(
  input: CreateSkillInput,
  createdBy: string,
  role: 'admin' | 'superuser'
): Promise<number> {
  // Skills module uses SQLite - delegate to sync
  return sync.createSkill(input, createdBy, role);
}

/**
 * Update an existing skill
 */
export async function updateSkill(
  id: number,
  updates: Partial<CreateSkillInput> & { is_active?: boolean },
  updatedBy: string
): Promise<void> {
  // Skills module uses SQLite - delegate to sync
  return sync.updateSkill(id, updates, updatedBy);
}

/**
 * Delete a skill
 */
export async function deleteSkill(id: number): Promise<{ success: boolean; message: string }> {
  // Skills module uses SQLite - delegate to sync
  return sync.deleteSkill(id);
}

/**
 * Toggle skill active status
 */
export async function toggleSkillActive(id: number, updatedBy: string): Promise<boolean> {
  // Skills module uses SQLite - delegate to sync
  return sync.toggleSkillActive(id, updatedBy);
}

// ============ Restore Operations ============

/**
 * Reset all core skills to their config file defaults
 * Deletes existing core skills - caller should re-run seedCoreSkills() after
 */
export async function resetCoreSkillsToDefaults(): Promise<number> {
  // Skills module uses SQLite - delegate to sync
  return sync.resetCoreSkillsToDefaults();
}

/**
 * Remove is_core flag from all skills
 * This allows all skills to be deletable by admins
 */
export async function removeCoreFlag(): Promise<number> {
  // Skills module uses SQLite - delegate to sync
  return sync.removeCoreFlag();
}

// ============ Seed Operations ============

/**
 * Seed a core skill (idempotent)
 */
export async function seedCoreSkill(
  name: string,
  description: string,
  promptContent: string,
  triggerType: TriggerType,
  triggerValue: string | null,
  priority: number
): Promise<void> {
  // Skills module uses SQLite - delegate to sync
  return sync.seedCoreSkill(name, description, promptContent, triggerType, triggerValue, priority);
}

// ============ Migration Operations ============

/**
 * Migrate tool routing rules to skills
 * Creates skill entries for each tool routing rule with tool_name set
 * This is a one-time migration for the unified keyword actions feature
 */
export async function migrateToolRoutingToSkills(migratedBy: string = 'system'): Promise<{
  migrated: number;
  skipped: number;
  errors: string[];
}> {
  // Skills module uses SQLite - delegate to sync
  return sync.migrateToolRoutingToSkills(migratedBy);
}
