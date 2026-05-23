/**
 * Cost Tracker
 *
 * Tracks cumulative LLM costs across autonomous plan execution.
 * Looks up per-model pricing from the database and emits SSE cost updates.
 */

import { getEnabledModel } from '@/lib/db/compat/enabled-models';

export interface ModelPricing {
  inputCostPer1M: number;
  outputCostPer1M: number;
}

export interface CostUpdateEvent {
  type: 'agent_cost_update';
  task_id: number;
  task_cost: number;
  cumulative_cost: number;
}

type EmitFn = (event: CostUpdateEvent) => void;

class CostTracker {
  private pricingCache = new Map<string, ModelPricing | null>();
  private cumulativeCost = 0;
  private emit: EmitFn;

  constructor(emit: EmitFn) {
    this.emit = emit;
  }

  /**
   * Lookup pricing for a model (cached).
   */
  async getModelPricing(modelId: string): Promise<ModelPricing | null> {
    const cached = this.pricingCache.get(modelId);
    if (cached !== undefined) return cached;

    try {
      const model = await getEnabledModel(modelId);
      if (typeof model?.inputCostPer1M === 'number' && typeof model?.outputCostPer1M === 'number') {
        const pricing: ModelPricing = {
          inputCostPer1M: model.inputCostPer1M,
          outputCostPer1M: model.outputCostPer1M,
        };
        this.pricingCache.set(modelId, pricing);
        return pricing;
      }
      this.pricingCache.set(modelId, null);
      return null;
    } catch {
      this.pricingCache.set(modelId, null);
      return null;
    }
  }

  /**
   * Compute cost for a token usage.
   * If input/output breakdown is not available, uses a 70/30 input/output heuristic.
   */
  computeCost(
    pricing: ModelPricing,
    totalTokens: number,
    inputTokens?: number,
    outputTokens?: number
  ): number {
    const inp = inputTokens ?? Math.round(totalTokens * 0.7);
    const out = outputTokens ?? (totalTokens - inp);

    const inputCost = (inp / 1_000_000) * pricing.inputCostPer1M;
    const outputCost = (out / 1_000_000) * pricing.outputCostPer1M;

    return parseFloat((inputCost + outputCost).toFixed(8));
  }

  /**
   * Get current cumulative cost.
   */
  getCumulativeCost(): number {
    return this.cumulativeCost;
  }

  /**
   * Record cost for a completed task and emit an SSE event.
   */
  async addCost(
    taskId: number,
    modelId: string,
    totalTokens: number,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<void> {
    if (totalTokens <= 0) return;

    const pricing = await this.getModelPricing(modelId);
    if (!pricing) return;

    const taskCost = this.computeCost(pricing, totalTokens, inputTokens, outputTokens);
    this.cumulativeCost = parseFloat((this.cumulativeCost + taskCost).toFixed(8));

    this.emit({
      type: 'agent_cost_update',
      task_id: taskId,
      task_cost: taskCost,
      cumulative_cost: this.cumulativeCost,
    });
  }
}

export default CostTracker;
