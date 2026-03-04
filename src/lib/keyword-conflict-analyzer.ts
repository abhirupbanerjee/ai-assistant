/**
 * Keyword Conflict Analyzer
 *
 * Consolidates skills and tool routing keywords and uses LLM
 * to identify conflicts and suggest resolutions.
 */

import { getAllSkills, getCategoriesForSkill } from '@/lib/db/compat/skills';
import { getAllRoutingRules } from '@/lib/db/compat/tool-routing';
import { getLlmSettings } from '@/lib/db/compat/config';
import getOpenAI from '@/lib/openai';
import type {
  KeywordSource,
  ConflictReport,
  ConflictItem,
  AnalyzeConflictsRequest,
  AnalysisScope,
} from '@/types/keyword-conflicts';

const MAX_TOKENS = 4000;

/**
 * Gather all keyword sources from database
 */
export async function consolidateKeywordSources(
  includeInactive = false,
  includePrompts = false
): Promise<{
  skills: KeywordSource[];
  routingRules: KeywordSource[];
}> {
  // Get skills with trigger_type = 'keyword'
  const allSkills = await getAllSkills({
    trigger_type: 'keyword',
    is_active: includeInactive ? undefined : true,
  });

  const skills: KeywordSource[] = [];
  for (const skill of allSkills) {
    // Get category names for this skill
    const categories = await getCategoriesForSkill(skill.id);
    const categoryNames = categories.map((c) => c.name);

    skills.push({
      type: 'skill' as const,
      id: skill.id,
      name: skill.name,
      keywords: skill.trigger_value?.split(',').map((k) => k.trim().toLowerCase()) || [],
      priority: skill.priority,
      isActive: skill.is_active,
      additionalInfo: {
        triggerType: skill.trigger_type,
        categoryRestricted: skill.category_restricted,
        categoryNames: categoryNames.length > 0 ? categoryNames : undefined,
        tokenEstimate: skill.token_estimate || undefined,
        promptContent: includePrompts ? skill.prompt_content : undefined,
      },
    });
  }

  // Get tool routing rules
  const allRules = await getAllRoutingRules();
  const filteredRules = includeInactive
    ? allRules
    : allRules.filter((r) => r.isActive);

  const routingRules: KeywordSource[] = filteredRules.map((rule) => ({
    type: 'tool_routing' as const,
    id: rule.id,
    name: rule.ruleName,
    keywords: rule.patterns.map((p) => p.toLowerCase()),
    priority: rule.priority,
    isActive: rule.isActive,
    additionalInfo: {
      forceMode: rule.forceMode,
      ruleType: rule.ruleType,
      toolName: rule.toolName,
    },
  }));

  return { skills, routingRules };
}

/**
 * Pre-compute exact keyword overlaps programmatically
 * This provides verified overlaps before LLM analysis
 */
export function computeExactOverlaps(
  skills: KeywordSource[],
  routingRules: KeywordSource[]
): { keyword: string; sources: string[]; sourceTypes: ('skill' | 'tool_routing')[] }[] {
  const keywordMap = new Map<string, { names: string[]; types: ('skill' | 'tool_routing')[] }>();

  // Map keywords to their sources
  for (const skill of skills) {
    for (const kw of skill.keywords) {
      const entry = keywordMap.get(kw) || { names: [], types: [] };
      entry.names.push(skill.name);
      entry.types.push('skill');
      keywordMap.set(kw, entry);
    }
  }
  for (const rule of routingRules) {
    for (const kw of rule.keywords) {
      const entry = keywordMap.get(kw) || { names: [], types: [] };
      entry.names.push(rule.name);
      entry.types.push('tool_routing');
      keywordMap.set(kw, entry);
    }
  }

  // Return keywords with multiple sources
  return Array.from(keywordMap.entries())
    .filter(([, entry]) => entry.names.length > 1)
    .map(([keyword, entry]) => ({
      keyword,
      sources: entry.names,
      sourceTypes: entry.types,
    }));
}

/**
 * Filter out false positive conflicts from LLM analysis
 */
export function filterFalsePositives(
  conflicts: ConflictItem[],
  skills: KeywordSource[]
): ConflictItem[] {
  return conflicts.filter((conflict) => {
    // For exact_overlap between skills, check category restrictions
    if (conflict.conflictType === 'exact_overlap') {
      const skillSources = conflict.sources.filter((s) => s.type === 'skill');
      if (skillSources.length === 2) {
        const [s1, s2] = skillSources;
        // If both skills are category-restricted, check for category overlap
        if (s1.additionalInfo.categoryRestricted && s2.additionalInfo.categoryRestricted) {
          const cats1 = new Set(s1.additionalInfo.categoryNames || []);
          const cats2 = s2.additionalInfo.categoryNames || [];
          const hasOverlap = cats2.some((c) => cats1.has(c));
          if (!hasOverlap) {
            // No category overlap means they never fire together - not a real conflict
            return false;
          }
        }
      }
      return true;
    }

    // Be stricter about semantic overlaps - only keep high severity
    if (conflict.conflictType === 'semantic_overlap') {
      return conflict.severity === 'high';
    }

    // Keep all other conflict types
    return true;
  });
}

