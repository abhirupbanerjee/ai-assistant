/**
 * Agent Config Compatibility Layer
 *
 * Uses Kysely/PostgreSQL via the config compat layer.
 */

import { getSetting, setSetting } from './config';

// ============================================================================
// Re-export types
// ============================================================================

export type { AgentModelConfig, StoredAgentModelConfigs, StreamingConfig } from '../agent-config';

import type { AgentModelConfig, StoredAgentModelConfigs, StreamingConfig } from '../agent-config';

// Re-export pure validation function (no DB access)
export { validateAgentModelConfig } from '../utils';

// ============================================================================
// Streaming Configuration
// ============================================================================

const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  keepalive_interval_seconds: 10,
  max_stream_duration_seconds: 300,
  tool_timeout_seconds: 120,
};

/**
 * Get streaming configuration from database
 */
export async function getStreamingConfig(): Promise<StreamingConfig> {
  const keepalive = await getSetting(
    'streaming_keepalive_interval',
    String(DEFAULT_STREAMING_CONFIG.keepalive_interval_seconds)
  );
  const maxDuration = await getSetting(
    'streaming_max_duration',
    String(DEFAULT_STREAMING_CONFIG.max_stream_duration_seconds)
  );
  const toolTimeout = await getSetting(
    'streaming_tool_timeout',
    String(DEFAULT_STREAMING_CONFIG.tool_timeout_seconds)
  );

  return {
    keepalive_interval_seconds: parseInt(keepalive, 10),
    max_stream_duration_seconds: parseInt(maxDuration, 10),
    tool_timeout_seconds: parseInt(toolTimeout, 10),
  };
}

/**
 * Save streaming configuration to database
 */
export async function setStreamingConfig(
  config: StreamingConfig,
  updatedBy: string
): Promise<void> {
  await setSetting(
    'streaming_keepalive_interval',
    String(config.keepalive_interval_seconds),
    updatedBy
  );
  await setSetting(
    'streaming_max_duration',
    String(config.max_stream_duration_seconds),
    updatedBy
  );
  await setSetting(
    'streaming_tool_timeout',
    String(config.tool_timeout_seconds),
    updatedBy
  );
}

// ============================================================================
// Agent Model Configuration
// ============================================================================

/**
 * Get agent model configurations from database
 */
export async function getAgentModelConfigs(): Promise<StoredAgentModelConfigs> {
  // Import config-loader for defaults
  const { getDefaultLLMModel, getModelPresetsFromConfig } = await import(
    '../../config-loader'
  );

  const defaultModel = getDefaultLLMModel();
  const presets = getModelPresetsFromConfig();

  // Build default configs with role-optimized model selection
  // Planner: prefer claude-sonnet-4-6 (best instruction following + JSON reliability)
  // Executor: prefer fireworks/minimax-m2p5 (80.2% SWE-bench, built for agentic workloads)
  // Checker/Summarizer: prefer gpt-4.1-mini (sufficient for classification/summary)
  const plannerModel =
    presets['claude-sonnet-4-6']
      ? 'claude-sonnet-4-6'
      : presets['gemini-2.5-pro']
        ? 'gemini-2.5-pro'
        : presets['gemini-2.5-flash']
          ? 'gemini-2.5-flash'
          : defaultModel;

  const executorModel =
    presets['fireworks/minimax-m2p5']
      ? 'fireworks/minimax-m2p5'
      : presets['fireworks/deepseek-v3p2']
        ? 'fireworks/deepseek-v3p2'
        : presets['fireworks/kimi-k2p5']
          ? 'fireworks/kimi-k2p5'
          : defaultModel;

  const checkerModel =
    presets['gpt-4.1-mini']
      ? 'gpt-4.1-mini'
      : defaultModel;

  const mapProvider = (model: string): 'openai' | 'gemini' | 'mistral' => {
    const provider = presets[model]?.provider;
    if (provider === 'gemini' || provider === 'google') return 'gemini';
    if (provider === 'mistral') return 'mistral';
    return 'openai'; // OpenAI, Anthropic, Fireworks all route through LiteLLM
  };

  const defaultConfigs: StoredAgentModelConfigs = {
    planner: {
      provider: mapProvider(plannerModel),
      model: plannerModel,
      temperature: 0.3,
      max_tokens: 8192,
    },
    executor: {
      provider: mapProvider(executorModel),
      model: executorModel,
      temperature: 0.4,
      max_tokens: 4096,
    },
    checker: {
      provider: mapProvider(checkerModel),
      model: checkerModel,
      temperature: 0.2,
      max_tokens: 2048,
    },
    summarizer: {
      provider: mapProvider(checkerModel),
      model: checkerModel,
      temperature: 0.5,
      max_tokens: 4096,
    },
  };

  try {
    const plannerJson = await getSetting('agent_model_planner', '');
    const executorJson = await getSetting('agent_model_executor', '');
    const checkerJson = await getSetting('agent_model_checker', '');
    const summarizerJson = await getSetting('agent_model_summarizer', '');

    const mergeConfig = (
      stored: string,
      defaults: AgentModelConfig
    ): AgentModelConfig => {
      if (!stored) return defaults;
      const parsed = JSON.parse(stored);
      return {
        ...defaults,
        ...parsed,
        max_tokens: parsed.max_tokens ?? defaults.max_tokens,
      };
    };

    return {
      planner: mergeConfig(plannerJson, defaultConfigs.planner),
      executor: mergeConfig(executorJson, defaultConfigs.executor),
      checker: mergeConfig(checkerJson, defaultConfigs.checker),
      summarizer: mergeConfig(summarizerJson, defaultConfigs.summarizer),
    };
  } catch (error) {
    console.error('[Agent Config] Error loading model configs:', error);
    return defaultConfigs;
  }
}

/**
 * Save agent model configurations to database
 */
export async function setAgentModelConfigs(
  configs: StoredAgentModelConfigs,
  updatedBy: string
): Promise<void> {
  await setSetting('agent_model_planner', JSON.stringify(configs.planner), updatedBy);
  await setSetting('agent_model_executor', JSON.stringify(configs.executor), updatedBy);
  await setSetting('agent_model_checker', JSON.stringify(configs.checker), updatedBy);
  await setSetting('agent_model_summarizer', JSON.stringify(configs.summarizer), updatedBy);
}

// ============================================================================
// Summarizer System Prompt (configurable)
// ============================================================================

/**
 * Get the summarizer system prompt from database, falling back to hardcoded default
 */
export async function getSummarizerSystemPrompt(): Promise<string> {
  const { DEFAULT_SUMMARIZER_SYSTEM_PROMPT } = await import('../../agent/summarizer');
  const stored = await getSetting('agent_summarizer_system_prompt', '');
  return stored || DEFAULT_SUMMARIZER_SYSTEM_PROMPT;
}

/**
 * Save a custom summarizer system prompt to database
 */
export async function setSummarizerSystemPrompt(
  prompt: string,
  updatedBy: string
): Promise<void> {
  await setSetting('agent_summarizer_system_prompt', prompt, updatedBy);
}
