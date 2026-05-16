/**
 * Agent Swarm Module
 *
 * Moonshot Kimi K2.6-based agent swarm execution.
 */

export { executeSwarmWithStreaming } from './moonshot-swarm';
export type { SwarmExecutionOptions, SwarmExecutionResult } from './moonshot-swarm';

export { checkMoonshotCapabilities } from './capability-check';
export type { MoonshotCapabilityResult } from './capability-check';

export { getSwarmTools, executeSwarmToolCall } from './tool-adapter';
export type { AdaptedTool } from './tool-adapter';
