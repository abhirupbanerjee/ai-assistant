/**
 * Autonomous Agent Types
 *
 * Type definitions for the autonomous agent system that enables
 * Plan → Execute → Check → Summarize workflows.
 */

// ============ Status Types ============

export type AgentPlanStatus =
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'needs_review';

export type ReviewStatus = 'approved' | 'rejected' | 'needs_more_data';

// ============ State History (for idempotency) ============

export interface StateHistoryEntry {
  status: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ============ Budget Types ============

export interface AgentBudget {
  max_llm_calls: number;
  max_tokens: number;
  max_web_searches: number;
  max_duration_minutes: number;
  task_timeout_minutes: number;
}

export interface BudgetUsage {
  llm_calls: number;
  tokens_used: number;
  web_searches: number;
}

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  max_llm_calls: 100,
  max_tokens: 500000,
  max_web_searches: 20,
  max_duration_minutes: 30,
  task_timeout_minutes: 5,
};

// ============ Model Configuration ============

export type LLMProvider = 'openai' | 'gemini' | 'mistral';

export interface ModelSpec {
  provider: LLMProvider;
  model: string;
  temperature: number;
  max_tokens?: number;
}

export interface AgentModelConfig {
  planner: ModelSpec;
  executor: ModelSpec;
  checker: ModelSpec;
  summarizer: ModelSpec;
}


// ============ Task & Plan Types ============

export interface AgentTask {
  id: number;
  type: string;
  target: string;
  description: string;
  expected_output?: string;
  status: AgentTaskStatus;
  priority: number;
  dependencies: number[];
  confidence_score?: number;
  result?: string;
  error?: string;
  review_status?: ReviewStatus;
  review_notes?: string;
  state_history?: StateHistoryEntry[];
  execution_started_at?: string;
  execution_timeout_at?: string;
  tokens_used?: number;
  llm_calls?: number;
  started_at?: string;
  completed_at?: string;
  // Retry support (Phase 2.6c)
  retry_count?: number;
  retry_context?: string;
  retry_strategy?: string;
  // Execution hints (Phase 2.6e — stored, not acted on until Phase 3.5)
  execution_hint?: 'parallel' | 'sequential' | 'wave_barrier';
  // Skill IDs tagged by planner (Phase 3 — skills gap fix)
  skill_ids?: number[];
  // Tool name from planner — specifies which AVAILABLE_TOOLS tool to execute
  tool_name?: string;
}

export interface AgentConfig {
  confidence_threshold: number;
  enable_web_search: boolean;
  enable_doc_gen: boolean;
  enable_checker: boolean;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  confidence_threshold: 80,
  enable_web_search: true,
  enable_doc_gen: true,
  enable_checker: true,
};

export interface AgentPlan {
  id: string;
  thread_id: string;
  user_id: string;
  category_slug?: string;
  status: AgentPlanStatus;
  title: string;
  original_request: string;
  tasks: AgentTask[];
  config: AgentConfig;
  budget: AgentBudget;
  budget_used: BudgetUsage;
  model_config: AgentModelConfig;
  summary?: string;
  stats?: AgentPlanStats;
  current_task_id?: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface AgentPlanStats {
  total_tasks: number;
  pending_tasks: number;
  running_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  needs_review_tasks: number;
  total_duration_ms: number;
  average_confidence: number;
  total_llm_calls: number;
  total_tokens_used: number;
  total_web_searches: number;
  progress_percent: number;
}

// ============ Execution Result Types ============

export interface ExecutionResult {
  success: boolean;
  result?: string;
  confidence?: number;
  error?: string;
  skipped?: boolean;
  needsReview?: boolean;
  skipReason?: string;
  retry_suggestion?: string;
  tokens_used?: number;
  llm_calls?: number;
}

export interface CheckerResult {
  status: 'approved' | 'needs_review' | 'rejected';
  confidence_score: number; // 0-100
  notes: string;
  tokens_used?: number;
  retry_suggestion?: string; // Alternative approach for retry (Phase 2.6c)
}

// ============ Budget Status Types ============

export interface BudgetStatus {
  exceeded: boolean;
  budgetType?: string;
  message?: string;
  percentage?: number;
}

// ============ Dependency Validation Types ============

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StuckPlanResult {
  isStuck: boolean;
  reason?: string;
  stuckTaskIds: number[];
  suggestions: string[];
}

// ============ JSON Parser Types ============

export interface ParseSuccess<T> {
  success: true;
  data: T;
}

export interface ParseFailure {
  success: false;
  error: string;
  rawContent: string;
  validationErrors?: string[];
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

// ============ Planner Response Schema ============

export interface PlannerResponse {
  title: string;
  tasks: Array<{
    id: number;
    type: string;
    target: string;
    description: string;
    expected_output?: string;
    priority?: number;
    dependencies?: number[];
    execution_hint?: 'parallel' | 'sequential' | 'wave_barrier';
    skill_ids?: number[];
    tool_name?: string;
  }>;
  context?: Record<string, unknown>;
}

// ============ Checker Response Schema ============

export interface CheckerResponse {
  confidence: number; // 0-100
  notes: string;
}

// ============ Orchestrator Result Types ============

export interface OrchestratorResult {
  success: boolean;
  plan_id: string;
  summary?: string;
  error?: string;
  // Control states
  paused?: boolean;
  stopped?: boolean;
  stats?: {
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    skipped_tasks: number;
    needs_review_tasks: number;
    average_confidence: number;
  };
}
