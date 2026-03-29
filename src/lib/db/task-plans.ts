/**
 * Task Plans Database Operations
 *
 * CRUD operations for the task_plans table.
 * Supports the Task Planner tool for managing multi-step task workflows.
 */

import { nanoid } from 'nanoid';
import { execute, queryOne, queryAll } from './index';

// ============ Types ============

export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped';
export type PlanStatus = 'active' | 'completed' | 'cancelled' | 'failed' | 'paused' | 'stopped';

export interface Task {
  id: number;
  description: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  reason?: string;
  started_at?: string;
  completed_at?: string;
}

export interface TaskPlan {
  id: string;
  threadId: string;
  userId: string;
  categorySlug?: string;
  title: string;
  tasks: Task[];
  status: PlanStatus;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  // Control fields
  pausedAt?: string;
  pauseReason?: string;
  resumedAt?: string;
  stoppedAt?: string;
  stopReason?: string;
  originalRequest?: string;
}

export interface TaskPlanStats {
  total: number;
  pending: number;
  in_progress: number;
  complete: number;
  failed: number;
  skipped: number;
  progress_percent: number;
}

// Database row type
interface DbTaskPlan {
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
  // Control columns
  paused_at: string | null;
  pause_reason: string | null;
  resumed_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
}

// ============ Mappers ============

function mapDbToTaskPlan(row: DbTaskPlan): TaskPlan {
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
    // Control fields
    pausedAt: row.paused_at || undefined,
    pauseReason: row.pause_reason || undefined,
    resumedAt: row.resumed_at || undefined,
    stoppedAt: row.stopped_at || undefined,
    stopReason: row.stop_reason || undefined,
  };
}

// ============ Stats Calculation ============

export function calculateStats(tasks: Task[]): TaskPlanStats {
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    complete: tasks.filter((t) => t.status === 'complete').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
    progress_percent: 0,
  };

  const finished = stats.complete + stats.failed + stats.skipped;
  stats.progress_percent = stats.total > 0 ? Math.round((finished / stats.total) * 100) : 0;

  return stats;
}

// ============ CRUD Operations ============

/**
 * Create a new task plan
 */
export function createTaskPlan(
  threadId: string,
  userId: string,
  title: string,
  tasks: { id: number; description: string }[],
  categorySlug?: string
): TaskPlan {
  const id = `plan_${nanoid(12)}`;
  const now = new Date().toISOString();

  const fullTasks: Task[] = tasks.map((t) => ({
    id: t.id,
    description: t.description,
    status: 'pending' as TaskStatus,
  }));

  const tasksJson = JSON.stringify({ tasks: fullTasks });

  execute(
    `INSERT INTO task_plans (
      id, thread_id, user_id, category_slug, title, tasks_json,
      status, total_tasks, completed_tasks, failed_tasks,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, 0, ?, ?)`,
    [id, threadId, userId, categorySlug || null, title, tasksJson, tasks.length, now, now]
  );

  return getTaskPlan(id)!;
}

/**
 * Get a task plan by ID
 */
export function getTaskPlan(planId: string): TaskPlan | undefined {
  const row = queryOne<DbTaskPlan>('SELECT * FROM task_plans WHERE id = ?', [planId]);
  return row ? mapDbToTaskPlan(row) : undefined;
}

/**
 * Get active task plan for a thread (most recent active plan)
 */
