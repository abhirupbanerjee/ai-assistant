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
import { isRoute2Model, isRoute3Model, isRoute5Model, isModelHealthy } from './llm-fallback';
import { AUTO_MODEL_SENTINEL } from './constants';
import { deriveScores } from './auto-model-scores';
import { DEPRECATED_MODELS } from './services/model-discovery';
import { classifyPrompt } from './classifier/prompt-category';
import { getModelQualityScores } from './model-quality';
import { AVAILABLE_TOOLS } from './tools';
import { isMcpTool } from './mcp/mcp-tools';
import type { EnabledModel, CapabilityScores } from './db/enabled-models';
import type { ModelRequirements } from './tools';

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
    if (isRoute3Model(m.id)) return routesSettings.route3Enabled;
    return routesSettings.route2Enabled;
  }).filter(m => isModelHealthy(m.id));

  // Filter deprecated models — still in DB but shouldn't win Auto selection
  candidates = candidates.filter(m => !DEPRECATED_MODELS.has(m.id));

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

  // ── Step 4.5: Tool-aware filtering ──
  // Collect model requirements from matched tools and apply hard filters +
  // weight boosts. This makes auto-selection tool-specific instead of
  // using a generic "function_calling" dimension for all tool requests.

  const toolReqs: ModelRequirements[] = routing.matches
    .map(m => {
      if (isMcpTool(m.toolName)) {
        return { requiresToolCalling: true };
      }
      return AVAILABLE_TOOLS[m.toolName]?.modelRequirements;
    })
    .filter((r): r is ModelRequirements => r != null);

  if (toolReqs.length > 0) {
    // Hard filter: tool calling required
    if (toolReqs.some(r => r.requiresToolCalling)) {
      const toolModels = candidates.filter(m => m.toolCapable);
      if (toolModels.length > 0) candidates = toolModels;
    }

    // Hard filter: vision required
    if (toolReqs.some(r => r.requiresVision)) {
      const visionModels = candidates.filter(m => m.visionCapable);
      if (visionModels.length > 0) candidates = visionModels;
    }

    // Hard filter: minimum context window
    const minCtx = Math.max(...toolReqs.map(r => r.minimumContextTokens ?? 0));
    if (minCtx > 0) {
      const fits = candidates.filter(m => (m.maxInputTokens ?? 0) >= minCtx);
      if (fits.length > 0) candidates = fits;
    }
  }

  // Weight boosts from tool requirements (applied in scoreOf closure)
  const contextBoost = toolReqs.some(r => r.prefersLargeContext) ? 1.5 : 1;
  const reasoningBoost = toolReqs.some(r => r.prefersInstructionFollowing) ? 1.3 : 1;
  const codeQualityBoost = toolReqs.some(r => r.prefersCodeQuality) ? 1.3 : 1;

  // ── Step 5: Weighted scoring ranking ──
  // Uses per-model quality scores from user feedback + prompt category
  // classification to dynamically weight capability dimensions.

  const [latencies, weights, qualityScores, classification] = await Promise.all([
    getAllModelP50Latencies(),
    getModelScoringWeights(),
    getModelQualityScores(),
    // Pass tool match signal: any routing match (forced or not) means tools are likely
    classifyPrompt(input.userMessage, input.hasImages, !!forced || routing.matches.length > 0),
  ]);

  // Pick the task dimension: explicit override > classifier > signal-derived default
  const dimension: keyof CapabilityScores =
    input.dimensionOverride
    || classification.dimension
    || (input.hasImages ? 'visual_reasoning'
      : forced          ? 'function_calling'
      : 'reasoning');

  // Pre-compute quality SatisfactionTerm lookup for scoreOf closure
  const qualityMap = new Map<string, number>();
  for (const [id, q] of qualityScores) {
    qualityMap.set(id, q.satisfaction);
  }

  function scoreOf(m: EnabledModel): number {
    const caps = (m.capabilityScores ?? deriveScores(m)) as CapabilityScores;
    let capability = caps[dimension] ?? (m.toolCapable ? 0.7 : 0.3);

    // Apply tool-specific capability boosts
    if (reasoningBoost > 1 && dimension === 'reasoning') {
      capability = Math.min(1, capability * reasoningBoost);
    }
    if (codeQualityBoost > 1 && dimension === 'code_quality') {
      capability = Math.min(1, capability * codeQualityBoost);
    }

    const contextFit = input.estimatedTokens
      ? Math.min(1, (m.maxInputTokens ?? 0) / input.estimatedTokens)
      : 1;
    const cost = m.inputCostPer1M ? 1 / (1 + m.inputCostPer1M) : 0.5;   // cheaper → higher
    const p50 = latencies[m.id];
    const latency = p50 ? 1 / (1 + p50 / 1000) : 0.5;                   // faster → higher
    const satisfaction = qualityMap.get(m.id) ?? 0.5;                     // neutral default
    // Revised scoring: satisfaction gets 20% weight. ContextFit is boosted for tools
    // that need large context (e.g. doc_gen, web_search).
    return capability * 0.40
         + contextFit * weights.contextFit * contextBoost
         + cost       * weights.cost
         + latency    * weights.latency
         + satisfaction * 0.20;
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
  const bestSatisfaction = qualityMap.get(best.id) ?? 0.5;

  const contributions = {
    capability:   bestCapability * 0.40,
    contextFit:   bestContextFit * weights.contextFit * contextBoost,
    cost:         bestCost * weights.cost,
    latency:      bestLatency * weights.latency,
    satisfaction: bestSatisfaction * 0.20,
  };

  const dominantFactor = Object.entries(contributions)
    .sort(([, a], [, b]) => b - a)[0][0];

  const factorLabels: Record<string, string> = {
    capability:   'quality',
    contextFit:   'context fit',
    cost:         'cost efficiency',
    latency:      'speed',
    satisfaction: 'user satisfaction',
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
