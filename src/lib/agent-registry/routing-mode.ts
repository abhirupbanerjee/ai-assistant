/**
 * Routing Mode Mapper — Phase 2.2 eval harness support
 *
 * A pure, side-effect-free function that maps an LLM tool-call name to one of
 * the three single-agent routing modes defined in
 * plans/agent_system_architecture___implementation_plan.md §3.3:
 *
 *   - `solo`          → no tool call; the model answers directly.
 *   - `return_result` → the model called an `agent__<id>` tool (agent-as-tool).
 *   - `handoff`       → the model called `handoff_to_category`.
 *
 * This mapper is the deterministic core that the eval harness
 * (`eval/routing.ts`) tests in `:mock` mode. Keeping it pure (no DB, no LLM)
 * means the `:mock` run is deterministic, free, and CI-safe. The stream route
 * (`src/app/api/chat/stream/route.ts`) performs the equivalent classification
 * implicitly via `processToolResult`'s `isAgentTool` / `handoff_to_category`
 * branches; this module makes that classification explicit and testable.
 */
export type RoutingMode = 'solo' | 'return_result' | 'handoff';

/**
 * Prefix for agent-as-tool function names (see `agent-tools.ts`).
 */
export const AGENT_TOOL_PREFIX = 'agent__';

/**
 * The static tool name that triggers a category handoff.
 */
export const HANDOFF_TOOL_NAME = 'handoff_to_category';

/**
 * Classify a tool-call name into a routing mode.
 *
 * @param toolCallName - The function name the LLM invoked, or null/undefined
 *   if no tool was called.
 * @returns The routing mode. `solo` when no tool was called or the call is to
 *   an unrecognized non-agent tool (treated as an in-turn assist, not
 *   delegation); `return_result` for `agent__*`; `handoff` for
 *   `handoff_to_category`.
 */
export function determineRoutingMode(
  toolCallName: string | null | undefined
): RoutingMode {
  if (!toolCallName) return 'solo';
  if (toolCallName === HANDOFF_TOOL_NAME) return 'handoff';
  if (toolCallName.startsWith(AGENT_TOOL_PREFIX)) return 'return_result';
  // Any other tool (web_search, create_document, etc.) is an in-turn assist,
  // not agent delegation — the model still produces the final answer itself.
  return 'solo';
}

/**
 * Extract the agent id from an `agent__<id>` tool name.
 * @returns The agent id, or null if the name is not an agent tool.
 */
export function agentIdFromToolName(toolCallName: string): string | null {
  if (!toolCallName.startsWith(AGENT_TOOL_PREFIX)) return null;
  return toolCallName.slice(AGENT_TOOL_PREFIX.length);
}
