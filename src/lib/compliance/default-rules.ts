/**
 * Default Compliance Rules
 *
 * Defines default validation rules for each tool type.
 * These are auto-applied when a tool is expected based on skill matching.
 */

import type { ComplianceRule, CheckType, FailureAction } from '../../types/compliance';

interface DefaultToolRule {
  checkType: CheckType;
  checkConfig: Record<string, unknown>;
  weight: number;
  failureAction: FailureAction;
  failureMessage: string;
}

export const DEFAULT_TOOL_RULES: Record<string, DefaultToolRule> = {
  web_search: {
    checkType: 'data_returned',
    checkConfig: { minResults: 1 },
    weight: 25,
    failureAction: 'warn',
    failureMessage: 'Web search returned no results',
  },
  chart_gen: {
    checkType: 'artifact_valid',
    checkConfig: { minDataPoints: 1 },
    weight: 30,
    failureAction: 'hitl',
    failureMessage: 'Chart has no data',
  },
  doc_gen: {
    checkType: 'artifact_valid',
    checkConfig: { requireUrl: true },
    weight: 30,
    failureAction: 'hitl',
    failureMessage: 'Document generation failed',
  },
  image_gen: {
    checkType: 'artifact_valid',
    checkConfig: { requireUrl: true },
    weight: 25,
    failureAction: 'warn',
    failureMessage: 'Image generation failed',
  },
  data_source: {
    checkType: 'data_returned',
    checkConfig: { minResults: 1 },
    weight: 25,
    failureAction: 'warn',
    failureMessage: 'Data source query returned no results',
  },
  diagram_gen: {
    checkType: 'artifact_valid',
    checkConfig: { requireUrl: true },
    weight: 25,
    failureAction: 'warn',
    failureMessage: 'Diagram generation failed',
  },
};

/**
 * Get the default rule for a tool
 */
export function getDefaultRuleForTool(toolName: string): ComplianceRule | null {
  const defaultRule = DEFAULT_TOOL_RULES[toolName];
  if (!defaultRule) return null;

  return {
    ...defaultRule,
    sourceSkillId: undefined,
    sourceSkillName: undefined,
  };
}

/**
 * Get all default rules for a list of tool names
 */
export function getDefaultRulesForTools(toolNames: string[]): ComplianceRule[] {
  const rules: ComplianceRule[] = [];

  for (const toolName of toolNames) {
    const rule = getDefaultRuleForTool(toolName);
    if (rule) {
      rules.push(rule);
    }
  }

  return rules;
}

/**
 * Check if a tool has a default rule defined
 */
export function hasDefaultRule(toolName: string): boolean {
  return toolName in DEFAULT_TOOL_RULES;
}
