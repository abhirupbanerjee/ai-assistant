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
  | 'failed'
  | 'paused'
  | 'stopped';

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

export type LLMProvider = 'openai' | 'gemini' | 'mistral' | 'anthropic' | 'fireworks' | 'deepseek' | 'ollama' | 'ollama-cloud' | 'moonshot' | 'azure-foundry' | 'auto';

export type ExecutorProfileName =
  | 'default'
  | 'fast_low_cost'
  | 'deep_reasoning'
  | 'long_context'
  | 'artifact_generation'
  | 'local_private'
  | 'agentic_tool_loop'
  | 'code_generation'
  | 'multilingual';

export interface ModelSpec {
  provider: LLMProvider;
  model: string;
  temperature: number | undefined;
  max_tokens?: number;
  thinking_enabled?: boolean;
}

export interface ExecutorModelProfiles {
  default: ModelSpec;
  fast_low_cost?: ModelSpec;
  deep_reasoning?: ModelSpec;
  long_context?: ModelSpec;
  artifact_generation?: ModelSpec;
  local_private?: ModelSpec;
  agentic_tool_loop?: ModelSpec;
  code_generation?: ModelSpec;
  multilingual?: ModelSpec;
}

export interface AgentModelConfig {
  planner: ModelSpec;
  executor: ModelSpec;
  checker: ModelSpec;
  summarizer: ModelSpec;
  executor_profiles?: ExecutorModelProfiles;
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
  retry_after?: number; // epoch ms — delay before task is eligible for next wave
  // Execution hints (Phase 2.6e — stored, not acted on until Phase 3.5)
  execution_hint?: 'parallel' | 'sequential' | 'wave_barrier';
  // Skill IDs tagged by planner (Phase 3 — skills gap fix)
  skill_ids?: number[];
  // Tool name from planner — specifies which AVAILABLE_TOOLS tool to execute
  tool_name?: string;
  // Optional planner-selected executor profile for task-specific model routing
  executor_profile?: ExecutorProfileName;
  executor_profile_reason?: string;
  // Actual model ID used by executor for this task (for audit/debugging)
  executor_model_used?: string;
  // Subagent mode (Phase 4)
  subagent_enabled?: boolean;
  max_iterations?: number;
  // Per-task timeout override
  task_timeout_minutes?: number;
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
  web_searches?: number;
  /** Names of tools executed during this task */
  tools_used?: string[];
  /** Subagent loop state if task ran in subagent mode */
  subagent_state?: { iterations: number; hit_iteration_limit: boolean };
  /** Actual model ID used by executor for this task (for audit/debugging) */
  executor_model_used?: string;
  /** Set when a transient API error should trigger a delayed retry */
  needsRetry?: boolean;
  retryAfter?: number; // epoch ms
}

export interface CheckerResult {
  status: 'approved' | 'needs_review' | 'rejected';
  confidence_score: number; // 0-100
  notes: string;
  tokens_used?: number;
  llm_calls?: number;
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
    executor_profile?: ExecutorProfileName;
    executor_profile_reason?: string;
    subagent_enabled?: boolean;
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

// ===================================================================
// Universal I/O Contract (Phase 1 Agent System)
// See plans/agent_system_architecture___implementation_plan.md §3.2.
// Every agent invocation — single-agent or swarm — returns an
// AgentResponse envelope with { artifact, confidence, suggested_next }.
// Malformed responses collapse to confidence:0 via validateAgentResponse().
// ===================================================================

/**
 * The work product an agent produces. `type` is a coarse classification the
 * orchestrator/presenter uses to assemble the final deliverable; `content`
 * is the payload (text, JSON string, markdown, etc.); `sources` carries
 * citations for researcher agents.
 */
export interface AgentArtifact {
  type:
    | 'text'
    | 'plan'
    | 'research'
    | 'analysis'
    | 'critique'
    | 'presentation'
    | 'data'
    | 'error';
  content: string;
  sources?: Array<{ title: string; url?: string }>;
  metadata?: Record<string, unknown>;
}

/**
 * The next action an agent recommends. The orchestrator is the authority on
 * what actually happens next; this is advisory. `reason` is required so the
 * critic and trace can explain the transition.
 */
export type SuggestedNext =
  | { action: 'complete'; reason: string }
  | { action: 'loop_back'; reason: string; target_subtask?: string }
  | { action: 'escalate'; reason: string }
  | { action: 'handoff'; reason: string; target_role?: string };

/**
 * The universal response envelope. `confidence` is 0..1 (normalized from the
 * legacy 0..100 checker scale at the boundary). `agentId` and `roleFamily`
 * identify the producing agent for tracing.
 */
export interface AgentResponse {
  agentId: string;
  roleFamily:
    | 'planner'
    | 'executor'
    | 'critic'
    | 'researcher'
    | 'presenter';
  artifact: AgentArtifact;
  confidence: number; // 0..1
  suggestedNext: SuggestedNext;
  /** Optional token/cost telemetry for the tracing module. */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
  };
}

