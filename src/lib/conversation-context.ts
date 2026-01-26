/**
 * Unified Conversation Context Manager
 *
 * Addresses three interlinked RAG improvements:
 * - Smart history with anchors + follow-up detection
 * - Dynamic summary positioning
 * - Context-aware cache keys
 *
 * @module conversation-context
 */

import type { Message } from '@/types';
import { countTokens } from './summarization';
import { hashQuery } from './redis';

// ============ Types ============

/**
 * Unified conversation context state
 */
export interface ConversationContext {
  /** History management */
  history: {
    /** First 2 messages establishing thread topic */
    anchors: Message[];
    /** Recent messages within token budget */
    recent: Message[];
    /** Combined, deduplicated, chronologically ordered */
    all: Message[];
    /** Last Q&A pair for follow-up context */
    lastExchange: { question: string; answer: string } | null;
  };

  /** Follow-up detection */
  followUp: {
    /** Whether current message is a follow-up */
    isFollowUp: boolean;
    /** Confidence score 0-1 */
    confidence: number;
    /** Formatted hint for injection into context */
    hint: string | null;
  };

  /** Summary state */
  summary: {
    /** Whether summary exists */
    exists: boolean;
    /** Summary content */
    content: string | null;
    /** Where to position in prompt */
    position: 'before_rag' | 'before_question';
  };

  /** Cache management */
  cache: {
    /** Unique cache key incorporating all context */
    key: string;
    /** Whether response can be cached */
    isCacheable: boolean;
    /** Reason if not cacheable */
    reason?: string;
  };

  /** Token tracking */
  tokens: {
    /** Tokens used by history */
    history: number;
    /** Tokens used by summary */
    summary: number;
    /** Total tokens used */
    total: number;
    /** Maximum token budget */
    budget: number;
    /** Remaining tokens */
    remaining: number;
  };
}

/**
 * Options for building conversation context
 */
export interface ContextOptions {
  /** Maximum messages to include (default: 10) */
  maxMessages?: number;
  /** Maximum tokens for history (default: 6000) */
  maxTokens?: number;
  /** Thread summary context if available */
  summaryContext?: string;
  /** User memory context if available */
  memoryContext?: string;
  /** Category slugs for cache key */
  categorySlugs?: string[];
}

// ============ Follow-up Detection ============

/**
 * Patterns for detecting follow-up questions with confidence weights
 */
const FOLLOW_UP_PATTERNS: Array<{ pattern: RegExp; weight: number; type: string }> = [
  // High confidence - explicit continuation
  { pattern: /^(what about|how about|and what|and how|what if)\b/i, weight: 0.95, type: 'explicit' },
  { pattern: /^(also|additionally|furthermore|moreover)\b/i, weight: 0.90, type: 'additive' },
  { pattern: /^(can you|could you|would you) (also|expand|elaborate|explain)/i, weight: 0.90, type: 'request' },

  // Medium confidence - pronoun reference
  { pattern: /\b(it|that|this|those|these)\b.*\?$/i, weight: 0.75, type: 'pronoun' },
  { pattern: /^(the same|the above|the previous|that one)\b/i, weight: 0.80, type: 'reference' },
  { pattern: /\b(more details?|more info|tell me more|go on|continue|elaborate)\b/i, weight: 0.85, type: 'elaboration' },
  { pattern: /\b(what else|anything else|other)\b/i, weight: 0.75, type: 'extension' },

  // Lower confidence - implicit continuation
  { pattern: /^(why|how come|but why)\s+(is|was|does|did)\s+(it|that|this)/i, weight: 0.70, type: 'implicit' },
  { pattern: /^(yes|no|ok|okay|right|sure)[,.]?\s*(and|but|so|now)/i, weight: 0.65, type: 'response' },
  { pattern: /^(and|but|so|then)\s+\w/i, weight: 0.60, type: 'conjunction' },

  // Section/part references
  { pattern: /\b(section|part|chapter|point|item)\s*\d/i, weight: 0.85, type: 'section_ref' },
  { pattern: /\b(first|second|third|next|last|previous)\s+(one|point|item|thing)/i, weight: 0.80, type: 'ordinal' },
];

