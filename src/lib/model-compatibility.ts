/** Explicit compatibility overrides; unknown models retain their caller's legacy behavior. */
export type ModelReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelCompatibility {
  /** Omit temperature, top_p, and other sampling controls rather than forcing defaults. */
  readonly omitSampling: boolean;
  readonly alwaysThinking: boolean;
  readonly defaultEffort: ModelReasoningEffort;
  readonly allowedEfforts: readonly ModelReasoningEffort[];
  readonly reasoningMode: 'effort' | 'adaptive';
  /** Endpoint required for tool turns, independently of the selected reasoning effort. */
  readonly toolEndpoint: 'responses' | 'messages';
  readonly supportsPrefill: boolean;
  /** False means only auto/none, not required/any or a named tool. */
  readonly supportsForcedToolChoice: boolean;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
}

/** Keep the same normalization as the legacy thinking helpers, including local model tags. */
export function normalizeModelId(modelId: string): string {
  let id = modelId.toLowerCase().trim();
  id = id.replace(/^(ollama-cloud\/|ollama[-/]|openai\/|anthropic\/|deepseek\/|moonshot\/|mistral\/|gemini\/|google\/)/, '');
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash !== -1) id = id.slice(lastSlash + 1);
  return id.replace(/:.*$/, '');
}

const GPT6: ModelCompatibility = Object.freeze({
  omitSampling: true,
  alwaysThinking: false,
  defaultEffort: 'medium',
  allowedEfforts: Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const),
  reasoningMode: 'effort',
  toolEndpoint: 'responses',
  supportsPrefill: false,
  supportsForcedToolChoice: true,
  contextWindow: 1_050_000,
  maxOutputTokens: 128_000,
});

const CLAUDE: ModelCompatibility = Object.freeze({
  omitSampling: true,
  alwaysThinking: true,
  defaultEffort: 'high',
  allowedEfforts: Object.freeze(['low', 'medium', 'high', 'max'] as const),
  reasoningMode: 'adaptive',
  toolEndpoint: 'messages',
  supportsPrefill: false,
  supportsForcedToolChoice: false,
  contextWindow: 1_000_000,
  maxOutputTokens: 128_000,
});

const MODEL_COMPATIBILITY: Readonly<Record<string, ModelCompatibility>> = Object.freeze({
  'gpt-6-astra': Object.freeze({
    ...GPT6,
    alwaysThinking: true,
    allowedEfforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'] as const),
  }),
  'gpt-6-sol': GPT6,
  'gpt-6-luna': GPT6,
  'claude-fable-5-1': CLAUDE,
  'claude-opus-5-5': Object.freeze({
    ...CLAUDE,
    defaultEffort: 'medium',
    allowedEfforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'] as const),
  }),
});

/**
 * Pure, exact-ID lookup after provider-prefix normalization. No family-prefix matching:
 * undefined means there is no explicit override, not that a capability is unsupported.
 * Returned metadata and effort arrays are immutable and safe to share across callers.
 */
export function getModelCompatibility(model: string): ModelCompatibility | undefined {
  const id = normalizeModelId(model);
  return Object.hasOwn(MODEL_COMPATIBILITY, id) ? MODEL_COMPATIBILITY[id] : undefined;
}
