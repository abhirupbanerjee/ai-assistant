import type { Kysely } from 'kysely';
import type { DB } from '../db-types';
import { applyPersistedModelMetadata, getKnownModelMetadata } from '../../model-metadata-compatibility';

const capabilityFields = {
  tool_capable: 'toolCapable',
  vision_capable: 'visionCapable',
  parallel_tool_capable: 'parallelToolCapable',
  thinking_capable: 'thinkingCapable',
  forced_tool_capable: 'forcedToolCapable',
} as const;

/** Called inside the versioned startup transaction, after catalog creation/seed.
 * Match with the same exact normalized registry lookup as runtime. Only matching
 * rows change; no inserts, deployment writes, pricing, tiers, or scores. Lower
 * positive budgets (including indistinguishable old defaults) are preserved.
 */
export async function correctPersistedModelMetadata(database: Kysely<DB>): Promise<void> {
  const legacy = await database.selectFrom('enabled_models')
    .select(['id', 'tool_capable', 'vision_capable', 'parallel_tool_capable',
      'thinking_capable', 'forced_tool_capable', 'max_input_tokens', 'max_output_tokens'])
    .forUpdate().execute();
  for (const row of legacy) {
    const known = getKnownModelMetadata(row.id);
    if (!known) continue;
    const corrected = applyPersistedModelMetadata(row.id, {
      maxInputTokens: row.max_input_tokens, maxOutputTokens: row.max_output_tokens,
    });
    const patch: Record<string, number> = {};
    for (const [column, field] of Object.entries(capabilityFields)) {
      const value = known[field] ? 1 : 0;
      if (row[column as keyof typeof capabilityFields] !== value) patch[column] = value;
    }
    if (row.max_input_tokens !== corrected.maxInputTokens) patch.max_input_tokens = corrected.maxInputTokens!;
    if (row.max_output_tokens !== corrected.maxOutputTokens) patch.max_output_tokens = corrected.maxOutputTokens!;
    if (Object.keys(patch).length) {
      await database.updateTable('enabled_models').set({ ...patch, updated_at: new Date().toISOString() })
        .where('id', '=', row.id).execute();
    }
  }

  const catalog = await database.selectFrom('model_catalog')
    .select(['id', 'capabilities', 'max_input_tokens', 'max_output_tokens'])
    .where('capability_id', '=', 'llm').forUpdate().execute();
  for (const row of catalog) {
    if (!getKnownModelMetadata(row.id)) continue;
    const known = getKnownModelMetadata(row.id)!;
    const corrected = applyPersistedModelMetadata(row.id, {
      maxInputTokens: row.max_input_tokens, maxOutputTokens: row.max_output_tokens,
    });
    const caps = row.capabilities as Record<string, unknown> | null;
    const merged = { ...caps };
    let changed = false;
    for (const [column, field] of Object.entries(capabilityFields)) {
      if (caps?.[column] !== known[field]) changed = true;
      merged[column] = known[field];
    }
    const patch: Record<string, unknown> = {};
    if (changed) patch.capabilities = JSON.stringify(merged);
    if (row.max_input_tokens !== corrected.maxInputTokens) patch.max_input_tokens = corrected.maxInputTokens;
    if (row.max_output_tokens !== corrected.maxOutputTokens) patch.max_output_tokens = corrected.maxOutputTokens;
    if (Object.keys(patch).length) {
      await database.updateTable('model_catalog').set({ ...patch, updated_at: new Date().toISOString() })
        .where('id', '=', row.id).where('capability_id', '=', 'llm').execute();
    }
  }
}
