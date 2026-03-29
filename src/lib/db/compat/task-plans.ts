/**
 * Task Plans Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb, transaction } from '../kysely';
import { nanoid } from 'nanoid';
import { calculateStats } from '../utils';

// Re-export types from sync module
export type { TaskStatus, PlanStatus, Task, TaskPlan, TaskPlanStats } from '../task-plans';

// Re-export sync-safe functions
export { calculateStats } from '../utils';

import type { TaskStatus, PlanStatus, Task, TaskPlan, TaskPlanStats } from '../task-plans';

// ============ Helper Functions ============

interface DbTaskPlanRow {
  id: string;
  thread_id: string;
  user_id: string;
  category_slug: string | null;
  title: string | null;
  tasks_json: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  mode: string | null;
  budget_json: string | null;
  budget_used_json: string | null;
  model_config_json: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  resumed_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  original_request: string | null;
}

function mapDbToTaskPlan(row: DbTaskPlanRow): TaskPlan {
  const tasksData = JSON.parse(row.tasks_json) as { tasks: Task[] };
  return {
    id: row.id,
    threadId: row.thread_id,
    userId: row.user_id,
    categorySlug: row.category_slug || undefined,
    title: row.title || 'Task Plan',
    tasks: tasksData.tasks,
    status: row.status as PlanStatus,
    totalTasks: row.total_tasks,
    completedTasks: row.completed_tasks,
    failedTasks: row.failed_tasks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
    pausedAt: row.paused_at || undefined,
    pauseReason: row.pause_reason || undefined,
    resumedAt: row.resumed_at || undefined,
    stoppedAt: row.stopped_at || undefined,
    stopReason: row.stop_reason || undefined,
    originalRequest: row.original_request || undefined,
  };
}

// ============ CRUD Operations ============

/**
 * Create a new task plan
 */
export async function createTaskPlan(
  threadId: string,
  userId: string,
  title: string,
  tasks: { id: number; description: string }[],
  categorySlug?: string
): Promise<TaskPlan> {
  const id = `plan_${nanoid(12)}`;
  const now = new Date().toISOString();

  const fullTasks: Task[] = tasks.map((t) => ({
    id: t.id,
    description: t.description,
    status: 'pending' as TaskStatus,
  }));

  const tasksJson = JSON.stringify({ tasks: fullTasks });
  const db = await getDb();

  await db
    .insertInto('task_plans')
    .values({
      id,
      thread_id: threadId,
      user_id: userId,
      category_slug: categorySlug || null,
      title,
      tasks_json: tasksJson,
      status: 'active',
      total_tasks: tasks.length,
      completed_tasks: 0,
      failed_tasks: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return (await getTaskPlan(id))!;
}

/**
 * Get a task plan by ID
 */
export async function getTaskPlan(planId: string): Promise<TaskPlan | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('task_plans')
    .selectAll()
    .where('id', '=', planId)
    .executeTakeFirst();

  return row ? mapDbToTaskPlan(row as unknown as DbTaskPlanRow) : undefined;
}

/**
 * Get active task plan for a thread
 */
export async function getActiveTaskPlan(threadId: string): Promise<TaskPlan | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('task_plans')
    .selectAll()
    .where('thread_id', '=', threadId)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? mapDbToTaskPlan(row as unknown as DbTaskPlanRow) : undefined;
}

/**
 * Get all task plans for a thread
 */
export async function getTaskPlansByThread(threadId: string): Promise<TaskPlan[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('task_plans')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map((row) => mapDbToTaskPlan(row as unknown as DbTaskPlanRow));
}

/**
 * Get all task plans for a user
 */
export async function getTaskPlansByUser(userId: string, limit: number = 50): Promise<TaskPlan[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('task_plans')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => mapDbToTaskPlan(row as unknown as DbTaskPlanRow));
}

/**
 * Update a task's status within a plan
 */