/**
 * Detect if the current message is a follow-up to a previous exchange
 *
 * @param message - Current user message
 * @returns Detection result with confidence score
 */
export function detectFollowUp(message: string): { isFollowUp: boolean; confidence: number; matchedType?: string } {
  let maxConfidence = 0;
  let matchedType: string | undefined;

  const trimmed = message.trim();

  for (const { pattern, weight, type } of FOLLOW_UP_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (weight > maxConfidence) {
        maxConfidence = weight;
        matchedType = type;
      }
    }
  }

  // Additional heuristic: very short messages after a conversation are likely follow-ups
  if (trimmed.length < 50 && trimmed.endsWith('?')) {
    maxConfidence = Math.max(maxConfidence, 0.55);
  }

  return {
    isFollowUp: maxConfidence >= 0.65,
    confidence: maxConfidence,
    matchedType,
  };
}

// ============ History Building ============

/**
 * Get the last Q&A exchange from conversation history
 *
 * @param messages - Full conversation history
 * @returns Last question and answer pair, or null
 */
export function getLastExchange(messages: Message[]): { question: string; answer: string } | null {
  // Filter to conversational messages only
  const conversational = messages.filter(m => m.role !== 'tool');

  // Find the last user message followed by an assistant response
  for (let i = conversational.length - 1; i >= 1; i--) {
    if (conversational[i].role === 'assistant' && conversational[i - 1].role === 'user') {
      return {
        question: conversational[i - 1].content,
        answer: conversational[i].content,
      };
    }
  }

  return null;
}

/**
 * Build optimized conversation history with anchors and recent messages
 *
 * Strategy:
 * 1. Always include first 2 messages (establishes thread topic)
 * 2. Fill remaining slots with most recent messages
 * 3. Respect token budget
 * 4. Maintain chronological order
 *
 * @param messages - Full conversation history
 * @param maxMessages - Maximum messages to include
 * @param maxTokens - Maximum token budget
 * @returns Structured history with anchors and recent messages
 */
export function buildHistory(
  messages: Message[],
  maxMessages: number,
  maxTokens: number
): {
  anchors: Message[];
  recent: Message[];
  all: Message[];
  tokens: number;
} {
  // Filter to conversational messages only (exclude tool messages)
  const conversational = messages.filter(m => m.role !== 'tool');

  if (conversational.length === 0) {
    return { anchors: [], recent: [], all: [], tokens: 0 };
  }

  // If we have fewer messages than the limit, include all
  if (conversational.length <= maxMessages) {
    const tokens = conversational.reduce((sum, m) => sum + countTokens(m.content), 0);
    return {
      anchors: conversational.slice(0, Math.min(2, conversational.length)),
      recent: conversational.slice(2),
      all: conversational,
      tokens,
    };
  }

  // Get anchors (first 2 messages establish thread topic)
  const anchorCount = Math.min(2, conversational.length);
  const anchors = conversational.slice(0, anchorCount);
  const anchorIds = new Set(anchors.map(m => m.id));

  // Calculate anchor tokens
  let tokenCount = anchors.reduce((sum, m) => sum + countTokens(m.content), 0);

  // Get available messages (excluding anchors)
  const available = conversational.filter(m => !anchorIds.has(m.id));
  const recent: Message[] = [];

  // Add from most recent, respecting token budget
  const maxRecentCount = maxMessages - anchorCount;

  for (let i = available.length - 1; i >= 0 && recent.length < maxRecentCount; i--) {
    const msgTokens = countTokens(available[i].content);
    if (tokenCount + msgTokens <= maxTokens) {
      recent.unshift(available[i]); // Add to front to maintain order
      tokenCount += msgTokens;
    } else if (recent.length === 0) {
      // Always include at least the most recent message, even if over budget
      recent.unshift(available[i]);
      tokenCount += msgTokens;
      break;
    }
  }

  // Combine and sort by original order
  const all = [...anchors, ...recent].sort((a, b) => {
    const aIdx = messages.findIndex(m => m.id === a.id);
    const bIdx = messages.findIndex(m => m.id === b.id);
    return aIdx - bIdx;
  });

  return { anchors, recent, all, tokens: tokenCount };
}

