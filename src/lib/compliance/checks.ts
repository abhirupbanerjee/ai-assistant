/**
 * Compliance Check Implementations
 *
 * Individual check functions that verify tool outputs and response content.
 */

import type {
  ComplianceCheckResult,
  ToolExecutionRecord,
  CheckType,
} from '../../types/compliance';

/**
 * Check if a tool executed successfully (no error)
 */
export function checkToolSuccess(
  execution: ToolExecutionRecord,
  ruleName: string = 'Tool Success'
): ComplianceCheckResult {
  const passed = execution.success && !execution.error;

  return {
    rule: ruleName,
    checkType: 'tool_success',
    target: execution.toolName,
    passed,
    detail: passed
      ? `${execution.toolName} executed successfully`
      : `${execution.toolName} failed: ${execution.error || execution.failureType || 'Unknown error'}`,
    weight: 25,
  };
}

/**
 * Check if a tool returned data (not empty)
 */
export function checkDataReturned(
  execution: ToolExecutionRecord,
  minResults: number = 1,
  ruleName: string = 'Data Returned'
): ComplianceCheckResult {
  const resultCount = execution.resultCount ?? 0;
  const passed = execution.success && resultCount >= minResults;

  return {
    rule: ruleName,
    checkType: 'data_returned',
    target: execution.toolName,
    passed,
    detail: passed
      ? `${execution.toolName} returned ${resultCount} result(s)`
      : `${execution.toolName} returned ${resultCount} result(s), expected at least ${minResults}`,
    weight: 25,
  };
}

/**
 * Check if an artifact (chart, document, image) is valid
 */
export function checkArtifactValid(
  execution: ToolExecutionRecord,
  config: { requireUrl?: boolean; minDataPoints?: number } = {},
  ruleName: string = 'Artifact Valid'
): ComplianceCheckResult {
  let passed = execution.success;
  let detail = '';

  // Check for URL requirement (doc_gen, image_gen)
  if (config.requireUrl) {
    const hasUrl = !!execution.artifactUrl;
    passed = passed && hasUrl;
    detail = hasUrl
      ? `${execution.toolName} generated artifact successfully`
      : `${execution.toolName} did not generate artifact URL`;
  }

  // Check for data points (chart_gen)
  if (config.minDataPoints !== undefined) {
    const dataPoints = execution.dataPoints ?? 0;
    const hasEnoughData = dataPoints >= config.minDataPoints;
    passed = passed && hasEnoughData;
    detail = hasEnoughData
      ? `${execution.toolName} has ${dataPoints} data point(s)`
      : `${execution.toolName} has ${dataPoints} data point(s), expected at least ${config.minDataPoints}`;
  }

  // Default detail if none set
  if (!detail) {
    detail = passed
      ? `${execution.toolName} artifact is valid`
      : `${execution.toolName} artifact validation failed`;
  }

  return {
    rule: ruleName,
    checkType: 'artifact_valid',
    target: execution.toolName,
    passed,
    detail,
    weight: 30,
  };
}

/**
 * Check if required markdown sections are present in the response
 */
export function checkSectionsPresent(
  response: string,
  requiredSections: string[],
  ruleName: string = 'Sections Present'
): ComplianceCheckResult {
  const missingSections: string[] = [];
  const foundSections: string[] = [];

  for (const section of requiredSections) {
    // Normalize the section header (remove ## prefix if present for matching)
    const sectionPattern = section.startsWith('##')
      ? section
      : `## ${section}`;

    // Check if the section exists in the response (case-insensitive)
    const regex = new RegExp(escapeRegExp(sectionPattern), 'i');
    if (regex.test(response)) {
      foundSections.push(section);
    } else {
      missingSections.push(section);
    }
  }

  const passed = missingSections.length === 0;

  return {
    rule: ruleName,
    checkType: 'sections_present',
    target: 'response',
    passed,
    detail: passed
      ? `All ${requiredSections.length} required section(s) present`
      : `Missing section(s): ${missingSections.join(', ')}`,
    weight: 20,
  };
}

/**
 * Run a check based on check type
 */
export function runCheck(
  checkType: CheckType,
  execution: ToolExecutionRecord | null,
  response: string,
  config: Record<string, unknown>,
  ruleName: string
): ComplianceCheckResult {
  switch (checkType) {
    case 'tool_success':
      if (!execution) {
        return {
          rule: ruleName,
          checkType,
          target: 'unknown',
          passed: false,
          detail: 'Tool execution record not found',
          weight: 25,
        };
      }
      return checkToolSuccess(execution, ruleName);

    case 'data_returned':
      if (!execution) {
        return {
          rule: ruleName,
          checkType,
          target: 'unknown',
          passed: false,
          detail: 'Tool execution record not found',
          weight: 25,
        };
      }
      return checkDataReturned(
        execution,
        (config.minResults as number) ?? 1,
        ruleName
      );

    case 'artifact_valid':
      if (!execution) {
        return {
          rule: ruleName,
          checkType,
          target: 'unknown',
          passed: false,
          detail: 'Tool execution record not found',
          weight: 30,
        };
      }
      return checkArtifactValid(
        execution,
        {
          requireUrl: config.requireUrl as boolean,
          minDataPoints: config.minDataPoints as number,
        },
        ruleName
      );

    case 'sections_present':
      return checkSectionsPresent(
        response,
        (config.sections as string[]) ?? [],
        ruleName
      );

    default:
      return {
        rule: ruleName,
        checkType,
        target: 'unknown',
        passed: false,
        detail: `Unknown check type: ${checkType}`,
        weight: 10,
      };
  }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