export function getActiveTaskPlan(threadId: string): TaskPlan | undefined {
  const row = queryOne<DbTaskPlan>(
    `SELECT * FROM task_plans
     WHERE thread_id = ? AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [threadId]
  );
  return row ? mapDbToTaskPlan(row) : undefined;
}

/**
 * Get all task plans for a thread
 */
export function getTaskPlansByThread(threadId: string): TaskPlan[] {
  const rows = queryAll<DbTaskPlan>(
    'SELECT * FROM task_plans WHERE thread_id = ? ORDER BY created_at DESC',
    [threadId]
  );
  return rows.map(mapDbToTaskPlan);
}

/**
 * Get all task plans for a user
 */
export function getTaskPlansByUser(userId: string, limit: number = 50): TaskPlan[] {
  const rows = queryAll<DbTaskPlan>(
    'SELECT * FROM task_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit]
  );
  return rows.map(mapDbToTaskPlan);
}

/**
 * Update a task's status within a plan
 */
export function updateTask(
  planId: string,
  taskId: number,
  status: TaskStatus,
  extras?: { result?: string; error?: string; reason?: string }
): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
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

  // Update database
  execute(
    `UPDATE task_plans
     SET tasks_json = ?, updated_at = ?, completed_tasks = ?, failed_tasks = ?
     WHERE id = ?`,
    [JSON.stringify({ tasks: plan.tasks }), now, stats.complete, stats.failed, planId]
  );

  return getTaskPlan(planId);
}

/**
 * Complete a task plan
 */
export function completePlan(planId: string, summary?: string): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
  if (!plan) return undefined;

  const now = new Date().toISOString();

  // If summary provided, store it in the last task's result or create a summary task
  if (summary) {
    const lastTask = plan.tasks[plan.tasks.length - 1];
    if (lastTask && !lastTask.result) {
      lastTask.result = summary;
    }
  }

  execute(
    `UPDATE task_plans
     SET status = 'completed', tasks_json = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
    [JSON.stringify({ tasks: plan.tasks }), now, now, planId]
  );

  return getTaskPlan(planId);
}

/**
 * Cancel a task plan
 */
export function cancelPlan(planId: string, reason?: string): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
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

  execute(
    `UPDATE task_plans
     SET status = 'cancelled', tasks_json = ?, updated_at = ?
     WHERE id = ?`,
    [JSON.stringify({ tasks: plan.tasks }), now, planId]
  );

  return getTaskPlan(planId);
}

/**
 * Update task plan status (wrapper for completePlan/failPlan)
 */
export function updateTaskPlanStatus(planId: string, status: 'completed' | 'failed' | 'cancelled'): TaskPlan | undefined {
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
export function failPlan(planId: string, error: string): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
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

  execute(
    `UPDATE task_plans
     SET status = 'failed', tasks_json = ?, updated_at = ?
     WHERE id = ?`,
    [JSON.stringify({ tasks: plan.tasks }), now, planId]
  );

  return getTaskPlan(planId);
}

/**
 * Delete a task plan (hard delete)
 */
export function deleteTaskPlan(planId: string): boolean {
  const result = execute('DELETE FROM task_plans WHERE id = ?', [planId]);
  return result.changes > 0;
}

/**
 * Clean up old completed/cancelled/failed plans
 */
export function cleanupOldPlans(daysOld: number = 30): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = execute(
    `DELETE FROM task_plans
     WHERE status IN ('completed', 'cancelled', 'failed')
     AND updated_at < ?`,
    [cutoffDate.toISOString()]
  );

  return result.changes;
}

// ============ Autonomous Mode Operations ============

/**
 * Create autonomous plan with budget and model config
 */
export function createAutonomousPlan(
  threadId: string,
  userId: string,
  title: string,
  tasks: { id: number; description: string; type: string; target: string; dependencies?: number[] }[],
  options: {
    categorySlug?: string;
    budget?: Record<string, unknown>;
    modelConfig?: Record<string, unknown>;
  } = {}
): string {
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
  }));

  const tasksJson = JSON.stringify({ tasks: fullTasks });
  const budgetJson = JSON.stringify(options.budget || { max_llm_calls: 100, max_tokens: 500000 });
  const budgetUsedJson = JSON.stringify({ llm_calls: 0, tokens_used: 0, web_searches: 0 });
  const modelConfigJson = JSON.stringify(options.modelConfig || {});

  execute(
    `INSERT INTO task_plans (
      id, thread_id, user_id, category_slug, title, tasks_json,
      status, total_tasks, completed_tasks, failed_tasks,
      mode, budget_json, budget_used_json, model_config_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, 0, 'autonomous', ?, ?, ?, ?, ?)`,
    [
      id,
      threadId,
      userId,
      options.categorySlug || null,
      title,
      tasksJson,
      tasks.length,
      budgetJson,
      budgetUsedJson,
      modelConfigJson,
      now,
      now,
    ]
  );

  return id;
}

