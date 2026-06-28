/**
 * Auto Model Selector
 *
 * Deterministic, signal-based model selection for the "Auto" mode in the chat
 * model selector dropdown. When a user selects "Auto", this module evaluates
 * the prompt context, tool routing, and skill matches to pick the best
 * available enabled model for that message.
 *
 * Core principle: Auto-selection runs ONLY when the user explicitly selects
 * "Auto". A user who picks a specific model always gets that model.
 *
 * Ranking signals (in priority order):
 *   1. Route health — only models on enabled, healthy routes
 *   2. Vision — hard-filter to vision models when images are present
 *   3. Context length — hard-filter to models that fit estimated tokens
 *   4. Tool preference — if a forced tool has a preferred model in the map
 *   5. Weighted scoring — capability × wc + contextFit × wf + cost × wo + latency × wl
 */

import { getActiveModels } from './db/compat/enabled-models';
import { getRoutesSettings, getAutoToolModelMap, getModelScoringWeights } from './db/compat/config';
import { getAllModelP50Latencies } from './db/compat/model-latency';
import { resolveToolRouting } from './tool-routing';
import { isRoute2Model, isRoute3Model, isRoute4Model, isRoute5Model, isModelHealthy } from './llm-fallback';
import { AUTO_MODEL_SENTINEL } from './constants';
import { deriveScores } from './auto-model-scores';
import type { EnabledModel, CapabilityScores } from './db/enabled-models';

// ============ Types ============

export interface AutoSelectionInput {
  /** The user's message text */
  userMessage: string;
  /** Category IDs for tool routing scope */
  categoryIds: number[];
  /** Whether the message includes image attachments */
  hasImages: boolean;
  /** Estimated token count for the full prompt context (optional) */
  estimatedTokens?: number;
  /**
   * Override the capability dimension used for scoring (Phase 5 bridge).
   * When absent, the dimension is auto-detected from signals (images → visual_reasoning,
   * forced tool → function_calling, else → reasoning).
   * When present, this dimension is used directly — enabling per-role Auto for
   * agent/autonomous mode (e.g. executor → function_calling, planner → reasoning).
   */
  dimensionOverride?: keyof CapabilityScores;
}

export type AutoSelectionReason =
  | 'tool_preference'    // A forced tool had a preferred model in the map
  | 'vision_required'    // Filtered to vision models because images present
  | 'long_context'       // Filtered to models with sufficient context window
  | 'best_score'         // Best available by weighted scoring (replaces default_best)
  | 'default_best';      // Legacy fallback — kept for backward compatibility

export interface AutoSelectionResult {
  /** The concrete model id to use (never 'auto') */
  modelId: string;
  /** Human-readable model name for UI feedback */
  displayName: string;
  /** Why this model was chosen */
  reason: AutoSelectionReason;
  /** Dominant scoring factor (e.g., "quality", "speed") for UI feedback */
  dominantFactor?: string;
}

// ============ Helper ============

/**
 * Get the preferred model id for a tool from the settings-backed map.
 * Returns undefined if no preference is configured for this tool.
 */
async function getToolPreferredModel(toolName: string): Promise<string | undefined> {
  const map = await getAutoToolModelMap();
  return map[toolName];
}

// ============ Main Selector ============

/**
 * Select the best available model for the given input context.
 *
 * This function is called ONLY when the user's selected model is the
 * AUTO_MODEL_SENTINEL. It never runs for explicit model choices.
 *
 * @returns AutoSelectionResult with a concrete model id and explanation
 * @throws Error if no models are available at all
 */
