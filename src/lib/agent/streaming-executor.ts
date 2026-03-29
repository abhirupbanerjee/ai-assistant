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
import { getAgentModelConfigs } from '../db/compat/agent-config';
import { getSetting } from '../db/compat/config';
import { generatePlanIntro, generateIncrementalSummary, generateConclusion, regenerateAccumulatedContent } from './summarizer';
import { createPlanApprovalResolver } from '../streaming/plan-approval-resolver';

/**
 * Result of autonomous execution including collected artifacts
 */
export interface AutonomousExecutionResult {
  summary: string;
  accumulatedContent: string;
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
  const modelConfigs = await getAgentModelConfigs();
  const modelConfig: AgentModelConfig = {
    planner: modelConfigs.planner,
    executor: modelConfigs.executor,
    checker: modelConfigs.checker,
    summarizer: modelConfigs.summarizer,
  };

  // Load HITL plan approval settings
  const hitlEnabled = (await getSetting('agent_hitl_enabled', 'true')) === 'true';
  const hitlMinTasks = parseInt(await getSetting('agent_hitl_min_tasks', '5'), 10);
  const hitlTimeoutMs = parseInt(await getSetting('agent_hitl_timeout_seconds', '300'), 10) * 1000;

  // Collect artifacts during execution for persistence
  const collectedDocuments: GeneratedDocumentInfo[] = [];
  const collectedImages: GeneratedImageInfo[] = [];
  let planId = '';
  let accumulatedContent = ''; // Progressive response content streamed to user

