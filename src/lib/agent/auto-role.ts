/**
 * Auto Role Resolution for Agent / Autonomous Mode
 *
 * Provides per-role Auto model selection that preserves role specialization.
 * Each agent role (planner, executor, checker, summarizer) can independently
 * be set to "Auto", which resolves through `selectBestModel()` with a
 * role-appropriate capability dimension.
 *
 * Phase 5B — extends the deterministic Auto engine to agent/autonomous mode.
 */

import type { ModelSpec, AgentModelConfig, ExecutorProfileName } from '@/types/agent';
import { AUTO_MODEL_SENTINEL } from '@/lib/auto-model-constants';
import { selectBestModel } from '@/lib/auto-model-selector';
import type { CapabilityScores } from '@/lib/db/enabled-models';
import { getEnabledModel } from '@/lib/db/compat/enabled-models';

// ============ Sentinel ============

/**
 * Recognizable ModelSpec sentinel for per-role Auto.
 * When a role's config is set to this spec, it will be resolved
 * at runtime via `selectBestModel()` with the role's dimension.
 */
export const AUTO_ROLE_SPEC: ModelSpec = {
  provider: 'auto',
  model: AUTO_MODEL_SENTINEL,
  temperature: undefined,
};

/**
 * Check if a ModelSpec is the Auto sentinel.
 */
export function isAutoRoleSpec(spec: ModelSpec): boolean {
  return spec?.model === AUTO_MODEL_SENTINEL || spec?.provider === 'auto';
}

// ============ Role → Dimension Mapping ============

/**
 * Map an agent role to its primary capability dimension for Auto scoring.
 * This preserves role specialization — planner and executor resolve differently.
 */
export function roleToDimension(
  role: 'planner' | 'executor' | 'checker' | 'summarizer',
): keyof CapabilityScores {
  switch (role) {
    case 'planner':   return 'reasoning';
    case 'executor':  return 'function_calling';
    case 'checker':   return 'reasoning';
    case 'summarizer': return 'reasoning';  // cost-weighted via scoring weights
  }
}

/**
 * Map an executor profile to its primary capability dimension.
 * Each profile has a different optimization target.
 * Returns `null` for `local_private` — that profile must never use Auto
 * (air-gapped deployments must stay on Route 3).
 */
export function profileToDimension(
  profile: ExecutorProfileName,
): keyof CapabilityScores | null {
  switch (profile) {
    case 'default':             return 'function_calling';
    case 'deep_reasoning':      return 'reasoning';
    case 'code_generation':     return 'code_quality';
    case 'long_context':        return 'reasoning';
    case 'agentic_tool_loop':   return 'function_calling';
    case 'multilingual':        return 'reasoning';
    case 'fast_low_cost':       return 'reasoning';
    case 'artifact_generation': return 'code_quality';
    case 'local_private':       return null;  // MUST NOT resolve to Auto
  }
}

// ============ Model ID → ModelSpec Conversion ============

/**
 * Convert a resolved model id back into a ModelSpec by looking up
 * the enabled model's provider and using the detectProvider fallback.
 */
export async function modelIdToSpec(modelId: string): Promise<ModelSpec> {
  const enabledModel = await getEnabledModel(modelId);
  if (enabledModel) {
    return {
      provider: detectProviderFromId(modelId),
      model: modelId,
      temperature: undefined,  // use model default
    };
  }
  // Fallback: detect provider from model id prefix
  return {
    provider: detectProviderFromId(modelId),
    model: modelId,
    temperature: undefined,
  };
}

/**
 * Detect LLM provider from a model id string.
 * Mirrors the logic in llm-router.ts detectProvider() but returns
 * the LLMProvider union type (which now includes 'auto').
 */
function detectProviderFromId(modelId: string): ModelSpec['provider'] {
  if (modelId.startsWith('anthropic/') || modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('fireworks/') || modelId.startsWith('accounts/fireworks')) return 'fireworks';
  if (modelId.startsWith('deepseek-') || modelId.startsWith('deepseek/')) return 'deepseek';
  if (modelId.startsWith('moonshot/')) return 'moonshot';
  if (modelId.startsWith('ollama-cloud/') || modelId.endsWith('-cloud') || modelId.includes(':cloud')) return 'ollama-cloud';
  if (modelId.startsWith('ollama-') || modelId.startsWith('ollama/')) return 'ollama';
  if (modelId.startsWith('azure-foundry/')) return 'azure-foundry';
  if (modelId.startsWith('gemini')) return 'gemini';
  if (modelId.startsWith('mistral') || modelId.startsWith('codestral') || modelId.startsWith('pixtral')) return 'mistral';
  return 'openai';
}

// ============ Main Resolver ============

/**
 * Context passed to the resolver for richer Auto decisions.
 */
export interface AutoRoleContext {
  userMessage?: string;
  categoryIds?: number[];
  estimatedTokens?: number;
  executorProfile?: ExecutorProfileName;
}

/**
 * Resolve a role's ModelSpec, handling the Auto sentinel.
 * If the spec is not Auto, returns it unchanged.
 * If the spec is Auto, resolves via `selectBestModel()` with the
 * role-appropriate dimension override.
 *
 * This is the async replacement for the sync `getModelForRole()`.
 */
export async function resolveModelForRole(
  role: 'planner' | 'executor' | 'checker' | 'summarizer',
  config: AgentModelConfig,
  ctx?: AutoRoleContext,
): Promise<ModelSpec> {
  const spec = config[role];
  if (!isAutoRoleSpec(spec)) return spec;

  // Determine dimension: executor uses profile mapping, others use role mapping
  const dimension =
    role === 'executor' && ctx?.executorProfile
      ? profileToDimension(ctx.executorProfile)
      : roleToDimension(role);

  // Safety: if dimension is null (e.g. local_private), fall back to role default
  if (!dimension) {
    console.warn(`[AutoRole] Profile "${ctx?.executorProfile}" excluded from Auto — using role default`);
    return spec;  // returns the AUTO_ROLE_SPEC, caller should handle fallback
  }

  try {
    const picked = await selectBestModel({
      userMessage: ctx?.userMessage ?? '',
      categoryIds: ctx?.categoryIds ?? [],
      hasImages: false,
      estimatedTokens: ctx?.estimatedTokens,
      dimensionOverride: dimension,
    });

    const resolvedSpec = await modelIdToSpec(picked.modelId);
    const autoMsg = picked.reason === 'best_score' && picked.dominantFactor
      ? `[AutoRole] ${role} → ${picked.displayName} (best ${picked.dominantFactor})`
      : `[AutoRole] ${role} → ${picked.displayName} (${picked.reason.replace(/_/g, ' ')})`;
    console.log(autoMsg);

    return resolvedSpec;
  } catch (err) {
    console.error(`[AutoRole] ${role} Auto resolution failed, falling back to global default:`, err);
    // Fall back to the global default model — never return the unresolved sentinel
    const { getDefaultModel } = await import('@/lib/db/compat/enabled-models');
    const defaultModel = await getDefaultModel();
    if (defaultModel) {
      return await modelIdToSpec(defaultModel.id);
    }
    // Last resort: a reasonable default spec
    return { provider: 'openai', model: 'gpt-4o-mini', temperature: undefined };
  }
}

/**
 * Check if a resolved spec is still the Auto sentinel (resolution failed).
 * Callers should fall back to a sensible default when this returns true.
 */
export function isUnresolvedAuto(spec: ModelSpec): boolean {
  return isAutoRoleSpec(spec);
}
