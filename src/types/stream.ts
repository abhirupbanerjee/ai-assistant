/**
 * Stream Event Types
 *
 * Server-Sent Event types for chat streaming, including status updates,
 * tool execution tracking, artifacts, RAG sources, autonomous mode events,
 * and compliance events.
 */

import type {
  Source,
  GeneratedDocumentInfo,
  GeneratedImageInfo,
  MessageVisualization,
  DiagramHint,
  PodcastHint,
} from './index';
import type { ArtifactComment } from './artifact-canvas';
import type { BrowserSessionState, BrowserSessionInfo } from './browser';
import type {
  ComplianceDecision,
  HitlClarificationEvent,
  PreflightClarificationEvent,
} from './compliance';
import type { FallbackReason } from '@/lib/llm-fallback';

// ============ Stream Phases ============

/**
 * Streaming phases for UI status display
 */
export type StreamPhase =
  | 'init'        // Connection established
  | 'idle'
  | 'thinking'
  | 'reasoning'
  | 'planning'
  | 'rag'         // RAG retrieval in progress
  | 'clarifying_question' // Pre-flight: waiting for user clarification
  | 'tools'       // Executing tool calls
  | 'memory'
  | 'streaming'
  | 'generating'  // Streaming LLM response
  | 'agent_planning'   // Agent mode: Creating task plan
  | 'agent_executing'  // Agent mode: Executing tasks
  | 'agent_checking'   // Agent mode: Quality checking task
  | 'agent_summarizing' // Agent mode: Generating summary
  | 'awaiting_approval' // Agent mode: Waiting for user plan approval
  | 'compliance'
  | 'complete'    // All done
  | 'error';

// ============ Skill & Tool Tracking ============

/**
 * Skill information for context display
 */
export interface SkillInfo {
  name: string;
  triggerReason: 'always' | 'category' | 'keyword';
}

// ============ Supporting Types ============

/**
 * Operation log entry for backend operations
 */
export interface OperationLogEntry {
  timestamp: number;
  /** Category of the operation */
  category: OperationCategory;
  /** Human-readable description of the operation */
  message: string;
}

/**
 * Operation categories for backend operation logs
 */
export type OperationCategory =
  | 'rag'
  | 'llm'
  | 'memory'
  | 'tool'
  | 'upload'
  | 'system'
  | 'compliance'
  | 'plan'
  | 'agent';

/**
 * Human-readable labels for operation categories
 */
export const OPERATION_CATEGORY_LABELS: Record<OperationCategory, string> = {
  rag: 'Knowledge Retrieval',
  llm: 'AI Model',
  memory: 'Memory',
  tool: 'Tool',
  upload: 'Upload',
  system: 'System',
  compliance: 'Compliance',
  plan: 'Planning',
  agent: 'Agent',
};

/**
 * User-friendly status messages for streaming phases
 */
export const PHASE_MESSAGES: Record<string, string> = {
  idle: 'Waiting...',
  thinking: 'Thinking...',
  reasoning: 'Reasoning...',
  planning: 'Planning...',
  tools: 'Running tools...',
  rag: 'Searching knowledge base...',
  memory: 'Loading context...',
  streaming: 'Generating response...',
  complete: 'Complete',
  error: 'Error',
  agent_planning: 'Planning tasks...',
  agent_executing: 'Executing tasks...',
  agent_summarizing: 'Generating summary...',
  awaiting_approval: 'Waiting for approval...',
  compliance: 'Checking compliance...',
};

/**
 * Tool execution state for UI tracking
 */
export interface ToolExecutionState {
  name: string;
  displayName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startTime?: number;
  duration?: number;
  error?: string;
  /** Optional arguments passed to the tool (for richer display) */
  args?: Record<string, unknown>;
}

/**
 * User upload extraction state for UI tracking
 */
export interface UploadExtractionState {
  filename: string;
  sourceType: 'file' | 'web' | 'youtube';
  status: 'pending' | 'extracting' | 'success' | 'error';
  contentLength?: number;
  contentPreview?: string; // First 300 chars of extracted text
  error?: string;
}

/**
 * Agent plan statistics for summary display
 */
export interface AgentPlanStats {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  needs_review_tasks: number;
  average_confidence: number;
  // Token usage stats
  llm_calls?: number;
  tokens_used?: number;
  web_searches?: number;
}

