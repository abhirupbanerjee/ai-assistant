/**
 * Skill Resolver
 *
 * Resolves which skills to apply based on:
 * - Always-on skills (core prompts)
 * - Category-based skills (index skills for selected categories)
 * - Keyword-triggered skills (matched against user message)
 *
 * Extended to support unified keyword actions (skills + tool routing)
 */

import { getSkillsSettings, getDiagramSettings } from '../db/config';
import {
  getSkillsByTrigger,
  getIndexSkillsForCategories,
  getKeywordSkills,
  getCategoriesForSkill,
} from '../db/skills';
import type { Skill, ResolvedSkills, ForceMode, DataSourceFilter } from './types';

/**
 * Match keywords or regex patterns in message text
 * Supports comma-separated keywords in trigger_value
 * Uses match_type to determine matching strategy
 */
function matchesPattern(skill: Skill, message: string): boolean {
  if (!skill.trigger_value) return false;

  const patterns = skill.trigger_value.split(',').map(p => p.trim());
  const messageLower = message.toLowerCase();

  if (skill.match_type === 'regex') {
    // Regex mode: each pattern is a full regex
    return patterns.some(pattern => {
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(message);
      } catch {
        // Invalid regex, skip
        return false;
      }
    });
  }

  // Default: keyword mode with word boundary matching
  return patterns.some(keyword => {
    const keywordLower = keyword.toLowerCase();
    const regex = new RegExp(`\\b${escapeRegex(keywordLower)}\\b`, 'i');
    return regex.test(messageLower);
  });
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine tool_choice based on matched skills with tool routing
 */
function determineToolChoice(
  toolMatches: Array<{
    skillId: number;
    skillName: string;
    toolName: string;
    forceMode: ForceMode;
    configOverride?: Record<string, unknown>;
  }>
): 'auto' | 'required' | { type: 'function'; function: { name: string } } {
  if (toolMatches.length === 0) {
    return 'auto';
  }

  // Sort by force mode priority: required > preferred > suggested
  const forceModeOrder: Record<ForceMode, number> = {
    required: 0,
    preferred: 1,
    suggested: 2,
  };

  const sorted = [...toolMatches].sort(
    (a, b) => forceModeOrder[a.forceMode] - forceModeOrder[b.forceMode]
  );

  const topMatch = sorted[0];

  // Count required matches
  const requiredMatches = sorted.filter(m => m.forceMode === 'required');

  if (requiredMatches.length === 1) {
    // Single required match: force that specific tool
    return { type: 'function', function: { name: requiredMatches[0].toolName } };
  }

  if (requiredMatches.length > 1) {
    // Multiple required matches: force some tool (LLM picks)
    return 'required';
  }

  // No required matches - check for preferred
  const preferredMatches = sorted.filter(m => m.forceMode === 'preferred');
  if (preferredMatches.length > 0) {
    return 'required';
  }

  // Only suggested matches: don't force
  return 'auto';
}

/**
 * Resolve skills for a given context
 *
 * @param categoryIds - IDs of categories selected for the thread
 * @param userMessage - The user's message to check for keywords
 * @returns Resolved skills with combined prompt and metadata
 */
