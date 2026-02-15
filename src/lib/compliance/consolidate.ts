/**
 * Rule Consolidation for Multi-Skill Scenarios
 *
 * When multiple skills match a query, this module merges their
 * compliance rules, sections, and thresholds into a unified check.
 */

import type {
  ComplianceRule,
  ConsolidatedRules,
  ToolRoutingMatch,
  ComplianceGlobalConfig,
  SkillComplianceConfig,
  MatchedSkillInfo,
} from '../../types/compliance';
import { getDefaultRuleForTool } from './default-rules';

/**
 * Collect and consolidate rules from all matched skills
 */
export function collectConsolidatedRules(
  matchedSkills: MatchedSkillInfo[],
  toolRoutingMatches: ToolRoutingMatch[],
  globalConfig: ComplianceGlobalConfig
): ConsolidatedRules {
  const rules: ComplianceRule[] = [];
  const sections: string[] = [];
  const thresholds: { pass: number[]; warn: number[] } = { pass: [], warn: [] };

  // 1. Auto-apply default tool rules from toolRouting.matches
  for (const match of toolRoutingMatches) {
    const defaultRule = getDefaultRuleForTool(match.toolName);
    if (defaultRule) {
      rules.push({
        ...defaultRule,
        sourceSkillId: match.skillId,
        sourceSkillName: match.skillName,
      });
    }
  }

  // 2. Collect sections and threshold overrides from all skills with compliance enabled
  for (const skill of matchedSkills) {
    const config = skill.complianceConfig;
    if (!config?.enabled) continue;

    // Collect sections
    if (config.sections && config.sections.length > 0) {
      sections.push(...config.sections);
    }

    // Collect threshold overrides
    if (config.passThreshold !== undefined) {
      thresholds.pass.push(config.passThreshold);
    }
    if (config.warnThreshold !== undefined) {
      thresholds.warn.push(config.warnThreshold);
    }

    // Apply per-tool check overrides from skill config
    if (config.toolChecks) {
      for (const [toolName, override] of Object.entries(config.toolChecks)) {
        // Find the rule for this tool
        const ruleIndex = rules.findIndex(
          r => r.sourceSkillId === skill.id && r.checkType !== 'sections_present'
        );

        if (ruleIndex >= 0) {
          // Apply overrides
          if (override.failureAction) {
            rules[ruleIndex].failureAction = override.failureAction;
          }
          if (override.minResults !== undefined) {
            rules[ruleIndex].checkConfig = {
              ...rules[ruleIndex].checkConfig,
              minResults: override.minResults,
            };
          }
        }
      }
    }
  }

  // 3. Deduplicate sections
  const uniqueSections = [...new Set(sections)];

  // 4. Add sections_present rule if any sections are required
  if (uniqueSections.length > 0) {
    rules.push({
      checkType: 'sections_present',
      checkConfig: { sections: uniqueSections },
      weight: 20,
      failureAction: 'warn',
      failureMessage: `Missing required sections: ${uniqueSections.join(', ')}`,
    });
  }

  // 5. Determine thresholds (use strictest from skills, fallback to global)
  const passThreshold =
    thresholds.pass.length > 0
      ? Math.min(...thresholds.pass)
      : globalConfig.passThreshold;
  const warnThreshold =
    thresholds.warn.length > 0
      ? Math.min(...thresholds.warn)
      : globalConfig.warnThreshold;

  return {
    rules,
    sections: uniqueSections,
    passThreshold,
    warnThreshold,
  };
}

/**
 * Check if any matched skill has compliance enabled
 */
export function hasComplianceEnabled(matchedSkills: MatchedSkillInfo[]): boolean {
  return matchedSkills.some(skill => skill.complianceConfig?.enabled);
}

/**
 * Get clarification instructions from matched skills
 * Returns the first non-empty instruction found
 */
export function getClarificationInstructions(
  matchedSkills: MatchedSkillInfo[]
): string | undefined {
  for (const skill of matchedSkills) {
    if (skill.complianceConfig?.clarificationInstructions) {
      return skill.complianceConfig.clarificationInstructions;
    }
  }
  return undefined;
}

/**
 * Get HITL model override from matched skills
 * Returns the first non-empty model found
 */
export function getHitlModelOverride(
  matchedSkills: MatchedSkillInfo[]
): string | undefined {
  for (const skill of matchedSkills) {
    if (skill.complianceConfig?.hitlModel) {
      return skill.complianceConfig.hitlModel;
    }
  }
  return undefined;
}
