/**
 * Message Input Payload Builder
 *
 * Pure, framework-free logic extracted from the chat composer's submit handler.
 * Given the raw message text plus the currently-selected @agent chip and
 * /command chips, it decides whether the turn is:
 *
 *   1. an inline multi-agent **pipeline** (2+ valid @agent tokens), or
 *   2. a single @agent mention + slash-command hints, or
 *   3. a plain message with slash-command hints (chips and/or raw tokens).
 *
 * Extracting this out of the React component makes the branching testable
 * without a DOM and keeps `handleSubmit` thin.
 */

import type { PipelineStep, PipelineMode } from '@/types/stream';
import { parsePipelinePrompt } from '@/lib/pipeline-parser';

/** Inputs describing the current composer state at submit time. */
export interface BuildSubmitPayloadInput {
  /** Raw (untrimmed) textarea contents. */
  message: string;
  /** Selected @agent chip id, or null when none is active. */
  activeAgentMention: string | null;
  /** Selected /command chip keys (already validated by the chip menu). */
  activeSlashCommands: string[];
  /** Valid agent ids from the registry (may be empty if the fetch failed). */
  knownAgentIds: Set<string>;
  /** Valid slash-command keys from the registry (may be empty). */
  knownCommandKeys: Set<string>;
  /** Current pipeline execution mode preference. */
  pipelineModeState: PipelineMode;
  /** Maximum number of slash-command hints to attach to a non-pipeline turn. */
  maxSlashCommands: number;
}

/** Resolved payload passed to the streaming send call. */
export interface BuildSubmitPayloadResult {
  finalMessage: string;
  toolHints?: string[];
  agentMention?: string;
  pipeline?: PipelineStep[];
  pipelineMode?: PipelineMode;
}

/**
 * Extract all validated /command tokens from a message, in order of first
 * appearance, deduped and capped. Returns the surviving keys plus the message
 * with those tokens removed.
 *
 * When `knownCommandKeys` is empty (registry fetch failed), falls back to the
 * legacy behaviour of matching a single leading `/command` without validation,
 * so slash hints still work in a degraded/offline state.
 */
function extractRawSlashCommands(
  message: string,
  knownCommandKeys: Set<string>,
  maxSlashCommands: number
): { toolHints: string[]; remaining: string } {
  const trimmed = message.trim();

  // Degraded fallback: no known keys — accept a single leading /command.
  if (knownCommandKeys.size === 0) {
    const slashMatch = trimmed.match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]+))?$/i);
    if (slashMatch) {
      return { toolHints: [slashMatch[1].toLowerCase()], remaining: (slashMatch[2] ?? '').trim() };
    }
    return { toolHints: [], remaining: trimmed };
  }

  const slashRegex = /(?:^|\s)\/([a-z0-9_-]+)/gi;
  const matches: Array<{ index: number; endIndex: number; key: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = slashRegex.exec(message)) !== null) {
    const key = m[1].toLowerCase();
    if (knownCommandKeys.has(key)) {
      matches.push({ index: m.index, endIndex: m.index + m[0].length, key });
    }
  }

  if (matches.length === 0) {
    return { toolHints: [], remaining: trimmed };
  }

  // Collect unique keys in appearance order, capped.
  const toolHints: string[] = [];
  for (const match of matches) {
    if (!toolHints.includes(match.key) && toolHints.length < maxSlashCommands) {
      toolHints.push(match.key);
    }
  }

  // Strip the matched tokens right-to-left so offsets stay valid.
  let remaining = message;
  for (const match of [...matches].sort((a, b) => b.index - a.index)) {
    remaining = remaining.slice(0, match.index) + remaining.slice(match.endIndex);
  }
  remaining = remaining.replace(/\s{2,}/g, ' ').trim();

  return { toolHints, remaining };
}

/**
 * Build the send payload from composer state, applying pipeline detection,
 * chip merging, and slash-command extraction.
 */
export function buildSubmitPayload(
  input: BuildSubmitPayloadInput
): BuildSubmitPayloadResult {
  const {
    message,
    activeAgentMention,
    activeSlashCommands,
    knownAgentIds,
    knownCommandKeys,
    pipelineModeState,
    maxSlashCommands,
  } = input;

  let finalMessage = message.trim();
  let toolHints: string[] | undefined;
  let agentMention: string | undefined;
  let pipeline: PipelineStep[] | undefined;
  let pipelineMode: PipelineMode | undefined;

  // Re-insert chip tokens (@agent + /commands) before parsing so that a
  // chip-selected agent/slash combined with inline @agent tokens forms a
  // pipeline whose step 1 still carries the chip-selected slash hints.
  // Without this, selecting a slash chip and then typing a second @agent
  // would silently drop the slash chip.
  const chipPrefixParts = [
    activeAgentMention ? `@${activeAgentMention}` : '',
    ...activeSlashCommands.map((c) => `/${c}`),
  ].filter(Boolean);
  const parseInput =
    chipPrefixParts.length > 0 ? `${chipPrefixParts.join(' ')} ${message}` : message;

  // ---- Pipeline detection (2+ valid @agent tokens) ----
  if (knownAgentIds.size > 0 && parseInput.includes('@')) {
    const result = parsePipelinePrompt(parseInput, knownAgentIds, knownCommandKeys);
    if (result.steps.length >= 2) {
      pipeline = result.steps;
      pipelineMode = pipelineModeState;
      // Map the parser remainder back onto the original message tail when it
      // matches; otherwise fall back to the whole message.
      finalMessage = result.remainder
        ? result.remainder === message.slice(message.indexOf(result.remainder))
          ? result.remainder
          : message
        : message;
      // Chip-based hints/mention are now embedded in the pipeline steps.
      agentMention = undefined;
      toolHints = undefined;
      return { finalMessage, toolHints, agentMention, pipeline, pipelineMode };
    }
  }

  // ---- Single @agent mention (chip) ----
  if (activeAgentMention) {
    agentMention = activeAgentMention;
    // Only strip a leading @token when it matches the active chip — a different
    // inline @token should not be silently consumed.
    const leading = finalMessage.match(/^@([a-z0-9_-]+)\s*/i);
    if (leading && leading[1].toLowerCase() === activeAgentMention.toLowerCase()) {
      finalMessage = finalMessage.slice(leading[0].length).trim();
    }
  }

  // ---- Slash-command hints ----
  if (activeSlashCommands.length > 0) {
    // Chips take precedence; use them verbatim.
    toolHints = [...activeSlashCommands];
  } else {
    // Fallback: extract raw /command tokens (supports multiple).
    const { toolHints: rawHints, remaining } = extractRawSlashCommands(
      finalMessage,
      knownCommandKeys,
      maxSlashCommands
    );
    if (rawHints.length > 0) {
      toolHints = rawHints;
      finalMessage = remaining;
    }
  }

  return { finalMessage, toolHints, agentMention, pipeline, pipelineMode };
}