export async function updateTask(
  planId: string,
  taskId: number,
  status: TaskStatus,
  extras?: { result?: string; error?: string; reason?: string }
): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan || plan.status !== 'active') return undefined;

  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return undefined;

  const now = new Date().toISOString();

  // Update task
  task.status = status;
  if (status === 'in_progress') {
    task.started_at = now;
  }
  if (status === 'complete' || status === 'failed' || status === 'skipped') {
    task.completed_at = now;
  }
  if (extras?.result) task.result = extras.result;
  if (extras?.error) task.error = extras.error;
  if (extras?.reason) task.reason = extras.reason;

  // Calculate stats
  const stats = calculateStats(plan.tasks);

  const db = await getDb();
  await db
    .updateTable('task_plans')
    .set({
      tasks_json: JSON.stringify({ tasks: plan.tasks }),
      updated_at: now,
      completed_tasks: stats.complete,
      failed_tasks: stats.failed,
    })
    .where('id', '=', planId)
    .execute();

  return getTaskPlan(planId);
}

/**
 * Complete a task plan
 */
export async function completePlan(planId: string, summary?: string): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan) return undefined;

  const now = new Date().toISOString();

  if (summary) {
    const lastTask = plan.tasks[plan.tasks.length - 1];
    if (lastTask && !lastTask.result) {
      lastTask.result = summary;
    }
  }

  const db = await getDb();
  await db
    .updateTable('task_plans')
    .set({
      status: 'completed',
      tasks_json: JSON.stringify({ tasks: plan.tasks }),
      updated_at: now,
      completed_at: now,
    })
    .where('id', '=', planId)
    .execute();

  return getTaskPlan(planId);
}

/**
 * Cancel a task plan
 */
export async function cancelPlan(planId: string, reason?: string): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan) return undefined;

  const now = new Date().toISOString();

  // Mark all pending tasks as skipped
  for (const task of plan.tasks) {
    if (task.status === 'pending' || task.status === 'in_progress') {
      task.status = 'skipped';
      task.reason = reason || 'Plan cancelled';
      task.completed_at = now;
    }
  }

  const db = await getDb();
  await db
    .updateTable('task_plans')
    .set({
      status: 'cancelled',
      tasks_json: JSON.stringify({ tasks: plan.tasks }),
      updated_at: now,
    })
    .where('id', '=', planId)
    .execute();

  return getTaskPlan(planId);
}

/**
 * Update task plan status
 */
export async function updateTaskPlanStatus(planId: string, status: 'completed' | 'failed' | 'cancelled'): Promise<TaskPlan | undefined> {
  if (status === 'completed') {
    return completePlan(planId);
  } else if (status === 'failed') {
    return failPlan(planId, 'Plan execution failed');
  } else if (status === 'cancelled') {
    return cancelPlan(planId, 'Plan cancelled by user');
  }
  return undefined;
}

/**
 * Fail a task plan
 */
export async function failPlan(planId: string, error: string): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan) return undefined;

  const now = new Date().toISOString();

  // Mark all pending tasks as skipped due to failure
  for (const task of plan.tasks) {
    if (task.status === 'pending' || task.status === 'in_progress') {
      task.status = 'skipped';
      task.reason = `Plan failed: ${error}`;
      task.completed_at = now;
    }
  }

  const db = await getDb();
  await db
    .updateTable('task_plans')
    .set({
      status: 'failed',
      tasks_json: JSON.stringify({ tasks: plan.tasks }),
      updated_at: now,
    })
    .where('id', '=', planId)
    .execute();

  return getTaskPlan(planId);
}

/**
 * Delete a task plan
 */
export async function deleteTaskPlan(planId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('task_plans')
    .where('id', '=', planId)
    .executeTakeFirst();

  return (result.numDeletedRows ?? 0) > 0;
}

/**
 * Clean up old completed/cancelled/failed plans
 */
