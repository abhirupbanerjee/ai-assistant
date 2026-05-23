/**
 * Streaming Chat Hook
 *
 * React hook for SSE-based streaming chat with:
 * - Chunk batching via requestAnimationFrame for performance
 * - ProcessingDetails state management
 * - Abort controller handling
 * - Progressive disclosure UI state
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  StreamEvent,
  StreamPhase,
  ToolExecutionState,
  OperationLogEntry,
  UploadExtractionState,
  ProcessingDetails,
  Source,
  MessageVisualization,
  GeneratedDocumentInfo,
  GeneratedImageInfo,
  DiagramHint,
  PodcastHint,
  ChatPreferences,
} from '@/types';
import type { PreflightClarificationEvent, HitlClarificationEvent } from '@/types/compliance';
import type { PlanApprovalEvent } from '@/types/stream';

// ============ Types ============

/** Autonomous task state for UI display */
export interface AutonomousTaskState {
  id: number;
  description: string;
  type: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'needs_review' | 'error';
  executorProfile?: 'default' | 'fast_low_cost' | 'deep_reasoning' | 'long_context' | 'artifact_generation' | 'local_private';
  executorProfileReason?: string;
  executorModelUsed?: string;
  confidence?: number;
  result?: string;
  checkerNotes?: string;
  /** Per-task telemetry */
  tokensUsed?: number;
  llmCalls?: number;
  webSearches?: number;
  toolsUsed?: string[];
  cost?: number;
  /** Current action being performed by the task (e.g. "read_file(path=src/lib/tools.ts)") */
  currentAction?: string;
}

/** Autonomous plan state for UI display */
export interface AutonomousPlanState {
  planId: string;
  title: string;
  tasks: AutonomousTaskState[];
  stats?: {
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
  };
}

export interface StreamingState {
  /** Whether streaming is in progress */
  isStreaming: boolean;
  /** Current phase of streaming */
  phase: StreamPhase | null;
  /** Accumulated content from chunks */
  currentContent: string;
  /** Accumulated thinking/reasoning content from think-tag models */
  currentThinkingContent: string;
  /** Processing details for progressive disclosure */
  processingDetails: ProcessingDetails;
  /** RAG sources received */
  sources: Source[];
  /** Visualizations from tools */
  visualizations: MessageVisualization[];
  /** Generated documents from tools */
  documents: GeneratedDocumentInfo[];
  /** Generated images from tools */
  images: GeneratedImageInfo[];
  /** Generated diagrams from tools */
  diagrams: DiagramHint[];
  /** Generated podcasts from tools */
  podcasts: PodcastHint[];
  /** Autonomous plan state (for autonomous mode) */
  autonomousPlan: AutonomousPlanState | null;
  /** Cumulative cost for autonomous mode */
  totalCost: number;
  /** Budget warning info (for autonomous mode) */
  budgetWarning: { level: 'medium' | 'high'; percentage: number; message: string } | null;
  /** Error message if any */
  error: string | null;
  /** Whether error is recoverable */
  errorRecoverable: boolean;
  // Execution control state
  /** Whether plan is paused */
  isPaused: boolean;
  /** Whether plan is stopped */
  isStopped: boolean;
  /** Active plan ID (for control operations) */
  activePlanId: string | null;
  /** HITL pre-flight clarification event (waiting for user input) */
  preflightEvent: PreflightClarificationEvent | null;
  /** HITL post-response clarification event */
  hitlEvent: HitlClarificationEvent | null;
  /** HITL plan approval event (autonomous mode) */
  planApprovalEvent: PlanApprovalEvent | null;
  /** HITL subagent tool approval event */
  subagentApprovalEvent: { taskId: number; toolName: string; args: Record<string, unknown>; reasoning: string; riskLevel: 'low' | 'medium' | 'high' } | null;
}

export interface UseStreamingChatOptions {
  /** Callback when streaming completes successfully */
  onComplete?: (messageId: string, content: string, sources: Source[], visualizations: MessageVisualization[], documents: GeneratedDocumentInfo[], images: GeneratedImageInfo[], diagrams: DiagramHint[], podcasts: PodcastHint[], metadata?: import('@/types').MessageMetadata, thinkingContent?: string) => void;
  /** Callback on error */
  onError?: (code: string, message: string, recoverable: boolean) => void;
  /** Callback when phase changes */
  onPhaseChange?: (phase: StreamPhase) => void;
  /** Callback when LLM model is switched (fallback or capability requirement) */
  onModelSwitch?: (originalModel: string, newModel: string, reason: string, message: string) => void;
}

