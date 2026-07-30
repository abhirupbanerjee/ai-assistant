/**
 * Agent Invoker — Runtime Engine for Registry Agents
 *
 * Phase 2.1 of the agent system architecture (see
 * plans/agent_system_architecture___implementation_plan.md §3.2, §3.3).
 *
 * This module is the single chokepoint that turns a registered agent into a
 * concrete LLM call and validates the response through the universal I/O
 * contract (`validateAgentResponse`). Every caller — the return-result tool
 * wrapper, the swarm orchestrator, the eval harness — goes through
 * `invokeAgent()` so that:
 *
 *   1. Malformed model output never escapes as a structurally-invalid value
 *      (it collapses to `confidence: 0` + `escalate`).
 *   2. Token usage is captured uniformly for the tracing module.
 *   3. Model resolution (agent-bound model → default model) happens in one
 *      place, so the swarm planner and the tool wrapper agree on which model
 *      an agent runs on.
 *
 * Design notes:
 * - The LLM is asked to emit a JSON object matching `AgentResponse` (minus the
 *   `agentId`/`roleFamily` fields we inject ourselves). We request
 *   `responseFormat: { type: 'json_object' }` for OpenAI-native providers;
 *   other providers (Claude, Gemini, etc.) are instructed via the system
 *   prompt to return only JSON. `createInternalCompletion` is provider-agnostic
 *   and routes to the correct SDK.
 * - We never throw on a malformed response. A thrown error here would bypass
 *   the contract's "collapse to confidence:0" guarantee. We only throw for
 *   unrecoverable infra problems (agent not found, no model available,
 *   provider error) — and even then the caller is expected to catch and
 *   surface a contract-shaped error envelope.
 */

import { generateResponseWithTools } from '@/lib/openai';
import { getAgentById, type AgentRecord, type AgentRoleFamily } from '@/lib/db/compat/agents';
import { getEnabledModel, getDefaultModel } from '@/lib/db/compat/enabled-models';
import { getLlmSettings } from '@/lib/db/compat/config';
import { validateAgentResponse, type AgentResponse } from '@/types/agent';
import { AVAILABLE_TOOLS } from '@/lib/tools';
import type { Message, StreamingCallbacks } from '@/types';
import { logger } from '@/lib/logger';

// ============ Public Types ============

/**
 * Input to `invokeAgent`. `task` is the human-readable instruction the agent
 * should act on; `context` is optional supporting material (prior artifacts,
 * conversation history, retrieved docs) the caller wants the agent to see.
 */
export interface InvokeAgentInput {
  /** The agent registry id (e.g. `tpl-executor` or a custom id). */
  agentId: string;
  /** The task instruction for the agent. */
  task: string;
  /** Optional supporting context (prior outputs, retrieved chunks, etc.). */
  context?: string;
  /** Optional category id for category-scoped tool resolution (future use). */
  categoryId?: number;
  /** Optional override of the agent's bound model. */
  modelOverride?: string;
  /** Optional temperature override (defaults to a per-call-family value). */
  temperature?: number;
  /** Optional max-tokens override. */
  maxTokens?: number;
  /** Optional per-agent tool hints (from /command tokens in the user's pipeline). */
  toolHints?: string[];
  /** Optional thread ID for artifact persistence (file saves). */
  threadId?: string;
  /** Optional parent callbacks for streaming sub-agent tool activity to the UI (Fix 8). */
  parentCallbacks?: StreamingCallbacks;
}

/**
 * The result of an invocation. `response` is always present and always
 * contract-valid (malformed output collapses per §3.2). `error` is set only
 * for infrastructure failures (agent not found, provider down); in that case
 * `response` is a synthetic error envelope so callers can treat the two
 * paths uniformly if they wish.
 */
export interface InvokeAgentResult {
  response: AgentResponse;
  /** The model that actually ran the completion. */
  modelUsed: string;
  /** Infrastructure error, if any (agent missing, provider failure). */
  error?: string;
}

// ============ Constants ============

/**
 * The JSON shape we ask the model to produce. We inject `agentId` and
 * `roleFamily` ourselves after validation, so the model only owes us
 * `artifact`, `confidence`, `suggestedNext`, and optional `usage`.
 */