export async function selectBestModel(input: AutoSelectionInput): Promise<AutoSelectionResult> {
  const routesSettings = await getRoutesSettings();

  // ── Step 1: Candidate pool ──
  // Only active enabled models on enabled routes that are currently healthy
  let candidates = (await getActiveModels()).filter(m => {
    // Filter by route availability
    // NOTE: Route 5 MUST be checked first — models may match multiple route prefixes
    if (isRoute5Model(m.id)) return routesSettings.route5Enabled;
    if (isRoute4Model(m.id)) return routesSettings.route4Enabled;
    if (isRoute3Model(m.id)) return routesSettings.route3Enabled;
    if (isRoute2Model(m.id)) return routesSettings.route2Enabled;
    return routesSettings.route1Enabled; // Route 1 (LiteLLM) is the default
  }).filter(m => isModelHealthy(m.id));

  if (candidates.length === 0) {
    throw new Error('No models available for Auto selection. Enable at least one model on an active route.');
  }

  // ── Step 2: Hard filter — vision requirement ──
  // If images are present, prefer vision-capable models.
  // Only fall back to non-vision if NO vision model exists.
  if (input.hasImages) {
    const visionModels = candidates.filter(m => m.visionCapable);
    if (visionModels.length > 0) {
      candidates = visionModels;
    }
    // If no vision models exist, we still proceed with whatever is available
    // (the existing buildModelsToTry fallback handles the vision switch)
  }

  // ── Step 3: Hard filter — context length requirement ──
  // If we have an estimated token count, prefer models that can fit it.
  // Only fall back to shorter-context models if none fit.
  if (input.estimatedTokens && input.estimatedTokens > 0) {
    const fits = candidates.filter(m => (m.maxInputTokens ?? 0) >= input.estimatedTokens!);
    if (fits.length > 0) {
      candidates = fits;
    }
  }

  // ── Step 4: Tool preference signal ──
  // If a forced tool is matched by routing rules and has a preferred model
  // in the auto_tool_model_map, use it directly (if it's still a candidate).
  const routing = await resolveToolRouting(input.userMessage, input.categoryIds);
  const forced = routing.matches.find(m => m.forceMode === 'required');
  if (forced) {
    const prefId = await getToolPreferredModel(forced.toolName);
    if (prefId) {
      const match = candidates.find(m => m.id === prefId);
      if (match) {
        return {
          modelId: match.id,
          displayName: match.displayName || match.id,
          reason: 'tool_preference',
        };
      }
    }
  }

  // ── Step 5: Weighted scoring ranking ──
  // Replaces the old default-best sort with a data-driven weighted score.
  // Steps 1–4 and the function signature are unchanged.

  const latencies = await getAllModelP50Latencies();  // {} when no data
  const weights = await getModelScoringWeights();      // settings with defaults

  // Pick the task dimension: explicit override > signal-derived default
  const dimension: keyof CapabilityScores =
    input.dimensionOverride
    || (input.hasImages ? 'visual_reasoning'
      : forced          ? 'function_calling'   // `forced` already computed in Step 4
      : 'reasoning');

  function scoreOf(m: EnabledModel): number {
    const caps = (m.capabilityScores ?? deriveScores(m)) as CapabilityScores;
    const capability = caps[dimension] ?? (m.toolCapable ? 0.7 : 0.3);
    const contextFit = input.estimatedTokens
      ? Math.min(1, (m.maxInputTokens ?? 0) / input.estimatedTokens)
      : 1;
    const cost = m.inputCostPer1M ? 1 / (1 + m.inputCostPer1M) : 0.5;   // cheaper → higher
    const p50 = latencies[m.id];
    const latency = p50 ? 1 / (1 + p50 / 1000) : 0.5;                   // faster → higher
    return capability * weights.capability
         + contextFit * weights.contextFit
         + cost       * weights.cost
         + latency    * weights.latency;
  }

  candidates.sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a);
    if (Math.abs(d) > 1e-9) return d;
    return a.sortOrder - b.sortOrder;   // deterministic final tie-break (unchanged)
  });

  const best = candidates[0];

  // Determine the reason for UI feedback
  let reason: AutoSelectionReason;
  if (input.hasImages && best.visionCapable) {
    reason = 'vision_required';
  } else if (input.estimatedTokens && input.estimatedTokens > 100000 && (best.maxInputTokens ?? 0) >= input.estimatedTokens) {
    reason = 'long_context';
  } else {
    reason = 'best_score';
  }

  // Determine the dominant scoring factor for richer feedback
  const bestCaps = (best.capabilityScores ?? deriveScores(best)) as CapabilityScores;
  const bestCapability = bestCaps[dimension] ?? (best.toolCapable ? 0.7 : 0.3);
  const bestContextFit = input.estimatedTokens
    ? Math.min(1, (best.maxInputTokens ?? 0) / input.estimatedTokens)
    : 1;
  const bestCost = best.inputCostPer1M ? 1 / (1 + best.inputCostPer1M) : 0.5;
  const bestP50 = latencies[best.id];
  const bestLatency = bestP50 ? 1 / (1 + bestP50 / 1000) : 0.5;

  const contributions = {
    capability: bestCapability * weights.capability,
    contextFit: bestContextFit * weights.contextFit,
    cost:       bestCost * weights.cost,
    latency:    bestLatency * weights.latency,
  };

  const dominantFactor = Object.entries(contributions)
    .sort(([, a], [, b]) => b - a)[0][0];

  const factorLabels: Record<string, string> = {
    capability: 'quality',
    contextFit: 'context fit',
    cost:       'cost efficiency',
    latency:    'speed',
  };

  return {
    modelId: best.id,
    displayName: best.displayName || best.id,
    reason,
    dominantFactor: factorLabels[dominantFactor] ?? dominantFactor,
  };
}

// ============ Utility ============

/**
 * Check if a model id is the Auto sentinel value.
 * Used across validation layers to special-case 'auto'.
 */
export function isAutoSentinel(modelId: string | null | undefined): boolean {
  return modelId === AUTO_MODEL_SENTINEL;
}
