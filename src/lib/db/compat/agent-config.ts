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

  // Build default configs
  const geminiModel =
    presets['gemini-2.5-flash']
      ? 'gemini-2.5-flash'
      : Object.keys(presets).find((id) => id.includes('gemini')) || defaultModel;

  const geminiProvider = presets[geminiModel]?.provider || 'gemini';
  const defaultProvider = presets[defaultModel]?.provider || 'openai';

  const defaultConfigs: StoredAgentModelConfigs = {
    planner: {
      provider: geminiProvider as 'openai' | 'gemini' | 'mistral',
      model: geminiModel,
      temperature: 0.3,
      max_tokens: 8192,
    },
    executor: {
      provider: defaultProvider as 'openai' | 'gemini' | 'mistral',
      model: defaultModel,
      temperature: 0.4,
      max_tokens: 4096,
    },
    checker: {
      provider: defaultProvider as 'openai' | 'gemini' | 'mistral',
      model: defaultModel,
      temperature: 0.2,
      max_tokens: 2048,
    },
    summarizer: {
      provider: defaultProvider as 'openai' | 'gemini' | 'mistral',
      model: defaultModel,
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
