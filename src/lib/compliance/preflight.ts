/**
 * Pre-flight Clarification Module
 *
 * Assesses query ambiguity BEFORE response generation and triggers
 * clarification questions when needed. Gated behind two-level config:
 * global preflightEnabled + per-skill preflightClarification.enabled.
 */

import type {
  ComplianceGlobalConfig,
  SkillComplianceConfig,
  PreflightClarificationEvent,
  ResolvedPreflightConfig,
  ClarificationQuestion,
  HitlFallbackAction,
} from '../../types/compliance';

const MIN_TIMEOUT_MS = 5000;   // 5 seconds minimum
const MAX_TIMEOUT_MS = 900000; // 15 minutes hard cap

/**
 * Check if preflight is enabled for any matched skill.
 * Requires both global preflightEnabled AND at least one skill with preflight opt-in.
 */
export function hasPreflightEnabled(
  globalConfig: ComplianceGlobalConfig,
  skills: Array<{ complianceConfig?: { preflightClarification?: { enabled: boolean } } | null }>
): boolean {
  if (!globalConfig.preflightEnabled) return false;
  return skills.some(s => s.complianceConfig?.preflightClarification?.enabled === true);
}

/**
 * Find the first skill with preflight enabled and return its config.
 */
export function findPreflightSkill(
  skills: Array<{ name: string; complianceConfig?: SkillComplianceConfig | null }>
): { name: string; config: NonNullable<SkillComplianceConfig['preflightClarification']> } | null {
  for (const skill of skills) {
    const pf = skill.complianceConfig?.preflightClarification;
    if (pf?.enabled) {
      return { name: skill.name, config: pf };
    }
  }
  return null;
}

/**
 * Merge global defaults with per-skill overrides.
 * Caps timeout at MAX_TIMEOUT_MS (15 min).
 */
export function resolvePreflightConfig(
  globalConfig: ComplianceGlobalConfig,
  skillConfig?: SkillComplianceConfig['preflightClarification']
): ResolvedPreflightConfig {
  const timeoutMs = Math.max(
    MIN_TIMEOUT_MS,
    Math.min(skillConfig?.timeoutMs ?? globalConfig.preflightDefaultTimeoutMs, MAX_TIMEOUT_MS)
  );

  return {
    enabled: globalConfig.preflightEnabled && (skillConfig?.enabled ?? false),
    instructions: skillConfig?.instructions,
    maxQuestions: skillConfig?.maxQuestions ?? globalConfig.preflightMaxQuestions,
    timeoutMs,
    skipOnFollowUp: skillConfig?.skipOnFollowUp ?? globalConfig.preflightSkipOnFollowUp,
  };
}

/**
 * Run preflight assessment: call LLM to evaluate query ambiguity.
 * Returns PreflightClarificationEvent if questions are needed, null if query is clear.
 *
 * Never throws — returns null on any error so the pipeline continues.
 */
export async function runPreflightAssessment(
  message: string,
  messageId: string,
  resolvedConfig: ResolvedPreflightConfig,
  globalConfig: ComplianceGlobalConfig,
  skillName?: string,
): Promise<PreflightClarificationEvent | null> {
  try {
    const { generatePreflightClarifications } = await import('./clarification-generator');

    const questions = await generatePreflightClarifications(
      message,
      resolvedConfig,
      globalConfig,
    );

    // No ambiguity detected — proceed without interruption
    if (!questions || questions.length === 0) {
      return null;
    }

    // Cap to maxQuestions
    const cappedQuestions = questions.slice(0, resolvedConfig.maxQuestions);

    const fallbackActions: HitlFallbackAction[] = [
      { action: 'continue', label: 'Skip — proceed without clarification' },
      { action: 'cancel', label: 'Cancel' },
    ];

    return {
      type: 'hitl_preflight',
      messageId,
      questions: cappedQuestions,
      fallbackActions,
      timeoutMs: resolvedConfig.timeoutMs,
      skillName,
    };
  } catch (error) {
    console.warn('[Preflight] Assessment failed, proceeding without clarification:', error);
    return null;
  }
}
