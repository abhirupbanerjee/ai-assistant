/**
 * Compliance Checker Tool
 *
 * Processor tool that validates response completeness and tool outputs.
 * Features auto-detection of tool requirements from activated skills
 * and intelligent HITL with LLM-generated contextual clarifications.
 */

import { getToolConfig } from '../db/compat/tool-config';
import type { ToolDefinition, ValidationResult } from '../tools';
import type {
  ComplianceContext,
  ComplianceGlobalConfig,
  ComplianceDecision,
  HitlClarificationEvent,
} from '../../types/compliance';
import { runComplianceCheck, DEFAULT_COMPLIANCE_CONFIG } from '../compliance/engine';
import { handleComplianceFailure } from '../compliance/hitl';
import { saveComplianceResult } from '@/lib/db/compat';

// ===== Types =====

export interface ComplianceCheckerArgs {
  /** User's original message */
  userMessage: string;
  /** Assistant's response content */
  response: string;
  /** Tool execution records from the response */
  toolExecutions: ComplianceContext['toolExecutions'];
  /** Matched skills with their compliance configs */
  matchedSkills: ComplianceContext['matchedSkills'];
  /** Tool routing matches from skill system */
  toolRoutingMatches?: { toolName: string; forceMode: string }[];
  /** Message ID for logging */
  messageId?: string;
  /** Conversation ID for logging */
  conversationId?: string;
}

export interface ComplianceCheckerResult {
  success: boolean;
  decision: ComplianceDecision;
  hitlEvent?: HitlClarificationEvent;
  savedResultId?: number;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

// ===== Default Configuration =====

export const COMPLIANCE_CHECKER_DEFAULTS: ComplianceGlobalConfig = {
  ...DEFAULT_COMPLIANCE_CONFIG,
};

// ===== Configuration Schema =====

const complianceCheckerConfigSchema = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      title: 'Enable Compliance Checking',
      description: 'Enable or disable compliance validation globally. When enabled, only skills with compliance explicitly enabled will be checked.',
      default: true,
    },
    passThreshold: {
      type: 'number',
      title: 'Pass Threshold',
      description: 'Minimum score (0-100) for a response to pass. Recommended: 70-80. Responses scoring above this are accepted automatically.',
      minimum: 0,
      maximum: 100,
      default: 80,
    },
    warnThreshold: {
      type: 'number',
      title: 'Warning Threshold',
      description: 'Minimum score for warning (below this triggers HITL). Recommended: 40-60. Responses between this and pass threshold show a warning badge.',
      minimum: 0,
      maximum: 100,
      default: 50,
    },
    enableHitl: {
      type: 'boolean',
      title: 'Enable Human-in-the-Loop',
      description: 'Show clarification dialog when compliance score is below warning threshold. Users can answer questions, accept as-is, or retry.',
      default: true,
    },
    useWeightedScoring: {
      type: 'boolean',
      title: 'Use Weighted Scoring',
      description: 'Weight checks by importance: artifact failures=30%, tool errors=25%, empty results=25%, missing sections=20%. When disabled, all checks have equal weight.',
      default: true,
    },
    clarificationProvider: {
      type: 'string',
      title: 'Clarification LLM Provider',
      description: 'Provider for generating clarification questions. Select "auto" to use the same provider configured in LLM Settings.',
      enum: ['auto', 'openai', 'gemini', 'mistral'],
      default: 'auto',
    },
    clarificationModel: {
      type: 'string',
      title: 'Clarification Model',
      description: 'Model for generating clarifications. Leave empty to use the default model from LLM Settings. Tip: Use cheaper/faster models like gpt-4.1-mini for cost savings.',
      default: '',
    },
    useLlmClarifications: {
      type: 'boolean',
      title: 'Use LLM Clarifications',
      description: 'Generate contextual questions using LLM. When disabled, uses pre-defined templates for common scenarios (empty search, failed charts, missing sections, etc.).',
      default: true,
    },
    clarificationTimeout: {
      type: 'number',
      title: 'Clarification Timeout (ms)',
      description: 'Maximum wait time for LLM clarification generation. Recommended: 3000-5000ms. Falls back to templates if exceeded and fallback is enabled.',
      minimum: 1000,
      maximum: 30000,
      default: 5000,
    },
    fallbackToTemplates: {
      type: 'boolean',
      title: 'Fallback to Templates',
      description: 'If LLM clarification fails or times out, show template questions instead. Templates exist for: empty search results, failed charts, missing sections, failed document/image generation, data source errors, and general tool errors.',
      default: true,
    },
    allowAcceptFlagged: {
      type: 'boolean',
      title: 'Allow "Accept & Flag"',
      description: 'Show "Accept but flag for review" option in HITL dialog. Lets users accept responses despite compliance issues while marking them for admin review later.',
      default: true,
    },
  },
};

