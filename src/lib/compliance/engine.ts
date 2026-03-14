/**
 * Compliance Engine
 *
 * Main compliance runner that orchestrates checks, calculates scores,
 * and determines the decision (pass/warn/hitl).
 */

import type {
  ComplianceContext,
  ComplianceDecision,
  ComplianceCheckResult,
  ComplianceGlobalConfig,
  ConsolidatedRules,
  CHECK_WEIGHTS,
} from '../../types/compliance';
import { runCheck } from './checks';
import { collectConsolidatedRules, hasComplianceEnabled } from './consolidate';
import { extractExpectedTools, findMissingRequiredTools } from './auto-detect';

/**
 * Default global compliance configuration
 */
export const DEFAULT_COMPLIANCE_CONFIG: ComplianceGlobalConfig = {
  enabled: true,
  passThreshold: 80,
  warnThreshold: 50,
  enableHitl: true,
  useWeightedScoring: true,

  clarificationProvider: 'auto',
  clarificationModel: '',  // Empty = use default LLM model from settings
  useLlmClarifications: true,
  clarificationTimeout: 5000,
  fallbackToTemplates: true,

  allowAcceptFlagged: true,

  // Pre-flight clarification defaults
  preflightEnabled: false,                // Global kill switch — off by default
  preflightDefaultTimeoutMs: 300000,      // 5 minutes
  preflightMaxQuestions: 2,               // 1-4 range
  preflightSkipOnFollowUp: true,          // Skip preflight on follow-up messages
};

/**
 * Run compliance check on a response
 */
export async function runComplianceCheck(
  context: ComplianceContext,
  globalConfig: ComplianceGlobalConfig = DEFAULT_COMPLIANCE_CONFIG
): Promise<ComplianceDecision> {
  // If no skills have compliance enabled and no tools were called, skip
  if (!hasComplianceEnabled(context.matchedSkills) && context.toolExecutions.length === 0) {
    return createPassDecision(100, []);
  }

  // Collect and consolidate rules from all matched skills
  const consolidatedRules = collectConsolidatedRules(
    context.matchedSkills,
    context.toolRoutingMatches,
    globalConfig
  );

  // Extract expected tools
  const expectedTools = extractExpectedTools(context.toolRoutingMatches);

  // Find missing required tools
  const missingRequired = findMissingRequiredTools(expectedTools, context.toolExecutions);

  // Run all checks
  const checksPerformed: ComplianceCheckResult[] = [];

  // Check for missing required tools
  for (const missing of missingRequired) {
    checksPerformed.push({
      rule: 'Required Tool',
      checkType: 'tool_success',
      target: missing.toolName,
      passed: false,
      detail: `Required tool '${missing.toolName}' was not called`,
      weight: 25,
    });
  }

  // Run consolidated rules
  for (const rule of consolidatedRules.rules) {
    // Find matching execution for tool-based checks
    const execution = context.toolExecutions.find(
      e => rule.sourceSkillId !== undefined || e.toolName === rule.checkConfig.toolName
    );

    const result = runCheck(
      rule.checkType,
      execution || null,
      context.response,
      rule.checkConfig,
      rule.failureMessage
    );

    // Override weight from rule if specified
    if (rule.weight) {
      result.weight = rule.weight;
    }

    checksPerformed.push(result);
  }

  // Also check any tools that were called but not in expected
  // (These are tools the LLM decided to call autonomously)
  for (const execution of context.toolExecutions) {
    const alreadyChecked = checksPerformed.some(c => c.target === execution.toolName);
    if (!alreadyChecked) {
      checksPerformed.push({
        rule: 'Tool Success',
        checkType: 'tool_success',
        target: execution.toolName,
        passed: execution.success,
        detail: execution.success
          ? `${execution.toolName} executed successfully`
          : `${execution.toolName} failed: ${execution.error || 'Unknown error'}`,
        weight: 25,
      });
    }
  }

  // Calculate score
  const score = globalConfig.useWeightedScoring
    ? calculateWeightedScore(checksPerformed)
    : calculateSimpleScore(checksPerformed);

  // Determine decision
  const decision = determineDecision(
    score,
    checksPerformed,
    consolidatedRules,
    globalConfig
  );

  return decision;
}

/**
 * Calculate weighted score based on check weights
 */
export function calculateWeightedScore(checks: ComplianceCheckResult[]): number {
  if (checks.length === 0) return 100;

  let totalWeight = 0;
  let earnedWeight = 0;

  for (const check of checks) {
    const weight = check.weight || 10;
    totalWeight += weight;
    if (check.passed) {
      earnedWeight += weight;
    }
  }

  if (totalWeight === 0) return 100;

  return Math.round((earnedWeight / totalWeight) * 100);
}

/**
 * Calculate simple percentage score (all checks equal)
 */
export function calculateSimpleScore(checks: ComplianceCheckResult[]): number {
  if (checks.length === 0) return 100;

  const passedCount = checks.filter(c => c.passed).length;
  return Math.round((passedCount / checks.length) * 100);
}

/**
 * Determine the compliance decision based on score and failed checks
 */
function determineDecision(
  score: number,
  checks: ComplianceCheckResult[],
  rules: ConsolidatedRules,
  config: ComplianceGlobalConfig
): ComplianceDecision {
  const failedChecks = checks.filter(c => !c.passed);
  const failedCheckNames = failedChecks.map(c => c.rule);
  const issues = failedChecks.map(c => c.detail);

  // Check for critical failures that trigger HITL regardless of score
  const hasCriticalFailure = failedChecks.some(c =>
    c.checkType === 'artifact_valid' &&
    (c.target === 'chart_gen' || c.target === 'doc_gen')
  );

  // Determine decision
  let decision: 'pass' | 'warn' | 'hitl';
  let badgeType: 'success' | 'warning' | 'error';
  let badgeText: string;

  if (hasCriticalFailure && config.enableHitl) {
    decision = 'hitl';
    badgeType = 'error';
    badgeText = 'Issues Found';
  } else if (score >= rules.passThreshold) {
    decision = 'pass';
    badgeType = 'success';
    badgeText = `${score}% Compliance`;
  } else if (score >= rules.warnThreshold) {
    decision = 'warn';
    badgeType = 'warning';
    badgeText = `${score}% - Issues Found`;
  } else {
    decision = config.enableHitl ? 'hitl' : 'warn';
    badgeType = 'error';
    badgeText = config.enableHitl ? 'Clarification Needed' : `${score}% - Issues Found`;
  }

  return {
    decision,
    score,
    checksPerformed: checks,
    failedChecks: failedCheckNames,
    issues,
    badgeType,
    badgeText,
  };
}

/**
 * Create a pass decision (used when no compliance checks needed)
 */
function createPassDecision(
  score: number,
  checks: ComplianceCheckResult[]
): ComplianceDecision {
  return {
    decision: 'pass',
    score,
    checksPerformed: checks,
    failedChecks: [],
    issues: [],
    badgeType: 'success',
    badgeText: `${score}% Compliance`,
  };
}

/**
 * Check if compliance checking should run for this context
 */
export function shouldRunComplianceCheck(
  context: ComplianceContext,
  globalConfig: ComplianceGlobalConfig
): boolean {
  // Don't run if globally disabled
  if (!globalConfig.enabled) return false;

  // Run if any skill has compliance enabled
  if (hasComplianceEnabled(context.matchedSkills)) return true;

  // Run if any tools were called (auto-detect mode)
  if (context.toolExecutions.length > 0) return true;

  // Run if any tool routing matches exist
  if (context.toolRoutingMatches.length > 0) return true;

  return false;
}