/**
 * Agent response info for the Phase 2.2 "Answered by agent X" card.
 *
 * Mirrors the fields of `AgentResponse` (src/types/agent.ts) that the UI needs,
 * without importing the agent-contract type into the stream-type module (kept
 * cross-domain-clean). The stream route populates this from the invoker result.
 */
export interface AgentResponseInfo {
  agentId: string;
  agentName: string;
  roleFamily: 'planner' | 'executor' | 'critic' | 'researcher' | 'presenter';
  artifact: {
    type: 'text' | 'table' | 'file_ref' | 'structured' | 'error';
    content: string;
  };
  /** 0..1 self-assessed confidence. */
  confidence: number;
  /** Optional short reason from the agent's suggested_next. */
  suggestedNextReason?: string;
}

/**
 * Plan approval HITL event for autonomous mode
 */
export interface PlanApprovalEvent {
  planId: string;
  title: string;
  tasks: Array<{
    id: number;
    type: string;
    target: string;
    description: string;
    tool_name?: string;
    executor_profile?: 'default' | 'fast_low_cost' | 'deep_reasoning' | 'long_context' | 'artifact_generation' | 'local_private' | 'agentic_tool_loop';
    executor_profile_reason?: string;
    dependencies: number[];
  }>;
  timeoutMs: number;
}

// ============ Stream Events ============

/**
 * Server-Sent Event types for chat streaming
 */
