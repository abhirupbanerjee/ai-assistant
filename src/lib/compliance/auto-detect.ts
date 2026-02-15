/**
 * Auto-Detection of Tool Requirements
 *
 * Extracts expected tools from skill matching results and
 * determines which validation rules should be applied.
 */

import type { ToolRoutingMatch, ToolExecutionRecord } from '../../types/compliance';
import type { ForceMode } from '../skills/types';

export interface ExpectedTool {
  toolName: string;
  skillIds: number[];
  skillNames: string[];
  forceMode: ForceMode;
}

/**
 * Extract expected tools from tool routing matches
 * Groups by tool name and tracks which skills requested each tool
 */
export function extractExpectedTools(
  toolRoutingMatches: ToolRoutingMatch[]
): Map<string, ExpectedTool> {
  const expectedTools = new Map<string, ExpectedTool>();

  for (const match of toolRoutingMatches) {
    const existing = expectedTools.get(match.toolName);

    if (existing) {
      // Add skill info to existing tool
      if (match.skillId) {
        existing.skillIds.push(match.skillId);
      }
      if (match.skillName) {
        existing.skillNames.push(match.skillName);
      }
      // Use strictest force mode (required > preferred > suggested)
      existing.forceMode = getStricterForceMode(existing.forceMode, match.forceMode as ForceMode);
    } else {
      // Create new expected tool entry
      expectedTools.set(match.toolName, {
        toolName: match.toolName,
        skillIds: match.skillId ? [match.skillId] : [],
        skillNames: match.skillName ? [match.skillName] : [],
        forceMode: (match.forceMode as ForceMode) || 'suggested',
      });
    }
  }

  return expectedTools;
}

/**
 * Compare expected tools vs actually called tools
 * Returns tools that were required but not called
 */
export function findMissingRequiredTools(
  expectedTools: Map<string, ExpectedTool>,
  toolExecutions: ToolExecutionRecord[]
): ExpectedTool[] {
  const calledToolNames = new Set(toolExecutions.map(t => t.toolName));
  const missingRequired: ExpectedTool[] = [];

  for (const [, expected] of expectedTools) {
    // Only flag required tools that weren't called
    if (expected.forceMode === 'required' && !calledToolNames.has(expected.toolName)) {
      missingRequired.push(expected);
    }
  }

  return missingRequired;
}

/**
 * Get the stricter of two force modes
 * required > preferred > suggested
 */
function getStricterForceMode(mode1: ForceMode, mode2: ForceMode): ForceMode {
  const priority: Record<ForceMode, number> = {
    required: 3,
    preferred: 2,
    suggested: 1,
  };

  return priority[mode1] >= priority[mode2] ? mode1 : mode2;
}

/**
 * Match tool executions to expected tools
 * Returns a map of tool name to execution record
 */
export function matchExecutionsToExpected(
  expectedTools: Map<string, ExpectedTool>,
  toolExecutions: ToolExecutionRecord[]
): Map<string, ToolExecutionRecord> {
  const executionMap = new Map<string, ToolExecutionRecord>();

  for (const execution of toolExecutions) {
    // Only include if tool was expected
    if (expectedTools.has(execution.toolName)) {
      executionMap.set(execution.toolName, execution);
    }
  }

  return executionMap;
}
