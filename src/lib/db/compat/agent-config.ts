/**
 * Agent Config Compatibility Layer
 *
 * Uses Kysely/PostgreSQL via the config compat layer.
 */

import { getSetting, setSetting } from './config';
import { validateAgentModelConfig as validateModelConfig } from '../utils';

// ============================================================================
// Re-export types
// ============================================================================

export type { AgentModelConfig, StoredAgentModelConfigs, StreamingConfig } from '../agent-config';

import type { AgentModelConfig, StoredAgentModelConfigs, StreamingConfig } from '../agent-config';

// Re-export pure validation function (no DB access)
export { validateAgentModelConfig } from '../utils';

export type ExecutorProfileName =
  | 'default'
  | 'fast_low_cost'
  | 'deep_reasoning'
  | 'long_context'
  | 'artifact_generation'
  | 'local_private'
  | 'agentic_tool_loop'
  | 'code_generation'
  | 'multilingual';

export interface ExecutorModelProfiles {
  default: AgentModelConfig;
  fast_low_cost?: AgentModelConfig;
  deep_reasoning?: AgentModelConfig;
  long_context?: AgentModelConfig;
  artifact_generation?: AgentModelConfig;
  local_private?: AgentModelConfig;
  agentic_tool_loop?: AgentModelConfig;
  code_generation?: AgentModelConfig;
  multilingual?: AgentModelConfig;
}

const EXECUTOR_PROFILE_KEYS: ExecutorProfileName[] = [
  'default',
  'fast_low_cost',
  'deep_reasoning',
  'long_context',
  'artifact_generation',
  'local_private',
  'agentic_tool_loop',
  'code_generation',
  'multilingual',
];

function sanitizeModelSpec(value: unknown): AgentModelConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as AgentModelConfig;
  return validateModelConfig(candidate) ? candidate : undefined;
}

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
      : presets['fireworks/minimax-m2p7']
        ? 'fireworks/minimax-m2p7'
        : presets['fireworks/kimi-k2p5']
          ? 'fireworks/kimi-k2p5'
          : defaultModel;

  const checkerModel =
    presets['gpt-4.1-mini']
      ? 'gpt-4.1-mini'
      : defaultModel;

  const mapProvider = (model: string): 'openai' | 'gemini' | 'mistral' | 'anthropic' | 'fireworks' | 'deepseek' | 'ollama' | 'ollama-cloud' | 'moonshot' => {
    const provider = presets[model]?.provider;
    if (provider === 'gemini' || provider === 'google') return 'gemini';
    if (provider === 'mistral') return 'mistral';
    if (provider === 'anthropic') return 'anthropic';
    if (provider === 'fireworks') return 'fireworks';
    if (provider === 'deepseek') return 'deepseek';
    if (provider === 'ollama') return 'ollama';
    if (provider === 'ollama-cloud') return 'ollama-cloud';
    if (provider === 'moonshot') return 'moonshot';
    return 'openai'; // OpenAI and other providers route directly
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
        thinking_enabled: typeof parsed.thinking_enabled === 'boolean' ? parsed.thinking_enabled : defaults.thinking_enabled ?? false,
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

/**
 * Get executor model profiles from database.
 * Backward-compatible: if no profiles are stored, return only `default`
 * using the currently configured executor model.
 */
export async function getExecutorModelProfiles(
  defaultExecutor?: AgentModelConfig
): Promise<ExecutorModelProfiles> {
  const fallbackDefault = defaultExecutor || (await getAgentModelConfigs()).executor;
  const raw = await getSetting('agent_executor_model_profiles', '');
  if (!raw) return { default: fallbackDefault };

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profiles: Partial<ExecutorModelProfiles> = {};

    for (const key of EXECUTOR_PROFILE_KEYS) {
      const value = sanitizeModelSpec(parsed[key]);
      if (value) {
        profiles[key] = value;
      }
    }

    return {
      ...profiles,
      default: profiles.default || fallbackDefault,
    } as ExecutorModelProfiles;
  } catch (error) {
    console.warn('[Agent Config] Failed to parse executor profiles, using default only:', error);
    return { default: fallbackDefault };
  }
}

/**
 * Save executor model profiles to database.
 * Requires a valid `default` profile and validates all optional profiles.
 */
export async function setExecutorModelProfiles(
  profiles: ExecutorModelProfiles,
  updatedBy: string
): Promise<ExecutorModelProfiles> {
  const defaultProfile = sanitizeModelSpec(profiles.default);
  if (!defaultProfile) {
    throw new Error('Invalid default executor profile');
  }

  const sanitized: ExecutorModelProfiles = {
    default: defaultProfile,
  };

  for (const key of EXECUTOR_PROFILE_KEYS) {
    if (key === 'default') continue;
    const rawProfile = profiles[key];
    if (rawProfile === undefined || rawProfile === null) continue;

    const candidate = sanitizeModelSpec(rawProfile);
    if (!candidate) {
      throw new Error(`Invalid executor profile: ${key}`);
    }

    if (candidate) {
      sanitized[key] = candidate;
    }
  }

  await setSetting('agent_executor_model_profiles', JSON.stringify(sanitized), updatedBy);
  return sanitized;
}

