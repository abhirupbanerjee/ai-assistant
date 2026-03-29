/**
 * Orchestrator Agent
 *
 * Main coordinator for autonomous mode execution:
 * - Plan → Execute → Check → Summarize loop
 * - Budget enforcement at each step
 * - Stuck plan detection
 * - Idempotent state management
 * - Progress streaming
 */

// @ts-nocheck - Type compatibility between TaskPlan and AgentPlan will be addressed in future refactor
import type {
  AgentPlan,
  AgentTask,
  AgentModelConfig,
  ExecutionResult,
  OrchestratorResult,
} from '@/types/agent';
import type { StreamEvent } from '@/types/stream';
import { createPlan } from './planner';
import { executeTask, type ExecutorCallbacks } from './executor';
import { generateSummary } from './summarizer';
import { GlobalBudgetTracker } from './budget-tracker';
import { detectStuckPlan } from './dependency-validator';
import {
  getTaskPlan,
  updateTaskPlanStatus,
  transitionTaskState,
  incrementBudgetUsage,
  getPlanControlStatus,
  createAutonomousPlan,
  stopPlan,
  replacePlanTasks,
} from '../db/compat/task-plans';
import { getThreadById } from '../db/compat/threads';

/**
 * Orchestrator callbacks for progress updates
 */
export interface OrchestratorCallbacks {
  // Planning phase callbacks (user-friendly progress)
  onAnalyzing?: () => void;
  onPlanning?: () => void;
  onPlanReady?: (taskCount: number) => void;
  // Execution callbacks (key callbacks support async for progressive streaming)
  onPlanCreated?: (plan: AgentPlan) => void | Promise<void>;
  onTaskStarted?: (task: AgentTask) => void;
  onTaskChecking?: (task: AgentTask) => void; // When checker validates task result
  onTaskCompleted?: (task: AgentTask, result: ExecutionResult) => void | Promise<void>;
  onTaskSummary?: (task: AgentTask, summary: string) => void; // Brief output summary after each task
  onToolStart?: (name: string, displayName: string) => void;
  onToolEnd?: (name: string, success: boolean, duration: number, error?: string) => void;
  onArtifact?: (event: StreamEvent) => void;
  onSkillsLoaded?: (skills: { name: string; triggerReason: 'always' | 'category' | 'keyword' }[]) => void;
  onBudgetWarning?: (message: string, percentage: number) => void;
  onBudgetExceeded?: (message: string) => void;
  onError?: (error: string) => void;
  onSummarizing?: () => void; // When generating final summary
  onPlanCompleted?: (plan: AgentPlan, summary: string) => void | Promise<void>;
  // HITL callbacks
  onPlanApprovalNeeded?: (plan: AgentPlan) => Promise<{ approved: boolean; feedback?: string }>;
  // Control callbacks
  onPlanPaused?: (plan: AgentPlan, reason?: string) => void;
  onPlanStopped?: (plan: AgentPlan, reason?: string) => void;
}

/**
 * Execute autonomous plan from start to finish
 *
 * @param planId - The plan ID to execute
 * @param modelConfig - Model configuration for agent roles
 * @param callbacks - Progress callbacks for streaming updates
 * @returns Orchestrator result with summary and statistics
 */
