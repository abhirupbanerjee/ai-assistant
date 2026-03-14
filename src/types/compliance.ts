/**
 * Compliance Checker Types
 *
 * Type definitions for the compliance validation system that checks
 * response completeness and tool outputs with intelligent HITL.
 */

// ============ Check Types ============

export type CheckType = 'tool_success' | 'data_returned' | 'artifact_valid' | 'sections_present';

export type FailureType = 'error' | 'empty' | 'timeout' | 'partial';

export type FailureAction = 'warn' | 'hitl';

export type ClarificationAction = 'retry_with' | 'skip' | 'substitute' | 'custom';

export type HitlAction = 'continue' | 'accept' | 'accept_flagged' | 'retry' | 'cancel';

export type ComplianceDecisionType = 'pass' | 'warn' | 'hitl';

// ============ Check Weights ============

export const CHECK_WEIGHTS: Record<CheckType, number> = {
  artifact_valid: 30,    // Critical - charts/docs that fail are major issues
  tool_success: 25,      // Tool errors are significant
  data_returned: 25,     // Empty results matter
  sections_present: 20,  // Structural, less critical
};

// ============ Tool Execution Record ============

export interface ToolExecutionRecord {
  toolName: string;
  success: boolean;
  error?: string;
  failureType?: FailureType;
  duration: number;
  resultCount?: number;
  artifactUrl?: string;      // For doc_gen, image_gen
  dataPoints?: number;       // For chart_gen
  partialData?: unknown;
  executedAt: string;        // ISO timestamp
}

// ============ Compliance Rules ============

export interface ComplianceRule {
  checkType: CheckType;
  checkConfig: Record<string, unknown>;
  weight: number;
  failureAction: FailureAction;
  failureMessage: string;
  sourceSkillId?: number;
  sourceSkillName?: string;
}

export interface ConsolidatedRules {
  rules: ComplianceRule[];
  sections: string[];
  passThreshold: number;
  warnThreshold: number;
}

// ============ Check Results ============

export interface ComplianceCheckResult {
  rule: string;
  checkType: CheckType;
  target: string;                    // Tool name or 'response'
  passed: boolean;
  detail: string;
  weight: number;                    // Weight contribution
}

// ============ Compliance Decision ============

export interface ComplianceDecision {
  decision: ComplianceDecisionType;
  score: number;                     // 0-100
  checksPerformed: ComplianceCheckResult[];
  failedChecks: string[];
  issues: string[];                  // Human-readable
  badgeType: 'success' | 'warning' | 'error';
  badgeText: string;
}

// ============ Skill Compliance Config ============

export interface SkillComplianceConfig {
  enabled: boolean;
  sections?: string[];               // Required markdown headings (JSON array)
  passThreshold?: number;            // Override global (default: 80)
  warnThreshold?: number;            // Override global (default: 50)
  clarificationInstructions?: string; // Custom HITL context per skill
  hitlModel?: string;                // Model override for clarification generation
  toolChecks?: Record<string, {      // Per-tool check overrides
    required?: boolean;
    minResults?: number;
    failureAction?: FailureAction;
  }>;
  preflightClarification?: {         // Pre-response HITL clarification
    enabled: boolean;                // Per-skill opt-in (requires global preflightEnabled)
    instructions?: string;           // Domain-specific LLM prompt context for ambiguity assessment
    maxQuestions?: number;           // Override global preflightMaxQuestions
    timeoutMs?: number;              // Override global preflightDefaultTimeoutMs (max 900000)
    skipOnFollowUp?: boolean;        // Override global preflightSkipOnFollowUp
  };
}

// ============ Global Compliance Config ============

export interface ComplianceGlobalConfig {
  enabled: boolean;
  passThreshold: number;             // Default: 80
  warnThreshold: number;             // Default: 50
  enableHitl: boolean;               // Default: true
  useWeightedScoring: boolean;       // Default: true
  checkWeights?: Record<string, number>;  // Override defaults

  // Clarification generation
  clarificationProvider: 'openai' | 'gemini' | 'mistral' | 'auto';
  clarificationModel: string;        // Default: 'gpt-4.1-mini'
  useLlmClarifications: boolean;     // Default: true
  clarificationTimeout: number;      // Default: 5000ms
  fallbackToTemplates: boolean;      // Default: true