// ============ Cache Key Building ============

/**
 * Build a context-aware cache key that incorporates conversation state
 *
 * @param message - Current user message
 * @param isFollowUp - Whether this is a follow-up question
 * @param historyFingerprint - Hash of recent conversation
 * @param summaryFingerprint - Hash of summary (if exists)
 * @param memoryFingerprint - Hash of memory context (if exists)
 * @param categorySlugs - Category slugs for the thread
 * @returns Unique cache key
 */
export function buildCacheKey(
  message: string,
  isFollowUp: boolean,
  historyFingerprint: string,
  summaryFingerprint: string | null,
  memoryFingerprint: string | null,
  categorySlugs: string[]
): string {
  const parts: string[] = [message];

  // Add category context
  if (categorySlugs.length > 0) {
    parts.push(`cat:${categorySlugs.sort().join(',')}`);
  }

  // Add conversation fingerprint
  parts.push(`hist:${historyFingerprint}`);

  // Add follow-up flag (critical for cache differentiation)
  parts.push(`fu:${isFollowUp}`);

  // Add summary fingerprint if present
  if (summaryFingerprint) {
    parts.push(`sum:${summaryFingerprint}`);
  }

  // Add memory fingerprint if present
  if (memoryFingerprint) {
    parts.push(`mem:${memoryFingerprint}`);
  }

  return hashQuery(parts.join(':'));
}

// ============ Main Builder ============

/**
 * Build unified conversation context
 *
 * This is the main entry point that combines:
 * - Smart history with anchors
 * - Follow-up detection
 * - Summary positioning
 * - Cache key generation
 *
 * @param messages - Full conversation history
 * @param currentMessage - Current user message
 * @param options - Configuration options
 * @returns Complete conversation context
 *
 * @example
 * ```typescript
 * const ctx = buildConversationContext(
 *   conversationHistory,
 *   "What about section 3?",
 *   {
 *     maxMessages: 10,
 *     summaryContext: existingSummary,
 *     categorySlugs: ['hr', 'policies']
 *   }
 * );
 *
 * if (ctx.followUp.isFollowUp) {
 *   // Include follow-up hint in context
 * }
 * ```
 */
