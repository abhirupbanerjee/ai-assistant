/**
 * Subagent Budget Tracker
 *
 * Per-task token allocation from plan-level budget.
 * Warnings at 80% threshold.
 */

export interface SubagentBudget {
  maxTokens: number;
  tokensUsed: number;
  iterationsUsed: number;
}

/**
 * Create a subagent budget allocated from plan-level budget.
 */
export function createSubagentBudget(
  planBudgetTokens: number,
  budgetRatio: number
): SubagentBudget {
  const ratio = Math.max(1, Math.min(100, budgetRatio)) / 100;
  return {
    maxTokens: Math.max(1000, Math.round(planBudgetTokens * ratio)),
    tokensUsed: 0,
    iterationsUsed: 0,
  };
}

/**
 * Check if budget is exceeded or approaching limit.
 */
export function checkBudget(
  budget: SubagentBudget
): { exceeded: boolean; warning: boolean; pct: number } {
  const pct = budget.maxTokens > 0
    ? Math.round((budget.tokensUsed / budget.maxTokens) * 100)
    : 0;
  return {
    exceeded: pct >= 100,
    warning: pct >= 80,
    pct,
  };
}
