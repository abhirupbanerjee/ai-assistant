/**
 * Streaming Types for Chat API
 *
 * Defines SSE event types for real-time streaming responses,
 * progressive disclosure UI state, and processing metadata.
 */

import type { Source, GeneratedDocumentInfo, GeneratedImageInfo, MessageVisualization } from './index';

// ============ Stream Phases ============

/**
 * Streaming phases for UI status display
 */
export type StreamPhase =
  | 'init'        // Connection established
  | 'rag'         // RAG retrieval in progress
  | 'tools'       // Executing tool calls
  | 'generating'  // Streaming LLM response
  | 'agent_planning'   // Autonomous mode: Creating task plan
  | 'agent_executing'  // Autonomous mode: Executing tasks
  | 'agent_summarizing' // Autonomous mode: Generating summary
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

  // RAG sources
  | { type: 'sources'; data: Source[] }

  // Text content chunks
  | { type: 'chunk'; content: string }

  // Completion
  | { type: 'done'; messageId: string; threadId: string }

  // Error
  | { type: 'error'; code: StreamErrorCode; message: string; recoverable: boolean }

  // Autonomous mode events
  | { type: 'agent_plan_created'; plan_id: string; title: string; task_count: number; tasks: Array<{ id: number; description: string; type: string }> }
  | { type: 'agent_task_started'; task_id: number; description: string; task_type: string }
  | { type: 'agent_task_completed'; task_id: number; status: 'done' | 'skipped' | 'needs_review'; confidence?: number; result?: string; checkerNotes?: string }
  | { type: 'agent_budget_warning'; level: 'medium' | 'high'; percentage: number; message: string }
  | { type: 'agent_budget_exceeded'; message: string }
  | { type: 'agent_plan_summary'; summary: string; stats: AgentPlanStats }
  | { type: 'agent_error'; error: string }

  // Autonomous mode control events
  | { type: 'agent_paused'; plan_id: string; completed_tasks: number; total_tasks: number; message: string; reason?: string }
  | { type: 'agent_resumed'; plan_id: string; remaining_tasks: number; total_tasks: number; message: string }
  | { type: 'agent_stopped'; plan_id: string; completed_tasks: number; skipped_tasks: number; total_tasks: number; summary?: string; reason?: string }
  | { type: 'agent_task_skipped'; plan_id: string; task_id: number; reason?: string };

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
  | 'RATE_LIMITED';

// ============ Request/Response Types ============

/**
 * Request body for streaming endpoint
 */
export interface StreamChatRequest {
  message: string;
  threadId: string;
  mode?: 'normal' | 'autonomous'; // Optional mode selection (defaults to 'normal')
  modelConfigPreset?: string; // For autonomous mode: 'default', 'quality', 'economy', 'compliance'
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
  isExpanded: boolean; // UI state for collapse/expand
}

// ============ Streaming Callbacks ============

/**
 * Callbacks for streaming tool execution events
 * Used by generateResponseWithTools when streaming is enabled
 */
export interface StreamingCallbacks {
  onToolStart?: (name: string, displayName: string) => void;
  onToolEnd?: (name: string, success: boolean, duration: number, error?: string) => void;
  onArtifact?: (type: 'visualization' | 'document' | 'image', data: MessageVisualization | GeneratedDocumentInfo | GeneratedImageInfo) => void;
}
