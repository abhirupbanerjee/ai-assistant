/**
 * Auto Model Scores — Derive and seed capability scores from stored flags
 *
 * Derives baseline capability scores from the boolean flags already on each
 * model row (toolCapable, visionCapable, parallelToolCapable, thinkingCapable).
 * Does NOT re-run the module-private discovery regexes.
 *
 * Score shape: { function_calling, visual_reasoning, reasoning, code_quality }
 * Each value is 0..1.
 */

import { getActiveModels, updateEnabledModel } from './db/compat/enabled-models';
import type { EnabledModel, CapabilityScores } from './db/enabled-models';

// ============ Derive ============

/**
 * Derive capability scores from the stored boolean flags on a model.
 * Uses a coarse family heuristic for code_quality (the only dimension
 * that inspects the model id string).
 */
export function deriveScores(m: EnabledModel): CapabilityScores {
  const id = m.id.toLowerCase();
  return {
    function_calling: m.toolCapable ? (m.parallelToolCapable ? 0.85 : 0.7) : 0.3,
    visual_reasoning: m.visionCapable ? 0.75 : 0.2,
    reasoning:        m.thinkingCapable ? 0.8 : 0.55,
    // coarse family heuristic for code quality
    code_quality:     /gpt-5\.6-sol/.test(id) ? 0.85
                    : /deepseek|qwen|glm|claude|gpt-5|codestral/.test(id) ? 0.75
                    : 0.6,
  };
}

// ============ Seed ============

/**
 * Seed capability scores for all active models that have null scores.
 * Idempotent — only writes to models whose capability_scores column is null.
 *
 * @returns Number of models that were seeded
 */
export async function seedCapabilityScores(): Promise<number> {
  const models = await getActiveModels();
  let seeded = 0;

  for (const m of models) {
    if (m.capabilityScores == null) {
      const scores = deriveScores(m);
      await updateEnabledModel(m.id, { capabilityScores: scores });
      seeded++;
    }
  }

  return seeded;
}

/**
 * Force-reseed capability scores for ALL active models,
 * overwriting any existing scores with freshly derived ones.
 *
 * @returns Number of models that were re-seeded
 */
export async function reseedAllCapabilityScores(): Promise<number> {
  const models = await getActiveModels();
  let seeded = 0;

  for (const m of models) {
    const scores = deriveScores(m);
    await updateEnabledModel(m.id, { capabilityScores: scores });
    seeded++;
  }

  return seeded;
}
