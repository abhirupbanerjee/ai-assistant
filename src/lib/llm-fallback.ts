/**
 * LLM Fallback System
 *
 * Provides resilient model selection with automatic fallback:
 * 1. Capability fallback: Auto-switch to capable model for vision/tools
 * 2. Availability fallback: When selected model fails, try fallback
 */

import { getEnabledModel, getActiveModels } from './db/compat/enabled-models';
import { getLlmFallbackSettings, getRoutesSettings } from './db/compat/config';

// ============ Types ============

export type FallbackReason =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'model_unavailable'
  | 'api_error'
  | 'auth_error'
  | 'vision_required'
  | 'tools_required';

export interface ModelSwitchEvent {
  originalModel: string;
  newModel: string;
  reason: FallbackReason;
  timestamp: Date;
}

export interface ModelResolution {
  models: string[];
  capabilitySwitch?: ModelSwitchEvent;
}

/**
 * Custom error class for LLM fallback failures
 */
export class LlmFallbackError extends Error {
  code: 'NO_MODELS_AVAILABLE' | 'ALL_MODELS_FAILED' | 'CAPABILITY_UNAVAILABLE';
  recoverable: boolean;
  attemptedModels?: string[];
  originalError?: Error;

  constructor(options: {
    code: 'NO_MODELS_AVAILABLE' | 'ALL_MODELS_FAILED' | 'CAPABILITY_UNAVAILABLE';
    message: string;
    recoverable: boolean;
    attemptedModels?: string[];
    originalError?: Error;
  }) {
    super(options.message);
    this.name = 'LlmFallbackError';
    this.code = options.code;
    this.recoverable = options.recoverable;
    this.attemptedModels = options.attemptedModels;
    this.originalError = options.originalError;
  }
}

// ============ Health Cache (in-memory) ============

// Track unhealthy models to avoid repeated failures
const unhealthyModels = new Map<string, number>(); // modelId -> unhealthyUntil timestamp

/**
 * Mark a model as unhealthy for the configured duration
 */
export async function markModelUnhealthy(modelId: string): Promise<void> {
  const settings = await getLlmFallbackSettings();
  const duration =
    settings.healthCacheDuration === 'hourly' ? 3600000 :
    settings.healthCacheDuration === 'daily' ? 86400000 : 0;

  if (duration > 0) {
    unhealthyModels.set(modelId, Date.now() + duration);
    console.log(`[LLM-Fallback] Marked ${modelId} as unhealthy until ${new Date(Date.now() + duration).toISOString()}`);
  }
}

/**
 * Check if a model is currently healthy (not in unhealthy cache)
 */
export function isModelHealthy(modelId: string): boolean {
  const unhealthyUntil = unhealthyModels.get(modelId);
  if (!unhealthyUntil) return true;

  if (Date.now() > unhealthyUntil) {
    // Cache expired, model is healthy again
    unhealthyModels.delete(modelId);
    return true;
  }

  return false;
}

/**
 * Clear all unhealthy model entries (for admin reset)
 */
export function clearHealthCache(): void {
  unhealthyModels.clear();
  console.log('[LLM-Fallback] Health cache cleared');
}

/**
 * Get list of currently unhealthy models (for admin UI)
 */
export function getUnhealthyModels(): Array<{ modelId: string; expiresAt: Date }> {
  const now = Date.now();
  const result: Array<{ modelId: string; expiresAt: Date }> = [];

  for (const [modelId, unhealthyUntil] of unhealthyModels.entries()) {
    if (now < unhealthyUntil) {
      result.push({ modelId, expiresAt: new Date(unhealthyUntil) });
    } else {
      // Clean up expired entries
      unhealthyModels.delete(modelId);
    }
  }

  return result;
}

// ============ Error Categorization ============

/**
 * Categorize an API error to determine if fallback should be attempted
 * Returns null for non-recoverable errors
 */
export function isRecoverableApiError(error: Error): FallbackReason | null {
  const msg = error.message.toLowerCase();

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return 'rate_limit';
  }

  // Quota/billing issues
  if (msg.includes('quota') || msg.includes('billing') || msg.includes('insufficient') ||
      msg.includes('exceeded') || msg.includes('limit reached')) {
    return 'quota_exceeded';
  }

  // Model not found/available
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') ||
      msg.includes('unavailable') || msg.includes('not available'))) {
    return 'model_unavailable';
  }

  // Authentication errors
  if (msg.includes('unauthorized') || msg.includes('invalid api key') ||
      msg.includes('401') || msg.includes('authentication') || msg.includes('invalid key')) {
    return 'auth_error';
  }

  // Network/server errors
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused') ||
      msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return 'api_error';
  }

  // Not a recoverable error
  return null;
}

