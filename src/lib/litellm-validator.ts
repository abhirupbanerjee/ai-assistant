/**
 * LiteLLM Configuration Validator & Model Discovery
 *
 * Two responsibilities:
 * 1. Validates that models defined in config/defaults.json exist in
 *    litellm-proxy/litellm_config.yaml at application startup.
 * 2. Parses LiteLLM config to auto-discover available models with metadata.
 *
 * Validation Behavior:
 * - WARN: If default model is missing from YAML (sync may register it)
 * - WARN: If other preset models are missing from YAML (sync may register them)
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { loadConfig } from './config-loader';

interface ValidationResult {
  valid: boolean;
  defaultModelMissing: boolean;
  missingModels: string[];
  errors: string[];
}

/**
 * Validate LiteLLM configuration against defaults.json
 */
export function validateLiteLLMConfig(): ValidationResult {
  const defaults = loadConfig();
  const yamlPath = path.join(
    process.cwd(),
    'litellm-proxy',
    'litellm_config.yaml'
  );

  const result: ValidationResult = {
    valid: true,
    defaultModelMissing: false,
    missingModels: [],
    errors: [],
  };

  // Check if YAML exists
  if (!fs.existsSync(yamlPath)) {
    result.valid = false;
    result.defaultModelMissing = true;
    result.errors.push(formatError('YAML_NOT_FOUND', yamlPath));
    return result;
  }

  // Parse YAML and get available models
  let litellmConfig: { model_list?: Array<{ model_name: string }> };
  try {
    const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
    litellmConfig = yaml.parse(yamlContent);
  } catch (error) {
    result.valid = false;
    result.defaultModelMissing = true;
    result.errors.push(formatError('YAML_PARSE_ERROR', yamlPath, undefined, error));
    return result;
  }

  const availableModels = new Set(
    litellmConfig.model_list?.map((m) => m.model_name) || []
  );

  // Get default model from LLM settings
  const defaultModel = defaults.llm?.model || defaults.defaultPreset;

  // Default model missing from YAML — warn only (sync service may register it)
  if (!availableModels.has(defaultModel)) {
    result.defaultModelMissing = true;
    result.missingModels.push(defaultModel);
  }

  // WARN ONLY: Check preset models
  for (const presetKey of Object.keys(defaults.modelPresets || {})) {
    if (!availableModels.has(presetKey) && presetKey !== defaultModel) {
      result.missingModels.push(presetKey);
    }
  }

  // WARN ONLY: Check embedding model
  const embeddingModel = defaults.embedding?.model;
  if (embeddingModel && !availableModels.has(embeddingModel)) {
    result.missingModels.push(embeddingModel);
  }

  // WARN ONLY: Check transcription model
  const transcriptionModel = defaults.models?.transcription;
  if (transcriptionModel && !availableModels.has(transcriptionModel)) {
    result.missingModels.push(transcriptionModel);
  }

  return result;
}

/**
 * Format detailed error messages with guidance
 */
function formatError(
  type: 'YAML_NOT_FOUND' | 'YAML_PARSE_ERROR' | 'DEFAULT_MODEL_MISSING',
  yamlPath: string,
  model?: string,
  parseError?: unknown
): string {
  const divider = '═'.repeat(70);

  if (type === 'YAML_NOT_FOUND') {
    return `
${divider}
❌ FATAL: LiteLLM configuration file not found
${divider}

WHAT'S WRONG:
  The file 'litellm-proxy/litellm_config.yaml' does not exist.

FILE EXPECTED AT:
  ${yamlPath}

HOW TO FIX:
  1. Copy the example config:
     cp litellm-proxy/litellm_config.example.yaml litellm-proxy/litellm_config.yaml

  2. Verify models match those in config/defaults.json

REFERENCE FILES:
  - App defaults: config/defaults.json (modelPresets, llm.model)
  - LiteLLM routing: litellm-proxy/litellm_config.yaml

${divider}
`;
  }

  if (type === 'YAML_PARSE_ERROR') {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    return `
${divider}
❌ FATAL: Failed to parse LiteLLM configuration
${divider}

WHAT'S WRONG:
  The file 'litellm-proxy/litellm_config.yaml' contains invalid YAML.

FILE LOCATION:
  ${yamlPath}

PARSE ERROR:
  ${errorMsg}

HOW TO FIX:
  1. Validate YAML syntax:
     npx yaml-lint litellm-proxy/litellm_config.yaml

  2. Or restore from example:
     cp litellm-proxy/litellm_config.example.yaml litellm-proxy/litellm_config.yaml

${divider}
`;
  }

  if (type === 'DEFAULT_MODEL_MISSING') {
    return `
${divider}
❌ FATAL: Default LLM model not found in LiteLLM configuration
${divider}

WHAT'S WRONG:
  The default model '${model}' is configured in defaults.json
  but does NOT exist in litellm_config.yaml.

FILES INVOLVED:
  - Default model defined in: config/defaults.json
    → llm.model: "${model}"
    → OR defaultPreset: "${model}"

  - LiteLLM config at: ${yamlPath}
    → Missing entry for model_name: "${model}"

HOW TO FIX:

  Option 1: Add the model to litellm_config.yaml
  ─────────────────────────────────────────────
  Add an entry to model_list in litellm-proxy/litellm_config.yaml:

  - model_name: ${model}
    litellm_params:
      model: ${model}
      api_key: os.environ/OPENAI_API_KEY

  Option 2: Change the default model in defaults.json
  ─────────────────────────────────────────────────────
  Edit config/defaults.json and change 'llm.model' to a model
  that exists in litellm_config.yaml.

AVAILABLE MODELS IN YAML:
  Run: grep 'model_name:' litellm-proxy/litellm_config.yaml

${divider}
`;
  }

  return '';
}