// ===== Helper Functions =====

/**
 * Get tool configuration with defaults
 */
export async function getComplianceConfig(): Promise<ComplianceGlobalConfig> {
  const config = await getToolConfig('compliance_checker');
  if (config?.config) {
    const c = config.config as Record<string, unknown>;
    return {
      enabled: (c.enabled as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.enabled,
      passThreshold: (c.passThreshold as number) ?? COMPLIANCE_CHECKER_DEFAULTS.passThreshold,
      warnThreshold: (c.warnThreshold as number) ?? COMPLIANCE_CHECKER_DEFAULTS.warnThreshold,
      enableHitl: (c.enableHitl as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.enableHitl,
      useWeightedScoring: (c.useWeightedScoring as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.useWeightedScoring,
      clarificationProvider: (c.clarificationProvider as ComplianceGlobalConfig['clarificationProvider']) ?? COMPLIANCE_CHECKER_DEFAULTS.clarificationProvider,
      clarificationModel: (c.clarificationModel as string) ?? COMPLIANCE_CHECKER_DEFAULTS.clarificationModel,
      useLlmClarifications: (c.useLlmClarifications as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.useLlmClarifications,
      clarificationTimeout: (c.clarificationTimeout as number) ?? COMPLIANCE_CHECKER_DEFAULTS.clarificationTimeout,
      fallbackToTemplates: (c.fallbackToTemplates as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.fallbackToTemplates,
      allowAcceptFlagged: (c.allowAcceptFlagged as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.allowAcceptFlagged,
      // Pre-flight clarification
      preflightEnabled: (c.preflightEnabled as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.preflightEnabled,
      preflightDefaultTimeoutMs: (c.preflightDefaultTimeoutMs as number) ?? COMPLIANCE_CHECKER_DEFAULTS.preflightDefaultTimeoutMs,
      preflightMaxQuestions: (c.preflightMaxQuestions as number) ?? COMPLIANCE_CHECKER_DEFAULTS.preflightMaxQuestions,
      preflightSkipOnFollowUp: (c.preflightSkipOnFollowUp as boolean) ?? COMPLIANCE_CHECKER_DEFAULTS.preflightSkipOnFollowUp,
    };
  }
  return COMPLIANCE_CHECKER_DEFAULTS;
}

/**
 * Format successful response
 */
function formatResponse(result: ComplianceCheckerResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format error response
 */
function formatError(code: string, message: string, details?: string): string {
  const result: ComplianceCheckerResult = {
    success: false,
    decision: {
      score: 0,
      decision: 'hitl',
      issues: [message],
      checksPerformed: [],
      failedChecks: [],
      badgeType: 'error',
      badgeText: 'Error',
    },
    error: { code, message, details },
  };
  return JSON.stringify(result, null, 2);
}

// ===== Validation Function =====

/**
 * Validate compliance_checker tool configuration
 */
function validateComplianceConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate thresholds
  if (config.passThreshold !== undefined) {
    const threshold = config.passThreshold as number;
    if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
      errors.push('passThreshold must be between 0 and 100');
    }
  }

  if (config.warnThreshold !== undefined) {
    const threshold = config.warnThreshold as number;
    if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
      errors.push('warnThreshold must be between 0 and 100');
    }
  }

  // Ensure pass > warn
  const pass = (config.passThreshold as number) ?? COMPLIANCE_CHECKER_DEFAULTS.passThreshold;
  const warn = (config.warnThreshold as number) ?? COMPLIANCE_CHECKER_DEFAULTS.warnThreshold;
  if (pass <= warn) {
    errors.push('passThreshold must be greater than warnThreshold');
  }

  // Validate provider
  const validProviders = ['openai', 'gemini', 'mistral', 'auto'];
  if (config.clarificationProvider && !validProviders.includes(config.clarificationProvider as string)) {
    errors.push(`clarificationProvider must be one of: ${validProviders.join(', ')}`);
  }

  // Validate timeout
  if (config.clarificationTimeout !== undefined) {
    const timeout = config.clarificationTimeout as number;
    if (typeof timeout !== 'number' || timeout < 1000 || timeout > 30000) {
      errors.push('clarificationTimeout must be between 1000 and 30000 ms');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== Tool Definition =====

/**
 * Compliance checker tool implementation
 */
export const complianceCheckerTool: ToolDefinition = {
  name: 'compliance_checker',
  displayName: 'Compliance Checker',
  description: 'Validates response completeness and tool outputs with weighted scoring and intelligent HITL clarifications.',
  category: 'processor',

  // Processor tools don't have OpenAI function definitions
  definition: undefined,

  configSchema: complianceCheckerConfigSchema,

  defaultConfig: COMPLIANCE_CHECKER_DEFAULTS as unknown as Record<string, unknown>,

  execute: async (args: Record<string, unknown>): Promise<string> => {
    const typedArgs = args as unknown as ComplianceCheckerArgs;
    const config = await getComplianceConfig();

    // Check if compliance is enabled
    if (!config.enabled) {
      return formatResponse({
        success: true,
        decision: {
          score: 100,
          decision: 'pass',
          issues: [],
          checksPerformed: [],
          failedChecks: [],
          badgeType: 'success',
          badgeText: 'Pass',
        },
      });
    }

    // Validate required args
    if (!typedArgs.response) {
      return formatError('VALIDATION_ERROR', 'response is required');
    }

    if (!typedArgs.matchedSkills || !Array.isArray(typedArgs.matchedSkills)) {
      return formatError('VALIDATION_ERROR', 'matchedSkills is required and must be an array');
    }

    try {
      // Build compliance context
      const context: ComplianceContext = {
        userMessage: typedArgs.userMessage || '',
        response: typedArgs.response,
        toolExecutions: typedArgs.toolExecutions || [],
        matchedSkills: typedArgs.matchedSkills,
        toolRoutingMatches: typedArgs.toolRoutingMatches || [],
        messageId: typedArgs.messageId,
        conversationId: typedArgs.conversationId,
      };

      // Run compliance check
      const decision = await runComplianceCheck(context, config);

      // Handle HITL if needed
      let hitlEvent: HitlClarificationEvent | null = null;
      if (decision.decision === 'hitl' && config.enableHitl) {
        hitlEvent = await handleComplianceFailure(decision, context, config);
      }

      // Save result to database if we have IDs
      let savedResultId: number | undefined;
      if (typedArgs.messageId && typedArgs.conversationId) {
        const skillIds = typedArgs.matchedSkills.map(s => s.id);
        savedResultId = await saveComplianceResult(
          typedArgs.messageId,
          typedArgs.conversationId,
          skillIds,
          decision,
          hitlEvent || undefined
        );
      }

      return formatResponse({
        success: true,
        decision,
        hitlEvent: hitlEvent || undefined,
        savedResultId,
      });
    } catch (error) {
      console.error('[ComplianceChecker] Execution error:', error);
      return formatError(
        'EXECUTION_ERROR',
        'Failed to run compliance check',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  },

  validateConfig: validateComplianceConfig,
};

export default complianceCheckerTool;
