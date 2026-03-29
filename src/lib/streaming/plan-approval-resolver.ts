/**
 * Plan Approval Resolver
 *
 * In-memory Map that coordinates the SSE stream pause/resume for
 * autonomous mode plan approval. The stream awaits a Promise that
 * is resolved when the user responds via POST /api/autonomous/[planId]/approve.
 *
 * Same pattern as preflight-resolver.ts.
 * Scaling path: replace Map with Redis pub/sub.
 */

export interface PlanApprovalResult {
  approved: boolean;
  feedback?: string;
}

interface PendingResolver {
  resolve: (result: PlanApprovalResult | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingResolver>();

/**
 * Create a Promise that pauses the stream until the user approves/rejects,
 * the timeout expires, or the client disconnects.
 *
 * @returns PlanApprovalResult, or null (timeout/disconnect = auto-approve)
 */
export function createPlanApprovalResolver(
  planId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<PlanApprovalResult | null> {
  if (pending.size > 50) {
    console.log(`[PlanApprovalResolver] ${pending.size} pending resolvers — check for leaks`);
  }

  // Guard: clear any existing resolver for this planId
  const existing = pending.get(planId);
  if (existing) {
    console.warn(`[PlanApprovalResolver] Overwriting existing resolver for planId=${planId}`);
    clearTimeout(existing.timer);
    existing.resolve(null);
    pending.delete(planId);
  }

  return new Promise<PlanApprovalResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(planId);
      resolve(null); // null = auto-approve (caller handles)
    }, timeoutMs);

    pending.set(planId, { resolve, timer });

    // Clean up on client disconnect
    if (abortSignal) {
      const onAbort = () => {
        const entry = pending.get(planId);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(planId);
          resolve(null);
        }
      };

      if (abortSignal.aborted) {
        clearTimeout(timer);
        pending.delete(planId);
        resolve(null);
        return;
      }

      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Resolve a pending plan approval (called from POST /api/autonomous/[planId]/approve).
 * Returns true if resolved, false if planId not found (expired/already resolved).
 */
export function resolvePlanApprovalById(
  planId: string,
  result: PlanApprovalResult
): boolean {
  const entry = pending.get(planId);
  if (!entry) return false;

  clearTimeout(entry.timer);
  pending.delete(planId);
  entry.resolve(result);
  return true;
}