/**
 * Log warnings for non-critical missing models
 */
export function logMissingModelsWarning(missingModels: string[]): void {
  if (missingModels.length === 0) return;

  console.warn(`[LiteLLM Validator] ${missingModels.length} preset model(s) not in YAML (may be registered by auto-sync): ${missingModels.join(', ')}`);
}

/**
 * Run validation on startup (called from db/index.ts)
 * Exits process if default model is missing
 */
export function validateLiteLLMOnStartup(): void {
  // Skip validation if not using LiteLLM proxy
  const baseUrl = process.env.OPENAI_BASE_URL || '';
  if (!baseUrl.includes('litellm') && !baseUrl.includes(':4000')) {
    return;
  }

  const result = validateLiteLLMConfig();

  // Default model missing from YAML — just log a one-liner (sync registers it)
  if (result.defaultModelMissing) {
    console.warn('[LiteLLM Validator] Default model missing from YAML — will be registered by auto-sync if enabled in DB');
  }

  // WARN ONLY: Other models missing (exclude default which was already checked)
  const nonDefaultMissing = result.missingModels.filter(
    (m) => !result.errors.some((e) => e.includes(`'${m}'`))
  );
  logMissingModelsWarning(nonDefaultMissing);
}

// ============ Model Discovery ============

/**
 * Raw model entry from litellm_config.yaml
 */
interface LiteLLMModelEntry {
  model_name: string;
  litellm_params: {
    model: string;
    api_key?: string;
    api_base?: string;
  };
  model_info?: {
    supports_function_calling?: boolean;
    supports_vision?: boolean;
    max_input_tokens?: number;
  };
}

/**
 * Parsed model with derived metadata
 */
export interface ParsedLiteLLMModel {
  id: string;              // model_name from YAML
  name: string;            // auto-generated display name
  description: string;     // auto-generated description
  provider: string;        // derived from litellm_params.model
  toolCapable: boolean;    // from model_info.supports_function_calling
  visionCapable: boolean;  // from model_info.supports_vision
  maxInputTokens?: number; // from model_info.max_input_tokens
  modelType: 'chat' | 'embedding' | 'transcription';
}

/**
 * Extract provider from LiteLLM model path
 * Examples:
 *   gemini/gemini-2.5-flash → gemini
 *   mistral/mistral-large   → mistral
 *   ollama/llama3.2         → ollama
 *   gpt-4.1-mini            → openai (default)
 */
export function getProviderFromModelPath(modelPath: string): string {
  const lowerPath = modelPath.toLowerCase();

  if (lowerPath.startsWith('gemini/')) return 'gemini';
  if (lowerPath.startsWith('mistral/')) return 'mistral';
  if (lowerPath.startsWith('ollama/')) return 'ollama';
  if (lowerPath.startsWith('azure/')) return 'azure';
  if (lowerPath.startsWith('anthropic/')) return 'anthropic';
  if (lowerPath.startsWith('fireworks/') || lowerPath.startsWith('fireworks_ai/')) return 'fireworks';

  // Default to openai for models without prefix
  return 'openai';
}

/**
 * Generate human-friendly display name from model ID
 * Examples:
 *   gpt-4.1-mini        → GPT-4.1 Mini
 *   gemini-2.5-flash    → Gemini 2.5 Flash
 *   ollama-llama3.2     → Ollama Llama 3.2
 *   mistral-small-3.2   → Mistral Small 3.2
 */
