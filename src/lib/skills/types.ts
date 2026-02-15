/**
 * Skills System Types
 *
 * Defines types for the modular prompt skills system
 * Extended to support unified keyword actions (skills + tool routing)
 */

import type { SkillComplianceConfig } from '../../types/compliance';

// Re-export for convenience
export type { SkillComplianceConfig };

export type TriggerType = 'always' | 'category' | 'keyword';
export type MatchType = 'keyword' | 'regex';
export type ForceMode = 'required' | 'preferred' | 'suggested';

export interface DataSourceFilter {
  type: 'include' | 'exclude';
  source_ids: number[];
}

export interface Skill {
  id: number;
  name: string;
  description: string | null;
  prompt_content: string;
  trigger_type: TriggerType;
  trigger_value: string | null;
  category_restricted: boolean;
  is_index: boolean;
  priority: number;
  is_active: boolean;
  is_core: boolean;
  created_by_role: 'admin' | 'superuser';
  token_estimate: number | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;

  // Tool routing fields (unified keyword actions)
  match_type: MatchType;
  tool_name: string | null;
  force_mode: ForceMode | null;
  tool_config_override: Record<string, unknown> | null;
  data_source_filter: DataSourceFilter | null;

  // Compliance configuration
  compliance_config: SkillComplianceConfig | null;
}

export interface SkillWithCategories extends Skill {
  categories: {
    id: number;
    name: string;
    slug: string;
  }[];
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  prompt_content: string;
  trigger_type: TriggerType;
  trigger_value?: string;
  category_restricted?: boolean;
  is_index?: boolean;
  priority?: number;
  category_ids?: number[];

  // Tool routing fields (optional)
  match_type?: MatchType;
  tool_name?: string;
  force_mode?: ForceMode;
  tool_config_override?: Record<string, unknown>;
  data_source_filter?: DataSourceFilter;

  // Compliance configuration (optional)
  compliance_config?: SkillComplianceConfig;
}

export interface ResolvedSkills {
  skills: Skill[];
  combinedPrompt: string;
  totalTokens: number;
  activatedBy: {
    always: string[];
    category: string[];
    keyword: string[];
  };

  // Tool routing from matched skills
  toolRouting?: {
    toolChoice: 'auto' | 'required' | { type: 'function'; function: { name: string } };
    matches: Array<{
      skillId: number;
      skillName: string;
      toolName: string;
      forceMode: ForceMode;
      configOverride?: Record<string, unknown>;
    }>;
    dataSourceFilters: DataSourceFilter[];
  };
}

export interface SkillsSettings {
  enabled: boolean;
  maxTotalTokens: number;
  debugMode: boolean;
}