export type StreamEvent =
  // Status updates
  | { type: 'status'; phase: StreamPhase; content: string }

  // Context loaded (skills + available tools) - for progressive disclosure
  | { type: 'context_loaded'; skills: SkillInfo[]; toolsAvailable: string[] }

  // Tool execution tracking
  | { type: 'tool_start'; name: string; displayName: string }
  | { type: 'tool_end'; name: string; success: boolean; duration?: number; error?: string }

  // Artifacts
  | { type: 'artifact'; subtype: 'visualization'; data: MessageVisualization }
  | { type: 'artifact'; subtype: 'document'; data: GeneratedDocumentInfo }
  | { type: 'artifact'; subtype: 'image'; data: GeneratedImageInfo }
  | { type: 'artifact'; subtype: 'diagram'; data: DiagramHint }
  | { type: 'artifact'; subtype: 'podcast'; data: PodcastHint }
  // Agent System (Phase 2.2) — return-result surfacing. Emitted when the LLM
  // calls an `agent__*` tool; the UI renders a collapsible "Answered by agent
  // X" card with the artifact + confidence. The main LLM still synthesizes a
  // final summary on top. See plans/phase_2_2_implementation_plan.md §1 (a).
  | { type: 'artifact'; subtype: 'agent'; data: AgentResponseInfo }

  // Browser session (remote browser) — emitted when browser_task_start creates a
  // session so the UI opens the right-panel BrowserSessionViewer.
  | { type: 'browser_session_started'; sessionId: string; threadId?: string; state: BrowserSessionState; url?: string; title?: string }

  // RAG sources
  | { type: 'sources'; data: Source[] }

  // User upload extraction status
  | { type: 'upload_status'; uploads: UploadExtractionState[] }

  // Context truncation warning (when user doc content is cut off)
  | { type: 'context_truncation'; filename: string; totalChunks: number; processedChunks: number; includedChunks: number; message: string }

  // Text content chunks
  | { type: 'chunk'; content: string }

  // Thinking/reasoning content from think-tag models (Qwen3, QwQ, DeepSeek-R1)
  | { type: 'thinking_chunk'; content: string }

  // User message persisted — emitted immediately after the user turn is saved,
  // BEFORE generation begins, so the client can reconcile its optimistic
  // user-<ts> id with the real DB id even when the stream is stopped or errors
  // (the 'done' event never fires in those paths).
  | { type: 'user_message_saved'; messageId: string; threadId: string }

  // Completion
  | { type: 'done'; messageId: string; threadId: string; userMessageId?: string; model?: string; totalMs?: number; llmMs?: number; ragMs?: number; completionTokens?: number; tokensEstimated?: boolean }

  // Error
  | { type: 'error'; code: StreamErrorCode; message: string; recoverable: boolean }

  // Autonomous mode events
  | {
      type: 'agent_plan_created';
      plan_id: string;
      title: string;
      task_count: number;
      tasks: Array<{
        id: number;
        description: string;
        type: string;
        executor_profile?: 'default' | 'fast_low_cost' | 'deep_reasoning' | 'long_context' | 'artifact_generation' | 'local_private' | 'agentic_tool_loop';
        executor_profile_reason?: string;
      }>;
    }
  | { type: 'agent_wave_started'; wave_number: number; task_count: number; task_ids: number[] }
  | {
      type: 'agent_task_started';
      task_id: number;
      description: string;
      task_type: string;
      executor_profile?: 'default' | 'fast_low_cost' | 'deep_reasoning' | 'long_context' | 'artifact_generation' | 'local_private' | 'agentic_tool_loop';
    }
  | {
      type: 'agent_task_completed';
      task_id: number;
      status: 'done' | 'skipped' | 'needs_review';
      confidence?: number;
      result?: string;
      checkerNotes?: string;
      executor_profile?: 'default' | 'fast_low_cost' | 'deep_reasoning' | 'long_context' | 'artifact_generation' | 'local_private' | 'agentic_tool_loop';
      executor_model_used?: string;
      /** Per-task token usage */
      tokens_used?: number;
      /** Per-task LLM call count */
      llm_calls?: number;
      /** Per-task web search count */
      web_searches?: number;
      /** Per-task tools executed (names only) */
      tools_used?: string[];
    }
  | { type: 'agent_budget_warning'; level: 'medium' | 'high'; percentage: number; message: string }
  | { type: 'agent_budget_exceeded'; message: string }
  | { type: 'agent_task_summary'; task_id: number; summary: string }
  | { type: 'agent_plan_summary'; summary: string; stats: AgentPlanStats }
  | { type: 'agent_error'; error: string }
  | { type: 'agent_replanning'; plan_id: string; failed_task_count: number; message: string }

  // Autonomous mode — per-task tool tracking (Subagent Panel)
  | { type: 'agent_task_tool_start'; task_id: number; tool_name: string; displayName: string; args?: Record<string, unknown> }
  | { type: 'agent_task_tool_end'; task_id: number; tool_name: string; success: boolean; duration: number }
  | { type: 'agent_task_progress'; task_id: number; message: string }

  // Autonomous mode — cost tracking
  | { type: 'agent_cost_update'; task_id: number; task_cost: number; cumulative_cost: number }

  // Subagent loop events
  | { type: 'subagent_step'; task_id: number; iteration: number; tool_name: string; args: Record<string, unknown> }
  | { type: 'subagent_thinking'; task_id: number; thought: string }
  | { type: 'subagent_budget_warning'; task_id: number; pct: number }
  | { type: 'subagent_complete'; task_id: number; result: string; iterations: number; hit_limit: boolean }
  | { type: 'subagent_human_approval_needed'; task_id: number; plan_id: string; request: { tool_name: string; arguments: Record<string, unknown>; reasoning: string; risk_level: 'low' | 'medium' | 'high' } }

  // Autonomous mode HITL — plan approval
  | { type: 'hitl_plan_approval'; data: PlanApprovalEvent }

  // Autonomous mode control events
  | { type: 'agent_paused'; plan_id: string; completed_tasks: number; total_tasks: number; message: string; reason?: string }
  | { type: 'agent_resumed'; plan_id: string; remaining_tasks: number; total_tasks: number; message: string }
  | { type: 'agent_stopped'; plan_id: string; completed_tasks: number; skipped_tasks: number; total_tasks: number; summary?: string; reason?: string }
  | { type: 'agent_task_skipped'; plan_id: string; task_id: number; reason?: string }

  // Compliance events
  | { type: 'compliance'; data: ComplianceDecision }
  | { type: 'hitl_clarification'; data: HitlClarificationEvent }
  | { type: 'hitl_preflight'; data: PreflightClarificationEvent }

  // LLM fallback events
  | { type: 'stream_reset' }
  | { type: 'model_switch'; originalModel: string; newModel: string; reason: FallbackReason; message: string }

  // Backend operation log (RAG steps, LLM switches, memory loading) for Operations UI section
  | { type: 'operation_log'; category: OperationCategory; message: string }

  // Agent System (Phase 2.2) — single-agent routing
  // Emitted by the stream route when the LLM calls `handoff_to_category`.
  // Ownership has transferred to toCategoryId; the current turn ends after
  // this event. The UI surfaces a category-change banner. See
  // plans/phase_2_2_implementation_plan.md §1 decision (c).
  | {
      type: 'handoff';
      fromCategoryId: number;
      toCategoryId: number;
      toCategoryName: string;
      toCategorySlug: string;
      reason?: string;
    };