/**
 * Build the analysis prompt for the LLM
 */
export function buildAnalysisPrompt(
  skills: KeywordSource[],
  routingRules: KeywordSource[],
  analysisScope: AnalysisScope = 'keywords',
  exactOverlaps: { keyword: string; sources: string[]; sourceTypes: ('skill' | 'tool_routing')[] }[] = []
): string {
  // Scope-specific instructions
  let scopeInstructions = '';
  let conflictTypes = '';

  if (analysisScope === 'keywords') {
    scopeInstructions = `
## Analysis Scope: Keywords Only
Focus on keyword/pattern conflicts. Do not analyze prompt content.`;
    conflictTypes = 'exact_overlap, semantic_overlap, priority_tie, redundant, category_mismatch';
  } else if (analysisScope === 'prompts') {
    scopeInstructions = `
## Analysis Scope: Prompts Only
Focus on conflicts in the prompt content. Look for:
- Contradictory instructions between skills
- Prompts that conflict with what forced tools do
- Redundant or overlapping guidance`;
    conflictTypes = 'contradictory_instructions, tool_prompt_mismatch, redundant';
  } else {
    scopeInstructions = `
## Analysis Scope: Keywords AND Prompts
Analyze both keyword conflicts AND prompt content conflicts.
For keywords, look for overlapping or duplicate patterns.
For prompts, look for:
- Contradictory instructions between skills
- Prompts that conflict with what forced tools do
- Redundant or overlapping guidance`;
    conflictTypes = 'exact_overlap, semantic_overlap, priority_tie, redundant, category_mismatch, contradictory_instructions, tool_prompt_mismatch';
  }

  // Build skills data - include prompts when scope includes them
  const skillsData = skills.map((s) => {
    const base: Record<string, unknown> = {
      name: s.name,
      keywords: s.keywords,
      priority: s.priority,
      active: s.isActive,
      categoryRestricted: s.additionalInfo.categoryRestricted,
      tokens: s.additionalInfo.tokenEstimate,
    };
    // Include category names if available
    if (s.additionalInfo.categoryNames && s.additionalInfo.categoryNames.length > 0) {
      base.categories = s.additionalInfo.categoryNames;
    }
    // Include prompt content when analyzing prompts
    if (analysisScope !== 'keywords' && s.additionalInfo.promptContent) {
      base.promptContent = s.additionalInfo.promptContent;
    }
    return base;
  });

  return `You are analyzing configurations for a chatbot system.
The system has TWO independent keyword-based mechanisms:

## 1. Skills System
- **Purpose**: Injects specialized prompt content when keywords match
- **Effect**: Adds context/instructions to the LLM's system prompt
- **Matching**: Word-boundary regex, case-insensitive
- **Category Restriction**: Skills can be restricted to specific categories
  - If \`categoryRestricted: true\` and \`categories\` is set, the skill only fires in those categories
  - Skills with different category restrictions do NOT conflict (they never fire simultaneously)

## 2. Tool Routing System
- **Purpose**: Forces specific tool calls when keywords match
- **Effect**: Sets OpenAI's tool_choice parameter
- **Force Modes**:
  - required: Forces the specific tool
  - preferred: Forces some tool call (LLM picks which)
  - suggested: Hints but doesn't force
${scopeInstructions}

## Current Configurations

### Skills (${skills.length} keyword-triggered):
${JSON.stringify(skillsData, null, 2)}

### Tool Routing Rules (${routingRules.length}):
${JSON.stringify(
  routingRules.map((r) => ({
    name: r.name,
    tool: r.additionalInfo.toolName,
    keywords: r.keywords,
    forceMode: r.additionalInfo.forceMode,
    priority: r.priority,
    active: r.isActive,
  })),
  null,
  2
)}
${
  exactOverlaps.length > 0
    ? `
## Pre-Computed Exact Overlaps (Verified)
The following keywords appear in multiple sources - these are CONFIRMED overlaps:
${JSON.stringify(exactOverlaps, null, 2)}

Focus your analysis on:
1. Determining if these verified overlaps are problematic (some may be intentional)
2. Finding semantic overlaps NOT in this list
3. Checking for contradictory prompt instructions
`
    : ''
}
## Your Analysis Task

Identify conflicts and issues. For each, provide:
1. The specific keyword(s) or prompt section involved
2. Conflict type: ${conflictTypes}
3. Severity: high (causes errors/confusion), medium (suboptimal), low (minor)
4. Clear description of the problem
5. Specific, actionable resolution suggestion

Consider these conflict scenarios:
- **exact_overlap**: Same keyword in both skills and tool routing
- **semantic_overlap**: Similar keywords that might confuse users (e.g., "chart" vs "graph")
- **priority_tie**: Multiple tool routing rules with same priority
- **redundant**: Duplicate keywords or similar prompt instructions
- **category_mismatch**: Tool routing forces a tool but no skill provides context for it
- **contradictory_instructions**: Skills with conflicting guidance (e.g., "be formal" vs "be casual")
- **tool_prompt_mismatch**: Skill prompt conflicts with forced tool behavior

**IMPORTANT - NOT a conflict**:
- Skills with the same keywords but different category restrictions are NOT conflicts if they never fire together
- If two skills have categoryRestricted=true and non-overlapping categories, they cannot conflict
- Only report conflicts when skills could actually fire simultaneously

Respond ONLY with valid JSON in this exact format:
{
  "conflicts": [
    {
      "keyword": "the keyword, keywords, or prompt section involved",
      "conflictType": "one of the conflict types listed above",
      "severity": "high|medium|low",
      "sources": ["name1", "name2"],
      "description": "Clear description of the conflict",
      "suggestion": "Specific resolution action"
    }
  ],
  "summary": "2-3 sentence summary of overall configuration health",
  "recommendations": [
    "General recommendation 1",
    "General recommendation 2"
  ]
}`;
}

