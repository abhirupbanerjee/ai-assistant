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

// ============ Types ============

/** Autonomous task state for UI display */
export interface AutonomousTaskState {
  id: number;
  description: string;
  type: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'needs_review' | 'error';
  confidence?: number;
  result?: string;
  checkerNotes?: string;
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
}

export interface UseStreamingChatOptions {
  /** Callback when streaming completes successfully */
  onComplete?: (messageId: string, content: string, sources: Source[], visualizations: MessageVisualization[], documents: GeneratedDocumentInfo[], images: GeneratedImageInfo[], diagrams: DiagramHint[], podcasts: PodcastHint[], metadata?: import('@/types').MessageMetadata) => void;
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
  sendMessage: (message: string, threadId: string, mode?: 'normal' | 'autonomous', preferences?: ChatPreferences) => Promise<void>;
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
}

// ============ Initial State ============

const initialProcessingDetails: ProcessingDetails = {
  phase: 'init',
  skills: [],
  toolsAvailable: [],
  toolsExecuted: [],
  userUploads: [],
  truncationWarnings: [],
  isExpanded: false,
};

const initialState: StreamingState = {
  isStreaming: false,
  phase: null,
  currentContent: '',
  processingDetails: initialProcessingDetails,
  sources: [],
  visualizations: [],
  documents: [],
  images: [],
  diagrams: [],
  podcasts: [],
  autonomousPlan: null,
  budgetWarning: null,
  error: null,
  errorRecoverable: false,
  isPaused: false,
  isStopped: false,
  activePlanId: null,
};

// ============ Hook ============

export function useStreamingChat(options: UseStreamingChatOptions = {}): UseStreamingChatReturn {
  const { onComplete, onError, onPhaseChange, onModelSwitch } = options;

  const [state, setState] = useState<StreamingState>(initialState);

  // Refs for chunk batching and race condition prevention
  const contentBufferRef = useRef('');
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
          processingDetails: {
            ...prev.processingDetails,
            phase: event.phase,
            statusMessage: event.content, // User-friendly status message
          },
        }));
        onPhaseChange?.(event.phase);
        break;

      case 'context_loaded':
        setState(prev => ({
          ...prev,
          processingDetails: {
            ...prev.processingDetails,
            skills: event.skills,
            toolsAvailable: event.toolsAvailable,
          },
        }));
        break;

      case 'tool_start':
        setState(prev => {
          const newTool: ToolExecutionState = {
            name: event.name,
            displayName: event.displayName,
            status: 'running',
            startTime: Date.now(),
          };
          return {
            ...prev,
            processingDetails: {
              ...prev.processingDetails,
              toolsExecuted: [...prev.processingDetails.toolsExecuted, newTool],
            },
          };
        });
        break;

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
        // Initialize autonomous plan with tasks from the event
        setState(prev => ({
          ...prev,
          activePlanId: event.plan_id,
          autonomousPlan: {
            planId: event.plan_id,
            title: event.title,
            tasks: event.tasks?.map(t => ({
              id: t.id,
              description: t.description,
              type: t.type,
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
        // Update task to running status
        setState(prev => {
          if (!prev.autonomousPlan) return prev;
          return {
            ...prev,
            autonomousPlan: {
              ...prev.autonomousPlan,
              tasks: prev.autonomousPlan.tasks.map(task =>
                task.id === event.task_id
                  ? { ...task, description: event.description, type: event.task_type, status: 'running' as const }
                  : task
              ),
            },
          };
        });
        break;

      case 'agent_task_completed':
        // Update task to completed status with result and checker notes
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
                    }
                  : task
              ),
            },
          };
        });
        break;

      case 'agent_plan_summary':
        // Handle autonomous mode summary - set the content and stats
        if (event.summary) {
          contentBufferRef.current = event.summary;
          setState(prev => ({
            ...prev,
            currentContent: event.summary,
            autonomousPlan: prev.autonomousPlan
              ? { ...prev.autonomousPlan, stats: event.stats }
              : null,
          }));
        }
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
        // Handle plan resumed
        setState(prev => ({
          ...prev,
          isPaused: false,
          isStreaming: true,
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

      case 'model_switch':
        // Handle LLM model switch (fallback or capability requirement)
        onModelSwitch?.(event.originalModel, event.newModel, event.reason, event.message);
        break;

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

      case 'done':
        // Final flush of any remaining content
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = undefined;
        }
        setState(prev => {
          const finalContent = contentBufferRef.current || prev.currentContent;
          const metadata = (event.model || event.totalMs || event.completionTokens) ? {
            model: event.model,
            totalMs: event.totalMs,
            llmMs: event.llmMs,
            ragMs: event.ragMs,
            completionTokens: event.completionTokens,
          } : undefined;
          onComplete?.(event.messageId, finalContent, prev.sources, prev.visualizations, prev.documents, prev.images, prev.diagrams, prev.podcasts, metadata);
          return {
            ...prev,
            isStreaming: false,
            phase: 'complete',
            currentContent: finalContent,
            processingDetails: {
              ...prev.processingDetails,
              phase: 'complete',
            },
          };
        });
        break;

      case 'error':
        setState(prev => ({
          ...prev,
          isStreaming: false,
          error: event.message,
          errorRecoverable: event.recoverable,
        }));
        onError?.(event.code, event.message, event.recoverable);
        break;
    }
  }, [onComplete, onError, onPhaseChange, onModelSwitch]);

  /**
   * Send message and start streaming
   */
  const sendMessage = useCallback(async (message: string, threadId: string, mode: 'normal' | 'autonomous' = 'normal', preferences?: ChatPreferences) => {
    // Abort any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Increment message version to prevent stale updates from aborted streams
    messageVersionRef.current += 1;
    const currentVersion = messageVersionRef.current;

    // Reset state for new message
    contentBufferRef.current = '';
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
      processingDetails: {
        ...prev.processingDetails,
        currentPhase: 'complete',
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
  };
}

export default useStreamingChat;
