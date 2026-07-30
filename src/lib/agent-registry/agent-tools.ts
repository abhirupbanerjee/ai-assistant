/**
 * Agent-as-Tool Bridge — Expose Registry Agents as OpenAI Function Tools
 *
 * Phase 2.1 of the agent system architecture (see
 * plans/agent_system_architecture___implementation_plan.md §3.3, §6 "Tools
 * registry: Agent-as-tool invocation metadata").
 *
 * Registered agents are DB-driven and category-scoped, so they cannot live in
 * the static `AVAILABLE_TOOLS` record in `src/lib/tools.ts`. Instead —
 * mirroring the dynamic `function_api` pattern — this module generates
 * OpenAI function-tool definitions at runtime from the agent registry and
 * dispatches tool calls back through `invokeAgent()`.
 *
 * Three exports form the contract with the chat runtime (Phase 2.2 wiring):
 *
 *   - `getAgentToolDefinitions(categoryId?)` → OpenAI function tools, one per
 *     enabled agent (filtered by category when provided). The stream route
 *     merges these with the static tool list before calling the LLM.
 *   - `isAgentTool(name)` → predicate; `executeTool` in tools.ts will check
 *     this before its static-tool lookup so agent tool calls route here.
 *   - `executeAgentTool(name, args)` → runs the agent via `invokeAgent` and
 *     returns a JSON string (the contract envelope) for the LLM to consume.
 *
 * Tool-name convention: `agent__<agentId>` (double underscore separator to
 * avoid collisions with real tool names, which use single underscores). The
 * agent id is constrained to `[a-z0-9_-]` by the admin UI, so the tool name
 * is always a valid OpenAI function name (`[a-zA-Z0-9_-]+`, ≤64 chars).
 */

import type { OpenAI } from 'openai';
import { listEnabledAgents, getAgentsForCategory, getAgentById, type AgentRecord, type AgentRoleFamily } from '@/lib/db/compat/agents';
import { invokeAgent } from './invoker';
import { logger } from '@/lib/logger';

// ============ Constants ============

/** Prefix marking an OpenAI function name as an agent invocation. */
export const AGENT_TOOL_PREFIX = 'agent__';

/** Maximum number of agents exposed as tools in a single request. */
const MAX_AGENT_TOOLS = 12;

// ============ Role-family descriptions (for tool descriptions) ============

const ROLE_DESCRIPTIONS: Record<AgentRoleFamily, string> = {
  planner: 'decomposes a goal into an ordered subtask plan',
  executor: 'performs a concrete subtask and produces a work-product artifact',
  critic: 'reviews an artifact for defects and proposes revisions or approval',
  researcher: 'gathers and synthesizes information into a cited research artifact',
  presenter: 'assembles artifacts into a final deliverable for the user',
};

// ============ Name encoding ============

/** Encode an agent id into an OpenAI-compatible tool function name. */
export function agentIdToToolName(agentId: string): string {
  return `${AGENT_TOOL_PREFIX}${agentId}`;
}

/** Decode a tool function name back into an agent id. Returns null if not an agent tool. */
export function toolNameToAgentId(name: string): string | null {
  if (!name.startsWith(AGENT_TOOL_PREFIX)) return null;
  return name.slice(AGENT_TOOL_PREFIX.length);
}

/** Predicate: does this function name refer to an agent tool? */
export function isAgentTool(name: string): boolean {
  return name.startsWith(AGENT_TOOL_PREFIX);
}

// ============ Tool-definition generation ============

/**
 * Build OpenAI function-tool definitions for enabled registry agents.
 *
 * @param categoryId  When provided, only agents scoped to this category (or
 *                    global template agents with category_id NULL) are
 *                    included — matching the swarm pool's scoping rule. When
 *                    omitted, all enabled agents across all categories are
 *                    included (used by the admin tool-preview and eval
 *                    harness).
 *
 * Definitions are ordered: category-scoped agents first, then globals, then
 * by role family. A hard cap (`MAX_AGENT_TOOLS`) prevents flooding the
 * context window when many agents are registered.
 */
export async function getAgentToolDefinitions(
  categoryId?: number
): Promise<OpenAI.Chat.ChatCompletionFunctionTool[]> {
  let agents: AgentRecord[];
  try {
    agents = categoryId !== undefined
      ? await getAgentsForCategory(categoryId)
      : await listEnabledAgents();
  } catch (err) {
    // DB unavailable (e.g. during build) — return empty rather than throwing.
    // The chat runtime treats an empty agent-tool list as "no agents
    // available", which is the correct degraded behavior.
    logger.warn('Failed to load agents for tool definitions', { error: String(err) });
    return [];
  }

  const tools: OpenAI.Chat.ChatCompletionFunctionTool[] = [];
  for (const agent of agents.slice(0, MAX_AGENT_TOOLS)) {
    tools.push(buildToolDefinition(agent));
  }
  return tools;
}

