/**
 * Streaming Autonomous Executor
 *
 * Integrates autonomous mode with SSE streaming for real-time progress updates
 */

// @ts-nocheck - Type compatibility issues will be resolved in future refactor
import type { StreamEvent } from '@/types/stream';
import type { AgentModelConfig, AgentPlan, AgentTask, ExecutionResult } from '@/types/agent';
import type { GeneratedDocumentInfo, GeneratedImageInfo } from '@/types';
import { createAndExecuteAutonomousPlan } from './orchestrator';
import { getAgentModelConfigs } from '../db/agent-config';

/**
 * Result of autonomous execution including collected artifacts
 */
export interface AutonomousExecutionResult {
  summary: string;
  planId: string;
  generatedDocuments: GeneratedDocumentInfo[];
  generatedImages: GeneratedImageInfo[];
}

/**
 * Execute autonomous plan with streaming progress updates
 *
 * @param userRequest - The user's autonomous mode request
 * @param context - Additional context (RAG, conversation history, etc.)
 * @param planConfig - Plan configuration (thread/user IDs, budget, model config)
 * @param sendEvent - Callback to send SSE events to client
 * @returns Execution result including summary and collected artifacts
 */
export async function executeAutonomousWithStreaming(
  userRequest: string,
  context: {
    ragContext?: string;
    conversationHistory?: string;
    categoryContext?: string;
  },
  planConfig: {
    threadId: string;
    userId: string;
    categorySlug?: string;
    budget?: Record<string, unknown>;
  },
  sendEvent: (event: StreamEvent) => void
): Promise<AutonomousExecutionResult> {
  // Get model config from database (admin-configured)
  const modelConfigs = getAgentModelConfigs();
  const modelConfig: AgentModelConfig = {
    planner: modelConfigs.planner,
    executor: modelConfigs.executor,
    checker: modelConfigs.checker,
    summarizer: modelConfigs.summarizer,
  };

  // Collect artifacts during execution for persistence
  const collectedDocuments: GeneratedDocumentInfo[] = [];
  const collectedImages: GeneratedImageInfo[] = [];
  let planId = '';

  // Execute autonomous plan with streaming callbacks
  try {
    sendEvent({ type: 'status', phase: 'agent_planning', content: 'Creating autonomous task plan...' });

    const result = await createAndExecuteAutonomousPlan(
      userRequest,
      context,
      {
        threadId: planConfig.threadId,
        userId: planConfig.userId,
        categorySlug: planConfig.categorySlug,
        budget: planConfig.budget,
        modelConfig,
      },
      {
        onPlanCreated: (plan: AgentPlan) => {
          // Capture plan ID for return value
          planId = plan.id;

          // Count document generation tasks to estimate output count
          const generateTasks = plan.tasks.filter(t => t.type === 'generate');
          const docGenTasks = generateTasks.filter(t =>
            t.target?.toLowerCase().includes('document') ||
            t.target?.toLowerCase().includes('report') ||
            t.target?.toLowerCase().includes('word') ||
            t.target?.toLowerCase().includes('pdf')
          );

          sendEvent({
            type: 'agent_plan_created',
            plan_id: plan.id,
            title: plan.title,
            task_count: plan.tasks.length,
            tasks: plan.tasks.map(t => ({
              id: t.id,
              description: t.description,
              type: t.type,
            })),
          });

          // Provide informative status message based on plan complexity
          let statusMessage = `Executing ${plan.tasks.length} tasks...`;

          if (plan.tasks.length > 30) {
            // Large batch - explain what's happening
            statusMessage = `Processing large request: ${plan.tasks.length} tasks planned. `;
            if (docGenTasks.length > 1) {
              statusMessage += `Will generate ${docGenTasks.length} individual documents. This may take several minutes.`;
            } else {
              statusMessage += `This may take several minutes to complete.`;
            }
          } else if (docGenTasks.length > 1) {
            // Multiple documents
            statusMessage = `Executing ${plan.tasks.length} tasks to generate ${docGenTasks.length} documents...`;
          }

          sendEvent({
            type: 'status',
            phase: 'agent_executing',
            content: statusMessage,
          });
        },

        onTaskStarted: (task: AgentTask) => {
          sendEvent({
            type: 'agent_task_started',
            task_id: task.id,
            description: task.description,
            task_type: task.type,
          });
        },

        onTaskCompleted: (task: AgentTask, result: ExecutionResult) => {
          const status = result.success
            ? 'done'
            : result.skipped
              ? 'skipped'
              : result.needsReview
                ? 'needs_review'
                : 'done';

          sendEvent({
            type: 'agent_task_completed',
            task_id: task.id,
            status,
            confidence: result.confidence,
            result: result.result,           // Executor output text
            checkerNotes: task.review_notes, // Checker's assessment notes
          });
        },

        // Tool execution callbacks for streaming artifacts
        onToolStart: (name: string, displayName: string) => {
          sendEvent({
            type: 'tool_start',
            name,
            displayName,
          });
        },

        onToolEnd: (name: string, success: boolean, duration?: number, error?: string) => {
          sendEvent({
            type: 'tool_end',
            name,
            success,
            duration,
            error,
          });
        },

        onArtifact: (event: StreamEvent) => {
          // Forward artifact events directly to client
          sendEvent(event);

          // Also collect artifacts for persistence in message
          if (event.type === 'artifact') {
            if (event.subtype === 'document' && event.data) {
              collectedDocuments.push(event.data as GeneratedDocumentInfo);
            } else if (event.subtype === 'image' && event.data) {
              collectedImages.push(event.data as GeneratedImageInfo);
            }
          }
        },

        onBudgetWarning: (message: string, percentage: number) => {
          const level = percentage >= 75 ? 'high' : 'medium';
          sendEvent({
            type: 'agent_budget_warning',
            level,
            percentage,
            message,
          });
        },

        onBudgetExceeded: (message: string) => {
          sendEvent({
            type: 'agent_budget_exceeded',
            message,
          });
        },

        onError: (error: string) => {
          sendEvent({
            type: 'agent_error',
            error,
          });
        },

        onPlanCompleted: (plan: AgentPlan, summary: string) => {
          sendEvent({ type: 'status', phase: 'agent_summarizing', content: 'Generating summary...' });

          // Calculate stats
          const tasksWithConfidence = plan.tasks.filter((t) => t.confidence_score !== undefined);
          const stats = {
            total_tasks: plan.tasks.length,
            completed_tasks: plan.tasks.filter((t) => t.status === 'done').length,
            failed_tasks: plan.tasks.filter((t) => t.status === 'failed').length,
            skipped_tasks: plan.tasks.filter((t) => t.status === 'skipped').length,
            needs_review_tasks: plan.tasks.filter((t) => t.status === 'needs_review').length,
            average_confidence: tasksWithConfidence.length > 0
              ? tasksWithConfidence.reduce((sum, t) => sum + (t.confidence_score || 0), 0) / tasksWithConfidence.length
              : 0,
          };

          sendEvent({
            type: 'agent_plan_summary',
            summary,
            stats,
          });
        },
      }
    );

    if (result.success && result.summary) {
      return {
        summary: result.summary,
        planId,
        generatedDocuments: collectedDocuments,
        generatedImages: collectedImages,
      };
    } else if (result.error) {
      throw new Error(result.error);
    } else {
      throw new Error('Autonomous execution failed with unknown error');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    sendEvent({
      type: 'agent_error',
      error: errorMsg,
    });
    throw error;
  }
}
