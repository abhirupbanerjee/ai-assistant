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
import { detectStuckPlan, getReadyTasks } from './dependency-validator';
import {
  getTaskPlan,
  updateTaskPlanStatus,
  transitionTaskState,
  incrementBudgetUsage,
  getPlanControlStatus,
  createAutonomousPlan,
  stopPlan,
  replacePlanTasks,
  replaceFailedTasks,
  resetFailedTasks,
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
  // Wave execution callbacks
  onWaveStarted?: (waveNumber: number, taskCount: number, taskIds: number[]) => void;
  // Re-planning callbacks
  onReplanNeeded?: (planId: string, failedTasks: { id: number; description: string; error?: string }[]) => void;
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
 * Execute tasks in dependency-driven waves
 *
 * Each iteration finds ALL tasks whose dependencies are satisfied (a "wave")
 * and executes them in parallel via Promise.allSettled. Results are processed
 * sequentially to maintain event ordering and safe state transitions.
 */
async function executeTasksInOrder(
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  budgetTracker: GlobalBudgetTracker,
  callbacks?: OrchestratorCallbacks
): Promise<OrchestratorResult> {
  const maxWaves = 200; // Safety limit — waves, not individual tasks
  let waveCount = 0;
  // No fixed threshold — every retry-exhausted task triggers re-planning at wave boundary

  while (waveCount < maxWaves) {
    waveCount++;

    // 1. Budget check before wave
    const budgetStatus = await budgetTracker.checkBudget();
    if (budgetStatus.exceeded) {
      const errorMsg = `Budget exceeded: ${budgetStatus.message}`;
      callbacks?.onError?.(errorMsg);
      await updateTaskPlanStatus(plan.id, 'failed');
      return { success: false, error: errorMsg, plan_id: plan.id };
    }

    // 2. Reload plan for latest task states
    const currentPlan = await getTaskPlan(plan.id);
    if (!currentPlan) {
      callbacks?.onError?.('Plan not found during execution');
      await updateTaskPlanStatus(plan.id, 'failed');
      return { success: false, error: 'Plan not found during execution', plan_id: plan.id };
    }

    // 3. Get all ready tasks (deps satisfied) — the "wave"
    const wave = getReadyTasks(currentPlan.tasks);

    if (wave.length === 0) {
      // Check if plan is complete or stuck
      const allCompleted = currentPlan.tasks.every((t) =>
        ['done', 'skipped', 'needs_review'].includes(t.status)
      );
      if (allCompleted) {
        return { success: true, plan_id: plan.id };
      }

      const stuckResult = detectStuckPlan(currentPlan.tasks);
      if (stuckResult.isStuck) {
        const errorMsg = `Plan stuck: ${stuckResult.reason}`;
        callbacks?.onError?.(errorMsg);
        await updateTaskPlanStatus(plan.id, 'failed');
        return { success: false, error: errorMsg, plan_id: plan.id };
      }

      const errorMsg = 'No executable task found but plan not complete or stuck';
      callbacks?.onError?.(errorMsg);
      return { success: false, error: errorMsg, plan_id: plan.id };
    }

    // Sort wave by priority (highest first) for consistent ordering
    wave.sort((a, b) => (b.priority || 1) - (a.priority || 1));

    // 4. Notify wave and task starts
    if (wave.length > 1) {
      callbacks?.onWaveStarted?.(waveCount, wave.length, wave.map(t => t.id));
    }
    for (const task of wave) {
      callbacks?.onTaskStarted?.(task);
    }

    // 5. Execute wave — parallel if multiple tasks, sequential fast path if single
    const baseCallbacks: ExecutorCallbacks = {
      onToolStart: callbacks?.onToolStart,
      onToolEnd: callbacks?.onToolEnd,
      onArtifact: callbacks?.onArtifact,
      onSkillsLoaded: callbacks?.onSkillsLoaded,
    };

    let waveResults: { task: AgentTask; result: ExecutionResult }[];

    if (wave.length === 1) {
      // Single task — no Promise.allSettled overhead
      const task = wave[0];
      const cb: ExecutorCallbacks = { ...baseCallbacks, onChecking: () => callbacks?.onTaskChecking?.(task) };
      const result = await executeTask(task, currentPlan, modelConfig, cb);
      waveResults = [{ task, result }];
    } else {
      // Parallel wave execution
      console.log(`[Orchestrator] Executing wave ${waveCount}: ${wave.length} tasks in parallel [${wave.map(t => t.id).join(', ')}]`);
      const settled = await Promise.allSettled(
        wave.map((task) => {
          const cb: ExecutorCallbacks = { ...baseCallbacks, onChecking: () => callbacks?.onTaskChecking?.(task) };
          return executeTask(task, currentPlan, modelConfig, cb)
            .then((result) => ({ task, result }));
        })
      );
      waveResults = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? s.value
          : {
              task: wave[i],
              result: {
                success: false,
                error: (s.reason as Error)?.message || 'Task execution failed',
              } as ExecutionResult,
            }
      );
    }

    // 6. Process results SEQUENTIALLY (budget, events, retries)
    for (const { task, result } of waveResults) {
      // Budget usage
      if (result.tokens_used || result.llm_calls) {
        await incrementBudgetUsage(plan.id, {
          llm_calls: result.llm_calls || 0,
          tokens_used: result.tokens_used || 0,
        });
      }

      // Reload task for fresh state after execution
      const updatedPlan = await getTaskPlan(plan.id);
      const updatedTask = updatedPlan?.tasks?.find((t: AgentTask) => t.id === task.id) || task;
      await callbacks?.onTaskCompleted?.(updatedTask, result);

      // Emit per-task output summary
      const taskSummary = generateTaskOutputSummary(updatedTask, result);
      callbacks?.onTaskSummary?.(updatedTask, taskSummary);

      // === Retry Logic ===
      if (result.needsReview && (updatedTask.retry_count || 0) < 2) {
        const retrySuggestion = result.retry_suggestion || 'more_specific_prompt';
        console.log(`[Orchestrator] Task ${task.id} needs review — retrying with strategy: ${retrySuggestion}`);
        await transitionTaskState(plan.id, task.id, 'pending', {
          retry_count: (updatedTask.retry_count || 0) + 1,
          retry_context: updatedTask.review_notes || `Low confidence (${result.confidence}%). ${result.result?.substring(0, 200) || ''}`,
          retry_strategy: retrySuggestion,
        });
        callbacks?.onTaskSummary?.(updatedTask, `Retrying with alternative approach: ${retrySuggestion}`);
        continue; // Skip error check — task will be retried in next wave
      }

      // Error handling
      if (!result.success) {
        if (result.skipped) {
          console.warn(`[Orchestrator] Task ${task.id} skipped: ${result.error}`);
        } else if (result.needsReview) {
          // Retry exhausted — mark as failed so downstream tasks are blocked
          console.warn(
            `[Orchestrator] Task ${task.id} retry exhausted (confidence: ${result.confidence}%, retries: ${updatedTask.retry_count || 0})`
          );
          await transitionTaskState(plan.id, task.id, 'failed', {
            error: `Retry exhausted: confidence ${result.confidence}% after ${updatedTask.retry_count || 0} retries`,
          });
        } else {
          const errorMsg = `Task ${task.id} failed: ${result.error}`;
          callbacks?.onError?.(errorMsg);
          return { success: false, error: errorMsg, plan_id: plan.id };
        }
      }
    }

    // 6b. Re-plan: collect ALL retry-exhausted tasks from this wave and re-plan
    const freshPlan = await getTaskPlan(plan.id);
    const failedTasks = (freshPlan?.tasks || [])
      .filter((t: any) =>
        t.status === 'failed' &&
        t.error?.startsWith('Retry exhausted') &&
        (t.replan_count || 0) < 2  // Max 2 re-plans per task (loop guard)
      )
      .map((t: any) => ({ id: t.id, description: t.description, type: t.type, error: t.review_notes || t.error }));

    if (failedTasks.length > 0) {
      const budgetCheck = await budgetTracker.checkBudget();
      if (!budgetCheck.exceeded) {
        callbacks?.onReplanNeeded?.(plan.id, failedTasks);

        try {
          const replanResult = await createPlan(
            freshPlan?.originalRequest || '',
            { replanContext: failedTasks },
            modelConfig
          );

          if (replanResult.tasks.length > 0) {
            await resetFailedTasks(plan.id, failedTasks.map(t => t.id), replanResult.tasks);
            await incrementBudgetUsage(plan.id, { llm_calls: 1, tokens_used: 0 });
            console.log(`[Orchestrator] Re-planned: reset ${failedTasks.length} tasks with improved descriptions`);
          }
        } catch (e) {
          console.error('[Orchestrator] Re-planning failed:', e);
        }
      }
    }

    // 7. Post-wave budget check
    const postWaveBudget = await budgetTracker.checkBudget();
    if (postWaveBudget.exceeded) {
      const errorMsg = `Budget exceeded after wave ${waveCount}: ${postWaveBudget.message}`;
      callbacks?.onError?.(errorMsg);
      await updateTaskPlanStatus(plan.id, 'failed');
      return { success: false, error: errorMsg, plan_id: plan.id };
    }

    // 8. Control signals — check once per wave
    const controlStatus = await getPlanControlStatus(plan.id);
    if (controlStatus) {
      if (controlStatus.isPaused) {
        const pausedPlan = (await getTaskPlan(plan.id) as unknown as AgentPlan) || plan;
        callbacks?.onPlanPaused?.(pausedPlan, controlStatus.pauseReason);
        console.log(`[Orchestrator] Plan ${plan.id} paused after wave ${waveCount}`);
        return { success: true, paused: true, plan_id: plan.id };
      }

      if (controlStatus.isStopped) {
        const stoppedPlan = (await getTaskPlan(plan.id) as unknown as AgentPlan) || plan;
        callbacks?.onPlanStopped?.(stoppedPlan, controlStatus.stopReason);
        console.log(`[Orchestrator] Plan ${plan.id} stopped after wave ${waveCount}`);
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
  }

  // Safety limit
  const errorMsg = `Execution exceeded maximum waves (${maxWaves})`;
  callbacks?.onError?.(errorMsg);
  await updateTaskPlanStatus(plan.id, 'failed');
  return { success: false, error: errorMsg, plan_id: plan.id };
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