export function buildConversationContext(
  messages: Message[],
  currentMessage: string,
  options: ContextOptions = {}
): ConversationContext {
  const {
    maxMessages = 10,
    maxTokens = 6000,
    summaryContext,
    memoryContext,
    categorySlugs = [],
  } = options;

  // 1. Detect follow-up
  const { isFollowUp, confidence } = detectFollowUp(currentMessage);

  // 2. Build optimized history
  const history = buildHistory(messages, maxMessages, maxTokens);
  const lastExchange = getLastExchange(messages);

  // 3. Build follow-up hint if detected
  let followUpHint: string | null = null;
  if (isFollowUp && lastExchange) {
    const maxQLen = 300;
    const maxALen = 500;
    const q = lastExchange.question.substring(0, maxQLen);
    const a = lastExchange.answer.substring(0, maxALen);
    const qTruncated = lastExchange.question.length > maxQLen;
    const aTruncated = lastExchange.answer.length > maxALen;

    followUpHint = `## Immediate Context (Follow-up Detected)
The user's previous question: "${q}${qTruncated ? '...' : ''}"
Your response: "${a}${aTruncated ? '...' : ''}"

The current message appears to be a follow-up. Consider the above context when responding.
---`;
  }

  // 4. Determine summary position
  // If follow-up, place summary closer to question for better LLM attention
  // If not follow-up, place before RAG to frame document interpretation
  const summaryExists = Boolean(summaryContext?.trim());
  const summaryPosition: 'before_rag' | 'before_question' = isFollowUp ? 'before_question' : 'before_rag';

  // 5. Calculate tokens
  const summaryTokens = summaryContext ? countTokens(summaryContext) : 0;
  const totalTokens = history.tokens + summaryTokens;

  // 6. Build cache fingerprints
  const historyFingerprint = history.all.length > 0
    ? hashQuery(
        history.all
          .slice(-3)
          .map(m => `${m.role[0]}:${m.content.substring(0, 30)}`)
          .join('|')
      )
    : 'empty';

  const summaryFingerprint = summaryContext
    ? hashQuery(summaryContext.substring(0, 100))
    : null;

  const memoryFingerprint = memoryContext
    ? hashQuery(memoryContext.substring(0, 100))
    : null;

  // 7. Build cache key
  const cacheKey = buildCacheKey(
    currentMessage,
    isFollowUp,
    historyFingerprint,
    summaryFingerprint,
    memoryFingerprint,
    categorySlugs
  );

  // Don't cache follow-up responses (too context-dependent)
  const isCacheable = !isFollowUp && !summaryExists;

  return {
    history: {
      anchors: history.anchors,
      recent: history.recent,
      all: history.all,
      lastExchange,
    },
    followUp: {
      isFollowUp,
      confidence,
      hint: followUpHint,
    },
    summary: {
      exists: summaryExists,
      content: summaryContext || null,
      position: summaryPosition,
    },
    cache: {
      key: cacheKey,
      isCacheable,
      reason: !isCacheable
        ? isFollowUp
          ? 'follow-up question'
          : 'has summary context'
        : undefined,
    },
    tokens: {
      history: history.tokens,
      summary: summaryTokens,
      total: totalTokens,
      budget: maxTokens,
      remaining: maxTokens - totalTokens,
    },
  };
}

// ============ Message Formatting ============

/**
 * Format the user message with proper context ordering
 *
 * Ordering depends on context:
 * - Follow-up hint (if detected)
 * - Summary (position varies based on follow-up)
 * - RAG context
 * - Current question
 *
 * @param ctx - Conversation context
 * @param ragContext - Retrieved document context
 * @param currentQuestion - Current user question
 * @returns Formatted user message string
 */
export function formatUserMessage(
  ctx: ConversationContext,
  ragContext: string,
  currentQuestion: string
): string {
  const parts: string[] = [];

  // 1. Add follow-up hint if detected (highest priority)
  if (ctx.followUp.hint) {
    parts.push(ctx.followUp.hint);
  }

  // 2. Add summary BEFORE RAG if positioned there
  if (ctx.summary.exists && ctx.summary.position === 'before_rag') {
    parts.push(`## Previous Conversation Summary
${ctx.summary.content}

---`);
  }

  // 3. Add RAG context
  if (ragContext && ragContext.trim()) {
    parts.push(`## Relevant Documents
${ragContext}`);
  }

  // 4. Add summary BEFORE QUESTION if positioned there
  if (ctx.summary.exists && ctx.summary.position === 'before_question') {
    parts.push(`---

## Earlier Conversation Context
${ctx.summary.content}`);
  }

  // 5. Add current question
  parts.push(`---

## Current Question
${currentQuestion}`);

  return parts.join('\n\n');
}

/**
 * Get history messages formatted for OpenAI API
 *
 * @param ctx - Conversation context
 * @returns Array of messages ready for OpenAI
 */
export function getHistoryForAPI(ctx: ConversationContext): Message[] {
  return ctx.history.all;
}
