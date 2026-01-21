/**
 * Keyword Conflict Analysis Types
 *
 * Types for analyzing conflicts between skills and tool routing keywords.
 */

/** Source of a keyword configuration */
export interface KeywordSource {
  type: 'skill' | 'tool_routing';
  id: number | string;
  name: string;
  keywords: string[];
  priority: number;
  isActive: boolean;
  additionalInfo: {
    // For skills
    triggerType?: 'always' | 'category' | 'keyword';
    categoryRestricted?: boolean;
    categoryNames?: string[]; // Category names linked to this skill
    tokenEstimate?: number;
    promptContent?: string; // Skill prompt content (for prompt analysis)
    // For tool routing
    forceMode?: 'required' | 'preferred' | 'suggested';
    ruleType?: 'keyword' | 'regex';
    toolName?: string;
  };
}

/** Types of conflicts that can be detected */
export type ConflictType =
  | 'exact_overlap' // Same keyword in both systems
  | 'semantic_overlap' // Similar meaning keywords
  | 'priority_tie' // Same priority in tool routing
  | 'redundant' // Duplicate within same system
  | 'category_mismatch' // Tool routing without category skill support
  | 'contradictory_instructions' // Skills with conflicting prompt instructions
  | 'tool_prompt_mismatch'; // Prompt conflicts with forced tool behavior

/** Severity levels */
export type ConflictSeverity = 'high' | 'medium' | 'low';

/** Individual conflict item */
export interface ConflictItem {
  id: string; // Unique ID for UI key
  keyword: string;
  conflictType: ConflictType;
  severity: ConflictSeverity;
  sources: KeywordSource[];
  description: string;
  suggestion: string;
}

/** Complete conflict analysis report */
export interface ConflictReport {
  generatedAt: string;
  analysisModel: string;

  // Statistics
  stats: {
    totalSkills: number;
    totalRoutingRules: number;
    activeSkills: number;
    activeRoutingRules: number;
    uniqueSkillKeywords: number;
    uniqueRoutingKeywords: number;
  };

  // Conflicts by severity
  conflicts: ConflictItem[];
  conflictCounts: {
    high: number;
    medium: number;
    low: number;
  };

  // LLM-generated insights
  summary: string;
  recommendations: string[];
}

/** Analysis scope options */
export type AnalysisScope = 'keywords' | 'prompts' | 'both';

/** API request/response types */
export interface AnalyzeConflictsRequest {
  includeInactive?: boolean; // Include inactive skills/rules
  analysisScope?: AnalysisScope; // What to analyze (default: 'keywords')
}

export interface AnalyzeConflictsResponse {
  success: boolean;
  report?: ConflictReport;
  error?: string;
  details?: string;
}