export async function executeAutonomousPlan(
  planId: string,
  modelConfig: AgentModelConfig,
  callbacks?: OrchestratorCallbacks
): Promise<OrchestratorResult> {
  // Load plan from database
  let plan = await getTaskPlan(planId) as unknown as AgentPlan | undefined;
  if (!plan) {
    const error = `Plan ${planId} not found`;
    callbacks?.onError?.(error);
    return {
      success: false,
      error,
      plan_id: planId,
    };
  }

  // Initialize budget tracker with callbacks
  const budgetTracker = await GlobalBudgetTracker.create((event) => {
    if (event.type === 'budget_warning') {
      callbacks?.onBudgetWarning?.(
        `Budget ${event.level} warning: ${event.percentage}% used`,
        event.percentage
      );
    } else if (event.type === 'budget_exceeded') {
      callbacks?.onBudgetExceeded?.(event.message);
    }
  });

  try {
    // Phase 1: Planning (already done if plan exists with tasks)
    if (!plan.tasks || plan.tasks.length === 0) {
      callbacks?.onError?.('Plan has no tasks - planning phase failed');
      await updateTaskPlanStatus(planId, 'failed');
      return {
        success: false,
        error: 'Plan has no tasks',
        plan_id: planId,
      };
    }

    await callbacks?.onPlanCreated?.(plan);

    // Phase 2: Execution Loop
    const executionResult = await executeTasksInOrder(plan, modelConfig, budgetTracker, callbacks);

    if (!executionResult.success) {
      return executionResult;
    }

    // Reload plan to get updated task states
    plan = (await getTaskPlan(planId) as unknown as AgentPlan) || plan;

    // Phase 3: Summarization
    callbacks?.onSummarizing?.();
    const summaryResult = await generatePlanSummary(plan, modelConfig, budgetTracker);

    if (!summaryResult.success) {
      callbacks?.onError?.(summaryResult.error || 'Summary generation failed');
      await updateTaskPlanStatus(planId, 'failed');
      return {
        success: false,
        error: summaryResult.error,
        plan_id: planId,
      };
    }

    // Mark plan as completed
    await updateTaskPlanStatus(planId, 'completed');

    // Bug fix: Reload plan from database to get fresh data for callback
    const finalPlan = (await getTaskPlan(planId) as unknown as AgentPlan) || plan;
    await callbacks?.onPlanCompleted?.(finalPlan, summaryResult.summary || '');

    return {
      success: true,
      plan_id: planId,
      summary: summaryResult.summary,
      stats: calculatePlanStats(finalPlan),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Orchestrator] Execution error:', errorMsg);
    callbacks?.onError?.(errorMsg);
    await updateTaskPlanStatus(planId, 'failed');

    return {
      success: false,
      error: errorMsg,
      plan_id: planId,
    };
  }
}

/**
 * Execute tasks in dependency order
 */
