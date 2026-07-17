export type ThinkingStreamField = 'reasoning_content' | 'thinking' | 'think_tags';

export interface ThinkingRequestProfile {
  capable: boolean;
  enabled: boolean;
  defaultEnabled: boolean;
  requestParams: Record<string, unknown>;
  streamFields: ThinkingStreamField[];
  requiresThinkingStatePreservation: boolean;
}

function normalizeModelId(modelId: string): string {
  let id = modelId.toLowerCase().trim();
  id = id.replace(/^(ollama-cloud\/|ollama[-/]|openai\/|anthropic\/|deepseek\/|moonshot\/|mistral\/|gemini\/|google\/)/, '');
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash !== -1) id = id.slice(lastSlash + 1);
  return id.replace(/:.*$/, '');
}

export function isOpenAIOFamilyModel(modelId: string): boolean {
  return /^o\d/i.test(normalizeModelId(modelId));
}

export function isNonOOpenAIGpt5Model(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return id.startsWith('gpt-5') && !isOpenAIOFamilyModel(id);
}

/**
 * Check if the model is a GPT-5.x model that rejects reasoning_effort with
 * function tools in /v1/chat/completions and requires /v1/responses instead.
 *
 * Initially only gpt-5.5 exhibited this behavior, but gpt-5.4 was later
 * observed to also reject reasoning_effort with function tools (400 error:
 * "Function tools with reasoning_effort are not supported for gpt-5.4").
 * This covers all GPT-5.x standard chat models.
 *
 * Note: gpt-5.5-pro / gpt-5.4-pro are excluded — they are NOT chat models
 * (only legacy /v1/completions) and are handled by isNonChatOpenAIModel().
 */
function isGpt5ModelRejectingReasoningWithTools(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return id === 'gpt-5.5' || id === 'gpt-5.4' || id === 'gpt-5.4-mini' || id === 'gpt-5.4-nano'
      || id.startsWith('gpt-5.6');
}

export function isTemperatureLockedModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return (
    id.startsWith('gpt-5')
    || id.startsWith('kimi-k2.6')
    || id.startsWith('kimi-k2p6')
    || id.startsWith('kimi-k2.5')
    || id.startsWith('kimi-k2p5')
    || id.startsWith('kimi-k3')
    || id.startsWith('deepseek-v4-pro')
    || id.startsWith('deepseek-reasoner')
  );
}

export function isClaudeAdaptiveThinkingModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return (
    id.startsWith('claude-opus-4-7') ||
    id.startsWith('claude-opus-4-8') ||
    id.startsWith('claude-fable-5') ||
    id.startsWith('claude-sonnet-4-6') ||
    id.startsWith('claude-opus-4-6') ||
    id.startsWith('claude-sonnet-5')
  );
}

function isClaudeLegacyThinkingModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return (
    (id.startsWith('claude-opus-4') ||
     id.startsWith('claude-sonnet-4') ||
     id.startsWith('claude-haiku-4'))
    && !isClaudeAdaptiveThinkingModel(modelId)
  );
}

export function isTemperatureUnsupportedModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  // OpenAI o-series does not accept temperature at all.
  // Temperature-locked models (kimi-k2, gpt-5, etc.) also reject custom temps.
  // Claude adaptive-thinking models (Fable 5, Opus 4.7+) also reject temperature.
  return isOpenAIOFamilyModel(id) || isTemperatureLockedModel(id) || isClaudeAdaptiveThinkingModel(modelId);
}

export function getEffectiveTemperature(modelId: string, requestedTemperature: number): number {
  if (isTemperatureUnsupportedModel(modelId)) {
    return requestedTemperature; // Caller must strip the param entirely
  }
  return isTemperatureLockedModel(modelId) ? 1 : requestedTemperature;
}

/**
 * Get the correct temperature value for a model.
 * - O-series models: undefined (strip entirely)
 * - Temperature-locked models (kimi-k2, gpt-5, deepseek-reasoner): 1
 * - All others: requestedTemperature
 *
 * Use this instead of the isTemperatureUnsupportedModel + getEffectiveTemperature pair.
 */
export function getTemperatureForModel(modelId: string, requestedTemperature: number | undefined): number | undefined {
  const id = normalizeModelId(modelId);
  if (isOpenAIOFamilyModel(id) || isClaudeAdaptiveThinkingModel(id)) {
    return undefined; // Strip entirely — o-series and Claude adaptive-thinking models reject temperature
  }
  if (isTemperatureLockedModel(id)) {
    return 1; // Temperature-locked models require exactly 1
  }
  return requestedTemperature ?? 0.3;
}

export function isDefaultThinkingEnabledModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return id.startsWith('deepseek-v4-pro') || id.startsWith('kimi-k2p6') || id.startsWith('kimi-k2.6') || id.startsWith('claude-sonnet-5');
}

export function isLikelyThinkingCapableModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  if (isOpenAIOFamilyModel(id)) return false;

  return [
    /^gpt-5/,
    /^claude/,
    /^qwen3/,
    /^qwq/,
    /^deepseek-v4-pro/,
    /^deepseek-reasoner/,
    /^kimi-k/,
    /^gpt-oss/,
    /^gemini-2\.5/,
    /^magistral/,
    /^mistral-(small|medium).*reason/,
  ].some((pattern) => pattern.test(id));
}

function isClaudeModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.startsWith('anthropic/') || id.startsWith('claude-') || normalizeModelId(modelId).startsWith('claude');
}

function isDeepSeekThinkingModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return id.startsWith('deepseek-v4-pro') || id.startsWith('deepseek-reasoner');
}

function isKimiThinkingModel(modelId: string): boolean {
  return normalizeModelId(modelId).startsWith('kimi-k');
}

function isOllamaModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.startsWith('ollama/') || id.startsWith('ollama-') || id.startsWith('ollama-cloud/');
}

function isReasoningEffortModel(modelId: string): boolean {
  const id = normalizeModelId(modelId);
  return isNonOOpenAIGpt5Model(id) || id.startsWith('gemini-2.5') || id.startsWith('magistral') || id.startsWith('mistral-');
}

export function buildThinkingRequestProfile(options: {
  modelId: string;
  thinkingCapable?: boolean;
  thinkingEnabled?: boolean;
  maxTokens?: number;
  toolsEnabled?: boolean;
  forcePlain?: boolean;
}): ThinkingRequestProfile {
  const capable = Boolean(options.thinkingCapable) && isLikelyThinkingCapableModel(options.modelId) && !isOpenAIOFamilyModel(options.modelId);
  const defaultEnabled = capable && isDefaultThinkingEnabledModel(options.modelId);
  const enabled = capable && Boolean(options.thinkingEnabled) && !options.forcePlain;
  const requestParams: Record<string, unknown> = {};
  const streamFields = new Set<ThinkingStreamField>();
  let requiresThinkingStatePreservation = false;

  if (!capable) {
    return { capable, enabled: false, defaultEnabled, requestParams, streamFields: [], requiresThinkingStatePreservation };
  }

  streamFields.add('think_tags');

  if (!enabled) {
    if (isNonOOpenAIGpt5Model(options.modelId)) {
      const id = normalizeModelId(options.modelId);
      if (id.startsWith('gpt-5.6')) {
        // GPT-5.6 defaults reasoning ON — must explicitly set 'none' even with tools.
        // Omitting the param is NOT safe for this family (unlike gpt-5.4/5.5).
        requestParams.reasoning_effort = 'none';
      } else if (!(options.toolsEnabled && isGpt5ModelRejectingReasoningWithTools(options.modelId))) {
        // gpt-5.4/5.5: 'none' rejected with tools — only set when tools absent
        requestParams.reasoning_effort = 'none';
      }
    }
    return { capable, enabled: false, defaultEnabled, requestParams, streamFields: Array.from(streamFields), requiresThinkingStatePreservation };
  }

  if (isClaudeModel(options.modelId)) {
    requiresThinkingStatePreservation = true;
    if (isClaudeAdaptiveThinkingModel(options.modelId)) {
      requestParams.thinking = { type: 'adaptive', display: 'summarized' };
      requestParams.output_config = { effort: 'high' };
    } else {
      const maxTokens = Math.max(options.maxTokens ?? 4096, 2048);
      const budgetTokens = Math.max(1024, Math.min(4096, maxTokens - 1024));
      requestParams.thinking = { type: 'enabled', budget_tokens: budgetTokens };
    }
    streamFields.add('thinking');
  } else if (isDeepSeekThinkingModel(options.modelId)) {
    requiresThinkingStatePreservation = true;
    requestParams.thinking = { type: 'enabled' };
    requestParams.reasoning_effort = 'high';
    streamFields.add('reasoning_content');
  } else if (isOllamaModel(options.modelId)) {
    requestParams.think = true;
    streamFields.add('thinking');
    streamFields.add('reasoning_content');
  } else if (isReasoningEffortModel(options.modelId)) {
    const id = normalizeModelId(options.modelId);
    if (id.startsWith('gpt-5.6') && options.toolsEnabled) {
      // GPT-5.6: tools + reasoning incompatible on /v1/chat/completions.
      // Must explicitly set 'none' — omitting the param still triggers default reasoning.
      requestParams.reasoning_effort = 'none';
    } else if (!(options.toolsEnabled && isGpt5ModelRejectingReasoningWithTools(options.modelId))) {
      // GPT-5.6 Sol supports the new 'max' reasoning effort; use 'high' for Terra/Luna and other families.
      requestParams.reasoning_effort = (id === 'gpt-5.6' || id.startsWith('gpt-5.6-sol')) ? 'max' : 'high';
    }
    streamFields.add('reasoning_content');
  }

  return { capable, enabled, defaultEnabled, requestParams, streamFields: Array.from(streamFields), requiresThinkingStatePreservation };
}

export function stripThinkingRequestParams<T extends Record<string, unknown>>(params: T): T {
  const clone = { ...params };
  delete clone.reasoning_effort;
  delete clone.thinking;
  delete clone.think;
  delete clone.output_config;
  return clone;
}

export function isTemperatureParamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('temperature') &&
    (
      message.includes('unsupported') ||
      message.includes('invalid') ||
      message.includes('only 1 is allowed') ||
      message.includes('only the default') ||
      message.includes('does not support') ||
      message.includes('deprecated')
    )
  );
}

export function isUnsupportedThinkingParamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Guard: max_tokens/max_completion_tokens errors are NOT thinking-param errors.
  // Stripping thinking params won't fix them — they need the correct parameter name.
  if (message.includes('max_tokens') || message.includes('max_completion_tokens')) {
    return false;
  }

  return (
    message.includes('reasoning_effort') ||
    message.includes('reasoning effort') ||
    message.includes('thinking') ||
    message.includes('think') ||
    message.includes('unsupported') ||
    message.includes('unknown parameter') ||
    message.includes('extra inputs') ||
    message.includes('400')
  );
}