// ============================================================================
// Default Prompt Fallbacks (inlined to avoid circular dynamic imports)
//
// Canonical defaults live in each agent module (DEFAULT_*_SYSTEM_PROMPT exports).
// These are copies used ONLY when no DB-stored prompt exists.
// Inlining them here breaks the circular dependency chain that crashes
// Turbopack production builds: agent-module → agent-config → agent-module.
// ============================================================================

const FALLBACK_SUMMARIZER_PROMPT = `You are a content consolidation agent. You compile task results into a single, cohesive response that directly answers the user's original request.

Key principles:
- Present the ACTUAL CONTENT and FINDINGS from task results — not commentary about how well the tasks ran
- Structure the output as if YOU are answering the user's original question directly
- Include all data, links, files, and key information from task results
- If tasks produced downloadable files or links (documents, spreadsheets, presentations, images, diagrams, podcasts), list them clearly
- Include useful content from tasks marked for review when it helps answer the user, but do not expose confidence scores or execution internals
- Only mention missing, failed, or skipped outputs briefly and naturally when relevant
- Write as a direct answer, not as a plan execution report
- Do NOT mention task IDs, executor profiles, model names, token usage, budget usage, confidence scores, or retry details

Output your response in markdown format.`;

const FALLBACK_PLANNER_PROMPT = `You are an expert task planner. You break down complex requests into structured, executable task plans.

Before generating the JSON plan, analyze the request step by step:
1. DOMAIN: What domain is this? (policy, security, finance, technology, comparison, architecture, code analysis, etc.)
2. ENTITIES: What specific items/entities are mentioned or implied?
3. SCOPE: Is this per-item (separate outputs) or consolidated (single output)?
4. DATA SOURCE: Is data provided by user, in conversation history, in the knowledge base, or does it need web search?
5. OUTPUTS: What deliverables are expected? (report, chart, presentation, diagram, spreadsheet, etc.)
6. COMPLEXITY: Simple (≤3 tasks) or complex (requires analysis chains)?

Then generate the JSON plan.

Key principles:
- Create clear, specific tasks with measurable outcomes
- Define proper dependencies (no circular references)
- Use explicit tool types (document, image, chart, spreadsheet, presentation, podcast, diagram) when a specific output format is needed — do NOT use "generate" when a tool type applies
- Look for data in BOTH the user message AND recent conversation history
- CRITICAL: Do NOT create search tasks when the user has provided the data in their message. If the user lists items, features, or content, use "extract" to capture it. Web search is ONLY for finding NEW information not in the user's message or conversation history.
- For per-item requests ("for each", "individual", "separate"): create separate tasks per item (up to 50 tasks)
- For consolidated requests: keep plans concise (3-10 tasks)
- For multi-item analysis, always include a synthesize or summarize task at the end
- Include expected_output for each task — a one-line description of what good output looks like
- Ensure logical execution order
- If available skills are listed in the context, tag each task with applicable skill IDs by including a "skill_ids" array. Only tag skills whose keywords or description match the specific task. Use an empty array if no skills apply.
- If available tools are listed in the context, set "tool_name" only when a task directly maps to a specific tool.
- When executor model profiles are listed in context, assign "executor_profile" to each task based on task requirements and available enabled profiles.
- Use "artifact_generation" for document/image/chart/spreadsheet/presentation/podcast/diagram tasks, "deep_reasoning" for complex analysis/comparison/validation, "long_context" when many dependencies or large context are required, "fast_low_cost" for extraction/search/summarization/simple transformations, and "local_private" only for sensitive workloads that require local/private execution.
- Add "executor_profile_reason" when selecting a non-default profile. If no listed profile clearly fits, use "default".

Output valid JSON matching the schema provided.`;

const FALLBACK_EXECUTOR_PROMPT = `You are a task execution agent. You complete specific tasks as part of a larger plan.

Key principles:
- Follow the task type and description precisely
- Respect the assigned executor_profile intent when present, but focus on completing the task with the provided model
- Provide clear, actionable results
- Reference dependent task results when relevant
- Be concise but thorough
- If information is missing, explain what's needed
- For generated artifacts, make file names and download links clearly visible in the result
- Do NOT include conversational follow-ups like "If you want, I can...", "Would you like me to...", "Let me know if...", or similar offers. Your output will be consolidated with other task results — follow-up questions break the final response flow.

Output your result directly without JSON formatting.`;

const FALLBACK_CHECKER_PROMPT = `You are a quality checker. Evaluate task results objectively and return strict JSON.

Key principles:
- Score confidence on a 0-100 scale, where 100 means the task fully satisfies the expected output
- Evaluate completeness, accuracy, relevance, and clarity against the task description and expected_output
- Be threshold-aware: results below the configured threshold will require review or retry
- Do not inflate confidence when the result is vague, incomplete, unsupported, or fails to match the requested format
- Never approve by implication; if uncertain, lower the confidence and explain the specific gap
- Keep notes concise and actionable for retry/review

Output JSON only with "confidence" and "notes".`;

