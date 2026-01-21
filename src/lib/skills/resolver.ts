/**
 * Skill Resolver
 *
 * Resolves which skills to apply based on:
 * - Always-on skills (core prompts)
 * - Category-based skills (index skills for selected categories)
 * - Keyword-triggered skills (matched against user message)
 */

import { getSkillsSettings, getDiagramSettings } from '../db/config';
import {
  getSkillsByTrigger,
  getIndexSkillsForCategories,
  getKeywordSkills,
  getCategoriesForSkill,
} from '../db/skills';
import type { Skill, ResolvedSkills } from './types';

/**
 * Match keywords in message text
 * Supports comma-separated keywords in trigger_value
 */
function matchesKeyword(skill: Skill, message: string): boolean {
  if (!skill.trigger_value) return false;

  const keywords = skill.trigger_value.split(',').map(k => k.trim().toLowerCase());
  const messageLower = message.toLowerCase();

  return keywords.some(keyword => {
    // Word boundary matching for better accuracy
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
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
  for (const skill of keywordSkills) {
    // Skip if already activated
    if (seenIds.has(skill.id)) continue;

    // Check keyword match
    if (!matchesKeyword(skill, userMessage)) continue;

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

  if (settings.debugMode) {
    console.log('[Skills] Resolved skills:', {
      total: includedSkills.length,
      tokens: totalTokens,
      always: activatedBy.always,
      category: activatedBy.category,
      keyword: activatedBy.keyword,
      mermaidEnabled: diagramSettings.mermaidEnabled,
    });
  }

  return {
    skills: includedSkills,
    combinedPrompt,
    totalTokens,
    activatedBy,
  };
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