export function resolveSkills(
  categoryIds: number[],
  userMessage: string
): ResolvedSkills {
  const settings = getSkillsSettings();

  // Return empty if skills feature is disabled
  if (!settings.enabled) {
    return {
      skills: [],
      combinedPrompt: '',
      totalTokens: 0,
      activatedBy: { always: [], category: [], keyword: [] },
    };
  }

  const activatedSkills: Skill[] = [];
  const activatedBy = {
    always: [] as string[],
    category: [] as string[],
    keyword: [] as string[],
  };
  const seenIds = new Set<number>();

  // 1. Get "always" trigger skills (core prompts)
  const alwaysSkills = getSkillsByTrigger('always');
  for (const skill of alwaysSkills) {
    if (!seenIds.has(skill.id)) {
      seenIds.add(skill.id);
      activatedSkills.push(skill);
      activatedBy.always.push(skill.name);
    }
  }

  // 2. Get category index skills
  if (categoryIds.length > 0) {
    const indexSkills = getIndexSkillsForCategories(categoryIds);
    for (const skill of indexSkills) {
      if (!seenIds.has(skill.id)) {
        seenIds.add(skill.id);
        activatedSkills.push(skill);
        activatedBy.category.push(skill.name);
      }
    }
  }

  // 3. Match keyword-triggered skills
  const keywordSkills = getKeywordSkills();
  const toolMatches: Array<{
    skillId: number;
    skillName: string;
    toolName: string;
    forceMode: ForceMode;
    configOverride?: Record<string, unknown>;
  }> = [];
  const dataSourceFilters: DataSourceFilter[] = [];

  for (const skill of keywordSkills) {
    // Skip if already activated
    if (seenIds.has(skill.id)) continue;

    // Check pattern match (keyword or regex based on match_type)
    if (!matchesPattern(skill, userMessage)) continue;

    // Check category restriction
    if (skill.category_restricted && categoryIds.length > 0) {
      const skillCategories = getCategoriesForSkill(skill.id);
      const skillCategoryIds = skillCategories.map(c => c.id);
      const hasMatchingCategory = categoryIds.some(id => skillCategoryIds.includes(id));

      if (!hasMatchingCategory) {
        // Keyword matched but category doesn't - skip this skill
        if (settings.debugMode) {
          console.log(
            `[Skills] Skipping "${skill.name}" - keyword matched but category restriction not met`
          );
        }
        continue;
      }
    }

    seenIds.add(skill.id);
    activatedSkills.push(skill);
    activatedBy.keyword.push(skill.name);

    // Collect tool routing information from this skill
    if (skill.tool_name && skill.force_mode) {
      toolMatches.push({
        skillId: skill.id,
        skillName: skill.name,
        toolName: skill.tool_name,
        forceMode: skill.force_mode,
        configOverride: skill.tool_config_override || undefined,
      });
    }

    // Collect data source filters
    if (skill.data_source_filter) {
      dataSourceFilters.push(skill.data_source_filter);
    }
  }

  // Sort by priority (lower = higher priority)
  activatedSkills.sort((a, b) => a.priority - b.priority);

  // Build combined prompt respecting token limit
  let totalTokens = 0;
  const includedSkills: Skill[] = [];
  const promptParts: string[] = [];

  for (const skill of activatedSkills) {
    const skillTokens = skill.token_estimate || Math.ceil(skill.prompt_content.length / 4);

    // Check if adding this skill would exceed limit
    if (totalTokens + skillTokens > settings.maxTotalTokens) {
      if (settings.debugMode) {
        console.log(
          `[Skills] Skipping "${skill.name}" - would exceed token limit (${totalTokens + skillTokens} > ${settings.maxTotalTokens})`
        );
      }
      continue;
    }

    includedSkills.push(skill);
    promptParts.push(skill.prompt_content);
    totalTokens += skillTokens;
  }

  let combinedPrompt = promptParts.join('\n\n');

  // Inject Mermaid disable note if admin has disabled Mermaid diagrams
  const diagramSettings = getDiagramSettings();
  if (!diagramSettings.mermaidEnabled) {
    const mermaidDisabledNote = `

IMPORTANT: Mermaid diagrams are DISABLED by admin configuration.
- Do NOT generate any \`\`\`mermaid code blocks
- Use ASCII-only diagrams with 34-character width limit
- For flowcharts, architecture, and timelines: use ASCII box format`;
    combinedPrompt = combinedPrompt + mermaidDisabledNote;
  }

  // Determine tool routing from matched skills
  const toolChoice = determineToolChoice(toolMatches);

  if (settings.debugMode) {
    console.log('[Skills] Resolved skills:', {
      total: includedSkills.length,
      tokens: totalTokens,
      always: activatedBy.always,
      category: activatedBy.category,
      keyword: activatedBy.keyword,
      mermaidEnabled: diagramSettings.mermaidEnabled,
      toolMatches: toolMatches.length,
      toolChoice,
    });
  }

  // Build result with optional tool routing
  const result: ResolvedSkills = {
    skills: includedSkills,
    combinedPrompt,
    totalTokens,
    activatedBy,
  };

  // Add tool routing if any matches were found
  if (toolMatches.length > 0) {
    result.toolRouting = {
      toolChoice,
      matches: toolMatches,
      dataSourceFilters,
    };
  }

  return result;
}

/**
 * Get a preview of which skills would be activated
 * Useful for admin UI testing
 */
export function previewSkillResolution(
  categoryIds: number[],
  testMessage: string
): {
  wouldActivate: { name: string; trigger: string; tokens: number }[];
  totalTokens: number;
  exceedsLimit: boolean;
} {
  const settings = getSkillsSettings();
  const resolved = resolveSkills(categoryIds, testMessage);

  const wouldActivate = resolved.skills.map(skill => {
    let trigger = 'unknown';
    if (resolved.activatedBy.always.includes(skill.name)) trigger = 'always';
    else if (resolved.activatedBy.category.includes(skill.name)) trigger = 'category';
    else if (resolved.activatedBy.keyword.includes(skill.name)) trigger = 'keyword';

    return {
      name: skill.name,
      trigger,
      tokens: skill.token_estimate || Math.ceil(skill.prompt_content.length / 4),
    };
  });

  return {
    wouldActivate,
    totalTokens: resolved.totalTokens,
    exceedsLimit: resolved.totalTokens > settings.maxTotalTokens,
  };
}