async function executeTasksInOrder(
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  budgetTracker: GlobalBudgetTracker,
  callbacks?: OrchestratorCallbacks
): Promise<OrchestratorResult> {
  const maxIterations = 1000; // Safety limit to prevent infinite loops
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    // Check for budget exceeded BEFORE starting new tasks
    const budgetStatus = await budgetTracker.checkBudget();
    if (budgetStatus.exceeded) {
      const errorMsg = `Budget exceeded: ${budgetStatus.message}`;
      callbacks?.onError?.(errorMsg);
      await updateTaskPlanStatus(plan.id, 'failed');
      return {
        success: false,
        error: errorMsg,
        plan_id: plan.id,
      };
    }

    // Reload plan to get latest task states
    const currentPlan = await getTaskPlan(plan.id);
    if (!currentPlan) {
      // Bug fix: Mark plan as failed before returning
      callbacks?.onError?.('Plan not found during execution');
      await updateTaskPlanStatus(plan.id, 'failed');
      return {
        success: false,
        error: 'Plan not found during execution',
        plan_id: plan.id,
      };
    }

    // Find next executable task (all dependencies satisfied)
    const nextTask = findNextExecutableTask(currentPlan.tasks);

    if (!nextTask) {
      // No executable task found - check if plan is complete or stuck
      const allCompleted = currentPlan.tasks.every((t) =>
        ['done', 'skipped', 'needs_review'].includes(t.status)
      );

      if (allCompleted) {
        // Plan complete
        return {
          success: true,
          plan_id: plan.id,
        };
      }

      // Check if plan is stuck
      const stuckResult = detectStuckPlan(currentPlan.tasks);
      if (stuckResult.isStuck) {
        const errorMsg = `Plan stuck: ${stuckResult.reason}`;
        callbacks?.onError?.(errorMsg);
        await updateTaskPlanStatus(plan.id, 'failed');
        return {
          success: false,
          error: errorMsg,
          plan_id: plan.id,
        };
      }

      // No task ready yet, but not stuck - should not happen
      const errorMsg = 'No executable task found but plan not complete or stuck';
      callbacks?.onError?.(errorMsg);
      return {
        success: false,
        error: errorMsg,
        plan_id: plan.id,
      };
    }

    // Execute the task
    callbacks?.onTaskStarted?.(nextTask);

    // Create executor callbacks from orchestrator callbacks
    const executorCallbacks: ExecutorCallbacks = {
      onToolStart: callbacks?.onToolStart,
      onToolEnd: callbacks?.onToolEnd,
      onArtifact: callbacks?.onArtifact,
      onChecking: () => callbacks?.onTaskChecking?.(nextTask),
      onSkillsLoaded: callbacks?.onSkillsLoaded,
    };

    const result = await executeTask(nextTask, currentPlan, modelConfig, executorCallbacks);

    // Update budget usage
    if (result.tokens_used || result.llm_calls) {
      await incrementBudgetUsage(plan.id, {
        llm_calls: result.llm_calls || 0,
        tokens_used: result.tokens_used || 0,
      });
    }

    // Bug fix: Check budget AFTER task completion to catch overages
    const postTaskBudget = await budgetTracker.checkBudget();
    if (postTaskBudget.exceeded) {
      const errorMsg = `Budget exceeded after task ${nextTask.id}: ${postTaskBudget.message}`;
      callbacks?.onError?.(errorMsg);
      await updateTaskPlanStatus(plan.id, 'failed');
      return {
        success: false,
        error: errorMsg,
        plan_id: plan.id,
      };
    }

    // Bug fix: Reload task from database to get fresh data for callback
    const updatedPlan = await getTaskPlan(plan.id);
    const updatedTask = updatedPlan?.tasks?.find((t: AgentTask) => t.id === nextTask.id) || nextTask;
    await callbacks?.onTaskCompleted?.(updatedTask, result);

    // Emit per-task output summary for user feedback
    const taskSummary = generateTaskOutputSummary(updatedTask, result);
    callbacks?.onTaskSummary?.(updatedTask, taskSummary);

    // === Retry Logic ===
    // If checker flagged for review and we haven't retried yet, retry with feedback
    if (result.needsReview && (updatedTask.retry_count || 0) < 1) {
      const retrySuggestion = result.retry_suggestion || 'more_specific_prompt';
      console.log(`[Orchestrator] Task ${nextTask.id} needs review — retrying with strategy: ${retrySuggestion}`);

      // Transition task back to pending with retry context
      await transitionTaskState(plan.id, nextTask.id, 'pending', {
        retry_count: (updatedTask.retry_count || 0) + 1,
        retry_context: updatedTask.review_notes || `Low confidence (${result.confidence}%). ${result.result?.substring(0, 200) || ''}`,
        retry_strategy: retrySuggestion,
      });

      callbacks?.onTaskSummary?.(updatedTask, `Retrying with alternative approach: ${retrySuggestion}`);
      continue; // Re-enter the loop — task will be picked up again
    }

    // === Control Signal Checks ===
    // Check for pause/stop signals AFTER task completion
    const controlStatus = await getPlanControlStatus(plan.id);
    if (controlStatus) {
      // Check pause signal
      if (controlStatus.isPaused) {
        const pausedPlan = (await getTaskPlan(plan.id) as unknown as AgentPlan) || plan;
        callbacks?.onPlanPaused?.(pausedPlan, controlStatus.pauseReason);
        console.log(`[Orchestrator] Plan ${plan.id} paused after task ${nextTask.id}`);
        return {
          success: true,
          paused: true,
          plan_id: plan.id,
        };
      }

      // Check stop signal (graceful termination)
      if (controlStatus.isStopped) {
        const stoppedPlan = (await getTaskPlan(plan.id) as unknown as AgentPlan) || plan;
        callbacks?.onPlanStopped?.(stoppedPlan, controlStatus.stopReason);
        console.log(`[Orchestrator] Plan ${plan.id} stopped after task ${nextTask.id}`);

        // Generate partial summary for stopped plan
        const summaryResult = await generatePlanSummary(stoppedPlan, modelConfig, budgetTracker);
        return {
          success: true,
          stopped: true,
          plan_id: plan.id,
          summary: summaryResult.summary,
          stats: calculatePlanStats(stoppedPlan),
        };
      }
    }

    // Check for errors or review needed
    if (!result.success) {
      if (result.skipped) {
        // Task was skipped due to error - continue with next task
        console.warn(`[Orchestrator] Task ${nextTask.id} skipped: ${result.error}`);
      } else if (result.needsReview) {
        // Task needs review and retry exhausted — execution continues
        console.warn(
          `[Orchestrator] Task ${nextTask.id} needs review (confidence: ${result.confidence}%) — retry exhausted`
        );
      } else {
        // Unexpected error
        const errorMsg = `Task ${nextTask.id} failed: ${result.error}`;
        callbacks?.onError?.(errorMsg);
        return {
          success: false,
          error: errorMsg,
          plan_id: plan.id,
        };
      }
    }

    // Continue to next iteration
  }

  // Safety limit reached
  const errorMsg = `Execution exceeded maximum iterations (${maxIterations})`;
  callbacks?.onError?.(errorMsg);
  await updateTaskPlanStatus(plan.id, 'failed');
  return {
    success: false,
    error: errorMsg,
    plan_id: plan.id,
  };
}