/**
 * Helper to find full source objects by name
 */
function findSourcesByName(
  names: string[],
  skills: KeywordSource[],
  routingRules: KeywordSource[]
): KeywordSource[] {
  const all = [...skills, ...routingRules];
  return names
    .map((name) => all.find((s) => s.name === name))
    .filter((s): s is KeywordSource => s !== undefined);
}

/**
 * Parse and validate LLM response
 */
export function parseConflictResponse(
  llmResponse: string,
  skills: KeywordSource[],
  routingRules: KeywordSource[],
  model: string
): ConflictReport {
  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = llmResponse;
  const jsonMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  // Build conflict items with IDs
  const rawConflicts: ConflictItem[] = (parsed.conflicts || []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any, idx: number) => ({
      id: `conflict-${idx}`,
      keyword: c.keyword,
      conflictType: c.conflictType,
      severity: c.severity,
      sources: findSourcesByName(c.sources, skills, routingRules),
      description: c.description,
      suggestion: c.suggestion,
    })
  );

  // Filter out false positives (category-restricted non-overlaps, low-severity semantic)
  const conflicts = filterFalsePositives(rawConflicts, skills);

  // Re-index IDs after filtering
  conflicts.forEach((c, idx) => {
    c.id = `conflict-${idx}`;
  });

  // Count by severity (after filtering)
  const conflictCounts = {
    high: conflicts.filter((c) => c.severity === 'high').length,
    medium: conflicts.filter((c) => c.severity === 'medium').length,
    low: conflicts.filter((c) => c.severity === 'low').length,
  };

  // Compute stats
  const allSkillKeywords = new Set(skills.flatMap((s) => s.keywords));
  const allRoutingKeywords = new Set(routingRules.flatMap((r) => r.keywords));

  return {
    generatedAt: new Date().toISOString(),
    analysisModel: model,
    stats: {
      totalSkills: skills.length,
      totalRoutingRules: routingRules.length,
      activeSkills: skills.filter((s) => s.isActive).length,
      activeRoutingRules: routingRules.filter((r) => r.isActive).length,
      uniqueSkillKeywords: allSkillKeywords.size,
      uniqueRoutingKeywords: allRoutingKeywords.size,
    },
    conflicts,
    conflictCounts,
    summary: parsed.summary || 'Analysis complete.',
    recommendations: parsed.recommendations || [],
  };
}

/**
 * Main analysis function
 */
export async function analyzeKeywordConflicts(
  options: AnalyzeConflictsRequest = {}
): Promise<ConflictReport> {
  const { includeInactive = false, analysisScope = 'keywords' } = options;

  // Determine if we need prompts based on scope
  const includePrompts = analysisScope !== 'keywords';

  // 1. Consolidate sources
  const { skills, routingRules } = await consolidateKeywordSources(includeInactive, includePrompts);

  // 2. Pre-compute exact keyword overlaps
  const exactOverlaps = computeExactOverlaps(skills, routingRules);

  // 3. Build prompt with verified overlaps
  const prompt = buildAnalysisPrompt(skills, routingRules, analysisScope, exactOverlaps);

  // 4. Get configured LLM settings (not hardcoded)
  const llmSettings = await getLlmSettings();
  const model = llmSettings.model;

  // 5. Call LLM
  const openai = await getOpenAI();
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert system configuration analyst. Respond only with valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0.3, // Low temperature for consistent analysis
    response_format: { type: 'json_object' },
  });

  const llmResponse = response.choices[0]?.message?.content || '{}';

  // 6. Parse response and filter false positives
  return parseConflictResponse(llmResponse, skills, routingRules, model);
}