// ============ LiteLLM Proxy Health ============

let litellmHealthy = true;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Check if the LiteLLM proxy is healthy (cached, checks at most every 30s)
 */
export async function isLiteLLMProxyHealthy(): Promise<boolean> {
  if (!process.env.OPENAI_BASE_URL) return true; // No proxy configured, assume healthy
  if (Date.now() - lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) return litellmHealthy;

  try {
    const baseUrl = process.env.OPENAI_BASE_URL.replace(/\/v1\/?$/, '');
    // Use /health/liveliness (no auth required) instead of /health (requires LITELLM_MASTER_KEY)
    const res = await fetch(`${baseUrl}/health/liveliness`, { signal: AbortSignal.timeout(3000) });
    litellmHealthy = res.ok;
  } catch {
    litellmHealthy = false;
  }
  lastHealthCheck = Date.now();
  return litellmHealthy;
}

/**
 * Check if a model belongs to Route 2 (direct cloud providers, bypasses LiteLLM)
 */
export function isRoute2Model(model: string): boolean {
  return model.startsWith('anthropic/') || model.startsWith('claude-') || model.startsWith('fireworks/');
}

/**
 * Check if a model belongs to Route 3 (local / Ollama direct, air-gapped capable)
 */
export function isRoute3Model(model: string): boolean {
  return model.startsWith('ollama-') || model.startsWith('ollama/');
}

// ============ Model Resolution ============

/**
 * Build the list of models to try based on requirements and health status
 *
 * @param selectedModel - The user's selected model (or global default)
 * @param requiresVision - Whether the request includes images
 * @param requiresTools - Whether tools are enabled
 * @returns Models to try and any capability-based switch that occurred
 */
export async function buildModelsToTry(
  selectedModel: string | null,
  requiresVision: boolean,
  requiresTools: boolean
): Promise<ModelResolution> {
  const settings = await getLlmFallbackSettings();
  const selected = selectedModel ? await getEnabledModel(selectedModel) : null;

  // Check if selected model meets requirements
  const selectedMeetsVision = !requiresVision || selected?.visionCapable;
  const selectedMeetsTools = !requiresTools || selected?.toolCapable;
  const selectedMeetsNeeds = selected && selectedMeetsVision && selectedMeetsTools;

  if (selectedMeetsNeeds && isModelHealthy(selectedModel!)) {
    // Selected model works, include fallback as backup
    const models = [selectedModel!];
    if (settings.universalFallback && settings.universalFallback !== selectedModel) {
      models.push(settings.universalFallback);
    }

    // Route-aware: append cross-route fallback models if other routes are enabled
    const routesSettings = await getRoutesSettings();
    if (routesSettings.route2Enabled && !isRoute2Model(selectedModel!)) {
      const route2Fallbacks = ['fireworks/minimax-m2p5', 'claude-haiku-4-5-20251001'];
      for (const fb of route2Fallbacks) {
        if (!models.includes(fb) && isModelHealthy(fb)) {
          models.push(fb);
        }
      }
    }
    if (routesSettings.route3Enabled && !isRoute3Model(selectedModel!)) {
      const route3Fallbacks = await getActiveModels();
      for (const m of route3Fallbacks) {
        if (isRoute3Model(m.id) && !models.includes(m.id) && isModelHealthy(m.id)) {
          models.push(m.id);
          break; // One Ollama fallback is enough
        }
      }
    }

    return { models: models.filter(Boolean) };
  }

  // Selected doesn't meet needs OR is unhealthy → determine reason and use fallback
  let switchReason: FallbackReason;
  if (requiresVision && !selected?.visionCapable) {
    switchReason = 'vision_required';
  } else if (requiresTools && !selected?.toolCapable) {
    switchReason = 'tools_required';
  } else {
    switchReason = 'model_unavailable';
  }

  // Build models list starting with fallback
  const models: string[] = [];
  if (settings.universalFallback && isModelHealthy(settings.universalFallback)) {
    models.push(settings.universalFallback);
  }

  // Route-aware: if primary is unhealthy, try other routes as fallback
  const routesSettings = await getRoutesSettings();
  if (routesSettings.route2Enabled) {
    const proxyHealthy = await isLiteLLMProxyHealthy();
    if (!proxyHealthy || switchReason === 'model_unavailable') {
      const route2Fallbacks = ['fireworks/minimax-m2p5', 'claude-haiku-4-5-20251001'];
      for (const fb of route2Fallbacks) {
        if (!models.includes(fb) && isModelHealthy(fb)) {
          models.push(fb);
        }
      }
    }
  }
  if (routesSettings.route3Enabled) {
    const route3Models = await getActiveModels();
    for (const m of route3Models) {
      if (isRoute3Model(m.id) && !models.includes(m.id) && isModelHealthy(m.id)) {
        models.push(m.id);
        break;
      }
    }
  }

  // Create capability switch event if we're switching due to capability mismatch
  const capabilitySwitch: ModelSwitchEvent | undefined = selectedModel && models.length > 0 ? {
    originalModel: selectedModel,
    newModel: models[0],
    reason: switchReason,
    timestamp: new Date(),
  } : undefined;

  return { models, capabilitySwitch };
}