export interface UseStreamingChatReturn {
  /** Current streaming state */
  state: StreamingState;
  /** Send a message and start streaming */
  sendMessage: (message: string, threadId: string, mode?: 'normal' | 'autonomous' | 'swarm', preferences?: ChatPreferences) => Promise<void>;
  /** Abort current streaming */
  abort: () => void;
  /** Toggle processing details expansion */
  toggleProcessingDetails: () => void;
  /** Reset state for new conversation */
  reset: () => void;
  // Execution control methods
  /** Pause the current autonomous plan */
  pausePlan: (reason?: string) => Promise<boolean>;
  /** Resume a paused autonomous plan */
  resumePlan: () => Promise<boolean>;
  /** Stop the current autonomous plan gracefully */
  stopPlan: (reason?: string) => Promise<boolean>;
  /** Skip a specific task in the autonomous plan */
  skipTask: (taskId: number, reason?: string) => Promise<boolean>;
  /** Approve or deny a subagent tool execution request */
  approveSubagentTool: (taskId: number, action: 'approve' | 'deny' | 'modify', modifiedArgs?: Record<string, unknown>) => Promise<boolean>;
}

// ============ Tool Action Messages ============

const TOOL_ACTION_MESSAGES: Record<string, string> = {
  web_search: 'Searching online',
  doc_gen: 'Generating document',
  chart_gen: 'Creating chart',
  image_gen: 'Generating image',
  diagram_gen: 'Generating diagram using Mermaid',
  data_source: 'Querying data source',
  translation: 'Translating content',
  load_testing: 'Running load test',
  security_scan: 'Running security scan',
  ssl_scan: 'Checking SSL/TLS',
  dns_scan: 'Scanning DNS records',
  cookie_audit: 'Auditing cookies',
  redirect_audit: 'Checking redirects',
  website_analysis: 'Analysing website',
  code_analysis: 'Analysing code',
  podcast_gen: 'Generating podcast',
  pptx_gen: 'Creating presentation',
  xlsx_gen: 'Generating spreadsheet',
  get_file_content: 'Reading file contents',
  get_repo_contents: 'Fetching repository',
  list_issues: 'Listing issues',
  list_pull_requests: 'Listing pull requests',
};

// ============ Initial State ============

const initialProcessingDetails: ProcessingDetails = {
  phase: 'init',
  skills: [],
  toolsAvailable: [],
  toolsExecuted: [],
  operationLog: [],
  userUploads: [],
  truncationWarnings: [],
  isExpanded: false,
};

const initialState: StreamingState = {
  isStreaming: false,
  phase: null,
  currentContent: '',
  currentThinkingContent: '',
  processingDetails: initialProcessingDetails,
  sources: [],
  visualizations: [],
  documents: [],
  images: [],
  diagrams: [],
  podcasts: [],
  autonomousPlan: null,
  totalCost: 0,
  budgetWarning: null,
  error: null,
  errorRecoverable: false,
  isPaused: false,
  isStopped: false,
  activePlanId: null,
  preflightEvent: null,
  hitlEvent: null,
  planApprovalEvent: null,
  subagentApprovalEvent: null,
};

// ============ Hook ============

