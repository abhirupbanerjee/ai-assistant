/**
 * Inline Pipeline Prompt Parser
 *
 * Parses a user message containing inline @agent and /command tokens into an
 * ordered sequence of pipeline steps. Detects 2+ valid @agent tokens anywhere
 * in the message (not just at position 0) and segments the text into per-step
 * task clauses with attached tool hints from /command tokens.
 *
 * Pure function — no imports beyond types, fully unit-testable.
 */

import type { PipelineStep } from '@/types/stream';

/** Maximum number of pipeline steps parsed from a single message. */
export const MAX_PIPELINE_STEPS = 4;

/**
 * Parse a message for inline @agent and /command tokens.
 *
 * @param message         The raw user message (untrimmed).
 * @param knownAgentIds   Set of valid agent ids from the registry.
 * @param knownCommandKeys Set of valid slash-command keys.
 * @returns Parsed steps (empty if fewer than 2 agents found) and the remaining
 *          text after the last step (preamble attaches to step 1, post-last-@
 *          text becomes the main LLM's task).
 */
export function parsePipelinePrompt(
  message: string,
  knownAgentIds: Set<string>,
  knownCommandKeys: Set<string>
): { steps: PipelineStep[]; remainder: string } {
  // ---- 1. Find all @agent tokens ----
  const atRegex = /(?:^|\s)@([a-z0-9_-]+)/gi;
  const atMatches: Array<{ index: number; endIndex: number; agentId: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = atRegex.exec(message)) !== null) {
    const agentId = match[1].toLowerCase();
    if (knownAgentIds.has(agentId)) {
      atMatches.push({
        index: match.index,
        endIndex: match.index + match[0].length,
        agentId,
      });
    }
  }

  // Fewer than 2 valid agents — not a pipeline.
  if (atMatches.length < 2) {
    return { steps: [], remainder: '' };
  }

  // Cap to prevent context-window abuse.
  const effectiveMatches = atMatches.slice(0, MAX_PIPELINE_STEPS);

  // ---- 2. Find all /command tokens ----
  const slashRegex = /(?:^|\s)\/([a-z0-9_-]+)/gi;
  const slashMatches: Array<{ index: number; endIndex: number; commandKey: string }> = [];

  while ((match = slashRegex.exec(message)) !== null) {
    const commandKey = match[1].toLowerCase();
    if (knownCommandKeys.has(commandKey)) {
      slashMatches.push({
        index: match.index,
        endIndex: match.index + match[0].length,
        commandKey,
      });
    }
  }

  // ---- 3. Segment the message by the first @ of each step ----
  const steps: PipelineStep[] = [];

  for (let i = 0; i < effectiveMatches.length; i++) {
    const currentAt = effectiveMatches[i];
    const nextAt = effectiveMatches[i + 1];

    // Text from this @ to before the next @ (or end of message).
    const taskStart = currentAt.endIndex;
    const taskEnd = nextAt ? nextAt.index : message.length;
    let rawTask = message.slice(taskStart, taskEnd);

    // Process slash matches in this segment right-to-left so offsets stay valid.
    const inSegment = slashMatches
      .filter((sm) => sm.index >= taskStart && sm.index < taskEnd)
      .sort((a, b) => b.index - a.index);

    const toolHints: string[] = [];
    for (const sm of inSegment) {
      const relStart = sm.index - taskStart;
      const relEnd = sm.endIndex - taskStart;
      rawTask = rawTask.slice(0, relStart) + rawTask.slice(relEnd);
      if (!toolHints.includes(sm.commandKey)) toolHints.unshift(sm.commandKey);
    }
    rawTask = rawTask.replace(/\s{2,}/g, ' ').trim();

    steps.push({
      agentId: currentAt.agentId,
      task: rawTask,
      toolHints,
    });
  }

  // ---- 3b. Dedupe adjacent identical agents (merge tasks, union hints) ----
  const deduped: PipelineStep[] = [];
  for (const step of steps) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.agentId === step.agentId) {
      deduped[deduped.length - 1] = {
        agentId: step.agentId,
        task: `${prev.task} ${step.task}`.trim(),
        toolHints: [...new Set([...prev.toolHints, ...step.toolHints])],
      };
    } else {
      deduped.push(step);
    }
  }

  // ---- 4. Compute remainder (text after the last @agent) ----
  const lastAt = effectiveMatches[effectiveMatches.length - 1];
  let afterLast = message.slice(lastAt.endIndex);

  // Strip validated slash tokens from remainder so the main LLM doesn't
  // receive leftover /command tokens as user text.
  const remSlash = slashMatches
    .filter((sm) => sm.index >= lastAt.endIndex)
    .sort((a, b) => b.index - a.index);
  for (const sm of remSlash) {
    const relStart = sm.index - lastAt.endIndex;
    const relEnd = sm.endIndex - lastAt.endIndex;
    afterLast = afterLast.slice(0, relStart) + afterLast.slice(relEnd);
  }
  afterLast = afterLast.replace(/\s{2,}/g, ' ').trim();

  // The preamble (text before the first @) is attached as context to step 1.
  const firstAt = effectiveMatches[0];
  const preamble = message.slice(0, firstAt.index).trim();
  if (preamble) {
    deduped[0] = {
      ...deduped[0],
      task: `${preamble} ${deduped[0].task}`.trim(),
    };
  }

  return { steps: deduped, remainder: afterLast };
}

/**
 * Re-validate a client-supplied pipeline against the server-side registry.
 *
 * The chat stream endpoint receives `pipeline` directly from the client, which
 * is an untrusted trust boundary. This function drops steps whose `agentId` is
 * not a known agent, filters each surviving step's `toolHints` down to enabled
 * slash-command keys, and re-caps the pipeline to {@link MAX_PIPELINE_STEPS}.
 *
 * Runtime invocation already fails safely for a missing agent, but validating
 * here prevents a malicious client from enqueuing arbitrary `agent__*` calls
 * and strips bogus tool hints before they reach the agent invoker.
 *
 * @param pipeline         The client-provided pipeline steps.
 * @param knownAgentIds    Valid agent ids from the registry (category-scoped).
 * @param knownCommandKeys Valid, enabled slash-command keys.
 * @returns Sanitized steps (may be fewer than input; empty if <2 remain valid)
 *          and the ids of any dropped agents for observability.
 */
export function sanitizePipeline(
  pipeline: PipelineStep[],
  knownAgentIds: Set<string>,
  knownCommandKeys: Set<string>
): { steps: PipelineStep[]; droppedAgentIds: string[] } {
  const droppedAgentIds: string[] = [];
  const valid: PipelineStep[] = [];

  for (const step of pipeline) {
    const agentId = typeof step?.agentId === 'string' ? step.agentId.toLowerCase() : '';
    if (!agentId || !knownAgentIds.has(agentId)) {
      if (agentId) droppedAgentIds.push(agentId);
      continue;
    }
    const rawHints = Array.isArray(step.toolHints) ? step.toolHints : [];
    const toolHints = rawHints
      .map((h) => (typeof h === 'string' ? h.toLowerCase() : ''))
      .filter((h) => h && knownCommandKeys.has(h));
    valid.push({
      agentId,
      task: typeof step.task === 'string' ? step.task : '',
      toolHints: [...new Set(toolHints)],
    });
    if (valid.length >= MAX_PIPELINE_STEPS) break;
  }

  return { steps: valid, droppedAgentIds };
}