const CONTRACT_SCHEMA_HINT = `{
  "artifact": {
    "type": "text" | "plan" | "research" | "analysis" | "critique" | "presentation" | "data",
    "content": "<string: the work product>",
    "sources": [{ "title": "<string>", "url": "<optional string>" }],
    "metadata": { "<optional key>": "<optional value>" }
  },
  "confidence": <number 0..1>,
  "suggestedNext": {
    "action": "complete" | "loop_back" | "escalate" | "handoff",
    "reason": "<string: why this next action>",
    "target_subtask": "<optional, for loop_back>",
    "target_role": "<optional, for handoff>"
  },
  "usage": { "promptTokens": <optional number>, "completionTokens": <optional number> }
}`;

/**
 * System-prompt preamble appended before the agent's own `system_prompt`. This
 * instructs the model to emit only the contract JSON. Agents that already
 * include contract guidance in their `system_prompt` get this reinforced; the
 * redundancy is intentional and cheap.
 */
const CONTRACT_PREAMBLE = `You are an agent in a multi-agent system. You MUST respond with a single valid JSON object and nothing else — no prose, no markdown fences, no commentary before or after the JSON.

The JSON object must conform to this structure:
${CONTRACT_SCHEMA_HINT}

Rules:
- "artifact.type" must be one of the listed enum values (you may also use "file_ref" when your work product is a file generated by a tool, e.g. a PDF, image, spreadsheet, presentation, podcast, or HTML page).
- "artifact.content" is your actual work product (the deliverable). When a tool you invoked produced a file, set "artifact.type" to "file_ref" and put a short human-readable description of the file (name and what it contains) in "artifact.content"; reference the file metadata in "artifact.metadata" if available.
- "confidence" is your self-assessed confidence from 0.0 to 1.0 that your artifact satisfies the task.
- "suggestedNext.action" is advisory; the orchestrator decides what actually happens next, but your "reason" must explain your recommendation.
- You MUST always return this JSON envelope as your final response, even when one or more tools produced artifacts (files, images, etc.) during your turn. Never end your turn with only a tool result — always close with the contract JSON.`;

/** Per-role-family default temperature. Planners/researchers get a bit more divergence. */
const DEFAULT_TEMPERATURES: Record<AgentRoleFamily, number> = {
  planner: 0.4,
  executor: 0.2,
  critic: 0.3,
  researcher: 0.3,
  presenter: 0.4,
};

/** Conservative max-tokens default for a single agent turn. */
const DEFAULT_MAX_TOKENS = 4096;

// ============ Main Entry Point ============

/**
 * Invoke a registered agent and return a contract-valid `AgentResponse`.
 *
 * This is the single chokepoint for all agent invocations. It:
 *   1. Loads the agent from the registry (throws-free: returns a synthetic
 *      error envelope if the agent is missing or disabled).
 *   2. Resolves the model: explicit override → agent's bound model →
 *      system default model. Throws if no model is available.
 *   3. Builds the system + user messages (contract preamble + agent system
 *      prompt + task + optional context).
 *   4. Calls `createInternalCompletion` with JSON-object response format.
 *   5. Parses the JSON (with a tolerant fallback to treating the raw string
 *      as the artifact content if JSON parse fails).
 *   6. Validates via `validateAgentResponse` — malformed output collapses to
 *      `confidence: 0` + `escalate`, never throws.
 *
 * @returns Always returns an `InvokeAgentResult` with a contract-valid
 *          `response`. Inspect `result.error` for infrastructure failures.
 */