/**
 * Build a single OpenAI function-tool definition for an agent.
 *
 * The tool accepts a `task` string and an optional `context` string; these
 * map directly to `InvokeAgentInput`. The description tells the LLM what
 * role the agent fills so it can pick the right one.
 */
function buildToolDefinition(agent: AgentRecord): OpenAI.Chat.ChatCompletionFunctionTool {
  const roleDesc = ROLE_DESCRIPTIONS[agent.roleFamily] ?? 'performs a specialized task';
  const scopeNote = agent.categoryId === null
    ? 'Available in all categories.'
    : 'Scoped to a specific category.';

  return {
    type: 'function',
    function: {
      name: agentIdToToolName(agent.id),
      description: `Invoke the "${agent.name}" agent, which ${roleDesc}. ${scopeNote} Returns a structured result (artifact, confidence, and recommended next action). Use this when the user's request benefits from a specialized agent rather than answering directly.`,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The concrete task to assign to this agent. Be specific about what artifact it should produce.',
          },
          context: {
            type: 'string',
            description: 'Optional supporting context: prior conversation, relevant excerpts, or constraints the agent should respect. Omit if not needed.',
          },
        },
        required: ['task'],
      },
    },
  };
}

// ============ Tool execution ============

/**
 * Execute an agent tool call by dispatching through `invokeAgent`.
 *
 * @param name  The OpenAI function name (must start with `agent__`).
 * @param args  The raw JSON-string arguments from the LLM (`{task, context?}`).
 * @returns A JSON string the LLM consumes as the tool result. Shape:
 *   - On success: the full `AgentResponse` contract envelope.
 *   - On infra failure (agent missing, provider down): a minimal error
 *     object `{ error, agentId, roleFamily }` so the LLM can escalate.
 * @param toolHints Optional /command keys to inject as tool-use hints for the agent.
 */
export async function executeAgentTool(
  name: string,
  args: string,
  toolHints?: string[]
): Promise<string> {
  const agentId = toolNameToAgentId(name);
  if (!agentId) {
    return JSON.stringify({
      error: `Not an agent tool: ${name}`,
      code: 'INVALID_AGENT_TOOL_NAME',
    });
  }

  let parsed: { task?: string; context?: string };
  try {
    parsed = JSON.parse(args);
  } catch {
    return JSON.stringify({
      error: `Invalid JSON arguments for agent tool ${name}`,
      agentId,
      code: 'INVALID_JSON_ARGUMENTS',
    });
  }

  if (typeof parsed.task !== 'string' || !parsed.task.trim()) {
    return JSON.stringify({
      error: 'Agent tool requires a non-empty "task" string argument.',
      agentId,
      code: 'MISSING_TASK',
    });
  }

  // Resolve the agent name once for both the success and error paths so the
  // stream route's artifact callback can render "Answered by <name>" without a
  // second DB lookup. Falls back to the agentId if the agent was deleted
  // between tool-definition generation and execution.
  let agentName: string | undefined;
  try {
    const agent = await getAgentById(agentId);
    agentName = agent?.name;
  } catch {
    // DB error is non-fatal here — the invoker will surface a real error if
    // the agent is truly missing.
  }

  const result = await invokeAgent({
    agentId,
    task: parsed.task,
    context: typeof parsed.context === 'string' ? parsed.context : undefined,
    toolHints,
  });

  // If the invoker hit an infrastructure problem (agent not found, model
  // unavailable, LLM call threw), surface a compact error the LLM can act on.
  // The contract-shaped `response` is still present and valid, so callers that
  // prefer the uniform envelope can read `result.response` directly. For the
  // tool-result string we lead with the error when one exists.
  if (result.error) {
    return JSON.stringify({
      error: result.error,
      agentId: result.response.agentId,
      agentName: agentName ?? agentId,
      roleFamily: result.response.roleFamily,
      // Still include the contract envelope so the LLM sees confidence:0 + escalate.
      contract: result.response,
    });
  }

  // `agentName` is not part of the AgentResponse contract (only agentId +
  // roleFamily are). We inject it at the top level so the stream route's
  // artifact callback can build an AgentResponseInfo without a second DB
  // lookup. The LLM ignores extra fields.
  return JSON.stringify({
    ...result.response,
    agentName: agentName ?? agentId,
  });
}

// ============ Introspection (for admin UI / eval harness) ============

/**
 * Return metadata for every agent that would be exposed as a tool, for the
 * admin tools panel and the routing eval harness. Unlike
 * `getAgentToolDefinitions` (which returns OpenAI-shaped definitions), this
 * returns the underlying agent records plus their tool names.
 */
export async function getAgentToolMetadata(
  categoryId?: number
): Promise<Array<{ agent: AgentRecord; toolName: string }>> {
  let agents: AgentRecord[];
  try {
    agents = categoryId !== undefined
      ? await getAgentsForCategory(categoryId)
      : await listEnabledAgents();
  } catch {
    return [];
  }
  return agents.slice(0, MAX_AGENT_TOOLS).map((agent) => ({
    agent,
    toolName: agentIdToToolName(agent.id),
  }));
}
