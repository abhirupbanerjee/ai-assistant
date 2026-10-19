/**
 * Request Budget Resolver & Token Ledger
 *
 * Phase A of the on-demand document access plan. Fixes two classes of bugs:
 *
 * 1. Output-limit-as-input-budget: the previous flow passed the model's
 *    *max output tokens* as the input budget when truncating context.
 *    This module resolves the input ceiling from the model catalog's
 *    `max_input_tokens` (or a shared context window minus the requested
 *    output allowance) instead.
 *
 * 2. Missing accounting: tool schemas, tool arguments/results, images and
 *    provider framing were never counted. A TokenLedger tracks every part
 *    of an assembled request so compaction (A4) can evict reloadable parts
 *    deterministically instead of dropping RAG sections by delimiter.
 *
 * All token counts are conservative estimates (chars/4) unless a model-
 * specific tokenizer is wired into `countTokens` — see A2 of the plan.
 *
 * @module request-budget
 */

import { countTokens } from './summarization';
import { getEnabledModel } from '@/lib/db/compat';

// ============ Types ============

export interface RequestBudget {
  /** Model the budget was resolved for. Fallbacks must re-resolve. */
  model: string;
  /** Tokens allowed for the FULL request input (everything but the answer). */
  inputLimit: number;
  /** Requested response allowance (generation setting). */
  maxOutputTokens: number;
  /** Combined context window when the provider shares input+output. */
  contextWindow: number;
  /** Provider-specified input-only ceiling, when it exists. */
  separateInputCeiling: number | null;
  /** Reserved for provider framing + tokenizer drift. */
  safetyMargin: number;
}

export interface ResolveBudgetOptions {
  /** Caller's generation setting (e.g. limits.maxTokens for this request). */
  requestedMaxTokens?: number;
  /** Ollama-style runtime context size (num_ctx) in tokens, when known. */
  runtimeContextTokens?: number;
  /** Override safety margin (default 512). */
  safetyMargin?: number;
}

/** Thrown when indispensable input alone exceeds the resolved input limit. */
export class RequestBudgetExceeded extends Error {
  readonly code = 'REQUEST_BUDGET_EXCEEDED';
  readonly inputTokens: number;
  readonly inputLimit: number;

  constructor(inputTokens: number, inputLimit: number) {
    super(
      `Request input (${inputTokens} tokens) exceeds the model's input limit (${inputLimit} tokens) even after compaction. ` +
      `Reduce conversation history, remove attachments, or select a model with a larger context window.`
    );
    this.name = 'RequestBudgetExceeded';
    this.inputTokens = inputTokens;
    this.inputLimit = inputLimit;
  }
}

// ============ Defaults ============

/** Used when the model catalog has no token metadata for a model. */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const DEFAULT_SAFETY_MARGIN = 512;

/** Conservative chars→tokens ratio when no model-specific tokenizer exists. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimated token cost of one image input, per resolution tier.
 * Deliberately generous — an under-estimate overflows at the provider.
 */
const IMAGE_TOKEN_ESTIMATE = 1600;

/** Per-message provider framing overhead (role tags, separators). */
const MESSAGE_FRAMING_TOKENS = 8;

/** Overhead for each tool definition beyond its serialized JSON size. */
const TOOL_DEFINITION_FRAMING_TOKENS = 16;

// ============ Resolution (A1) ============

/**
 * Resolve the request budget for a model.
 *
 * Semantics — validated against the model catalog:
 * - `maxInputTokens` in the catalog describes an INPUT ceiling where the
 *   provider exposes one; `maxOutputTokens` is the maximum generations size.
 * - When no separate input ceiling is known, the shared-window formula
 *   applies: input = contextWindow − maxOutputTokens − margin.
 * - A runtime override (e.g. local Ollama num_ctx) may shrink the window
 *   below the advertised capacity and always wins when smaller.
 */