/**
 * Get budget usage for a plan
 */
export function getBudgetUsage(planId: string): { llm_calls: number; tokens_used: number; web_searches: number } {
  const row = queryOne<{ budget_used_json: string }>(
    'SELECT budget_used_json FROM task_plans WHERE id = ?',
    [planId]
  );

  if (!row) {
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
export function incrementBudgetUsage(
  planId: string,
  increment: { llm_calls?: number; tokens_used?: number; web_searches?: number }
): void {
  const current = getBudgetUsage(planId);

  const updated = {
    llm_calls: current.llm_calls + (increment.llm_calls || 0),
    tokens_used: current.tokens_used + (increment.tokens_used || 0),
    web_searches: current.web_searches + (increment.web_searches || 0),
  };

  execute('UPDATE task_plans SET budget_used_json = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(updated),
    new Date().toISOString(),
    planId,
  ]);
}

/**
 * Idempotent state transition with history tracking
 */
export function transitionTaskState(
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
  }
): void {
  const plan = getTaskPlan(planId);
  if (!plan) throw new Error('Plan not found');

  const tasksData = JSON.parse(
    queryOne<{ tasks_json: string }>('SELECT tasks_json FROM task_plans WHERE id = ?', [planId])!.tasks_json
  ) as { tasks: any[] };

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

  // Calculate updated stats
  const stats = {
    complete: tasksData.tasks.filter((t) => t.status === 'done').length,
    failed: tasksData.tasks.filter((t) => t.status === 'failed').length,
  };

  // Save to DB
  execute(
    `UPDATE task_plans SET tasks_json = ?, updated_at = ?, completed_tasks = ?, failed_tasks = ? WHERE id = ?`,
    [JSON.stringify(tasksData), now, stats.complete, stats.failed, planId]
  );
}

/**
 * Recovery function - called on startup to handle crashed plans
 */