/**
 * Validate and normalize a raw agent output into an AgentResponse.
 *
 * Per the plan §3.2, malformed responses collapse to a minimal envelope with
 * `confidence: 0` and a `suggestedNext` of `escalate` — never throw. This is
 * the single chokepoint every agent invocation passes through so the
 * orchestrator never sees a structurally-invalid response.
 *
 * @param raw    The parsed JSON (or string) the model returned.
 * @param agentId  The id of the agent that produced `raw`.
 * @param roleFamily  The role family of that agent.
 */
export function validateAgentResponse(
  raw: unknown,
  agentId: string,
  roleFamily: AgentResponse['roleFamily']
): AgentResponse {
  const fallback: AgentResponse = {
    agentId,
    roleFamily,
    artifact: { type: 'error', content: 'Malformed agent response' },
    confidence: 0,
    suggestedNext: { action: 'escalate', reason: 'Agent response failed validation' },
  };

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return fallback;
  }
  const obj = raw as Record<string, unknown>;

  // --- artifact ---
  let artifact: AgentArtifact = fallback.artifact;
  if (obj.artifact !== null && typeof obj.artifact === 'object') {
    const a = obj.artifact as Record<string, unknown>;
    const content = typeof a.content === 'string' ? a.content : '';
    const type = isValidArtifactType(a.type) ? a.type : 'text';
    const sources = Array.isArray(a.sources)
      ? (a.sources as unknown[]).filter(isValidSource).map((s) => s as { title: string; url?: string })
      : undefined;
    artifact = { type, content, sources, metadata: a.metadata as Record<string, unknown> | undefined };
  }

  // --- confidence (accept 0..1 or 0..100; normalize to 0..1) ---
  let confidence = 0;
  if (typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)) {
    confidence = obj.confidence > 1 ? obj.confidence / 100 : obj.confidence;
    confidence = Math.max(0, Math.min(1, confidence));
  }

  // --- suggestedNext ---
  let suggestedNext: SuggestedNext = fallback.suggestedNext;
  if (obj.suggestedNext !== null && typeof obj.suggestedNext === 'object') {
    const sn = obj.suggestedNext as Record<string, unknown>;
    if (isValidNextAction(sn.action) && typeof sn.reason === 'string') {
      suggestedNext = {
        action: sn.action as SuggestedNext['action'],
        reason: sn.reason,
        ...(typeof sn.target_subtask === 'string' ? { target_subtask: sn.target_subtask } : {}),
        ...(typeof sn.target_role === 'string' ? { target_role: sn.target_role } : {}),
      } as SuggestedNext;
    }
  }

  // --- usage (optional, pass-through) ---
  let usage: AgentResponse['usage'] | undefined;
  if (obj.usage !== null && typeof obj.usage === 'object') {
    const u = obj.usage as Record<string, unknown>;
    usage = {
      ...(typeof u.promptTokens === 'number' ? { promptTokens: u.promptTokens } : {}),
      ...(typeof u.completionTokens === 'number' ? { completionTokens: u.completionTokens } : {}),
      ...(typeof u.costUsd === 'number' ? { costUsd: u.costUsd } : {}),
    };
    if (Object.keys(usage).length === 0) usage = undefined;
  }

  return { agentId, roleFamily, artifact, confidence, suggestedNext, ...(usage ? { usage } : {}) };
}

// --- internal helpers for validateAgentResponse ---

const ARTIFACT_TYPES: AgentArtifact['type'][] = [
  'text',
  'plan',
  'research',
  'analysis',
  'critique',
  'presentation',
  'data',
  'error',
];

function isValidArtifactType(value: unknown): value is AgentArtifact['type'] {
  return typeof value === 'string' && (ARTIFACT_TYPES as string[]).includes(value);
}

const NEXT_ACTIONS: SuggestedNext['action'][] = ['complete', 'loop_back', 'escalate', 'handoff'];

function isValidNextAction(value: unknown): value is SuggestedNext['action'] {
  return typeof value === 'string' && (NEXT_ACTIONS as string[]).includes(value);
}

function isValidSource(value: unknown): value is { title: string; url?: string } {
  if (value === null || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return typeof s.title === 'string';
}
