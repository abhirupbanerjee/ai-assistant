/**
 * Agent Model Configuration Database Operations
 *
 * Manages storage and retrieval of LLM model configurations for autonomous mode agents
 */

import { getSetting, setSetting } from './config';

export interface AgentModelConfig {
  provider: 'openai' | 'gemini' | 'mistral';
  model: string;
  temperature: number;
  max_tokens?: number;
}

export interface StoredAgentModelConfigs {
  planner: AgentModelConfig;
  executor: AgentModelConfig;
  checker: AgentModelConfig;
  summarizer: AgentModelConfig;
}

// Default configurations (used when no custom config exists)
const DEFAULT_CONFIGS: StoredAgentModelConfigs = {
  planner: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.3,
    max_tokens: 8192, // Planner needs large output for per-item task lists
  },
  executor: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    temperature: 0.4,
    max_tokens: 4096,
  },
  checker: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    temperature: 0.2,
    max_tokens: 2048, // Checker outputs are small
  },
  summarizer: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    temperature: 0.5,
    max_tokens: 4096,
  },
};

/**
 * Get agent model configurations from database
 * Merges stored configs with defaults to ensure all fields (including max_tokens) are present
 */
export function getAgentModelConfigs(): StoredAgentModelConfigs {
  try {
    const plannerJson = getSetting('agent_model_planner', '');
    const executorJson = getSetting('agent_model_executor', '');
    const checkerJson = getSetting('agent_model_checker', '');
    const summarizerJson = getSetting('agent_model_summarizer', '');

    // Merge stored configs with defaults to ensure max_tokens is always present
    // Order: defaults first, then stored values override (except max_tokens which uses default if not stored)
    const mergeConfig = (stored: string, defaults: AgentModelConfig): AgentModelConfig => {
      if (!stored) return defaults;
      const parsed = JSON.parse(stored);
      return {
        ...defaults,           // Start with defaults (includes max_tokens)
        ...parsed,             // Override with stored values
        max_tokens: parsed.max_tokens ?? defaults.max_tokens, // Ensure max_tokens has a value
      };
    };

    return {
      planner: mergeConfig(plannerJson, DEFAULT_CONFIGS.planner),
      executor: mergeConfig(executorJson, DEFAULT_CONFIGS.executor),
      checker: mergeConfig(checkerJson, DEFAULT_CONFIGS.checker),
      summarizer: mergeConfig(summarizerJson, DEFAULT_CONFIGS.summarizer),
    };
  } catch (error) {
    console.error('[Agent Config] Error loading model configs:', error);
    return DEFAULT_CONFIGS;
  }
}

/**
 * Save agent model configurations to database
 */
export function setAgentModelConfigs(
  configs: StoredAgentModelConfigs,
  updatedBy: string
): void {
  setSetting('agent_model_planner', JSON.stringify(configs.planner), updatedBy);
  setSetting('agent_model_executor', JSON.stringify(configs.executor), updatedBy);
  setSetting('agent_model_checker', JSON.stringify(configs.checker), updatedBy);
  setSetting('agent_model_summarizer', JSON.stringify(configs.summarizer), updatedBy);
}

/**
 * Validate agent model configuration
 */
export function validateAgentModelConfig(config: AgentModelConfig): boolean {
  if (!config.provider || !['openai', 'gemini', 'mistral'].includes(config.provider)) {
    return false;
  }
  if (!config.model || config.model.trim() === '') {
    return false;
  }
  if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
    return false;
  }
  return true;
}

// ============ Streaming Configuration ============

export interface StreamingConfig {
  keepalive_interval_seconds: number;
  max_stream_duration_seconds: number;
  tool_timeout_seconds: number;
}

const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  keepalive_interval_seconds: 10,
  max_stream_duration_seconds: 300,
  tool_timeout_seconds: 60,
};

/**
 * Get streaming configuration from database
 */
export function getStreamingConfig(): StreamingConfig {
  return {
    keepalive_interval_seconds: parseInt(
      getSetting('streaming_keepalive_interval', String(DEFAULT_STREAMING_CONFIG.keepalive_interval_seconds)),
      10
    ),
    max_stream_duration_seconds: parseInt(
      getSetting('streaming_max_duration', String(DEFAULT_STREAMING_CONFIG.max_stream_duration_seconds)),
      10
    ),
    tool_timeout_seconds: parseInt(
      getSetting('streaming_tool_timeout', String(DEFAULT_STREAMING_CONFIG.tool_timeout_seconds)),
      10
    ),
  };
}

/**
 * Save streaming configuration to database
 */
export function setStreamingConfig(config: StreamingConfig, updatedBy: string): void {
  setSetting('streaming_keepalive_interval', String(config.keepalive_interval_seconds), updatedBy);
  setSetting('streaming_max_duration', String(config.max_stream_duration_seconds), updatedBy);
  setSetting('streaming_tool_timeout', String(config.tool_timeout_seconds), updatedBy);
}