/**
 * Stream error codes
 */
export type StreamErrorCode =
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'RAG_ERROR'
  | 'TOOL_ERROR'
  | 'LLM_ERROR'
  | 'TIMEOUT_ERROR'
  | 'UNKNOWN_ERROR'
  // Workspace-specific error codes
  | 'FEATURE_DISABLED'
  | 'NOT_FOUND'
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'DOMAIN_NOT_ALLOWED'
  | 'ACCESS_DENIED'
  | 'FORBIDDEN'
  | 'SESSION_EXPIRED'
  | 'SESSION_INVALID'
  | 'RATE_LIMITED'
  // LLM fallback error codes
  | 'NO_MODELS_AVAILABLE'
  | 'ALL_MODELS_FAILED'
  | 'CAPABILITY_UNAVAILABLE';

// ============ Chat Preferences ============

/**
 * Tone preset definition for response style control
 */
export interface TonePreset {
  label: string;
  icon: string;
  prompt: string;
}

/**
 * Available tone presets for response style
 */
export const TONE_PRESETS: Record<string, TonePreset> = {
  default: {
    label: 'Default',
    icon: 'MessageSquare',
    prompt: '', // No modification
  },
  concise: {
    label: 'Concise',
    icon: 'Minimize2',
    prompt: 'Be brief and to the point. Provide only essential information without unnecessary elaboration.',
  },
  detailed: {
    label: 'Detailed',
    icon: 'FileText',
    prompt: 'Provide comprehensive information covering all relevant aspects thoroughly with examples where helpful.',
  },
  explanatory: {
    label: 'Explanatory',
    icon: 'HelpCircle',
    prompt: 'Explain concepts clearly with context and background. Break down complex topics into understandable parts.',
  },
  formal: {
    label: 'Formal',
    icon: 'Briefcase',
    prompt: 'Use formal, professional language appropriate for official communications and documentation.',
  },
  creative: {
    label: 'Creative',
    icon: 'Sparkles',
    prompt: 'Use engaging, creative language while maintaining accuracy. Make the response interesting and memorable.',
  },
};

/**
 * A single step in an inline multi-agent pipeline.
 *
 * Each step pairs an agent id (validated against the registry) with a task
 * clause and optional tool hints from inline /command tokens.
 */
export interface PipelineStep {
  /** Validated agent id (e.g. `tpl-planner`). */
  agentId: string;
  /** The clause text assigned to this agent step. */
  task: string;
  /** /command keys attached to this step (e.g. `['pdf']`). */
  toolHints: string[];
}

/** Execution mode for inline pipelines. */
export type PipelineMode = 'auto' | 'strict';

/**
 * Chat preferences that can be set per-thread
 */
export interface ChatPreferences {
  webSearchEnabled: boolean;
  targetLanguage: string;
  responseTone: string;
  showSources: boolean;
  showCitationTrajectory: boolean;
  thinkingEnabled: boolean;
  toolHints?: string[]; // Transient slash command hints for this message only
  agentMention?: string; // Transient @ agent mention for this message only (agent id)
  /** Scope memory retrieval/extraction to a single category */
  activeCategoryId?: number;
  /** Inline multi-agent pipeline steps (2+ @agent tokens detected). */
  pipeline?: PipelineStep[];
  /** Execution mode for the pipeline: 'strict' (deterministic) or 'auto' (LLM-driven). */
  pipelineMode?: PipelineMode;
}

/**
 * Default chat preferences
 */
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  webSearchEnabled: true,
  targetLanguage: 'en',
  responseTone: 'default',
  showSources: true,
  showCitationTrajectory: true,
  thinkingEnabled: false,
};

/**
 * Global display settings controlled by admin
 */
