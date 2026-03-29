/**
 * Dependency Graph Validator
 *
 * Validates task dependencies to prevent:
 * - Circular dependencies
 * - Invalid dependency references
 * - Stuck plans (all tasks blocked)
 */

import type { AgentTask, ValidationResult, StuckPlanResult } from '@/types/agent';

/**
 * Validate dependency graph for a set of tasks
 *
 * Checks for:
 * - Duplicate task IDs
 * - Missing dependency references
 * - Self-dependencies
 * - Circular dependencies
 * - No root tasks (everything depends on something)
 */
export function validateDependencyGraph(tasks: AgentTask[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const taskIds = new Set(tasks.map(t => t.id));

  // Check 1: Duplicate IDs
  const idCounts = new Map<number, number>();
  for (const task of tasks) {
    idCounts.set(task.id, (idCounts.get(task.id) || 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push(`Duplicate task ID: ${id} (appears ${count} times)`);
    }
  }

  // Check 2: Invalid dependency references
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (!taskIds.has(depId)) {
        errors.push(`Task ${task.id} depends on non-existent task ${depId}`);
      }
    }
    // Self-dependency check
    if (task.dependencies.includes(task.id)) {
      errors.push(`Task ${task.id} depends on itself`);
    }
  }

  // Check 3: Circular dependencies
  const cycles = detectCircularDependencies(tasks);
  if (cycles.length > 0) {
    for (const cycle of cycles) {
      errors.push(`Circular dependency detected: ${cycle.join(' → ')} → ${cycle[0]}`);
    }
  }

  // Check 4: No root tasks (warning, not error)
  const roots = tasks.filter(t => t.dependencies.length === 0);
  if (roots.length === 0 && tasks.length > 0) {
    errors.push('No root tasks found - all tasks depend on other tasks, nothing can start');
  }

  // Check 5: Unreachable tasks (tasks that nothing depends on, except if they're leaves)
  const dependedOn = new Set<number>();
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      dependedOn.add(depId);
    }
  }
  const leaves = tasks.filter(t => !dependedOn.has(t.id));
  if (leaves.length > 3) {
    warnings.push(`Many leaf tasks (${leaves.length}) - consider consolidating`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detect circular dependencies using DFS
 *
 * @returns Array of cycles, where each cycle is an array of task IDs forming a loop
 */
function detectCircularDependencies(tasks: AgentTask[]): number[][] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set<number>();
  const recursionStack = new Set<number>();
  const cycles: number[][] = [];

  function dfs(taskId: number, path: number[]): void {
    visited.add(taskId);
    recursionStack.add(taskId);
    path.push(taskId);

    const task = taskMap.get(taskId);
    if (!task) return;

    for (const depId of task.dependencies) {
      if (!visited.has(depId)) {
        dfs(depId, [...path]);
      } else if (recursionStack.has(depId)) {
        // Found a cycle!
        const cycleStart = path.indexOf(depId);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), depId]);
        }
      }
    }

    recursionStack.delete(taskId);
  }

  // Start DFS from each unvisited task
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      dfs(task.id, []);
    }
  }

  return cycles;
}

/**
 * Detect if a plan is stuck (no tasks can make progress)
 *
 * A plan is stuck if:
 * - There are pending tasks
 * - No tasks are currently running
 * - All pending tasks have unmet dependencies
 */
export function detectStuckPlan(tasks: AgentTask[]): StuckPlanResult {
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const runningTasks = tasks.filter(t => t.status === 'running');
  const completedStatuses = ['done', 'skipped', 'needs_review'];

  // If nothing is pending or something is running, not stuck
  if (pendingTasks.length === 0 || runningTasks.length > 0) {
    return { isStuck: false, stuckTaskIds: [], suggestions: [] };
  }

  // Check if any pending task can execute (all dependencies met)
  const executableTasks = pendingTasks.filter(task => {
    return task.dependencies.every(depId => {
      const dep = tasks.find(t => t.id === depId);
      return dep && completedStatuses.includes(dep.status);
    });
  });

  if (executableTasks.length > 0) {
    // Not stuck - there are tasks that can run
    return { isStuck: false, stuckTaskIds: [], suggestions: [] };
  }

  // Plan is stuck - no pending tasks can execute
  const suggestions: string[] = [];

  // Analyze why tasks are stuck
  const blockedReasons = new Map<number, string[]>();
  for (const task of pendingTasks) {
    const unmetDeps: number[] = [];
    for (const depId of task.dependencies) {
      const dep = tasks.find(t => t.id === depId);
      if (!dep) {
        unmetDeps.push(depId);
      } else if (!completedStatuses.includes(dep.status)) {
        unmetDeps.push(depId);
      }
    }
    if (unmetDeps.length > 0) {
      blockedReasons.set(task.id, unmetDeps.map(id => `Task ${id}`));
    }
  }

  // Generate suggestions
  if (blockedReasons.size > 0) {
    suggestions.push('Some dependencies failed or are stuck');
    suggestions.push('Consider marking failed dependencies as skipped to unblock');
  }

  // Check for circular dependencies as a potential cause
  const cycles = detectCircularDependencies(tasks);
  if (cycles.length > 0) {
    suggestions.push('Circular dependencies detected - plan cannot complete');
  }

  return {
    isStuck: true,
    reason: 'All pending tasks have unmet dependencies',
    stuckTaskIds: pendingTasks.map(t => t.id),
    suggestions,
  };
}

/**
 * Get tasks that are ready to execute (no pending dependencies)
 */
export function getReadyTasks(tasks: AgentTask[]): AgentTask[] {
  const completedStatuses = ['done', 'skipped', 'needs_review'];

  return tasks.filter(task => {
    // Only consider pending tasks
    if (task.status !== 'pending') return false;

    // Check if all dependencies are completed
    return task.dependencies.every(depId => {
      const dep = tasks.find(t => t.id === depId);
      return dep && completedStatuses.includes(dep.status);
    });
  });
}

/**
 * Sort tasks in topological order (dependencies before dependents)
 *
 * Uses Kahn's algorithm for topological sorting
 */
export function topologicalSort(tasks: AgentTask[]): AgentTask[] | null {
  // Check for cycles first
  const cycles = detectCircularDependencies(tasks);
  if (cycles.length > 0) {
    return null; // Cannot sort if there are cycles
  }

  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map<number, number>();
  const result: AgentTask[] = [];

  // Initialize in-degrees
  for (const task of tasks) {
    inDegree.set(task.id, task.dependencies.length);
  }

  // Find all tasks with no dependencies
  const queue: AgentTask[] = tasks.filter(t => (inDegree.get(t.id) || 0) === 0);

  while (queue.length > 0) {
    const task = queue.shift()!;
    result.push(task);

    // Reduce in-degree for dependent tasks
    for (const otherTask of tasks) {
      if (otherTask.dependencies.includes(task.id)) {
        const newDegree = (inDegree.get(otherTask.id) || 0) - 1;
        inDegree.set(otherTask.id, newDegree);
        if (newDegree === 0) {
          queue.push(otherTask);
        }
      }
    }
  }

  // If not all tasks were processed, there's a cycle (shouldn't happen after check)
  if (result.length !== tasks.length) {
    return null;
  }

  return result;
}
