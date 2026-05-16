/**
 * Agent Swarm Compatibility Layer
 *
 * Uses Kysely/PostgreSQL via the config compat layer.
 */

import { getSetting, setSetting } from './config';

export interface AgentSwarmSettings {
  enabled: boolean;
  model: string;
  maxTokens: number;
  temperature: number; // Locked to 1.0 for K2.6 thinking mode
  systemPrompt: string;
}

const DEFAULT_SWARM_SETTINGS: AgentSwarmSettings = {
  enabled: false,
  model: 'kimi-k2.6',
  maxTokens: 32768,
  temperature: 1.0,
  systemPrompt: `You are Kimi K2.6, an advanced AI assistant with agent swarm capabilities. 
You can decompose complex tasks into parallel subtasks and coordinate multiple 
specialized agents to solve problems efficiently. You have access to tools for 
web search, document generation, data visualization, and code execution.

When given a task:
1. Analyze the request and break it into subtasks
2. Use available tools as needed
3. Synthesize results into a clear, actionable response`,
};

/**
 * Check if agent swarm mode is enabled globally
 */
export async function getAgentSwarmEnabled(): Promise<boolean> {
  const val = await getSetting('agent_swarm_enabled', 'false');
  return val === 'true';
}

/**
 * Enable or disable agent swarm mode globally
 */
export async function setAgentSwarmEnabled(
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  await setSetting('agent_swarm_enabled', String(enabled), updatedBy);
}

/**
 * Get full agent swarm settings from database
 */
export async function getAgentSwarmSettings(): Promise<AgentSwarmSettings> {
  try {
    const enabled = await getSetting('agent_swarm_enabled', 'false') === 'true';
    const model = await getSetting('agent_swarm_model', DEFAULT_SWARM_SETTINGS.model);
    const maxTokens = parseInt(await getSetting('agent_swarm_max_tokens', String(DEFAULT_SWARM_SETTINGS.maxTokens)), 10);
    const temperature = parseFloat(await getSetting('agent_swarm_temperature', String(DEFAULT_SWARM_SETTINGS.temperature)));
    const systemPrompt = await getSetting('agent_swarm_system_prompt', DEFAULT_SWARM_SETTINGS.systemPrompt);

    return {
      enabled,
      model: typeof model === 'string' ? model : DEFAULT_SWARM_SETTINGS.model,
      maxTokens: isNaN(maxTokens) ? DEFAULT_SWARM_SETTINGS.maxTokens : maxTokens,
      temperature: isNaN(temperature) ? DEFAULT_SWARM_SETTINGS.temperature : temperature,
      systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : DEFAULT_SWARM_SETTINGS.systemPrompt,
    };
  } catch (error) {
    console.error('[Agent Swarm Config] Error loading settings:', error);
    return { ...DEFAULT_SWARM_SETTINGS };
  }
}

/**
 * Save agent swarm settings to database
 */
export async function setAgentSwarmSettings(
  settings: Partial<AgentSwarmSettings>,
  updatedBy: string
): Promise<void> {
  if (settings.enabled !== undefined) {
    await setSetting('agent_swarm_enabled', String(settings.enabled), updatedBy);
  }
  if (settings.model !== undefined) {
    await setSetting('agent_swarm_model', settings.model, updatedBy);
  }
  if (settings.maxTokens !== undefined) {
    await setSetting('agent_swarm_max_tokens', String(settings.maxTokens), updatedBy);
  }
  if (settings.temperature !== undefined) {
    await setSetting('agent_swarm_temperature', String(settings.temperature), updatedBy);
  }
  if (settings.systemPrompt !== undefined) {
    await setSetting('agent_swarm_system_prompt', settings.systemPrompt, updatedBy);
  }
}