export interface DisplaySettings {
  sourcesEnabled: boolean;
  citationTrajectoryEnabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

// ============ Request/Response Types ============

/**
 * Request body for streaming endpoint
 */
export interface StreamChatRequest {
  message: string;
  threadId: string;
  /** Scope memory retrieval/extraction to a single category */
  activeCategoryId?: number;
  mode?: 'normal' | 'autonomous'; // Optional mode selection (defaults to 'normal')
  modelConfigPreset?: string; // For autonomous mode: 'default', 'quality', 'economy', 'compliance'
  // Chat preferences
  webSearchEnabled?: boolean; // default: true (follows admin setting)
  targetLanguage?: string; // e.g., 'es', 'fr', defaults to 'en'
  responseTone?: string; // e.g., 'concise', 'formal', defaults to 'default'
  showCitationTrajectory?: boolean; // default: true
  thinkingEnabled?: boolean; // default: false unless model-specific UI default enables it
  toolHints?: string[]; // Transient slash command hints for this message only
  agentMention?: string; // Transient @ agent mention for this message only (agent id)
  /** Inline multi-agent pipeline steps (detected from 2+ @agent tokens). */
  pipeline?: PipelineStep[];
  /** Execution mode for the pipeline. */
  pipelineMode?: PipelineMode;
  /**
   * Regenerate/edit flow: delete this message and all later messages in the
   * thread before persisting the new user message, so DB history matches the
   * client's truncated view (no ghost turns on reload).
   */
  truncateFromMessageId?: string;
  /** Artifact comments attached to this user message (Phase 2a Path A). */
  artifactComments?: ArtifactComment[];
}

/**
 * Context truncation warning for user documents
 */
export interface ContextTruncationWarning {
  filename: string;
  totalChunks: number;
  processedChunks: number;
  includedChunks: number;
  message: string;
}

/**
 * Processing details for progressive disclosure UI
 * IMPORTANT: This is frontend-only state, NOT saved to database
 */
export interface ProcessingDetails {
  phase: StreamPhase;
  statusMessage?: string; // User-friendly status message (e.g., "Analyzing your request...")
  skills: SkillInfo[];
  toolsAvailable: string[];
  toolsExecuted: ToolExecutionState[];
  operationLog: OperationLogEntry[]; // Chronological backend operation log (RAG, LLM, MEMORY, TOOL)
  userUploads: UploadExtractionState[]; // User upload extraction status
  truncationWarnings: ContextTruncationWarning[]; // Warnings for truncated user docs
  isExpanded: boolean; // UI state for collapse/expand
}

// ============ Streaming Callbacks ============

/**
 * Callbacks for streaming tool execution events
 * Used by generateResponseWithTools when streaming is enabled
 */
export interface StreamingCallbacks {
  onChunk?: (text: string) => void;
  /** Called with reasoning/thinking content from think-tag models (<think>…</think> blocks) */
  onThinkingChunk?: (text: string) => void;
  onToolStart?: (name: string, displayName: string) => void;
  onToolEnd?: (name: string, success: boolean, duration: number, error?: string) => void;
  onArtifact?: (type: 'visualization' | 'document' | 'image' | 'diagram' | 'podcast' | 'agent', data: MessageVisualization | GeneratedDocumentInfo | GeneratedImageInfo | DiagramHint | PodcastHint | AgentResponseInfo) => void;
  /** Called when browser_task_start creates a session — the client opens the BrowserSessionViewer. */
  onBrowserSessionStarted?: (session: BrowserSessionInfo) => void;
  /** Called when the LLM invokes request_clarification. Pauses the stream, shows HITL UI, resolves with user's answer or null. */
  onClarification?: (question: string, options: string[], allowFreeText: boolean) => Promise<string | null>;
  /**
   * Called when the `handoff_to_category` tool returns a handoff-request
   * envelope (`{ handoff: true, targetCategoryId, ... }`). The route layer
   * performs the actual `transferThreadCategory` call, emits the `handoff` SSE
   * event, and ends the current turn. Returning from this callback lets the
   * tool loop treat the handoff as terminal (no summary LLM call).
   */
  onHandoff?: (envelope: { targetCategoryId: number; targetCategoryName: string; targetCategorySlug: string; reason?: string }) => void;
}