  // Async HITL
  allowAcceptFlagged: boolean;       // Default: true

  // Pre-flight clarification (pre-response HITL)
  preflightEnabled: boolean;               // Global kill switch. Default: false
  preflightDefaultTimeoutMs: number;       // Default: 300000 (5 min). Max: 900000 (15 min)
  preflightMaxQuestions: number;           // Default: 2. Range: 1-4
  preflightSkipOnFollowUp: boolean;        // Default: true
}

// ============ Clarification Types ============

export interface ClarificationOption {
  id: string;
  label: string;
  description?: string;
  action: ClarificationAction;
  actionData?: Record<string, unknown>;
}

export interface ClarificationQuestion {
  id: string;
  context: string;
  question: string;
  options: ClarificationOption[];
  allowFreeText: boolean;
}

export interface GeneratedClarification {
  questions: ClarificationQuestion[];
}

// ============ HITL Types ============

export interface HitlFallbackAction {
  action: HitlAction;
  label: string;
}

export interface HitlClarificationEvent {
  type: 'hitl_clarification';
  messageId: string;
  score: number;
  issues: string[];
  questions: ClarificationQuestion[];
  fallbackActions: HitlFallbackAction[];
}

export interface HitlUserResponse {
  responses: Record<string, string>;      // questionId -> optionId
  freeTextInputs: Record<string, string>; // questionId -> free text
  fallbackAction?: HitlAction;
  timestamp?: string;                     // ISO timestamp when response was submitted
}

export interface HitlResult {
  action: 'continue' | 'retry';
  retryContext?: Record<string, unknown>;
}

// ============ Compliance Context ============

export interface MatchedSkillInfo {
  id: number;
  name: string;
  complianceConfig?: SkillComplianceConfig | null;
}

export interface ToolRoutingMatch {
  toolName: string;
  forceMode: string;
  skillId?: number;
  skillName?: string;
}

export interface ComplianceContext {
  userMessage: string;
  response: string;
  toolExecutions: ToolExecutionRecord[];
  matchedSkills: MatchedSkillInfo[];
  toolRoutingMatches: ToolRoutingMatch[];
  messageId?: string;
  conversationId?: string;
}

// ============ Database Types ============

export interface ComplianceResultRecord {
  id?: number;
  message_id: string;
  conversation_id: string;
  skill_ids: string | null;          // JSON array of skill IDs

  overall_score: number;
  decision: ComplianceDecisionType;

  checks_performed: string;          // JSON array of ComplianceCheckResult
  failed_checks: string | null;      // JSON array of failed check names

  hitl_triggered: number;            // 0 or 1
  hitl_questions: string | null;     // JSON: generated clarification questions
  hitl_user_response: string | null; // JSON: user's selections
  hitl_action: HitlAction | null;

  validated_at?: string;
}

// ============ Template Clarification Types ============

export interface TemplateClarification {
  context: string;
  question: string;
  options: ClarificationOption[];
  allowFreeText: boolean;
}

// ============ Clarification Request ============

export interface ClarificationRequest {
  failures: ComplianceCheckResult[];
  originalQuery: string;
  skillContext: string;
  toolResults: ToolExecutionRecord[];
  customInstructions?: string;
}

// ============ Pre-flight Clarification Types ============

export interface PreflightClarificationEvent {
  type: 'hitl_preflight';
  messageId: string;
  questions: ClarificationQuestion[];
  fallbackActions: HitlFallbackAction[];
  timeoutMs: number;
  skillName?: string;
}

export interface PreflightUserResponse {
  messageId: string;
  responses: Record<string, string>;      // questionId -> optionId
  freeTextInputs: Record<string, string>; // questionId -> free text
  fallbackAction?: HitlAction;
}

export interface ResolvedPreflightConfig {
  enabled: boolean;
  instructions?: string;
  maxQuestions: number;
  timeoutMs: number;
  skipOnFollowUp: boolean;
}

// ============ Stream Event Types ============

export type ComplianceStreamEvent =
  | { type: 'compliance'; data: ComplianceDecision }
  | { type: 'hitl_clarification'; data: HitlClarificationEvent }
  | { type: 'hitl_preflight'; data: PreflightClarificationEvent };
