/**
 * Keyword Conflict Analyzer
 *
 * Consolidates skills and tool routing keywords and uses LLM
 * to identify conflicts and suggest resolutions.
 */

import { getAllSkills } from '@/lib/db/skills';
import { getAllRoutingRules } from '@/lib/db/tool-routing';
import { getLlmSettings } from '@/lib/db/config';
import getOpenAI from '@/lib/openai';
import type {
  KeywordSource,
  ConflictReport,
  ConflictItem,
  AnalyzeConflictsRequest,
} from '@/types/keyword-conflicts';

const MAX_TOKENS = 4000;

/**
 * Gather all keyword sources from database
 */
export function consolidateKeywordSources(includeInactive = false): {
  skills: KeywordSource[];
  routingRules: KeywordSource[];
} {
  // Get skills with trigger_type = 'keyword'
  const allSkills = getAllSkills({
    trigger_type: 'keyword',
    is_active: includeInactive ? undefined : true,
  });

  const skills: KeywordSource[] = allSkills.map((skill) => ({
    type: 'skill' as const,
    id: skill.id,
    name: skill.name,
    keywords: skill.trigger_value?.split(',').map((k) => k.trim().toLowerCase()) || [],
    priority: skill.priority,
    isActive: skill.is_active,
    additionalInfo: {
      triggerType: skill.trigger_type,
      categoryRestricted: skill.category_restricted,
      tokenEstimate: skill.token_estimate || undefined,
    },
  }));

  // Get tool routing rules
  const allRules = getAllRoutingRules();
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
 * Build the analysis prompt for the LLM
 */
export function buildAnalysisPrompt(
  skills: KeywordSource[],
  routingRules: KeywordSource[]
): string {
  return `You are analyzing keyword configurations for a chatbot system.
The system has TWO independent keyword-based mechanisms:

## 1. Skills System
- **Purpose**: Injects specialized prompt content when keywords match
- **Effect**: Adds context/instructions to the LLM's system prompt
- **Matching**: Word-boundary regex, case-insensitive

## 2. Tool Routing System
- **Purpose**: Forces specific tool calls when keywords match
- **Effect**: Sets OpenAI's tool_choice parameter
- **Force Modes**:
  - required: Forces the specific tool
  - preferred: Forces some tool call (LLM picks which)
  - suggested: Hints but doesn't force

## Current Configurations

### Skills (${skills.length} keyword-triggered):
${JSON.stringify(
  skills.map((s) => ({
    name: s.name,
    keywords: s.keywords,
    priority: s.priority,
    active: s.isActive,
    categoryRestricted: s.additionalInfo.categoryRestricted,
    tokens: s.additionalInfo.tokenEstimate,
  })),
  null,
  2
)}

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

## Your Analysis Task

Identify conflicts and issues. For each, provide:
1. The specific keyword(s) involved
2. Conflict type: exact_overlap, semantic_overlap, priority_tie, redundant, category_mismatch
3. Severity: high (causes errors/confusion), medium (suboptimal), low (minor)
4. Clear description of the problem
5. Specific, actionable resolution suggestion

Consider these conflict scenarios:
- **exact_overlap**: Same keyword in both skills and tool routing
- **semantic_overlap**: Similar keywords that might confuse users (e.g., "chart" vs "graph")
- **priority_tie**: Multiple tool routing rules with same priority
- **redundant**: Duplicate keywords within the same system
- **category_mismatch**: Tool routing forces a tool but no skill provides context for it

Respond ONLY with valid JSON in this exact format:
{
  "conflicts": [
    {
      "keyword": "the keyword or keywords involved",
      "conflictType": "exact_overlap|semantic_overlap|priority_tie|redundant|category_mismatch",
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
  const conflicts: ConflictItem[] = (parsed.conflicts || []).map(
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

  // Count by severity
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
  const { includeInactive = false } = options;

  // 1. Consolidate sources
  const { skills, routingRules } = consolidateKeywordSources(includeInactive);

  // 2. Build prompt
  const prompt = buildAnalysisPrompt(skills, routingRules);

  // 3. Get configured LLM settings (not hardcoded)
  const llmSettings = getLlmSettings();
  const model = llmSettings.model;

  // 4. Call LLM
  const openai = getOpenAI();
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

  // 5. Parse response (pass model name for report metadata)
  return parseConflictResponse(llmResponse, skills, routingRules, model);
}