export async function resolveRequestBudget(
  model: string,
  opts: ResolveBudgetOptions = {}
): Promise<RequestBudget> {
  const safetyMargin = opts.safetyMargin ?? DEFAULT_SAFETY_MARGIN;

  // Look up catalog metadata through the compat layer (flag-aware).
  let contextWindow = DEFAULT_CONTEXT_WINDOW;
  let separateInputCeiling: number | null = null;
  let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;

  try {
    const enabled = await getEnabledModel(model);
    if (enabled) {
      if (enabled.maxInputTokens && enabled.maxInputTokens > 0) {
        separateInputCeiling = enabled.maxInputTokens;
        contextWindow = enabled.maxInputTokens;
      }
      if (enabled.maxOutputTokens && enabled.maxOutputTokens > 0) {
        maxOutputTokens = enabled.maxOutputTokens;
      }
    }
  } catch {
    // Catalog unavailable (e.g. NEXT_PHASE build guard) — use defaults.
  }

  // Requested output allowance: the caller's generation setting capped by
  // what the model can produce. This is the OUTPUT side only — it is never
  // used as the input budget (that was the original bug).
  const requested = opts.requestedMaxTokens && opts.requestedMaxTokens > 0
    ? opts.requestedMaxTokens
    : maxOutputTokens;
  maxOutputTokens = Math.min(requested, maxOutputTokens);

  // Shared-window formula: input = window − output − margin.
  const sharedWindowInput = contextWindow - maxOutputTokens - safetyMargin;

  // Separate ceiling: enforce ceiling − margin as well, take the min.
  let inputLimit = separateInputCeiling !== null
    ? Math.min(sharedWindowInput, separateInputCeiling - safetyMargin)
    : sharedWindowInput;

  // Runtime overrides (Ollama num_ctx etc.) may be smaller than advertised.
  // The runtime window is a SHARED window like the catalog one: the output
  // allowance AND the safety margin must both be reserved from it, otherwise
  // input + output + margin can exceed the physical num_ctx and the runtime
  // silently truncates the prompt or the generation.
  if (opts.runtimeContextTokens && opts.runtimeContextTokens > 0) {
    const runtimeSharedWindowInput = opts.runtimeContextTokens - maxOutputTokens - safetyMargin;
    inputLimit = Math.min(inputLimit, runtimeSharedWindowInput);
  }

  // Never invent input capacity beyond the physical window. A small positive
  // budget is valid; a reservation leaving no room for input is not.
  if (inputLimit < 1) {
    throw new RequestBudgetExceeded(1, Math.max(0, inputLimit));
  }

  return {
    model,
    inputLimit,
    maxOutputTokens,
    contextWindow,
    separateInputCeiling,
    safetyMargin,
  };
}

/**
 * Resolve the Ollama runtime context size (num_ctx) used by the direct
 * Ollama route in openai.ts. Returns undefined for non-Ollama requests.
 */
export function resolveOllamaRuntimeContextTokens(): number | undefined {
  const v = parseInt(process.env.OLLAMA_NUM_CTX || '16384', 10);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

// ============ Estimation helpers (A2) ============

/** Conservative token estimate for arbitrary text. */
export function estimateTextTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);
}

/** Token estimate for a single chat message (any role) including framing. */
export function estimateMessageTokens(msg: {
  content: unknown;
  tool_calls?: unknown;
}): number {
  let tokens = MESSAGE_FRAMING_TOKENS;
  const content = msg.content;
  if (typeof content === 'string') {
    tokens += estimateTextTokens(content);
  } else if (Array.isArray(content)) {
    // Multimodal content parts.
    for (const part of content) {
      const p = part as { type?: string; text?: string };
      if (p?.type === 'text' && typeof p.text === 'string') {
        tokens += estimateTextTokens(p.text);
      } else if (p?.type === 'image_url' || p?.type === 'image') {
        tokens += IMAGE_TOKEN_ESTIMATE;
      } else {
        tokens += estimateTextTokens(JSON.stringify(part));
      }
    }
  } else if (content != null) {
    tokens += estimateTextTokens(JSON.stringify(content));
  }
  if (msg.tool_calls) {
    tokens += estimateTextTokens(JSON.stringify(msg.tool_calls));
  }
  return tokens;
}