export function recoverActivePlans(): number {
  const activePlans = queryAll<{ id: string; tasks_json: string }>(
    "SELECT id, tasks_json FROM task_plans WHERE status = 'active' AND mode = 'autonomous'"
  );

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
        execute('UPDATE task_plans SET tasks_json = ?, updated_at = ? WHERE id = ?', [
          JSON.stringify(tasksData),
          new Date().toISOString(),
          planRow.id,
        ]);
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
 * The orchestrator will stop after the current task completes
 */
export function pausePlan(planId: string, reason?: string): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
  if (!plan) return undefined;

  // Can only pause active plans
  if (plan.status !== 'active') {
    console.warn(`[PausePlan] Cannot pause plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const now = new Date().toISOString();

  execute(
    `UPDATE task_plans
     SET status = 'paused', paused_at = ?, pause_reason = ?, updated_at = ?
     WHERE id = ?`,
    [now, reason || null, now, planId]
  );

  console.log(`[PausePlan] Plan ${planId} paused at ${now}${reason ? `: ${reason}` : ''}`);
  return getTaskPlan(planId);
}

/**
 * Resume a paused plan
 * Clears pause state and sets status back to active
 */
export function resumePlan(planId: string): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
  if (!plan) return undefined;

  // Can only resume paused plans
  if (plan.status !== 'paused') {
    console.warn(`[ResumePlan] Cannot resume plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const now = new Date().toISOString();

  execute(
    `UPDATE task_plans
     SET status = 'active', resumed_at = ?, updated_at = ?
     WHERE id = ?`,
    [now, now, planId]
  );

  console.log(`[ResumePlan] Plan ${planId} resumed at ${now}`);
  return getTaskPlan(planId);
}

/**
 * Gracefully stop a plan
 * Completes the current task but does not continue to remaining tasks
 * Different from cancel - stop keeps all completed work
 */
export function stopPlan(planId: string, reason?: string): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
  if (!plan) return undefined;

  // Can stop active or paused plans
  if (plan.status !== 'active' && plan.status !== 'paused') {
    console.warn(`[StopPlan] Cannot stop plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const now = new Date().toISOString();

  // Mark any in_progress tasks as complete (they'll finish their current work)
  // Skip pending tasks
  const tasksData = JSON.parse(
    queryOne<{ tasks_json: string }>('SELECT tasks_json FROM task_plans WHERE id = ?', [planId])!.tasks_json
  ) as { tasks: any[] };

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

  execute(
    `UPDATE task_plans
     SET status = 'stopped', stopped_at = ?, stop_reason = ?, tasks_json = ?, updated_at = ?
     WHERE id = ?`,
    [now, reason || null, JSON.stringify(tasksData), now, planId]
  );

  console.log(`[StopPlan] Plan ${planId} stopped at ${now}${reason ? `: ${reason}` : ''}`);
  return getTaskPlan(planId);
}

/**
 * Skip a specific task by ID
 * Can only skip pending tasks (not running or completed)
 */
export function skipTask(planId: string, taskId: number, reason?: string): TaskPlan | undefined {
  const plan = getTaskPlan(planId);
  if (!plan) return undefined;

  // Can only skip tasks in active or paused plans
  if (plan.status !== 'active' && plan.status !== 'paused') {
    console.warn(`[SkipTask] Cannot skip task in plan ${planId} with status '${plan.status}'`);
    return undefined;
  }

  const tasksData = JSON.parse(
    queryOne<{ tasks_json: string }>('SELECT tasks_json FROM task_plans WHERE id = ?', [planId])!.tasks_json
  ) as { tasks: any[] };

  const task = tasksData.tasks.find((t: any) => t.id === taskId);
  if (!task) {
    console.warn(`[SkipTask] Task ${taskId} not found in plan ${planId}`);
    return undefined;
  }

  // Can only skip pending tasks
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
    skipped: tasksData.tasks.filter((t: any) => t.status === 'skipped').length,
  };

  execute(
    `UPDATE task_plans SET tasks_json = ?, updated_at = ?, completed_tasks = ?, failed_tasks = ? WHERE id = ?`,
    [JSON.stringify(tasksData), now, stats.complete, stats.failed, planId]
  );

  console.log(`[SkipTask] Task ${taskId} in plan ${planId} skipped${reason ? `: ${reason}` : ''}`);
  return getTaskPlan(planId);
}

/**
 * Check if a plan is paused
 */
export function isPlanPaused(planId: string): boolean {
  const row = queryOne<{ status: string }>('SELECT status FROM task_plans WHERE id = ?', [planId]);
  return row?.status === 'paused';
}

/**
 * Check if a plan is stopped
 */
export function isPlanStopped(planId: string): boolean {
  const row = queryOne<{ status: string }>('SELECT status FROM task_plans WHERE id = ?', [planId]);
  return row?.status === 'stopped';
}

/**
 * Get plan control status (for orchestrator loop checks)
 */
export function getPlanControlStatus(planId: string): {
  status: PlanStatus;
  isPaused: boolean;
  isStopped: boolean;
  pauseReason?: string;
  stopReason?: string;
} | undefined {
  const row = queryOne<{
    status: string;
    pause_reason: string | null;
    stop_reason: string | null;
  }>('SELECT status, pause_reason, stop_reason FROM task_plans WHERE id = ?', [planId]);

  if (!row) return undefined;

  return {
    status: row.status as PlanStatus,
    isPaused: row.status === 'paused',
    isStopped: row.status === 'stopped',
    pauseReason: row.pause_reason || undefined,
    stopReason: row.stop_reason || undefined,
  };
}
