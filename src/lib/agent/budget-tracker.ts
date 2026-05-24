/**
 * Global Budget Tracker
 *
 * Tracks LLM usage across all autonomous plans with progressive warnings:
 * - 50% warning
 * - 75% warning
 * - 100% hard stop
 */

import type { AgentBudget, BudgetUsage, BudgetStatus } from '@/types/agent';
import { getSetting } from '../db/compat/config';
import { getDb } from '../db/kysely';

const WARNING_THRESHOLD_1 = 0.5; // 50%
const WARNING_THRESHOLD_2 = 0.75; // 75%

/**
 * Retry reserve settings — extra headroom for bounded retries/re-planning
 */
export interface RetryReserve {
  llm_calls: number;
  tokens: number;
}

/**
 * Get global budget settings from database
 */
export async function getGlobalBudgetSettings(): Promise<AgentBudget> {
  return {
    max_llm_calls: parseInt(await getSetting('agent_budget_max_llm_calls', '500'), 10),
    max_tokens: parseInt(await getSetting('agent_budget_max_tokens', '2000000'), 10),
    max_web_searches: parseInt(await getSetting('agent_budget_max_web_searches', '100'), 10),
    max_duration_minutes: parseInt(await getSetting('agent_budget_max_duration_minutes', '30'), 10),
    task_timeout_minutes: parseInt(await getSetting('agent_task_timeout_minutes', '5'), 10),
  };
}

/**
 * Get retry reserve settings from database
 */
export async function getRetryReserveSettings(): Promise<RetryReserve> {
  return {
    llm_calls: parseInt(await getSetting('agent_budget_retry_reserve_llm_calls', '10'), 10),
    tokens: parseInt(await getSetting('agent_budget_retry_reserve_tokens', '50000'), 10),
  };
}

/**
 * Global Budget Tracker
 *
 * Monitors resource usage across all active autonomous plans
 */
export class GlobalBudgetTracker {
  private globalBudget: AgentBudget;
  private retryReserve: RetryReserve;
  private startTime: number;
  private onEvent?: (event: BudgetWarningEvent) => void;

  // TTL cache for usage aggregation (prevents repeated DB queries)
  private usageCache: BudgetUsage | null = null;
  private usageCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 2000; // 2 second cache

  private constructor(
    budget: AgentBudget,
    retryReserve: RetryReserve,
    onEvent?: (event: BudgetWarningEvent) => void
  ) {
    this.globalBudget = budget;
    this.retryReserve = retryReserve;
    this.startTime = Date.now();
    this.onEvent = onEvent;
  }

  static async create(onEvent?: (event: BudgetWarningEvent) => void): Promise<GlobalBudgetTracker> {
    const [budget, retryReserve] = await Promise.all([
      getGlobalBudgetSettings(),
      getRetryReserveSettings(),
    ]);
    return new GlobalBudgetTracker(budget, retryReserve, onEvent);
  }

  /**
   * Invalidate usage cache (call after budget updates)
   */
  invalidateCache(): void {
    this.usageCache = null;
    this.usageCacheTime = 0;
  }

  /**
   * Record an LLM call and check budget
   */
  async recordLLMCall(tokens: number): Promise<BudgetStatus> {
    return this.checkBudget();
  }

  /**
   * Record a web search and check budget
   */
  async recordWebSearch(): Promise<BudgetStatus> {
    return this.checkBudget();
  }

  /**
   * Check current budget status against global limits.
   * @param usage - Optional pre-computed usage (falls back to DB query)
   * @param headroom - Optional additional headroom to add on top of the retry reserve
   */
  async checkBudget(usage?: BudgetUsage, headroom?: Partial<BudgetUsage>): Promise<BudgetStatus> {
    // If no usage provided, get current totals from all active plans
    const totalUsage = usage || await this.getTotalUsage();

    // Effective limits include retry reserve + any one-off headroom
    const effectiveLlmLimit = this.globalBudget.max_llm_calls + this.retryReserve.llm_calls + (headroom?.llm_calls || 0);
    const effectiveTokenLimit = this.globalBudget.max_tokens + this.retryReserve.tokens + (headroom?.tokens_used || 0);
    const effectiveSearchLimit = this.globalBudget.max_web_searches + (headroom?.web_searches || 0);

    // Percentages for warnings are based on ORIGINAL limits (so admins see true utilization)
    const llmPct = (totalUsage.llm_calls / this.globalBudget.max_llm_calls) * 100;
    const tokenPct = (totalUsage.tokens_used / this.globalBudget.max_tokens) * 100;
    const searchPct = (totalUsage.web_searches / this.globalBudget.max_web_searches) * 100;

    // Hard stop at effective limit (original + reserve + headroom)
    if (totalUsage.llm_calls >= effectiveLlmLimit) {
      return this.exceeded('llm_calls', `LLM call limit exceeded (${this.globalBudget.max_llm_calls} base + ${this.retryReserve.llm_calls} reserve)`);
    }
    if (totalUsage.tokens_used >= effectiveTokenLimit) {
      return this.exceeded('tokens', `Token limit exceeded (${this.globalBudget.max_tokens} base + ${this.retryReserve.tokens} reserve)`);
    }
    if (totalUsage.web_searches >= effectiveSearchLimit) {
      return this.exceeded('web_searches', `Web search limit exceeded (${this.globalBudget.max_web_searches})`);
    }

    // Duration check (no reserve for duration — it's a wall-clock safety)
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    if (elapsedMinutes >= this.globalBudget.max_duration_minutes) {
      return this.exceeded('duration', `Time limit exceeded (${this.globalBudget.max_duration_minutes} min)`);
    }

    // Check warnings at 50% and 75% (based on original limits)
    this.checkWarnings(totalUsage, llmPct, tokenPct, searchPct);

    return { exceeded: false };
  }