export function useStreamingChat(options: UseStreamingChatOptions = {}): UseStreamingChatReturn {
  const { onComplete, onError, onPhaseChange, onModelSwitch } = options;

  const [state, setState] = useState<StreamingState>(initialState);
  // Always-current state ref — used to read values outside setState updaters
  // (calling onComplete inside a setState updater fires twice in React strict mode)
  const stateRef = useRef<StreamingState>(initialState);
  stateRef.current = state;

  // Refs for chunk batching and race condition prevention
  const contentBufferRef = useRef('');
  const thinkingBufferRef = useRef('');
  const rafRef = useRef<number | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messageVersionRef = useRef(0); // Prevents stale updates from aborted streams

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  /**
   * Process a single SSE event
   */
  const processEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'status':
        setState(prev => ({
          ...prev,
          phase: event.phase,
          // Clear preflight card when phase moves past clarifying_question
          ...(prev.preflightEvent && event.phase !== 'clarifying_question'
            ? { preflightEvent: null }
            : {}),
          // Clear plan approval card when phase moves past awaiting_approval
          ...(prev.planApprovalEvent && event.phase !== 'awaiting_approval'
            ? { planApprovalEvent: null }
            : {}),
          processingDetails: {
            ...prev.processingDetails,
            phase: event.phase,
            statusMessage: event.content, // User-friendly status message
          },
        }));
        onPhaseChange?.(event.phase);
        break;

      case 'context_loaded':
        setState(prev => {
          const existing = prev.processingDetails.skills || [];
          const newSkills = event.skills.filter(
            s => !existing.some(e => e.name === s.name)
          );
          return {
            ...prev,
            processingDetails: {
              ...prev.processingDetails,
              skills: [...existing, ...newSkills],
              toolsAvailable: event.toolsAvailable.length > 0
                ? event.toolsAvailable
                : prev.processingDetails.toolsAvailable,
            },
          };
        });
        break;

      case 'tool_start': {
        const toolStartTime = Date.now();
        const newTool: ToolExecutionState = {
          name: event.name,
          displayName: event.displayName,
          status: 'running',
          startTime: toolStartTime,
        };
        const toolLogEntry: OperationLogEntry = {
          category: 'tool',
          message: TOOL_ACTION_MESSAGES[event.name] ?? event.displayName,
          timestamp: toolStartTime,
        };
        setState(prev => ({
          ...prev,
          processingDetails: {
            ...prev.processingDetails,
            toolsExecuted: [...prev.processingDetails.toolsExecuted, newTool],
            operationLog: [...prev.processingDetails.operationLog, toolLogEntry],
          },
        }));
        break;
      }

      case 'tool_end':
        setState(prev => ({
          ...prev,
          processingDetails: {
            ...prev.processingDetails,
            toolsExecuted: prev.processingDetails.toolsExecuted.map(tool =>
              tool.name === event.name
                ? {
                    ...tool,
                    status: event.success ? 'success' : 'error',
                    duration: event.duration,
                    error: event.error,
                  }
                : tool
            ),
          },
        }));
        break;

      case 'artifact':
        if (event.subtype === 'visualization') {
          setState(prev => ({
            ...prev,
            visualizations: [...prev.visualizations, event.data],
          }));
        } else if (event.subtype === 'document') {
          setState(prev => ({
            ...prev,
            documents: [...prev.documents, event.data],
          }));
        } else if (event.subtype === 'image') {
          setState(prev => ({
            ...prev,
            images: [...prev.images, event.data],
          }));
        } else if (event.subtype === 'diagram') {
          setState(prev => ({
            ...prev,
            diagrams: [...prev.diagrams, event.data],
          }));
        } else if (event.subtype === 'podcast') {
          setState(prev => ({
            ...prev,
            podcasts: [...prev.podcasts, event.data],
          }));
        }
        break;

      case 'sources':
        setState(prev => ({
          ...prev,
          sources: event.data,
        }));
        break;

      case 'upload_status':
        setState(prev => ({
          ...prev,
          processingDetails: {
            ...prev.processingDetails,
            userUploads: event.uploads,
          },
        }));
        break;

      case 'context_truncation':
        setState(prev => ({
          ...prev,
          processingDetails: {
            ...prev.processingDetails,
            truncationWarnings: [
              ...prev.processingDetails.truncationWarnings,
              {
                filename: event.filename,
                totalChunks: event.totalChunks,
                processedChunks: event.processedChunks,
                includedChunks: event.includedChunks,
                message: event.message,
              },
            ],
          },
        }));
        break;

      case 'agent_plan_created':
        // Initialize autonomous plan with tasks and set phase
        setState(prev => ({
          ...prev,
          activePlanId: event.plan_id,
          phase: 'agent_planning',
          processingDetails: {
            ...prev.processingDetails,
            phase: 'agent_planning',
            statusMessage: `Plan ready: ${event.title} (${event.task_count} tasks)`,
          },
          autonomousPlan: {
            planId: event.plan_id,
            title: event.title,
            tasks: event.tasks?.map(t => ({
              id: t.id,
              description: t.description,
              type: t.type,
              executorProfile: t.executor_profile,
              executorProfileReason: t.executor_profile_reason,
              status: 'pending' as const,
            })) || Array.from({ length: event.task_count }, (_, i) => ({
              id: i + 1,
              description: `Task ${i + 1}`,
              type: 'unknown',
              status: 'pending' as const,
            })),
          },
        }));
        break;

      case 'agent_task_started':
        // Update task to running status and set executing phase
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            phase: 'agent_executing',
            processingDetails: {
              ...prev.processingDetails,
              phase: 'agent_executing',
            },
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? {
                      ...task,
                      description: event.description,
                      type: event.task_type,
                      executorProfile: event.executor_profile || task.executorProfile,
                      status: 'running' as const,
                    }
                  : task
              ),
            },
          };
        });
        break;

      case 'agent_task_completed': {
        // Update task status in plan state (progressive content is streamed via chunk events)
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? {
                      ...task,
                      status: event.status,
                      confidence: event.confidence,
                      result: event.result,
                      checkerNotes: event.checkerNotes,
                      executorProfile: event.executor_profile || task.executorProfile,
                      executorModelUsed: event.executor_model_used || task.executorModelUsed,
                      // Per-task telemetry
                      tokensUsed: event.tokens_used ?? task.tokensUsed,
                      llmCalls: event.llm_calls ?? task.llmCalls,
                      webSearches: event.web_searches ?? task.webSearches,
                      toolsUsed: event.tools_used ?? task.toolsUsed,
                    }
                  : task
              ),
            },
          };
        });
        break;
      }

      case 'agent_cost_update': {
        setState(prev => ({
          ...prev,
          totalCost: event.cumulative_cost,
          autonomousPlan: prev.autonomousPlan
            ? {
                ...prev.autonomousPlan,
                tasks: prev.autonomousPlan.tasks.map(task =>
                  task.id === event.task_id
                    ? { ...task, cost: event.task_cost }
                    : task
                ),
              }
            : null,
        }));
        break;
      }

      case 'agent_plan_summary':
        // Handle autonomous mode summary — stats only
        // Content was already streamed progressively via chunk events
        setState(prev => {
          // Only use summary as fallback if no content was streamed via chunks
          if (!prev.currentContent && event.summary) {
            contentBufferRef.current = event.summary;
            return {
              ...prev,
              currentContent: event.summary,
              phase: 'agent_summarizing',
              processingDetails: {
                ...prev.processingDetails,
                phase: 'agent_summarizing',
                statusMessage: 'Summarizing results...',
              },
              autonomousPlan: prev.autonomousPlan
                ? { ...prev.autonomousPlan, stats: event.stats }
                : null,
            };
          }
          // Content already built from chunks — just update stats
          return {
            ...prev,
            autonomousPlan: prev.autonomousPlan
              ? { ...prev.autonomousPlan, stats: event.stats }
              : null,
          };
        });
        break;

      case 'agent_budget_warning':
        // Handle budget warning - show warning but continue execution
        setState(prev => ({
          ...prev,
          budgetWarning: {
            level: event.level,
            percentage: event.percentage,
            message: event.message,
          },
        }));
        break;

      case 'agent_budget_exceeded':
        // Handle budget exceeded - this will stop execution
        setState(prev => ({
          ...prev,
          budgetWarning: {
            level: 'high',
            percentage: 100,
            message: event.message,
          },
          error: event.message,
          errorRecoverable: false,
        }));
        break;

      case 'agent_error':
        // Handle autonomous mode error
        setState(prev => ({
          ...prev,
          error: event.error,
          errorRecoverable: true,
        }));
        break;

      case 'agent_paused':
        // Handle plan paused
        setState(prev => ({
          ...prev,
          isPaused: true,
          isStreaming: false,
        }));
        break;

      case 'agent_resumed':
        // Handle plan resumed — do not set isStreaming: true here,
        // the SSE connection is still active (resume happens within the same stream)
        setState(prev => ({
          ...prev,
          isPaused: false,
        }));
        break;

      case 'agent_stopped':
        // Handle plan stopped
        setState(prev => ({
          ...prev,
          isStopped: true,
          isStreaming: false,
          currentContent: event.summary || prev.currentContent,
        }));
        break;

      case 'agent_task_tool_start':
        // Update task with current action (tool name + args)
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? {
                      ...task,
                      currentAction: event.args
                        ? `${event.displayName}(${Object.entries(event.args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')})`
                        : event.displayName,
                    }
                  : task
              ),
            },
          };
        });
        break;

      case 'agent_task_tool_end':
        // Clear current action on tool end
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? { ...task, currentAction: undefined }
                  : task
              ),
            },
          };
        });
        break;

      case 'agent_task_progress':
        // Update task with progress message
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? { ...task, currentAction: event.message }
                  : task
              ),
            },
          };
        });
        break;

      case 'agent_task_skipped':
        // Handle task skipped
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? { ...task, status: 'skipped' as const }
                  : task
              ),
            },
          };
        });
        break;

      case 'subagent_step':
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? { ...task, currentAction: `${event.tool_name}(${Object.entries(event.args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')})` }
                  : task
              ),
            },
          };
        });
        break;

      case 'subagent_thinking':
        // Thinking content is streamed via chunks — no special state needed
        break;

      case 'subagent_budget_warning':
        setState(prev => ({
          ...prev,
          budgetWarning: {
            level: event.pct >= 90 ? 'high' : 'medium',
            percentage: event.pct,
            message: `Subagent budget at ${event.pct}%`,
          },
        }));
        break;

      case 'subagent_complete':
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? { ...task, status: 'done', currentAction: undefined }
                  : task
              ),
            },
          };
        });
        break;

      case 'subagent_human_approval_needed':
        setState(prev => ({
          ...prev,
          subagentApprovalEvent: {
            taskId: event.task_id,
            toolName: event.request.tool_name,
            args: event.request.arguments,
            reasoning: event.request.reasoning,
            riskLevel: event.request.risk_level,
          },
        }));
        break;

      case 'hitl_preflight':
        // Pre-flight clarification — waiting for user input before response generation
        setState(prev => ({
          ...prev,
          preflightEvent: event.data,
        }));
        break;

      case 'hitl_clarification':
        // Post-response HITL — compliance-triggered clarification
        setState(prev => ({
          ...prev,
          hitlEvent: event.data,
        }));
        break;

      case 'hitl_plan_approval':
        // Autonomous mode — plan approval needed before execution
        console.log('[HITL] Plan approval event received:', event.data?.planId, 'tasks:', event.data?.tasks?.length);
        setState(prev => ({
          ...prev,
          planApprovalEvent: event.data,
        }));
        break;

      case 'operation_log':
        setState(prev => ({
          ...prev,
          processingDetails: {
            ...prev.processingDetails,
            operationLog: [...prev.processingDetails.operationLog, {
              category: event.category,
              message: event.message,
              timestamp: Date.now(),
            }],
          },
        }));
        break;

      case 'stream_reset':
        // Discard partial streamed content from a failed model before fallback retries
        contentBufferRef.current = '';
        setState(prev => ({
          ...prev,
          currentContent: '',
        }));
        break;

      case 'model_switch': {
        // Handle LLM model switch (fallback or capability requirement)
        onModelSwitch?.(event.originalModel, event.newModel, event.reason, event.message);
        const LLM_REASON_MESSAGES: Record<string, string> = {
          rate_limit: 'Rate limit reached, switching to fallback model',
          quota_exceeded: 'Quota exceeded, switching to fallback model',
          model_unavailable: 'Model unavailable, switching to fallback',
          api_error: 'API error, retrying with fallback model',
          auth_error: 'Authentication error, switching to fallback',
          vision_required: 'Switching to vision-capable model',
          tools_required: 'Switching to tool-capable model',
        };
        setState(prev => ({
          ...prev,
          processingDetails: {
            ...prev.processingDetails,
            operationLog: [...prev.processingDetails.operationLog, {
              category: 'llm' as const,
              message: LLM_REASON_MESSAGES[event.reason] ?? event.message,
              timestamp: Date.now(),
            }],
          },
        }));
        break;
      }

      case 'chunk':
        // Use RAF batching for smooth updates
        contentBufferRef.current += event.content;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            setState(prev => ({
              ...prev,
              currentContent: contentBufferRef.current,
            }));
            rafRef.current = undefined;
          });
        }
        break;

      case 'thinking_chunk':
        thinkingBufferRef.current += event.content;
        setState(prev => ({ ...prev, currentThinkingContent: thinkingBufferRef.current }));
        break;

      case 'done': {
        // Final flush of any remaining content
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = undefined;
        }
        // Read current state values from ref BEFORE setState to avoid calling
        // onComplete inside a setState updater (would fire twice in React strict mode)
        const doneState = stateRef.current;
        const finalContent = contentBufferRef.current || doneState.currentContent;
        const finalThinking = thinkingBufferRef.current || doneState.currentThinkingContent;
        const metadata = (event.model || event.totalMs || event.completionTokens) ? {
          model: event.model,
          totalMs: event.totalMs,
          llmMs: event.llmMs,
          ragMs: event.ragMs,
          completionTokens: event.completionTokens,
          tokensEstimated: event.tokensEstimated,
        } : undefined;
        setState(prev => ({
          ...prev,
          isStreaming: false,
          phase: 'complete',
          currentContent: finalContent,
          autonomousPlan: null,
          preflightEvent: null,
          hitlEvent: null,
          planApprovalEvent: null,
          processingDetails: {
            ...prev.processingDetails,
            phase: 'complete',
          },
        }));
        onComplete?.(event.messageId, finalContent, doneState.sources, doneState.visualizations, doneState.documents, doneState.images, doneState.diagrams, doneState.podcasts, metadata, finalThinking || undefined);
        break;
      }

      case 'error':
        setState(prev => ({
          ...prev,
          isStreaming: false,
          error: event.message,
          errorRecoverable: event.recoverable,
          preflightEvent: null,
          hitlEvent: null,
          planApprovalEvent: null,
        }));
        onError?.(event.code, event.message, event.recoverable);
        break;
    }
  }, [onComplete, onError, onPhaseChange, onModelSwitch]);

  /**
   * Send message and start streaming
   */
  const sendMessage = useCallback(async (message: string, threadId: string, mode: 'normal' | 'autonomous' | 'swarm' = 'normal', preferences?: ChatPreferences) => {
    // Abort any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Increment message version to prevent stale updates from aborted streams
    messageVersionRef.current += 1;
    const currentVersion = messageVersionRef.current;

    // Reset state for new message
    contentBufferRef.current = '';
    thinkingBufferRef.current = '';
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }

    setState({
      ...initialState,
      isStreaming: true,
      phase: 'init',
      processingDetails: {
        ...initialProcessingDetails,
        phase: 'init',
      },
    });

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          threadId,
          mode,
          // Include chat preferences if provided
          webSearchEnabled: preferences?.webSearchEnabled,
          targetLanguage: preferences?.targetLanguage,
          responseTone: preferences?.responseTone,
          showCitationTrajectory: preferences?.showCitationTrajectory,
          thinkingEnabled: preferences?.thinkingEnabled,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          // Skip processing if a newer message has started (prevents stale updates)
          if (currentVersion !== messageVersionRef.current) {
            return;
          }
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6)) as StreamEvent;
              processEvent(eventData);
            } catch {
              // Ignore malformed JSON
              console.warn('Failed to parse SSE event:', line);
            }
          }
          // Ignore comments (keep-alive) and empty lines
        }
      }

      // Safety: if stream closed without explicit 'done' event, ensure bar is dismissed
      setState(prev => prev.isStreaming ? {
        ...prev,
        isStreaming: false,
        phase: 'complete',
        processingDetails: { ...prev.processingDetails, phase: 'complete' },
      } : prev);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User aborted, reset state
        setState(prev => ({
          ...prev,
          isStreaming: false,
          error: null,
        }));
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: message,
        errorRecoverable: true,
      }));
      onError?.('FETCH_ERROR', message, true);
    }
  }, [processEvent, onError]);

  /**
   * Abort current streaming
   */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    // Reset all streaming state including processing details
    setState(prev => ({
      ...prev,
      isStreaming: false,
      autonomousPlan: null,
      preflightEvent: null,
      hitlEvent: null,
      planApprovalEvent: null,
      processingDetails: {
        ...prev.processingDetails,
        phase: 'complete',
        toolsExecuted: prev.processingDetails.toolsExecuted, // Keep tool history for reference
      },
    }));
  }, []);

  /**
   * Toggle processing details expansion
   */
  const toggleProcessingDetails = useCallback(() => {
    setState(prev => ({
      ...prev,
      processingDetails: {
        ...prev.processingDetails,
        isExpanded: !prev.processingDetails.isExpanded,
      },
    }));
  }, []);

  /**
   * Reset state for new conversation
   */
  const reset = useCallback(() => {
    abort();
    contentBufferRef.current = '';
    thinkingBufferRef.current = '';
    setState(initialState);
  }, [abort]);

  // ============ Execution Control Methods ============

  /**
   * Pause the current autonomous plan
   * Note: Pause takes effect AFTER the current task completes (graceful pause)
   */
  const pausePlan = useCallback(async (reason?: string): Promise<boolean> => {
    const planId = state.activePlanId;
    console.log('[useStreamingChat] Pause requested, activePlanId:', planId);

    if (!planId) {
      console.warn('[useStreamingChat] Cannot pause: no active plan (activePlanId is null)');
      return false;
    }

    try {
      console.log('[useStreamingChat] Sending pause request to:', `/api/autonomous/${planId}/pause`);
      const response = await fetch(`/api/autonomous/${planId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[useStreamingChat] Pause accepted:', data);
        // Set pending pause state - actual pause happens after current task completes
        setState(prev => ({ ...prev, isPaused: true }));
        return true;
      } else {
        const error = await response.json();
        console.error('[useStreamingChat] Pause failed:', error);
        return false;
      }
    } catch (error) {
      console.error('[useStreamingChat] Pause error:', error);
      return false;
    }
  }, [state.activePlanId]);

  /**
   * Resume a paused autonomous plan
   */
  const resumePlan = useCallback(async (): Promise<boolean> => {
    const planId = state.activePlanId;
    if (!planId) {
      console.warn('[useStreamingChat] Cannot resume: no active plan');
      return false;
    }

    try {
      const response = await fetch(`/api/autonomous/${planId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        setState(prev => ({ ...prev, isPaused: false }));
        return true;
      } else {
        const error = await response.json();
        console.error('[useStreamingChat] Resume failed:', error);
        return false;
      }
    } catch (error) {
      console.error('[useStreamingChat] Resume error:', error);
      return false;
    }
  }, [state.activePlanId]);

  /**
   * Stop the current autonomous plan gracefully
   */
  const stopPlan = useCallback(async (reason?: string): Promise<boolean> => {
    const planId = state.activePlanId;
    if (!planId) {
      console.warn('[useStreamingChat] Cannot stop: no active plan');
      return false;
    }

    try {
      const response = await fetch(`/api/autonomous/${planId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      if (response.ok) {
        setState(prev => ({ ...prev, isStopped: true, isStreaming: false }));
        return true;
      } else {
        const error = await response.json();
        console.error('[useStreamingChat] Stop failed:', error);
        return false;
      }
    } catch (error) {
      console.error('[useStreamingChat] Stop error:', error);
      return false;
    }
  }, [state.activePlanId]);

  /**
   * Skip a specific task in the autonomous plan
   */
  const skipTask = useCallback(async (taskId: number, reason?: string): Promise<boolean> => {
    const planId = state.activePlanId;
    if (!planId) {
      console.warn('[useStreamingChat] Cannot skip task: no active plan');
      return false;
    }

    try {
      const response = await fetch(`/api/autonomous/${planId}/tasks/${taskId}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      if (response.ok) {
        // Update task state locally
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === taskId
                  ? { ...task, status: 'skipped' as const }
                  : task
              ),
            },
          };
        });
        return true;
      } else {
        const error = await response.json();
        console.error('[useStreamingChat] Skip task failed:', error);
        return false;
      }
    } catch (error) {
      console.error('[useStreamingChat] Skip task error:', error);
      return false;
    }
  }, [state.activePlanId]);

  const approveSubagentTool = useCallback(async (
    taskId: number,
    action: 'approve' | 'deny' | 'modify',
    modifiedArgs?: Record<string, unknown>
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/agent/subagent/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, action, modified_args: modifiedArgs }),
      });

      if (response.ok) {
        setState(prev => ({ ...prev, subagentApprovalEvent: null }));
        return true;
      } else {
        const error = await response.json();
        console.error('[useStreamingChat] Subagent approval failed:', error);
        return false;
      }
    } catch (error) {
      console.error('[useStreamingChat] Subagent approval error:', error);
      return false;
    }
  }, []);

  return {
    state,
    sendMessage,
    abort,
    toggleProcessingDetails,
    reset,
    pausePlan,
    resumePlan,
    stopPlan,
    skipTask,
    approveSubagentTool,
  };
}

export default useStreamingChat;