  // Execute autonomous plan with streaming callbacks
  try {
    const result = await createAndExecuteAutonomousPlan(
      userRequest,
      context,
      {
        threadId: planConfig.threadId,
        userId: planConfig.userId,
        categorySlug: planConfig.categorySlug,
        budget: planConfig.budget,
        modelConfig,
        hitlEnabled,
        hitlMinTasks,
        hitlTimeoutMs,
      },
      {
        // Planning phase callbacks - user-friendly progress messages
        onAnalyzing: () => {
          sendEvent({
            type: 'status',
            phase: 'agent_planning',
            content: 'Analyzing your request...',
          });
        },

        onPlanning: () => {
          sendEvent({
            type: 'status',
            phase: 'agent_planning',
            content: 'Creating a task plan...',
          });
        },

        onPlanReady: (taskCount: number) => {
          sendEvent({
            type: 'status',
            phase: 'agent_planning',
            content: `Ready to execute ${taskCount} tasks. You can pause, stop, or skip tasks if needed.`,
          });
        },

        onPlanApprovalNeeded: hitlEnabled ? async (plan: AgentPlan) => {
          sendEvent({
            type: 'hitl_plan_approval',
            data: {
              planId: plan.id,
              title: plan.title,
              tasks: plan.tasks.map(t => ({
                id: t.id,
                type: t.type,
                target: t.target,
                description: t.description,
                tool_name: t.tool_name,
                dependencies: t.dependencies,
              })),
              timeoutMs: hitlTimeoutMs,
            },
          });
          sendEvent({
            type: 'status',
            phase: 'awaiting_approval',
            content: 'Waiting for plan approval...',
          });
          const result = await createPlanApprovalResolver(plan.id, hitlTimeoutMs);
          return result ?? { approved: false }; // Timeout = auto-reject
        } : undefined,

        onSkillsLoaded: (skills) => {
          sendEvent({
            type: 'context_loaded',
            skills: skills.map(s => ({ name: s.name, triggerReason: s.triggerReason })),
            toolsAvailable: [],
          });
        },

        onPlanCreated: async (plan: AgentPlan) => {
          // Capture plan ID for return value
          planId = plan.id;

          // Crash recovery: if plan has completed tasks but accumulatedContent is empty,
          // regenerate from task results already persisted in DB
          const completedCount = plan.tasks.filter(t => ['done', 'needs_review'].includes(t.status)).length;
          if (completedCount > 0 && !accumulatedContent) {
            accumulatedContent = regenerateAccumulatedContent(plan);
            if (accumulatedContent) {
              console.log(`[Streaming] Recovered accumulatedContent from ${completedCount} completed tasks`);
              sendEvent({ type: 'chunk', content: accumulatedContent });
            }
          }

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

          // Generate and stream plan intro via progressive summarizer (skip if recovering)
          if (completedCount === 0) {
            try {
              const intro = await generatePlanIntro(
                userRequest, plan.title,
                plan.tasks.map(t => ({ description: t.description, type: t.type })),
                modelConfig
              );
              if (intro.content) {
                sendEvent({ type: 'chunk', content: intro.content + '\n\n' });
                accumulatedContent += intro.content + '\n\n';
              }
            } catch (e) {
              console.error('[Streaming] Plan intro generation failed:', e);
            }
          }

          sendEvent({
            type: 'status',
            phase: 'agent_executing',
            content: `Executing ${plan.tasks.length} tasks...`,
          });
        },

        onWaveStarted: (waveNumber: number, taskCount: number, taskIds: number[]) => {
          sendEvent({
            type: 'agent_wave_started',
            wave_number: waveNumber,
            task_count: taskCount,
            task_ids: taskIds,
          });
        },

        onReplanNeeded: (planId: string, failedTasks: { id: number; description: string; error?: string }[]) => {
          sendEvent({
            type: 'agent_replanning',
            plan_id: planId,
            failed_task_count: failedTasks.length,
            message: `Re-planning ${failedTasks.length} failed tasks...`,
          });
        },

        onTaskStarted: (task: AgentTask) => {
          sendEvent({
            type: 'agent_task_started',
            task_id: task.id,
            description: task.description,
            task_type: task.type,
          });
          // Update status message to show which task is executing
          sendEvent({
            type: 'status',
            phase: 'agent_executing',
            content: `Executing task ${task.id}: ${task.description.substring(0, 50)}${task.description.length > 50 ? '...' : ''}`,
          });
        },

        onTaskChecking: (task: AgentTask) => {
          sendEvent({
            type: 'status',
            phase: 'agent_executing',
            content: `Checking task ${task.id} quality...`,
          });
        },

        onTaskCompleted: async (task: AgentTask, result: ExecutionResult) => {
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

          // Generate and stream incremental summary for completed tasks (skip needs_review — low-confidence content)
          if (status === 'done' && result.result) {
            try {
              const section = await generateIncrementalSummary(
                userRequest, accumulatedContent,
                { description: task.description, result: result.result, type: task.type },
                modelConfig
              );
              if (section.content) {
                sendEvent({ type: 'chunk', content: section.content + '\n\n' });
                accumulatedContent += section.content + '\n\n';
              }
            } catch (e) {
              console.error('[Streaming] Incremental summary failed for task', task.id, e);
            }
          }
        },

        onTaskSummary: (task: AgentTask, summary: string) => {
          sendEvent({
            type: 'agent_task_summary',
            task_id: task.id,
            summary,
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

        onSummarizing: () => {
          sendEvent({
            type: 'status',
            phase: 'agent_summarizing',
            content: 'All tasks complete. Generating summary...',
          });
        },

        onPlanCompleted: async (plan: AgentPlan, summary: string) => {
          // Generate brief conclusion (bulk content already streamed incrementally)
          const failedTypes = [...new Set(
            plan.tasks
              .filter(t => t.status === 'skipped' || t.status === 'failed')
              .map(t => t.type)
          )];

          try {
            const conclusion = await generateConclusion(
              userRequest, accumulatedContent, failedTypes, modelConfig
            );
            if (conclusion.content) {
              sendEvent({ type: 'chunk', content: '\n---\n\n' + conclusion.content });
              accumulatedContent += '\n---\n\n' + conclusion.content;
            }
          } catch (e) {
            console.error('[Streaming] Conclusion generation failed:', e);
          }

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
            llm_calls: plan.budget_used?.llm_calls || 0,
            tokens_used: plan.budget_used?.tokens_used || 0,
            web_searches: plan.budget_used?.web_searches || 0,
          };

          sendEvent({
            type: 'agent_plan_summary',
            summary: '',  // Content already streamed via chunks; don't re-send
            stats,
          });
        },

        // Control callbacks
        onPlanPaused: (plan: AgentPlan, reason?: string) => {
          const completedTasks = plan.tasks.filter((t) => t.status === 'done').length;
          sendEvent({
            type: 'agent_paused',
            plan_id: plan.id,
            completed_tasks: completedTasks,
            total_tasks: plan.tasks.length,
            message: `Plan paused at ${completedTasks}/${plan.tasks.length} tasks`,
            reason,
          });
        },

        onPlanStopped: (plan: AgentPlan, reason?: string) => {
          const completedTasks = plan.tasks.filter((t) => t.status === 'done').length;
          const skippedTasks = plan.tasks.filter((t) => t.status === 'skipped').length;
          sendEvent({
            type: 'agent_stopped',
            plan_id: plan.id,
            completed_tasks: completedTasks,
            skipped_tasks: skippedTasks,
            total_tasks: plan.tasks.length,
            reason,
          });
        },
      }
    );

    if (result.success) {
      // Handle normal completion, paused, or stopped states
      if (result.paused) {
        return {
          summary: accumulatedContent || 'Plan paused - resume to continue execution.',
          accumulatedContent,
          planId,
          generatedDocuments: collectedDocuments,
          generatedImages: collectedImages,
        };
      } else if (result.stopped) {
        return {
          summary: accumulatedContent || result.summary || 'Plan stopped by user.',
          accumulatedContent,
          planId,
          generatedDocuments: collectedDocuments,
          generatedImages: collectedImages,
        };
      } else if (accumulatedContent || result.summary) {
        return {
          summary: accumulatedContent || result.summary || '',
          accumulatedContent,
          planId,
          generatedDocuments: collectedDocuments,
          generatedImages: collectedImages,
        };
      } else {
        return {
          summary: 'Plan completed.',
          accumulatedContent: '',
          planId,
          generatedDocuments: collectedDocuments,
          generatedImages: collectedImages,
        };
      }
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
