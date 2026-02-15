/**
 * Human-in-the-Loop Handler
 *
 * Manages HITL interactions when compliance check triggers clarification needs.
 * Generates contextual questions and handles user responses.
 */

import type {
  ComplianceDecision,
  ComplianceContext,
  ComplianceGlobalConfig,
  HitlClarificationEvent,
  HitlUserResponse,
  HitlResult,
  ClarificationQuestion,
  HitlFallbackAction,
} from '../../types/compliance';
import { generateClarifications } from './clarification-generator';
import { getClarificationInstructions, getHitlModelOverride } from './consolidate';

/**
 * Handle compliance failure by generating HITL clarification event
 */
export async function handleComplianceFailure(
  decision: ComplianceDecision,
  context: ComplianceContext,
  config: ComplianceGlobalConfig
): Promise<HitlClarificationEvent | null> {
  // Only handle HITL decisions
  if (decision.decision !== 'hitl') {
    return null;
  }

  // Get skill-specific overrides
  const customInstructions = getClarificationInstructions(context.matchedSkills);
  const modelOverride = getHitlModelOverride(context.matchedSkills);

  // Apply model override if specified
  const effectiveConfig = modelOverride
    ? { ...config, clarificationModel: modelOverride }
    : config;

  // Generate contextual clarification questions
  const failedChecks = decision.checksPerformed.filter(c => !c.passed);

  const questions = await generateClarifications(
    {
      failures: failedChecks,
      originalQuery: context.userMessage,
      skillContext: context.matchedSkills.map(s => s.name).join(', '),
      toolResults: context.toolExecutions,
      customInstructions,
    },
    effectiveConfig
  );

  // Build fallback actions
  const fallbackActions: HitlFallbackAction[] = [
    { action: 'accept', label: 'Accept current response' },
  ];

  if (config.allowAcceptFlagged) {
    fallbackActions.push({
      action: 'accept_flagged',
      label: 'Accept but flag for review',
    });
  }

  fallbackActions.push({ action: 'cancel', label: 'Cancel' });

  return {
    type: 'hitl_clarification',
    messageId: context.messageId || '',
    score: decision.score,
    issues: decision.issues,
    questions,
    fallbackActions,
  };
}

/**
 * Apply user's clarification responses
 * Returns retry context if user chose to retry
 */
export function applyUserClarifications(
  userResponse: HitlUserResponse,
  context: ComplianceContext
): HitlResult {
  // Handle fallback actions
  if (userResponse.fallbackAction) {
    switch (userResponse.fallbackAction) {
      case 'accept':
      case 'accept_flagged':
        return { action: 'continue' };
      case 'cancel':
        return { action: 'continue' }; // Let the caller handle cancellation
      case 'retry':
        return {
          action: 'retry',
          retryContext: buildRetryContext(userResponse, context),
        };
      default:
        return { action: 'continue' };
    }
  }

  // If user provided responses to questions, build retry context
  if (Object.keys(userResponse.responses).length > 0 ||
      Object.keys(userResponse.freeTextInputs).length > 0) {
    return {
      action: 'retry',
      retryContext: buildRetryContext(userResponse, context),
    };
  }

  return { action: 'continue' };
}

/**
 * Build retry context from user's responses
 */
function buildRetryContext(
  userResponse: HitlUserResponse,
  context: ComplianceContext
): Record<string, unknown> {
  const retryContext: Record<string, unknown> = {
    originalQuery: context.userMessage,
    clarifications: [],
  };

  // Process each response
  for (const [questionId, optionId] of Object.entries(userResponse.responses)) {
    const clarification: Record<string, unknown> = {
      questionId,
      selectedOption: optionId,
    };

    // Add free text if provided
    if (userResponse.freeTextInputs[questionId]) {
      clarification.freeText = userResponse.freeTextInputs[questionId];
    }

    (retryContext.clarifications as Record<string, unknown>[]).push(clarification);
  }

  // Add standalone free text inputs
  for (const [questionId, text] of Object.entries(userResponse.freeTextInputs)) {
    if (!userResponse.responses[questionId]) {
      (retryContext.clarifications as Record<string, unknown>[]).push({
        questionId,
        freeText: text,
      });
    }
  }

  return retryContext;
}

/**
 * Check if HITL should be skipped (e.g., automated scenarios)
 */
export function shouldSkipHitl(
  context: ComplianceContext,
  config: ComplianceGlobalConfig
): boolean {
  // Skip if HITL is globally disabled
  if (!config.enableHitl) {
    return true;
  }

  // Could add more conditions here (e.g., API calls vs UI)

  return false;
}

/**
 * Get action label for display
 */
export function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    continue: 'Continue',
    accept: 'Accept Current Response',
    accept_flagged: 'Accept but Flag for Review',
    retry: 'Retry with Changes',
    cancel: 'Cancel',
  };

  return labels[action] || action;
}
