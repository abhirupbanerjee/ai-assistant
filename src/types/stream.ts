/**
 * Streaming Types for Chat API
 *
 * Defines SSE event types for real-time streaming responses,
 * progressive disclosure UI state, and processing metadata.
 */

import type { Source, GeneratedDocumentInfo, GeneratedImageInfo, MessageVisualization, DiagramHint, PodcastHint } from './index';
import type { ComplianceDecision, HitlClarificationEvent, PreflightClarificationEvent } from './compliance';
import type { FallbackReason, ModelSwitchEvent } from '@/lib/llm-fallback';


// ============ Stream Phases ============

/**
 * Streaming phases for UI status display
 */
export type StreamPhase =
  | 'init'        // Connection established
  | 'rag'         // RAG retrieval in progress
  | 'clarifying_question' // Pre-flight: waiting for user clarification
  | 'tools'       // Executing tool calls
  | 'generating'  // Streaming LLM response
  | 'agent_planning'   // Agent mode: Creating task plan
  | 'agent_executing'  // Agent mode: Executing tasks
  | 'agent_checking'   // Agent mode: Quality checking task
  | 'agent_summarizing' // Agent mode: Generating summary
  | 'awaiting_approval' // Agent mode: Waiting for user plan approval
  | 'complete';   // All done

// ============ Skill & Tool Tracking ============

/**
 * Skill information for context display
 */
export interface SkillInfo {
  name: string;
  triggerReason?: 'always' | 'category' | 'keyword';
}

/**
 * Operation log category for backend event tracking
 */
export type OperationCategory = 'rag' | 'llm' | 'tool' | 'memory';

/**
 * Operation log entry for the unified Operations section in ProcessingIndicator
 */
export interface OperationLogEntry {
  category: OperationCategory;
  message: string;
  timestamp: number;
}

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

  // Completion
  | { type: 'done'; messageId: string; threadId: string; model?: string; totalMs?: number; llmMs?: number; ragMs?: number; completionTokens?: number; tokensEstimated?: boolean }

  // Error
  | { type: 'error'; code: StreamErrorCode; message: string; recoverable: boolean }

  // Autonomous mode events
  | { type: 'agent_plan_created'; plan_id: string; title: string; task_count: number; tasks: Array<{ id: number; description: string; type: string }> }
  | { type: 'agent_wave_started'; wave_number: number; task_count: number; task_ids: number[] }
  | { type: 'agent_task_started'; task_id: number; description: string; task_type: string }
  | { type: 'agent_task_completed'; task_id: number; status: 'done' | 'skipped' | 'needs_review'; confidence?: number; result?: string; checkerNotes?: string }
  | { type: 'agent_budget_warning'; level: 'medium' | 'high'; percentage: number; message: string }
  | { type: 'agent_budget_exceeded'; message: string }
  | { type: 'agent_task_summary'; task_id: number; summary: string }
  | { type: 'agent_plan_summary'; summary: string; stats: AgentPlanStats }
  | { type: 'agent_error'; error: string }
  | { type: 'agent_replanning'; plan_id: string; failed_task_count: number; message: string }

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
  | { type: 'operation_log'; category: OperationCategory; message: string };

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
  | 'DISABLED'
  | 'DOMAIN_NOT_ALLOWED'
  | 'ACCESS_DENIED'
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
 * Chat preferences that can be set per-thread
 */
export interface ChatPreferences {
  webSearchEnabled: boolean;
  targetLanguage: string;
  responseTone: string;
}

/**
 * Default chat preferences
 */
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  webSearchEnabled: true,
  targetLanguage: 'en',
  responseTone: 'default',
};

// ============ Request/Response Types ============

/**
 * Request body for streaming endpoint
 */
export interface StreamChatRequest {
  message: string;
  threadId: string;
  mode?: 'normal' | 'autonomous'; // Optional mode selection (defaults to 'normal')
  modelConfigPreset?: string; // For autonomous mode: 'default', 'quality', 'economy', 'compliance'
  // Chat preferences
  webSearchEnabled?: boolean; // default: true (follows admin setting)
  targetLanguage?: string; // e.g., 'es', 'fr', defaults to 'en'
  responseTone?: string; // e.g., 'concise', 'formal', defaults to 'default'
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
  onArtifact?: (type: 'visualization' | 'document' | 'image' | 'diagram' | 'podcast', data: MessageVisualization | GeneratedDocumentInfo | GeneratedImageInfo | DiagramHint | PodcastHint) => void;
  /** Called when the LLM invokes request_clarification. Pauses the stream, shows HITL UI, resolves with user's answer or null. */
  onClarification?: (question: string, options: string[], allowFreeText: boolean) => Promise<string | null>;
}