export function generateDisplayName(modelId: string): string {
  // Split by hyphens and dots, keeping version numbers together
  const parts = modelId.split(/[-.]/).filter(Boolean);

  return parts.map((part, index) => {
    // Uppercase known acronyms
    if (['gpt', 'llm', 'ai'].includes(part.toLowerCase())) {
      return part.toUpperCase();
    }
    // Keep version numbers as-is (e.g., "4.1", "2.5", "3.2")
    if (/^\d+$/.test(part)) {
      // If previous part was also a number, join with dot
      if (index > 0 && /^\d+$/.test(parts[index - 1])) {
        return '.' + part;
      }
      return part;
    }
    // Capitalize first letter of words
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ').replace(/ \./g, '.'); // Fix spacing around dots
}

/**
 * Generate description based on model characteristics
 */
function generateDescription(modelId: string, provider: string, toolCapable: boolean): string {
  const id = modelId.toLowerCase();

  // Determine tier
  let tier = '';
  if (id.includes('pro') || id.includes('large')) {
    tier = 'High-performance';
  } else if (id.includes('mini') || id.includes('flash') || id.includes('small')) {
    tier = 'Balanced';
  } else if (id.includes('nano') || id.includes('lite')) {
    tier = 'Cost-effective';
  }

  // Provider display names
  const providerNames: Record<string, string> = {
    openai: 'OpenAI',
    gemini: 'Google',
    mistral: 'Mistral AI',
    ollama: 'Local',
    azure: 'Azure',
    anthropic: 'Anthropic',
  };

  const providerLabel = providerNames[provider] || provider;
  const toolLabel = toolCapable ? ' with tool support' : '';

  if (tier) {
    return `${tier} ${providerLabel} model${toolLabel}`;
  }
  return `${providerLabel} model${toolLabel}`;
}

/**
 * Detect model type from model name
 */
function detectModelType(entry: LiteLLMModelEntry): 'chat' | 'embedding' | 'transcription' {
  const id = entry.model_name.toLowerCase();
  const model = entry.litellm_params.model.toLowerCase();

  if (id.includes('embed') || model.includes('embed')) return 'embedding';
  if (id.includes('whisper') || model.includes('whisper') ||
      id.includes('voxtral') || model.includes('voxtral')) return 'transcription';
  return 'chat';
}

// Cache for parsed models (cleared on restart)
let _parsedModelsCache: ParsedLiteLLMModel[] | null = null;

/**
 * Parse LiteLLM config and return all models with metadata
 * Results are cached for the lifetime of the process
 */
export function parseLiteLLMModels(): ParsedLiteLLMModel[] {
  if (_parsedModelsCache) {
    return _parsedModelsCache;
  }

  const yamlPath = path.join(
    process.cwd(),
    'litellm-proxy',
    'litellm_config.yaml'
  );

  // Return empty array if YAML doesn't exist (fallback to hardcoded)
  if (!fs.existsSync(yamlPath)) {
    return [];
  }

  try {
    const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
    const litellmConfig = yaml.parse(yamlContent) as {
      model_list?: LiteLLMModelEntry[];
    };

    if (!litellmConfig.model_list || !Array.isArray(litellmConfig.model_list)) {
      return [];
    }

    const parsedModels: ParsedLiteLLMModel[] = litellmConfig.model_list.map((entry) => {
      const provider = getProviderFromModelPath(entry.litellm_params.model);
      const toolCapable = entry.model_info?.supports_function_calling ?? false;

      return {
        id: entry.model_name,
        name: generateDisplayName(entry.model_name),
        description: generateDescription(entry.model_name, provider, toolCapable),
        provider,
        toolCapable,
        visionCapable: entry.model_info?.supports_vision ?? false,
        maxInputTokens: entry.model_info?.max_input_tokens,
        modelType: detectModelType(entry),
      };
    });

    _parsedModelsCache = parsedModels;
    console.log(`[LiteLLM] Discovered ${parsedModels.length} models from YAML config`);

    return parsedModels;
  } catch (error) {
    console.warn('[LiteLLM] Failed to parse config for model discovery:', error);
    return [];
  }
}

/**
 * Get only chat models (excludes embedding and transcription)
 * This is the main function used by config-loader.ts
 */
export function getLiteLLMChatModels(): ParsedLiteLLMModel[] {
  return parseLiteLLMModels().filter(m => m.modelType === 'chat');
}

/**
 * Get tool-capable model IDs from LiteLLM config
 */
export function getLiteLLMToolCapableModels(): Set<string> {
  const models = parseLiteLLMModels();
  return new Set(
    models
      .filter(m => m.toolCapable)
      .map(m => m.id)
  );
}

/**
 * Clear the parsed models cache (useful for testing)
 */
export function clearLiteLLMCache(): void {
  _parsedModelsCache = null;
}
