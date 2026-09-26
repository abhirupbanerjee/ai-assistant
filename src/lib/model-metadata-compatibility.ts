import { getModelCompatibility, normalizeModelId } from './model-compatibility';

// Deliberately exact: do not infer capabilities for future variants or snapshots.
const METADATA_MODELS = new Set([
  'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna',
  'claude-fable-5-1', 'claude-opus-5-5',
]);

export interface ModelMetadata {
  toolCapable?: boolean;
  visionCapable?: boolean;
  parallelToolCapable?: boolean;
  thinkingCapable?: boolean;
  forcedToolCapable?: boolean;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
}

/** Provider specifications, not administrator-selected request budgets. */
export function getKnownModelMetadata(modelId: string): {
  toolCapable: boolean;
  visionCapable: boolean;
  parallelToolCapable: boolean;
  thinkingCapable: boolean;
  forcedToolCapable: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
} | undefined {
  if (!METADATA_MODELS.has(normalizeModelId(modelId))) return undefined;
  const compatibility = getModelCompatibility(modelId);
  if (!compatibility) return undefined;
  return {
    toolCapable: true,
    visionCapable: true,
    parallelToolCapable: true,
    thinkingCapable: true,
    forcedToolCapable: compatibility.supportsForcedToolChoice,
    maxInputTokens: compatibility.contextWindow,
    maxOutputTokens: compatibility.maxOutputTokens,
  };
}

/** Exact compatibility wins over API omissions and LLM-guessed specifications. */
export function applyModelMetadataSpecifications<T extends ModelMetadata>(modelId: string, metadata: T): T {
  const known = getKnownModelMetadata(modelId);
  return known ? { ...metadata, ...known } : metadata;
}

/** Keep valid smaller admin budgets; repair missing/invalid or impossible limits. */
function correctBudget(value: number | null | undefined, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, maximum) : maximum;
}

/** Read/full-create correction. Never resets pricing, scores, tier, or enablement. */
export function applyPersistedModelMetadata<T extends ModelMetadata>(modelId: string, metadata: T): T {
  const known = getKnownModelMetadata(modelId);
  if (!known) return metadata;
  return {
    ...metadata,
    ...known,
    maxInputTokens: correctBudget(metadata.maxInputTokens, known.maxInputTokens),
    maxOutputTokens: correctBudget(metadata.maxOutputTokens, known.maxOutputTokens),
  };
}

/** Partial writes must not replace token budgets that the caller did not supply. */
export function applyModelMetadataUpdate<T extends ModelMetadata>(modelId: string, input: T): T {
  const corrected = applyPersistedModelMetadata(modelId, input);
  if (corrected === input) return input;
  if (input.maxInputTokens === undefined) delete corrected.maxInputTokens;
  if (input.maxOutputTokens === undefined) delete corrected.maxOutputTokens;
  return corrected;
}