export async function invokeAgent(
  input: InvokeAgentInput
): Promise<InvokeAgentResult> {
  const { agentId, task, context, modelOverride } = input;

  // --- 1. Load the agent ---
  const agent = await getAgentById(agentId);
  if (!agent) {
    return synthesizeError(
      agentId,
      'executor', // placeholder; caller knows the agent was not found
      `Agent not found: ${agentId}`,
      ''
    );
  }
  if (!agent.enabled) {
    return synthesizeError(
      agentId,
      agent.roleFamily,
      `Agent is disabled: ${agentId}`,
      ''
    );
  }

  // --- 2. Resolve the model ---
  const modelUsed = await resolveModel(agent, modelOverride);
  if (!modelUsed) {
    return synthesizeError(
      agentId,
      agent.roleFamily,
      'No model available: agent has no bound model and no system default is configured',
      ''
    );
  }

  // --- 3. Build messages ---
  const systemMessage = buildSystemMessage(agent);
  let annotatedTask = task;

  // Inject per-agent tool hints (from /command tokens in the user's pipeline).
  // If the hinted tool is outside the agent's allowlist, annotate honestly so
  // the orchestrator (or main LLM) can fulfill it instead.
  if (input.toolHints && input.toolHints.length > 0) {
    // Deferred import to avoid circular deps with the compat layer.
    const { getSlashCommandByKey } = await import('@/lib/db/compat/slash-commands');
    const hints: string[] = [];
    for (const key of input.toolHints) {
      const cmd = await getSlashCommandByKey(key);
      if (cmd?.enabled) {
        if (!agent.toolAllowlist.includes(cmd.toolName)) {
          hints.push(
            `The user requested /${key} (tool ${cmd.toolName}), which is outside your toolset. ` +
            `Note this in your suggested_next.reason so the orchestrator can fulfill it instead.`,
          );
        } else {
          let text = cmd.hint || `Use the ${cmd.toolName} tool.`;
          if (cmd.formatHint) text += ` Use format='${cmd.formatHint}'.`;
          hints.push(text);
        }
      }
    }
    if (hints.length > 0) {
      annotatedTask = `${task}\n\n[TOOL HINTS: ${hints.join(' | ')}]`;
    }
  }

  const userMessage = buildUserMessage(annotatedTask, context);

  // --- 4. Call the LLM via generateResponseWithTools ---
  // Phase 2.2 (d2): re-routed from createInternalCompletion to
  // generateResponseWithTools with enableTools=true. The function's internal
  // isToolCapableModelFromDb check gates tool support per model (downgrades
  // gracefully for non-tool models). The agent's toolAllowlist is enforced
  // via excludeTools = AVAILABLE_TOOLS \ allowlist (intersection, not deny).
  // Category skills are resolved internally by generateResponseWithTools via
  // resolveSkills(categoryIds, userMessage) using [agent.categoryId].
  // After the tool loop, the model returns the contract envelope as `content`,
  // which parseAgentOutput tolerates (JSON or wrapped text).
  //
  // NOTE: temperature/maxTokens overrides from InvokeAgentInput are not
  // accepted by generateResponseWithTools' signature; it derives temperature
  // from the model. The contract envelope is the deliverable, not
  // token-precise tuning.
  const agentParams = buildAgentCompletionParams({
    agent,
    systemMessage,
    userMessage,
    context,
    modelUsed,
    threadId: input.threadId,
    parentCallbacks: input.parentCallbacks,
  });

  let rawOutput: string;
  let capturedUsage: { inputTokens?: number; outputTokens?: number } = {};
  try {
    const result = await generateResponseWithTools(
      agentParams.systemPrompt,
      agentParams.conversationHistory,
      agentParams.context,
      agentParams.userMessage,
      agentParams.enableTools,
      agentParams.categoryIds,
      agentParams.callbacks,
      agentParams.images,
      agentParams.summaryContext,
      agentParams.memoryContext,
      agentParams.categorySlugs,
      agentParams.excludeTools,
      agentParams.imageCapabilities,
      agentParams.modelOverride,
      agentParams.enableClarification,
      agentParams.userId,
      agentParams.threadId,
      agentParams.thinkingEnabled,
    );
    rawOutput = result.content;
    // generateResponseWithTools reports total tokens (prompt + completion).
    // We approximate the split as all-completion for tracing purposes; the
    // validator's usage field is optional and the swarm tracer primarily
    // needs a non-zero total.
    if (result.totalTokens > 0) {
      capturedUsage = { outputTokens: result.totalTokens };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Agent invoker LLM call failed', { agentId, modelUsed, error: message });
    return synthesizeError(agentId, agent.roleFamily, `LLM call failed: ${message}`, modelUsed);
  }

  // --- 5. Parse + validate ---
  const parsed = parseAgentOutput(rawOutput);
  const response = validateAgentResponse(parsed, agentId, agent.roleFamily);

  // Attach captured usage if the validator didn't already pick it up from the
  // model's self-reported usage field.
  if (!response.usage && (capturedUsage.inputTokens || capturedUsage.outputTokens)) {
    response.usage = {
      ...(capturedUsage.inputTokens ? { promptTokens: capturedUsage.inputTokens } : {}),
      ...(capturedUsage.outputTokens ? { completionTokens: capturedUsage.outputTokens } : {}),
    };
  }

  return { response, modelUsed };
}

/**
 * Params-object adapter that maps an agent invocation onto
 * `generateResponseWithTools`' 19-arg signature. This is the single place
 * where tool enablement and the allowed/excluded tool sets are configured for
 * agent invocations.
 *
 * Phase 2.2 (d2): `enableTools=true`. The agent's `toolAllowlist` is enforced
 * as an intersection (not a denylist): `excludeTools` = every
 * `AVAILABLE_TOOLS` key NOT in `agent.toolAllowlist`. An empty allowlist
 * excludes all static tools (the agent can still see category-scoped dynamic
 * function APIs and agent-as-tool defs, which are added by
 * `getToolDefinitions` outside the `AVAILABLE_TOOLS` catalog). Category
 * skills are resolved internally by `generateResponseWithTools` via
 * `resolveSkills([agent.categoryId], userMessage)`.
 *
 * The agent's system prompt (contract preamble + role config) is passed as
 * `systemPrompt`; the task is passed as `userMessage`; any supporting context
 * is passed as `context` (the function composes them in the right order via
 * `formatUserMessage`). Conversation history is empty — agents are stateless
 * single-turn callers; multi-turn context is the caller's job to fold into
 * `context`.
 */
function buildAgentCompletionParams(input: {
  agent: AgentRecord;
  systemMessage: string;
  userMessage: string;
  context?: string;
  modelUsed: string;
  threadId?: string;
  parentCallbacks?: StreamingCallbacks;
}) {
  const { agent, systemMessage, userMessage, context, modelUsed, threadId, parentCallbacks } = input;
  const categoryIds = agent.categoryId ? [agent.categoryId] : undefined;

  // Enforce toolAllowlist as an intersection: exclude every AVAILABLE_TOOLS
  // key that is NOT in the agent's allowlist. An empty allowlist excludes all
  // static tools. The allowlist only governs the built-in tool catalog;
  // category-scoped dynamic function APIs and agent-as-tool defs are not in
  // AVAILABLE_TOOLS and are therefore unaffected.
  const allowSet = new Set(agent.toolAllowlist);
  const excludeTools = Object.keys(AVAILABLE_TOOLS).filter(
    (name) => !allowSet.has(name)
  );

  return {
    systemPrompt: systemMessage,
    conversationHistory: [] as Message[],
    context: context ?? '',
    userMessage,
    enableTools: true,
    categoryIds,
    // Phase 6 (Fix 8): Forward parent callbacks for sub-agent tool progress visibility.
    // Tool names are prefixed with '↳' so the UI can render nested tool activity.
    callbacks: parentCallbacks ? {
      onToolStart: (name: string, displayName: string) => {
        parentCallbacks?.onToolStart?.(`↳ ${name}`, `[${agent.name}] ${displayName}`);
      },
      onToolEnd: (name: string, success: boolean, duration: number, error?: string) => {
        parentCallbacks?.onToolEnd?.(`↳ ${name}`, success, duration, error);
      },
    } : undefined,
    images: undefined,
    summaryContext: undefined,
    memoryContext: undefined,
    categorySlugs: undefined,
    excludeTools: excludeTools.length > 0 ? excludeTools : undefined,
    imageCapabilities: undefined,
    modelOverride: modelUsed,
    enableClarification: false,
    userId: undefined,
    threadId: threadId,  // Phase 6: propagate for artifact persistence
    thinkingEnabled: false,
  };
}

// ============ Helpers ============

/**
 * Resolve which model an agent runs on.
 * Priority: explicit override → agent's bound modelId → system default model.
 * Returns null if none is available (caller surfaces a synthetic error).
 */
async function resolveModel(
  agent: AgentRecord,
  override?: string
): Promise<string | null> {
  if (override) return override;
  if (agent.modelId) {
    // Verify the bound model still exists and is enabled. If it was deleted
    // or disabled, fall back to the system default rather than failing hard.
    const model = await getEnabledModel(agent.modelId);
    if (model?.enabled) return model.id;
    logger.warn('Agent bound model unavailable, falling back to default', {
      agentId: agent.id,
      boundModelId: agent.modelId,
    });
  }
  const defaultModel = await getDefaultModel();
  if (defaultModel?.enabled) return defaultModel.id;
  // Last-resort: read the raw llm settings model string. This covers
  // environments where the enabled_models table is empty but a default
  // model is still configured in settings.
  try {
    const settings = await getLlmSettings();
    if (settings.model) return settings.model;
  } catch {
    // ignore — settings may be unavailable in build phase
  }
  return null;
}

/**
 * Build the system message: contract preamble + the agent's own system prompt.
 */
function buildSystemMessage(agent: AgentRecord): string {
  const parts: string[] = [CONTRACT_PREAMBLE];
  if (agent.systemPrompt && agent.systemPrompt.trim()) {
    parts.push(`\n--- Your role configuration ---\n${agent.systemPrompt.trim()}`);
  }
  return parts.join('\n');
}

/**
 * Build the user message: the task, plus optional context.
 */
function buildUserMessage(task: string, context?: string): string {
  const parts: string[] = [];
  if (context && context.trim()) {
    parts.push(`--- Context ---\n${context.trim()}\n`);
  }
  parts.push(`--- Task ---\n${task.trim()}`);
  parts.push('\n\nRespond with the JSON object only.');
  return parts.join('\n');
}

/**
 * Parse the model's raw string output into a JS value for validation.
 *
 * Tolerant strategy:
 *   1. Try direct JSON.parse.
 *   2. If that fails, look for the first `{` and last `}` and try parsing
 *      that substring (handles markdown fences / leading prose).
 *   3. If still no luck, wrap the raw string as `{ artifact: { type: 'text',
 *      content: raw } }` so the validator sees something structured and can
 *      apply its own field-level coercion. This preserves the agent's text
 *      output even when it ignored the JSON instruction.
 */
function parseAgentOutput(raw: string): unknown {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // 1. Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // 2. Extract the outermost JSON object
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // fall through
    }
  }

  // 3. Wrap raw text as a text artifact so the validator can coerce it.
  // The model didn't follow the contract, but its prose may still be useful;
  // validateAgentResponse will assign confidence based on what fields exist.
  return {
    artifact: { type: 'text', content: trimmed },
    confidence: 0.3, // low — model didn't follow the format
    suggestedNext: { action: 'complete', reason: 'Agent responded with non-JSON text; wrapped as text artifact' },
  };
}