/**
 * Find next task that can be executed (all dependencies satisfied)
 */
function findNextExecutableTask(tasks: AgentTask[]): AgentTask | null {
  const completedStatuses = ['done', 'skipped', 'needs_review'];

  // Find pending tasks
  const pendingTasks = tasks.filter((t) => t.status === 'pending');

  if (pendingTasks.length === 0) {
    return null;
  }

  // Find pending tasks with all dependencies satisfied, sorted by priority (highest first)
  const readyTasks = pendingTasks.filter((task) => {
    return task.dependencies.every((depId) => {
      const dep = tasks.find((t) => t.id === depId);
      return dep && completedStatuses.includes(dep.status);
    });
  });

  if (readyTasks.length === 0) return null;

  // Sort by priority descending (higher priority = runs first)
  readyTasks.sort((a, b) => (b.priority || 1) - (a.priority || 1));
  return readyTasks[0];
}

/**
 * Generate plan summary
 */
async function generatePlanSummary(
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  budgetTracker: GlobalBudgetTracker
): Promise<{ success: boolean; summary?: string; error?: string }> {
  // Check budget before summary
  const budgetStatus = await budgetTracker.checkBudget();
  if (budgetStatus.exceeded) {
    return {
      success: false,
      error: `Cannot generate summary - budget exceeded: ${budgetStatus.message}`,
    };
  }

  try {
    const summaryResult = await generateSummary(plan, modelConfig);

    // Track summarizer LLM usage
    await incrementBudgetUsage(plan.id, {
      llm_calls: 1,
      tokens_used: summaryResult.tokens_used,
    });

    return {
      success: true,
      summary: summaryResult.summary,
    };
  } catch (error) {
    console.error('[Orchestrator] Summary generation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Calculate plan statistics
 */
function calculatePlanStats(plan: AgentPlan): {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  needs_review_tasks: number;
  average_confidence: number;
} {
  const total = plan.tasks.length;
  const completed = plan.tasks.filter((t) => t.status === 'done').length;
  const failed = plan.tasks.filter((t) => t.status === 'failed').length;
  const skipped = plan.tasks.filter((t) => t.status === 'skipped').length;
  const needsReview = plan.tasks.filter((t) => t.status === 'needs_review').length;

  const confidenceScores = plan.tasks
    .filter((t) => t.confidence_score !== undefined)
    .map((t) => t.confidence_score!);

  const avgConfidence =
    confidenceScores.length > 0
      ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length
      : 0;

  return {
    total_tasks: total,
    completed_tasks: completed,
    failed_tasks: failed,
    skipped_tasks: skipped,
    needs_review_tasks: needsReview,
    average_confidence: avgConfidence,
  };
}

/**
 * Generate a brief human-readable summary of task output
 */
function generateTaskOutputSummary(task: AgentTask, result: ExecutionResult): string {
  if (result.skipped) {
    return `Skipped: ${result.error || 'Unknown error'}`;
  }
  if (result.needsReview) {
    return `Needs review (${result.confidence || 0}% confidence)`;
  }
  if (!result.success) {
    return `Failed: ${result.error || 'Unknown error'}`;
  }

  const resultText = result.result || task.result || '';
  const taskType = task.type.toLowerCase();

  // Tool outputs — extract key info
  if (resultText.includes('Document generated:')) {
    const match = resultText.match(/Document generated: (.+)/);
    return match ? `Generated: ${match[1]}` : 'Document generated';
  }
  if (resultText.includes('Image generated:')) {
    return `Image generated (${task.target})`;
  }
  if (resultText.includes('Spreadsheet generated:')) {
    const match = resultText.match(/Spreadsheet generated: (.+)/);
    return match ? `Generated: ${match[1]}` : 'Spreadsheet generated';
  }
  if (resultText.includes('Presentation generated:')) {
    const match = resultText.match(/Presentation generated: (.+)/);
    return match ? `Generated: ${match[1]}` : 'Presentation generated';
  }
  if (resultText.includes('Diagram generated:')) {
    return `Diagram created: ${task.target}`;
  }
  if (resultText.includes('Podcast generated:')) {
    return `Podcast generated: ${task.target}`;
  }

  // Search results
  if (taskType === 'search') {
    const match = resultText.match(/Found (\d+) results/);
    return match ? `Found ${match[1]} results for "${task.target.substring(0, 50)}"` : 'Search completed';
  }

  // LLM tasks — first 150 chars
  const preview = resultText.substring(0, 150).replace(/\n/g, ' ').trim();
  return preview.length >= 150 ? `${preview}...` : preview || 'Completed';
}

/**
 * Create and execute autonomous plan from user request
 *
 * @param userRequest - The user's autonomous mode request
 * @param context - Additional context (RAG, conversation history, etc.)
 * @param planConfig - Plan configuration (budget, model config, thread/user IDs)
 * @param callbacks - Progress callbacks
 * @returns Orchestrator result
 */
export async function createAndExecuteAutonomousPlan(
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
    modelConfig: AgentModelConfig;
    hitlEnabled?: boolean;
    hitlMinTasks?: number;
    hitlTimeoutMs?: number;
  },
  callbacks?: OrchestratorCallbacks
): Promise<OrchestratorResult> {
  try {
    // Validate thread exists before creating plan (FK constraint)
    const thread = await getThreadById(planConfig.threadId);
    if (!thread) {
      const error = `Thread ${planConfig.threadId} not found — cannot create autonomous plan`;
      callbacks?.onError?.(error);
      return { success: false, error, plan_id: '' };
    }

    // Phase 1a: Analyzing user request
    callbacks?.onAnalyzing?.();

    // Fetch skill catalog for planner (keyword-triggered skills)
    let skillCatalog: { id: number; name: string; description: string | null; trigger_value: string | null; tool_name: string | null; force_mode: string | null }[] = [];
    let resolvedSkillContext: {
      matchedSkills: { id: number; name: string; prompt_summary: string }[];
      toolHints: { tool_name: string; force_mode: string; skill_name: string }[];
    } = { matchedSkills: [], toolHints: [] };

    try {
      const { getSkillCatalogForPlanner } = await import('../db/compat/skills');
      let category: { id: number; name: string; slug: string } | null = null;
      if (planConfig.categorySlug) {
        const { getCategoryBySlug } = await import('../db/compat/categories');
        category = await getCategoryBySlug(planConfig.categorySlug);
        skillCatalog = await getSkillCatalogForPlanner(category ? [category.id] : []);
      } else {
        skillCatalog = await getSkillCatalogForPlanner([]);
      }
      if (skillCatalog.length > 0) {
        console.log(`[Orchestrator] Loaded ${skillCatalog.length} keyword skills for planner:`,
          skillCatalog.map(s => `${s.name} (id=${s.id}, keywords="${s.trigger_value}")`));
      }

      // Pre-resolve skills against user request for routing hints
      const { resolveSkills } = await import('../skills/resolver');
      const categoryIds = category ? [category.id] : [];
      const resolved = await resolveSkills(categoryIds, userRequest);

      const keywordMatched = resolved.skills.filter(s =>
        resolved.activatedBy.keyword.includes(s.name)
      );
      resolvedSkillContext.matchedSkills = keywordMatched.map(s => ({
        id: s.id,
        name: s.name,
        prompt_summary: s.description || s.prompt_content.substring(0, 100),
      }));

      if (resolved.toolRouting?.matches) {
        resolvedSkillContext.toolHints = resolved.toolRouting.matches.map(m => ({
          tool_name: m.toolName,
          force_mode: m.forceMode,
          skill_name: m.skillName,
        }));
      }

      if (resolvedSkillContext.matchedSkills.length > 0) {
        console.log(`[Orchestrator] Pre-resolved ${resolvedSkillContext.matchedSkills.length} keyword skills:`,
          resolvedSkillContext.matchedSkills.map(s => s.name));
      }
      if (resolvedSkillContext.toolHints.length > 0) {
        console.log(`[Orchestrator] Tool routing hints:`,
          resolvedSkillContext.toolHints.map(h => `${h.skill_name} → ${h.tool_name} (${h.force_mode})`));
      }
    } catch (err) {
      console.warn('[Orchestrator] Failed to load skill catalog for planner:', err);
    }

    // Fetch enabled tools dynamically for planner awareness
    let availableTools: { name: string; description: string }[] = [];
    try {
      const { getToolDefinitions } = await import('../tools');
      const categoryIds = planConfig.categorySlug
        ? await (async () => {
            const { getCategoryBySlug } = await import('../db/compat/categories');
            const cat = await getCategoryBySlug(planConfig.categorySlug!);
            return cat ? [cat.id] : [];
          })()
        : [];
      const toolDefs = await getToolDefinitions(categoryIds);
      availableTools = toolDefs.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
      }));
      if (availableTools.length > 0) {
        console.log(`[Orchestrator] ${availableTools.length} tools available for planner:`,
          availableTools.map(t => t.name));
      }
    } catch (err) {
      console.warn('[Orchestrator] Failed to fetch tool definitions for planner:', err);
    }

    // Phase 1b: Creating task plan
    callbacks?.onPlanning?.();
    const planResult = await createPlan(userRequest, { ...context, skillCatalog, resolvedSkillContext, availableTools }, planConfig.modelConfig);

    if (planResult.error || planResult.tasks.length === 0) {
      const error = planResult.error || 'Failed to create plan';
      callbacks?.onError?.(error);
      return {
        success: false,
        error,
        plan_id: '',
      };
    }

    // Create plan in database
    const planId = await createAutonomousPlan(
      planConfig.threadId,
      planConfig.userId,
      planResult.title,
      planResult.tasks.map((t) => ({
        id: t.id,
        description: t.description,
        type: t.type,
        target: t.target,
        dependencies: t.dependencies,
        expected_output: t.expected_output,
        execution_hint: t.execution_hint,
        skill_ids: t.skill_ids,
        tool_name: t.tool_name,
        retry_count: 0,
      })),
      {
        categorySlug: planConfig.categorySlug,
        budget: planConfig.budget,
        modelConfig: planConfig.modelConfig,
        originalRequest: userRequest,
      }
    );

    // Phase 1c: Plan ready - notify user with task count
    callbacks?.onPlanReady?.(planResult.tasks.length);

    // Phase 1d: HITL plan approval (conditional)
    const hitlMinTasks = planConfig.hitlMinTasks ?? 5;
    const shouldRequestApproval = callbacks?.onPlanApprovalNeeded
      && planConfig.hitlEnabled !== false
      && planResult.tasks.length >= hitlMinTasks;

    if (shouldRequestApproval) {
      let approvalAttempts = 0;
      const MAX_REPLAN_ITERATIONS = 3;

      while (approvalAttempts < MAX_REPLAN_ITERATIONS) {
        approvalAttempts++;
        const plan = await getTaskPlan(planId);
        if (!plan) break;

        const approval = await callbacks.onPlanApprovalNeeded!(plan as unknown as AgentPlan);

        if (!approval.approved) {
          await stopPlan(planId, 'User rejected plan');
          callbacks?.onPlanStopped?.(plan as unknown as AgentPlan, 'User rejected plan');
          return {
            success: false,
            error: 'Plan cancelled by user.',
            plan_id: planId,
          };
        }

        if (!approval.feedback) break; // Approved without feedback → proceed

        // Re-plan with user feedback
        console.log(`[Orchestrator] Re-planning (attempt ${approvalAttempts}) with feedback: ${approval.feedback}`);
        const revisedResult = await createPlan(
          userRequest,
          { ...context, skillCatalog, resolvedSkillContext, availableTools, planningFeedback: approval.feedback },
          planConfig.modelConfig
        );

        if (revisedResult.error || revisedResult.tasks.length === 0) {
          console.warn('[Orchestrator] Re-plan failed, proceeding with current plan');
          break;
        }

        await replacePlanTasks(planId, revisedResult.tasks, revisedResult.title);
        callbacks?.onPlanReady?.(revisedResult.tasks.length);
        // Loop → show revised plan for approval
      }
    }

    // Phase 2 & 3: Execute plan
    return await executeAutonomousPlan(planId, planConfig.modelConfig, callbacks);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Orchestrator] Create and execute error:', errorMsg);
    callbacks?.onError?.(errorMsg);
    return {
      success: false,
      error: errorMsg,
      plan_id: '',
    };
  }
}
