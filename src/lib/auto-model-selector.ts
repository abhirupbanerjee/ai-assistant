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
 *   5. Default-best — tool-capable > highest context > admin sort_order
 */

import { getActiveModels } from './db/compat/enabled-models';
import { getRoutesSettings, getAutoToolModelMap } from './db/compat/config';
import { resolveToolRouting } from './tool-routing';
import { isRoute2Model, isRoute3Model, isRoute4Model, isModelHealthy } from './llm-fallback';
import { AUTO_MODEL_SENTINEL } from './constants';

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
}

export type AutoSelectionReason =
  | 'tool_preference'    // A forced tool had a preferred model in the map
  | 'vision_required'    // Filtered to vision models because images present
  | 'long_context'       // Filtered to models with sufficient context window
  | 'default_best';      // Best available by capability ranking

export interface AutoSelectionResult {
  /** The concrete model id to use (never 'auto') */
  modelId: string;
  /** Human-readable model name for UI feedback */
  displayName: string;
  /** Why this model was chosen */
  reason: AutoSelectionReason;
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

  // ── Step 5: Default-best ranking ──
  // Deterministic tie-breaking: tool-capable first, then highest context,
  // then admin-configured sort order.
  candidates.sort((a, b) => {
    // Prefer tool-capable models (they can use the full tool ecosystem)
    if (a.toolCapable !== b.toolCapable) return a.toolCapable ? -1 : 1;

    // Prefer models with larger context windows (more room for RAG + history)
    const ctxDiff = (b.maxInputTokens ?? 0) - (a.maxInputTokens ?? 0);
    if (ctxDiff !== 0) return ctxDiff;

    // Final tie-break: admin sort order (lower = higher priority)
    return a.sortOrder - b.sortOrder;
  });

  const best = candidates[0];

  // Determine the reason for UI feedback
  let reason: AutoSelectionReason;
  if (input.hasImages && best.visionCapable) {
    reason = 'vision_required';
  } else if (input.estimatedTokens && input.estimatedTokens > 100000 && (best.maxInputTokens ?? 0) >= input.estimatedTokens) {
    reason = 'long_context';
  } else {
    reason = 'default_best';
  }

  return {
    modelId: best.id,
    displayName: best.displayName || best.id,
    reason,
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
