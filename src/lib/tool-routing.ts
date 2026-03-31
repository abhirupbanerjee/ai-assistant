/**
 * Tool Routing Engine
 *
 * Matches user messages against configured routing rules to determine
 * whether to force specific tool calls via OpenAI's tool_choice parameter.
 */

import { getActiveRoutingRules } from './db/compat/tool-routing';
import { toolsLogger as logger } from './logger';
import type { RoutingDecision, ToolRoutingResult } from '../types/tool-routing';

// ============ Pattern Matching ============

/**
 * Match a keyword pattern against a message using word boundaries
 * Case-insensitive matching
 */
function matchKeyword(message: string, pattern: string): boolean {
  // Escape regex special characters in the pattern
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Create word boundary regex
  const regex = new RegExp(`\\b${escaped}(?:e?s)?\\b`, 'i');
  return regex.test(message);
}

/**
 * Match a regex pattern against a message
 * Returns false if the regex is invalid
 */
function matchRegex(message: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(message);
  } catch {
    logger.warn('Invalid regex pattern in routing rule', { pattern });
    return false;
  }
}

// ============ Tool Choice Determination ============

/**
 * Determine the tool_choice parameter based on matched rules
 *
 * Logic:
 * - No matches → 'auto' (let LLM decide)
 * - Single 'required' match → force that specific tool
 * - Multiple 'required' matches → 'required' (force some tool, LLM picks which)
 * - Only 'preferred' matches → 'required' (force some tool)
 * - Only 'suggested' matches → 'auto' (hint but don't force)
 */
function determineToolChoice(
  matches: ToolRoutingResult[]
): RoutingDecision['toolChoice'] {
  if (matches.length === 0) {
    return 'auto';
  }

  // Sort by force mode priority (required > preferred > suggested)
  const sorted = [...matches].sort((a, b) => {
    const order = { required: 0, preferred: 1, suggested: 2 };
    return order[a.forceMode] - order[b.forceMode];
  });

  const top = sorted[0];

  // Count how many 'required' matches we have
  const requiredMatches = sorted.filter((m) => m.forceMode === 'required');

  // Multiple required tools = let LLM pick between them
  if (requiredMatches.length > 1) {
    return 'required';
  }

  // Single required tool = force that specific tool
  if (requiredMatches.length === 1) {
    const toolName = requiredMatches[0].toolName;
    // function_api is a dynamic tool that injects multiple function definitions
    // Don't force a specific function name - let LLM pick from injected functions
    if (toolName === 'function_api') {
      return 'required';
    }
    return {
      type: 'function' as const,
      function: { name: toolName },
    };
  }

  // No required, check preferred
  if (top.forceMode === 'preferred') {
    return 'required';
  }

  // Only suggested = just hint, don't force
  return 'auto';
}

// ============ Main Routing Function ============

/**
 * Resolve tool routing for a user message
 *
 * Matches the message against all active routing rules (filtered by category)
 * and returns a routing decision including matched rules and the tool_choice
 * parameter to use with the OpenAI API.
 *
 * @param userMessage - The user's message to match against rules
 * @param categoryIds - Category IDs to filter rules by (empty = all rules)
 * @returns RoutingDecision with matches and toolChoice
 */
export async function resolveToolRouting(
  userMessage: string,
  categoryIds: number[]
): Promise<RoutingDecision> {
  const rules = await getActiveRoutingRules(categoryIds);
  const messageLower = userMessage.toLowerCase();
  const matches: ToolRoutingResult[] = [];

  // Track which tools we've already matched to avoid duplicates
  const matchedTools = new Set<string>();

  for (const rule of rules) {
    // Skip if we already have a match for this tool
    if (matchedTools.has(rule.toolName)) {
      continue;
    }

    for (const pattern of rule.patterns) {
      const isMatch =
        rule.ruleType === 'keyword'
          ? matchKeyword(messageLower, pattern)
          : matchRegex(messageLower, pattern);

      if (isMatch) {
        matches.push({
          toolName: rule.toolName,
          forceMode: rule.forceMode,
          ruleName: rule.ruleName,
          matchedPattern: pattern,
        });
        matchedTools.add(rule.toolName);
        break; // One match per rule is enough
      }
    }
  }

  // Determine tool_choice based on matches
  const toolChoice = determineToolChoice(matches);

  // Log routing decision
  if (matches.length > 0) {
    logger.debug('Tool routing matched', {
      matchCount: matches.length,
      matches: matches.map((m) => ({
        tool: m.toolName,
        pattern: m.matchedPattern,
        mode: m.forceMode,
      })),
      toolChoice:
        typeof toolChoice === 'object' ? toolChoice.function.name : toolChoice,
    });
  }

  return { matches, toolChoice };
}

/**
 * Test routing rules against a message (for admin UI)
 *
 * @param message - Test message
 * @param categoryIds - Category IDs to filter rules by
 * @returns Detailed test results
 */
export async function testToolRouting(
  message: string,
  categoryIds: number[]
): Promise<{
  message: string;
  categoryIds: number[];
  matches: {
    ruleName: string;
    toolName: string;
    pattern: string;
    forceMode: string;
  }[];
  finalToolChoice: string;
}> {
  const decision = await resolveToolRouting(message, categoryIds);

  return {
    message,
    categoryIds,
    matches: decision.matches.map((m) => ({
      ruleName: m.ruleName,
      toolName: m.toolName,
      pattern: m.matchedPattern,
      forceMode: m.forceMode,
    })),
    finalToolChoice:
      typeof decision.toolChoice === 'object'
        ? `function:${decision.toolChoice.function.name}`
        : decision.toolChoice,
  };
}

/**
 * Check if routing would force a specific tool for a message
 *
 * @param userMessage - The user's message
 * @param categoryIds - Category IDs to filter rules by
 * @returns The tool name if forced, or null if not forced
 */
export async function getForcedToolName(
  userMessage: string,
  categoryIds: number[]
): Promise<string | null> {
  const decision = await resolveToolRouting(userMessage, categoryIds);

  if (
    typeof decision.toolChoice === 'object' &&
    decision.toolChoice.type === 'function'
  ) {
    return decision.toolChoice.function.name;
  }

  return null;
}