// ============================================================================
// Summarizer System Prompt (configurable)
// ============================================================================

export async function getSummarizerSystemPrompt(): Promise<string> {
  const stored = await getSetting('agent_summarizer_system_prompt', '');
  return stored || FALLBACK_SUMMARIZER_PROMPT;
}

export async function setSummarizerSystemPrompt(prompt: string, updatedBy: string): Promise<void> {
  await setSetting('agent_summarizer_system_prompt', prompt, updatedBy);
}

// ============================================================================
// Planner System Prompt (configurable)
// ============================================================================

export async function getPlannerSystemPrompt(): Promise<string> {
  const stored = await getSetting('agent_planner_system_prompt', '');
  return stored || FALLBACK_PLANNER_PROMPT;
}

export async function setPlannerSystemPrompt(prompt: string, updatedBy: string): Promise<void> {
  await setSetting('agent_planner_system_prompt', prompt, updatedBy);
}

// ============================================================================
// Executor System Prompt (configurable)
// ============================================================================

export async function getExecutorSystemPrompt(): Promise<string> {
  const stored = await getSetting('agent_executor_system_prompt', '');
  return stored || FALLBACK_EXECUTOR_PROMPT;
}

export async function setExecutorSystemPrompt(prompt: string, updatedBy: string): Promise<void> {
  await setSetting('agent_executor_system_prompt', prompt, updatedBy);
}

// ============================================================================
// Checker System Prompt (configurable)
// ============================================================================

export async function getCheckerSystemPrompt(): Promise<string> {
  const stored = await getSetting('agent_checker_system_prompt', '');
  return stored || FALLBACK_CHECKER_PROMPT;
}

export async function setCheckerSystemPrompt(prompt: string, updatedBy: string): Promise<void> {
  await setSetting('agent_checker_system_prompt', prompt, updatedBy);
}

// ============================================================================
// Autonomous Mode Toggle (admin-controlled)
// ============================================================================

/**
 * Check if autonomous mode is enabled globally
 */
export async function getAutonomousModeEnabled(): Promise<boolean> {
  const val = await getSetting('agent_autonomous_enabled', 'true');
  return val === 'true';
}

/**
 * Enable or disable autonomous mode globally
 */
export async function setAutonomousModeEnabled(
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  await setSetting('agent_autonomous_enabled', String(enabled), updatedBy);
}

// ============================================================================
// Subagent Configuration
// ============================================================================

export interface SubagentConfig {
  enabled: boolean;
  defaultOn: boolean;
  maxIterations: number;
  budgetRatio: number;
  hitlEnabled: boolean;
}

const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  enabled: false,
  defaultOn: false,
  maxIterations: 5,
  budgetRatio: 25,
  hitlEnabled: true,
};

/**
 * Get subagent configuration from database
 */
export async function getSubagentConfig(): Promise<SubagentConfig> {
  try {
    const enabled = (await getSetting('agent_subagent_enabled', 'false')) === 'true';
    const defaultOn = (await getSetting('agent_subagent_default_on', 'false')) === 'true';
    const maxIterations = parseInt(await getSetting('agent_subagent_max_iterations', '5'), 10);
    const budgetRatio = parseInt(await getSetting('agent_subagent_budget_ratio', '25'), 10);
    const hitlEnabled = (await getSetting('agent_subagent_hitl_enabled', 'true')) === 'true';

    return {
      enabled,
      defaultOn,
      maxIterations: Number.isNaN(maxIterations) ? 5 : Math.max(1, Math.min(20, maxIterations)),
      budgetRatio: Number.isNaN(budgetRatio) ? 25 : Math.max(1, Math.min(100, budgetRatio)),
      hitlEnabled,
    };
  } catch (error) {
    console.error('[Agent Config] Error loading subagent config:', error);
    return DEFAULT_SUBAGENT_CONFIG;
  }
}

/**
 * Save subagent configuration to database
 */
export async function setSubagentConfig(
  config: SubagentConfig,
  updatedBy: string
): Promise<void> {
  await setSetting('agent_subagent_enabled', String(config.enabled), updatedBy);
  await setSetting('agent_subagent_default_on', String(config.defaultOn), updatedBy);
  await setSetting('agent_subagent_max_iterations', String(config.maxIterations), updatedBy);
  await setSetting('agent_subagent_budget_ratio', String(config.budgetRatio), updatedBy);
  await setSetting('agent_subagent_hitl_enabled', String(config.hitlEnabled), updatedBy);
}

/**
 * Check if working memory (cross-wave plan memory) is enabled.
 * Gated behind agent_working_memory_enabled setting. Defaults to false.
 */
export async function isWorkingMemoryEnabled(): Promise<boolean> {
  return (await getSetting('agent_working_memory_enabled', 'false')) === 'true';
}