export async function cleanupOldPlans(daysOld: number = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const db = await getDb();
  const result = await db
    .deleteFrom('task_plans')
    .where('status', 'in', ['completed', 'cancelled', 'failed'])
    .where('updated_at', '<', cutoffDate.toISOString())
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}

// ============ Autonomous Mode Operations ============

/**
 * Create autonomous plan with budget and model config
 */
export async function createAutonomousPlan(
  threadId: string,
  userId: string,
  title: string,
  tasks: { id: number; description: string; type: string; target: string; dependencies?: number[]; expected_output?: string; execution_hint?: string; skill_ids?: number[]; tool_name?: string; retry_count?: number }[],
  options: {
    categorySlug?: string;
    budget?: Record<string, unknown>;
    modelConfig?: Record<string, unknown>;
    originalRequest?: string;
  } = {}
): Promise<string> {
  const id = `plan_${nanoid(12)}`;
  const now = new Date().toISOString();

  const fullTasks = tasks.map((t) => ({
    id: t.id,
    type: t.type || 'analyze',
    target: t.target || '',
    description: t.description,
    status: 'pending' as const,
    dependencies: t.dependencies || [],
    priority: 1,
    state_history: [],
    ...(t.expected_output ? { expected_output: t.expected_output } : {}),
    ...(t.execution_hint ? { execution_hint: t.execution_hint } : {}),
    ...(t.skill_ids?.length ? { skill_ids: t.skill_ids } : {}),
    ...(t.tool_name ? { tool_name: t.tool_name } : {}),
    retry_count: t.retry_count ?? 0,
  }));

  const tasksJson = JSON.stringify({ tasks: fullTasks });
  const budgetJson = JSON.stringify(options.budget || { max_llm_calls: 100, max_tokens: 500000 });
  const budgetUsedJson = JSON.stringify({ llm_calls: 0, tokens_used: 0, web_searches: 0 });
  const modelConfigJson = JSON.stringify(options.modelConfig || {});

  const db = await getDb();
  await db
    .insertInto('task_plans')
    .values({
      id,
      thread_id: threadId,
      user_id: userId,
      category_slug: options.categorySlug || null,
      title,
      tasks_json: tasksJson,
      status: 'active',
      total_tasks: tasks.length,
      completed_tasks: 0,
      failed_tasks: 0,
      mode: 'autonomous',
      budget_json: budgetJson,
      budget_used_json: budgetUsedJson,
      model_config_json: modelConfigJson,
      original_request: options.originalRequest || null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return id;
}

/**
 * Get budget usage for a plan
 */
export async function getBudgetUsage(planId: string): Promise<{ llm_calls: number; tokens_used: number; web_searches: number }> {
  const db = await getDb();
  const row = await db
    .selectFrom('task_plans')
    .select('budget_used_json')
    .where('id', '=', planId)
    .executeTakeFirst();

  if (!row || !row.budget_used_json) {
    return { llm_calls: 0, tokens_used: 0, web_searches: 0 };
  }

  try {
    return JSON.parse(row.budget_used_json);
  } catch {
    return { llm_calls: 0, tokens_used: 0, web_searches: 0 };
  }
}

/**
 * Increment budget usage
 */
export async function incrementBudgetUsage(
  planId: string,
  increment: { llm_calls?: number; tokens_used?: number; web_searches?: number }
): Promise<void> {
  await transaction(async (trx) => {
    const row = await trx
      .selectFrom('task_plans')
      .select('budget_used_json')
      .where('id', '=', planId)
      .forUpdate()
      .executeTakeFirst();

    const current = row?.budget_used_json
      ? JSON.parse(row.budget_used_json)
      : { llm_calls: 0, tokens_used: 0, web_searches: 0 };
    const updated = {
      llm_calls: current.llm_calls + (increment.llm_calls || 0),
      tokens_used: current.tokens_used + (increment.tokens_used || 0),
      web_searches: current.web_searches + (increment.web_searches || 0),
    };

    await trx
      .updateTable('task_plans')
      .set({
        budget_used_json: JSON.stringify(updated),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', planId)
      .execute();
  });
}

/**
 * Idempotent state transition with history tracking
 */
export async function transitionTaskState(
  planId: string,
  taskId: number,
  newStatus: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'needs_review',
  extras?: {
    result?: string;
    error?: string;
    confidence_score?: number;
    review_notes?: string;
    tokens_used?: number;
    llm_calls?: number;
    retry_count?: number;
    retry_context?: string;
    retry_strategy?: string;
  }
): Promise<void> {
  await transaction(async (trx) => {
    const planRow = await trx
      .selectFrom('task_plans')
      .select('tasks_json')
      .where('id', '=', planId)
      .forUpdate()
      .executeTakeFirst();

    if (!planRow) throw new Error('Plan not found');

    const tasksData = JSON.parse(planRow.tasks_json) as { tasks: any[] };
    const task = tasksData.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('Task not found');

    const now = new Date().toISOString();

    // Add state history entry only if status actually changes (idempotency)
    if (!task.state_history) task.state_history = [];
    if (task.status !== newStatus) {
      task.state_history.push({
        status: newStatus,
        timestamp: now,
        details: extras,
      });
    }

    // Update task status
    task.status = newStatus;
    if (newStatus === 'running') {
      task.execution_started_at = now;
      task.started_at = now;
    }
    if (['done', 'failed', 'skipped', 'needs_review'].includes(newStatus)) {
      task.completed_at = now;
    }

    // Update task fields
    if (extras?.result !== undefined) task.result = extras.result;
    if (extras?.error !== undefined) task.error = extras.error;
    if (extras?.confidence_score !== undefined) task.confidence_score = extras.confidence_score;
    if (extras?.review_notes !== undefined) task.review_notes = extras.review_notes;
    if (extras?.tokens_used !== undefined) task.tokens_used = extras.tokens_used;
    if (extras?.llm_calls !== undefined) task.llm_calls = extras.llm_calls;
    if (extras?.retry_count !== undefined) task.retry_count = extras.retry_count;
    if (extras?.retry_context !== undefined) task.retry_context = extras.retry_context;
    if (extras?.retry_strategy !== undefined) task.retry_strategy = extras.retry_strategy;

    // Calculate updated stats
    const stats = {
      complete: tasksData.tasks.filter((t) => t.status === 'done').length,
      failed: tasksData.tasks.filter((t) => t.status === 'failed').length,
    };

    await trx
      .updateTable('task_plans')
      .set({
        tasks_json: JSON.stringify(tasksData),
        updated_at: now,
        completed_tasks: stats.complete,
        failed_tasks: stats.failed,
      })
      .where('id', '=', planId)
      .execute();
  });
}

/**
 * Recovery function - called on startup to handle crashed plans
 */
export async function recoverActivePlans(): Promise<number> {
  const db = await getDb();
  const activePlans = await db
    .selectFrom('task_plans')
    .select(['id', 'tasks_json'])
    .where('status', '=', 'active')
    .where('mode', '=', 'autonomous')
    .execute();

  let recovered = 0;

  for (const planRow of activePlans) {
    try {
      const tasksData = JSON.parse(planRow.tasks_json) as { tasks: any[] };
      let modified = false;

      // Find tasks stuck in 'running' state
      for (const task of tasksData.tasks) {
        if (task.status === 'running') {
          const startedAt = task.state_history?.find((h: any) => h.status === 'running')?.timestamp;
          if (startedAt) {
            const elapsed = Date.now() - new Date(startedAt).getTime();
            // 5 minute timeout
            if (elapsed > 5 * 60 * 1000) {
              task.status = 'skipped';
              task.error = 'Task timeout during crash recovery';
              task.completed_at = new Date().toISOString();
              if (!task.state_history) task.state_history = [];
              task.state_history.push({
                status: 'skipped',
                timestamp: new Date().toISOString(),
                details: { error: 'Task timeout during crash recovery' },
              });
              modified = true;
            }
          }
        }
      }

      if (modified) {
        await db
          .updateTable('task_plans')
          .set({
            tasks_json: JSON.stringify(tasksData),
            updated_at: new Date().toISOString(),
          })
          .where('id', '=', planRow.id)
          .execute();
        recovered++;
      }
    } catch (e) {
      console.error(`[RecoverPlans] Failed to recover plan ${planRow.id}:`, e);
    }
  }

  return recovered;
}

// ============ Execution Control Operations ============

/**
 * Pause an active plan
 */
export async function pausePlan(planId: string, reason?: string): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan) return undefined;

  if (plan.status !== 'active') {
    console.warn(`[PausePlan] Cannot pause plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const now = new Date().toISOString();

  const db = await getDb();
  await db
    .updateTable('task_plans')
    .set({
      status: 'paused',
      paused_at: now,
      pause_reason: reason || null,
      updated_at: now,
    })
    .where('id', '=', planId)
    .execute();

  console.log(`[PausePlan] Plan ${planId} paused at ${now}${reason ? `: ${reason}` : ''}`);
  return getTaskPlan(planId);
}

/**
 * Resume a paused plan
 */
export async function resumePlan(planId: string): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan) return undefined;

  if (plan.status !== 'paused') {
    console.warn(`[ResumePlan] Cannot resume plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const now = new Date().toISOString();

  const db = await getDb();
  await db
    .updateTable('task_plans')
    .set({
      status: 'active',
      resumed_at: now,
      updated_at: now,
    })
    .where('id', '=', planId)
    .execute();

  console.log(`[ResumePlan] Plan ${planId} resumed at ${now}`);
  return getTaskPlan(planId);
}

/**
 * Gracefully stop a plan
 */
export async function stopPlan(planId: string, reason?: string): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan) return undefined;

  if (plan.status !== 'active' && plan.status !== 'paused') {
    console.warn(`[StopPlan] Cannot stop plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const now = new Date().toISOString();
  const db = await getDb();

  const planRow = await db
    .selectFrom('task_plans')
    .select('tasks_json')
    .where('id', '=', planId)
    .executeTakeFirstOrThrow();

  const tasksData = JSON.parse(planRow.tasks_json) as { tasks: any[] };

  for (const task of tasksData.tasks) {
    if (task.status === 'pending') {
      task.status = 'skipped';
      task.reason = reason || 'Plan stopped by user';
      task.completed_at = now;
      if (!task.state_history) task.state_history = [];
      task.state_history.push({
        status: 'skipped',
        timestamp: now,
        details: { reason: reason || 'Plan stopped by user' },
      });
    }
  }

  await db
    .updateTable('task_plans')
    .set({
      status: 'stopped',
      stopped_at: now,
      stop_reason: reason || null,
      tasks_json: JSON.stringify(tasksData),
      updated_at: now,
    })
    .where('id', '=', planId)
    .execute();

  console.log(`[StopPlan] Plan ${planId} stopped at ${now}${reason ? `: ${reason}` : ''}`);
  return getTaskPlan(planId);
}

/**
 * Skip a specific task by ID
 */
export async function skipTask(planId: string, taskId: number, reason?: string): Promise<TaskPlan | undefined> {
  const plan = await getTaskPlan(planId);
  if (!plan) return undefined;

  if (plan.status !== 'active' && plan.status !== 'paused') {
    console.warn(`[SkipTask] Cannot skip task in plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const db = await getDb();
  const planRow = await db
    .selectFrom('task_plans')
    .select('tasks_json')
    .where('id', '=', planId)
    .executeTakeFirstOrThrow();

  const tasksData = JSON.parse(planRow.tasks_json) as { tasks: any[] };
  const task = tasksData.tasks.find((t: any) => t.id === taskId);

  if (!task) {
    console.warn(`[SkipTask] Task ${taskId} not found in plan ${planId}`);
    return undefined;
  }

  if (task.status !== 'pending') {
    console.warn(`[SkipTask] Cannot skip task ${taskId} with status '${task.status}'`);
    return undefined;
  }

  const now = new Date().toISOString();

  task.status = 'skipped';
  task.reason = reason || 'Skipped by user';
  task.completed_at = now;
  if (!task.state_history) task.state_history = [];
  task.state_history.push({
    status: 'skipped',
    timestamp: now,
    details: { reason: reason || 'Skipped by user' },
  });

  // Update stats
  const stats = {
    complete: tasksData.tasks.filter((t: any) => t.status === 'done').length,
    failed: tasksData.tasks.filter((t: any) => t.status === 'failed').length,
  };

  await db
    .updateTable('task_plans')
    .set({
      tasks_json: JSON.stringify(tasksData),
      updated_at: now,
      completed_tasks: stats.complete,
      failed_tasks: stats.failed,
    })
    .where('id', '=', planId)
    .execute();

  console.log(`[SkipTask] Task ${taskId} in plan ${planId} skipped${reason ? `: ${reason}` : ''}`);
  return getTaskPlan(planId);
}

/**
 * Replace all tasks in a plan with new tasks (used for HITL re-planning with feedback)
 */
export async function replacePlanTasks(
  planId: string,
  newTasks: Array<{
    id: number;
    description: string;
    type: string;
    target: string;
    dependencies?: number[];
    expected_output?: string;
    execution_hint?: string;
    skill_ids?: number[];
    tool_name?: string;
  }>,
  newTitle?: string
): Promise<void> {
  const fullTasks = newTasks.map(t => ({
    ...t,
    status: 'pending',
    state_history: [],
    retry_count: 0,
    priority: t.id, // Use task order as priority
    dependencies: t.dependencies || [],
  }));

  const db = await getDb();
  await db
    .updateTable('task_plans')
    .set({
      tasks_json: JSON.stringify({ tasks: fullTasks }),
      total_tasks: fullTasks.length,
      completed_tasks: 0,
      failed_tasks: 0,
      ...(newTitle ? { title: newTitle } : {}),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', planId)
    .execute();

  console.log(`[ReplacePlanTasks] Plan ${planId} updated with ${fullTasks.length} tasks${newTitle ? ` (title: ${newTitle})` : ''}`);
}

/**
 * Replace failed (needs_review) tasks with new replacement tasks.
 * Uses transaction + FOR UPDATE to prevent concurrent modification.
 */
export async function replaceFailedTasks(
  planId: string,
  failedTaskIds: number[],
  newTasks: Array<{
    id: number;
    description: string;
    type: string;
    target: string;
    dependencies?: number[];
    expected_output?: string;
    execution_hint?: string;
    skill_ids?: number[];
    tool_name?: string;
  }>
): Promise<void> {
  await transaction(async (trx) => {
    const row = await trx
      .selectFrom('task_plans')
      .select('tasks_json')
      .where('id', '=', planId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    const data = JSON.parse(row.tasks_json) as { tasks: any[] };

    // Remove failed tasks
    data.tasks = data.tasks.filter(t => !failedTaskIds.includes(t.id));

    // Offset new task IDs to avoid collision with existing tasks
    const maxId = Math.max(0, ...data.tasks.map(t => t.id));
    const fullNewTasks = newTasks.map((t, i) => ({
      ...t,
      id: maxId + 1 + i,
      status: 'pending',
      dependencies: [],
      state_history: [],
      retry_count: 0,
      priority: 1,
    }));

    data.tasks.push(...fullNewTasks);

    await trx
      .updateTable('task_plans')
      .set({
        tasks_json: JSON.stringify(data),
        total_tasks: data.tasks.length,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', planId)
      .execute();

    console.log(`[ReplaceFailedTasks] Plan ${planId}: removed ${failedTaskIds.length} failed tasks, added ${fullNewTasks.length} replacement tasks`);
  });
}

/**
 * Reset failed tasks in-place with new descriptions from re-planning.
 * Preserves task IDs so downstream dependencies remain valid.
 * Maps planner results to failed tasks by index order.
 */
export async function resetFailedTasks(
  planId: string,
  failedTaskIds: number[],
  replacementTasks: Array<{
    description: string;
    type: string;
    target?: string;
    expected_output?: string;
    tool_name?: string;
  }>
): Promise<void> {
  await transaction(async (trx) => {
    const row = await trx
      .selectFrom('task_plans')
      .select('tasks_json')
      .where('id', '=', planId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    const data = JSON.parse(row.tasks_json) as { tasks: any[] };

    // 1:1 mapping — reset each failed task with planner's improved description
    for (let i = 0; i < failedTaskIds.length; i++) {
      const task = data.tasks.find((t: any) => t.id === failedTaskIds[i]);
      if (!task) continue;

      const replacement = replacementTasks[i];
      if (replacement) {
        task.description = replacement.description;
        task.type = replacement.type;
        if (replacement.target) task.target = replacement.target;
        if (replacement.expected_output) task.expected_output = replacement.expected_output;
        if (replacement.tool_name) task.tool_name = replacement.tool_name;
      }

      // Reset execution state — fresh start
      task.status = 'pending';
      task.retry_count = 0;
      task.result = null;
      task.error = null;
      task.review_notes = null;
      task.confidence_score = null;
      task.replan_count = (task.replan_count || 0) + 1;
      // ID + dependencies preserved
    }

    // If planner returned extras, add as independent tasks
    if (replacementTasks.length > failedTaskIds.length) {
      const maxId = Math.max(0, ...data.tasks.map((t: any) => t.id));
      for (let i = failedTaskIds.length; i < replacementTasks.length; i++) {
        data.tasks.push({
          ...replacementTasks[i],
          id: maxId + 1 + (i - failedTaskIds.length),
          status: 'pending',
          dependencies: [],
          state_history: [],
          retry_count: 0,
          replan_count: 0,
          priority: 1,
        });
      }
    }

    await trx
      .updateTable('task_plans')
      .set({
        tasks_json: JSON.stringify(data),
        total_tasks: data.tasks.length,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', planId)
      .execute();

    console.log(`[ResetFailedTasks] Plan ${planId}: reset ${failedTaskIds.length} tasks in-place, ${Math.max(0, replacementTasks.length - failedTaskIds.length)} extras added`);
  });
}

/**
 * Check if a plan is paused
 */
export async function isPlanPaused(planId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .selectFrom('task_plans')
    .select('status')
    .where('id', '=', planId)
    .executeTakeFirst();

  return row?.status === 'paused';
}

/**
 * Check if a plan is stopped
 */
export async function isPlanStopped(planId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .selectFrom('task_plans')
    .select('status')
    .where('id', '=', planId)
    .executeTakeFirst();

  return row?.status === 'stopped';
}

/**
 * Get plan control status
 */
export async function getPlanControlStatus(planId: string): Promise<{
  status: PlanStatus;
  isPaused: boolean;
  isStopped: boolean;
  pauseReason?: string;
  stopReason?: string;
} | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('task_plans')
    .select(['status', 'pause_reason', 'stop_reason'])
    .where('id', '=', planId)
    .executeTakeFirst();

  if (!row) return undefined;

  return {
    status: row.status as PlanStatus,
    isPaused: row.status === 'paused',
    isStopped: row.status === 'stopped',
    pauseReason: row.pause_reason || undefined,
    stopReason: row.stop_reason || undefined,
  };
}