  /**
   * Get total usage across all active plans (with TTL caching)
   */
  private async getTotalUsage(): Promise<BudgetUsage> {
    const now = Date.now();

    // Return cached value if still valid
    if (this.usageCache && (now - this.usageCacheTime) < GlobalBudgetTracker.CACHE_TTL_MS) {
      return this.usageCache;
    }

    // Query database for fresh usage data via Kysely
    const db = await getDb();
    const activePlans = await db
      .selectFrom('task_plans')
      .select('budget_used_json')
      .where('status', '=', 'active')
      .where('mode', '=', 'autonomous')
      .execute();

    const total: BudgetUsage = {
      llm_calls: 0,
      tokens_used: 0,
      web_searches: 0,
    };

    for (const plan of activePlans) {
      try {
        const usage: BudgetUsage = JSON.parse(plan.budget_used_json as string);
        total.llm_calls += usage.llm_calls || 0;
        total.tokens_used += usage.tokens_used || 0;
        total.web_searches += usage.web_searches || 0;
      } catch (e) {
        console.error('[BudgetTracker] Failed to parse budget_used_json:', e);
      }
    }

    // Update cache
    this.usageCache = total;
    this.usageCacheTime = now;

    return total;
  }

  /**
   * Emit budget exceeded event
   */
  private exceeded(type: string, message: string): BudgetStatus {
    this.onEvent?.({ type: 'budget_exceeded', budget_type: type, message });
    return { exceeded: true, budgetType: type, message };
  }

  /**
   * Check and emit warnings at 50% and 75%
   */
  private checkWarnings(usage: BudgetUsage, llmPct: number, tokenPct: number, searchPct: number) {
    const checks = [
      { type: 'llm_calls', pct: llmPct, used: usage.llm_calls, max: this.globalBudget.max_llm_calls },
      { type: 'tokens', pct: tokenPct, used: usage.tokens_used, max: this.globalBudget.max_tokens },
      { type: 'web_searches', pct: searchPct, used: usage.web_searches, max: this.globalBudget.max_web_searches },
    ];

    for (const check of checks) {
      // 75% warning
      if (check.pct >= WARNING_THRESHOLD_2 * 100 && check.pct < 100) {
        this.onEvent?.({
          type: 'budget_warning',
          budget_type: check.type,
          used: check.used,
          max: check.max,
          percentage: Math.round(check.pct),
          level: 'high',
        });
      }
      // 50% warning
      else if (check.pct >= WARNING_THRESHOLD_1 * 100 && check.pct < WARNING_THRESHOLD_2 * 100) {
        this.onEvent?.({
          type: 'budget_warning',
          budget_type: check.type,
          used: check.used,
          max: check.max,
          percentage: Math.round(check.pct),
          level: 'medium',
        });
      }
    }
  }

  /**
   * Check if usage has exceeded the BASE limit (excluding retry reserve).
   * Used by orchestrator to decide whether new tasks should be blocked
   * while still allowing retry-only waves to consume the reserve.
   */
  async isOverBaseLimit(usage?: BudgetUsage): Promise<boolean> {
    const totalUsage = usage || await this.getTotalUsage();
    return (
      totalUsage.llm_calls >= this.globalBudget.max_llm_calls ||
      totalUsage.tokens_used >= this.globalBudget.max_tokens ||
      totalUsage.web_searches >= this.globalBudget.max_web_searches
    );
  }

  /**
   * Get current usage summary
   */
  async getUsageSummary() {
    const total = await this.getTotalUsage();
    const elapsedMinutes = Math.round((Date.now() - this.startTime) / 60000);

    return {
      ...total,
      duration_minutes: elapsedMinutes,
      llm_pct: Math.round((total.llm_calls / this.globalBudget.max_llm_calls) * 100),
      token_pct: Math.round((total.tokens_used / this.globalBudget.max_tokens) * 100),
      search_pct: Math.round((total.web_searches / this.globalBudget.max_web_searches) * 100),
      duration_pct: Math.round((elapsedMinutes / this.globalBudget.max_duration_minutes) * 100),
    };
  }
}

// ============ Budget Event Types ============

export type BudgetWarningEvent =
  | {
      type: 'budget_exceeded';
      budget_type: string;
      message: string;
    }
  | {
      type: 'budget_warning';
      budget_type: string;
      used: number;
      max: number;
      percentage: number;
      level: 'medium' | 'high';
    };