/** Token estimate for tool schemas sent with the request. */
export function estimateToolSchemaTokens(tools: unknown): number {
  if (!tools) return 0;
  if (Array.isArray(tools)) {
    return tools.reduce(
      (sum, t) => sum + estimateTextTokens(JSON.stringify(t)) + TOOL_DEFINITION_FRAMING_TOKENS,
      0
    );
  }
  return estimateTextTokens(JSON.stringify(tools));
}

// ============ Ledger (A2/A4) ============

export type LedgerPartKind =
  | 'system'
  | 'history'
  | 'user'
  | 'context'
  | 'tool_schema'
  | 'tool_result'
  | 'other';

export interface LedgerPart {
  key: string;
  kind: LedgerPartKind;
  tokens: number;
  /**
   * True when the content can be re-fetched later (e.g. a kb_read/kb_search
   * result identified by documentId + ranges). Reloadable parts are evicted
   * first, replaced by a stub.
   */
  reloadable?: boolean;
  /** Citation stub kept in place of an evicted reloadable part. */
  stub?: string;
}

export interface TokenLedger {
  budget: RequestBudget;
  parts: LedgerPart[];
  /** Sum of all part tokens. */
  used: number;
}

export function createLedger(budget: RequestBudget): TokenLedger {
  return { budget, parts: [], used: 0 };
}

export function addLedgerPart(ledger: TokenLedger, part: LedgerPart): void {
  ledger.parts.push(part);
  ledger.used += part.tokens;
}

/** Recompute `used` after callers mutate part tokens in place. */
export function recomputeLedgerUsed(ledger: TokenLedger): number {
  ledger.used = ledger.parts.reduce((sum, p) => sum + p.tokens, 0);
  return ledger.used;
}

/**
 * A4 — deterministic compaction, in order:
 * 1. Deduplicate identical tool-result texts.
 * 2. Evict oldest reloadable tool results (keep stubs).
 * 3. Drop oldest compactable history entries (non-reloadable 'history'
 *    parts are only removed by the caller, which rewrites messages —
 *    here we only report which keys to compact).
 *
 * Returns the list of part keys that were zeroed (evicted) plus whether
 * the request now fits. Throws RequestBudgetExceeded if it cannot fit even
 * after evicting every reloadable part.
 */
export function compactLedger(ledger: TokenLedger): { evicted: string[]; fits: boolean } {
  const evicted: string[] = [];

  // 1. Deduplicate identical tool_result texts.
  const seenText = new Map<string, LedgerPart>();
  for (const part of ledger.parts) {
    if (part.kind !== 'tool_result' || part.tokens === 0) continue;
    const fingerprint = part.stub ?? part.key;
    const prior = seenText.get(fingerprint);
    if (prior && prior.tokens > 0) {
      // Mark duplicate for zeroing by the caller via evicted list.
      if (!evicted.includes(part.key)) evicted.push(part.key);
    } else {
      seenText.set(fingerprint, part);
    }
  }
  if (evicted.length > 0) recomputeLedgerUsed(ledger);

  // 2. Evict oldest reloadable parts while over budget.
  if (ledger.used > ledger.budget.inputLimit) {
    const reloadable = ledger.parts
      .filter(p => p.reloadable && p.tokens > 0)
      .sort((a, b) => ledger.parts.indexOf(a) - ledger.parts.indexOf(b));
    for (const part of reloadable) {
      if (ledger.used <= ledger.budget.inputLimit) break;
      part.tokens = 0; // caller replaces content with part.stub
      ledger.used -= 0; // recompute below for accuracy
      recomputeLedgerUsed(ledger);
      if (!evicted.includes(part.key)) evicted.push(part.key);
    }
  }

  const fits = ledger.used <= ledger.budget.inputLimit;
  if (!fits) {
    throw new RequestBudgetExceeded(ledger.used, ledger.budget.inputLimit);
  }
  return { evicted, fits };
}

/**
 * Convenience: tokens for a whole messages array (OpenAI shape).
 */
export function estimateMessagesTokens(messages: Array<{ content: unknown; tool_calls?: unknown }>): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

// Re-export the project's tokenizer for callers that want the shared
// implementation rather than the conservative estimator.
export { countTokens };