// ============ Circuit Breaker Logging ============

/**
 * Log a fallback event with structured output
 */
export function logFallbackEvent(event: {
  originalModel: string;
  newModel: string;
  reason: FallbackReason;
  error?: Error;
  threadId?: string;
  userId?: string;
  attemptNumber: number;
  totalAttempts: number;
}): void {
  const level =
    event.attemptNumber === event.totalAttempts ? 'ERROR' :
    event.attemptNumber === event.totalAttempts - 1 ? 'WARN' : 'INFO';

  console.log(`[LLM-Fallback] ${level}: Model switch: ${event.originalModel} → ${event.newModel}`);
  console.log(`[LLM-Fallback]   Reason: ${event.reason} | Thread: ${event.threadId || 'N/A'} | Attempt: ${event.attemptNumber}/${event.totalAttempts}`);

  if (event.error) {
    console.log(`[LLM-Fallback]   Error: ${event.error.message}`);
  }
}

// ============ Execution Wrapper ============

/**
 * Execute an LLM operation with automatic fallback on failure.
 * Used by both streaming and non-streaming routes.
 *
 * @param options.modelsToTry - Ordered list of models to attempt
 * @param options.execute - Function to execute with each model
 * @param options.onSwitch - Callback when switching models (for streaming notifications)
 * @param options.context - Context for logging (threadId, userId)
 * @returns Result, the model that was used, and any switch events
 */
export async function withModelFallback<T>(options: {
  modelsToTry: string[];
  execute: (model: string) => Promise<T>;
  onSwitch?: (event: ModelSwitchEvent) => void;
  context?: { threadId?: string; userId?: string };
}): Promise<{ result: T; usedModel: string; switches: ModelSwitchEvent[] }> {
  const { modelsToTry, execute, onSwitch, context } = options;
  const switches: ModelSwitchEvent[] = [];

  // No models available
  if (modelsToTry.length === 0) {
    throw new LlmFallbackError({
      code: 'NO_MODELS_AVAILABLE',
      message: 'No LLM models available. Please contact your administrator to configure a fallback model.',
      recoverable: false,
    });
  }

  let lastError: Error | null = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];

    try {
      const result = await execute(model);
      return { result, usedModel: model, switches };
    } catch (error) {
      lastError = error as Error;
      const reason = isRecoverableApiError(lastError);

      // Log the event
      logFallbackEvent({
        originalModel: model,
        newModel: modelsToTry[i + 1] || 'none',
        reason: reason || 'api_error',
        error: lastError,
        ...context,
        attemptNumber: i + 1,
        totalAttempts: modelsToTry.length,
      });

      if (reason) {
        // Mark model as unhealthy
        await markModelUnhealthy(model);

        // If there's another model to try, switch to it
        if (i < modelsToTry.length - 1) {
          const switchEvent: ModelSwitchEvent = {
            originalModel: model,
            newModel: modelsToTry[i + 1],
            reason,
            timestamp: new Date(),
          };
          switches.push(switchEvent);
          onSwitch?.(switchEvent);
          continue;
        }
      }

      // Non-recoverable error or no more models
      break;
    }
  }

  // All models exhausted
  throw new LlmFallbackError({
    code: 'ALL_MODELS_FAILED',
    message: 'All available LLM models failed. Please try again later.',
    recoverable: true,
    attemptedModels: modelsToTry,
    originalError: lastError || undefined,
  });
}

// ============ Utility Functions ============

/**
 * Get all models that are eligible as universal fallback (have both vision + tools)
 */
export async function getEligibleFallbackModels() {
  try {
    const activeModels = await getActiveModels();
    return activeModels.filter(m => m.visionCapable && m.toolCapable);
  } catch {
    return [];
  }
}

/**
 * Check if a model is eligible as universal fallback
 */
export async function isEligibleFallbackModel(modelId: string): Promise<boolean> {
  const model = await getEnabledModel(modelId);
  return Boolean(model?.visionCapable && model?.toolCapable && model?.enabled);
}