/**
 * Build a synthetic contract-valid error result for infrastructure failures.
 * This keeps the return type uniform: callers always get an `AgentResponse`,
 * and the `error` field signals whether it was an infra problem.
 */
function synthesizeError(
  agentId: string,
  roleFamily: AgentRoleFamily,
  message: string,
  modelUsed: string
): InvokeAgentResult {
  return {
    response: {
      agentId,
      roleFamily,
      artifact: { type: 'error', content: message },
      confidence: 0,
      suggestedNext: { action: 'escalate', reason: message },
    },
    modelUsed,
    error: message,
  };
}

// ============ Convenience: invoke by role family ============

/**
 * Invoke the first enabled agent matching a role family. Useful for the
 * return-result tool wrapper when the caller knows the role it wants but not
 * a specific agent id. For category-scoped selection, the caller should use
 * `getAgentsForCategory` and pick explicitly.
 */
export async function invokeAgentByRole(
  roleFamily: AgentRoleFamily,
  task: string,
  context?: string
): Promise<InvokeAgentResult> {
  const { getAgentsByRoleFamily } = await import('@/lib/db/compat/agents');
  const candidates = await getAgentsByRoleFamily(roleFamily);
  if (candidates.length === 0) {
    return synthesizeError(
      'unknown',
      roleFamily,
      `No enabled agent found for role family: ${roleFamily}`,
      ''
    );
  }
  // Use the first candidate (ordered by name). The swarm planner will do
  // more sophisticated selection; this is the simple single-agent path.
  return invokeAgent({ agentId: candidates[0].id, task, context });
}
