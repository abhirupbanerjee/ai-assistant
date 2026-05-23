/**
 * Subagent Tool Approval Resolver
 *
 * In-memory Map that coordinates SSE stream pause/resume for
 * subagent tool execution approval (HITL gating).
 *
 * Same pattern as plan-approval-resolver.ts.
 */

export interface SubagentApprovalResult {
  approved: boolean;
  modifiedArgs?: Record<string, unknown>;
}

interface PendingResolver {
  resolve: (result: SubagentApprovalResult | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingResolver>();

/**
 * Create a Promise that pauses the subagent loop until the user approves/denies/modifies
 * a tool call, or the timeout expires.
 *
 * @returns SubagentApprovalResult, or null (timeout = auto-deny)
 */
export function createSubagentApprovalResolver(
  taskId: number,
  timeoutMs: number
): Promise<SubagentApprovalResult | null> {
  if (pending.size > 100) {
    console.warn(`[SubagentApprovalResolver] ${pending.size} pending resolvers — possible leak`);
  }

  const key = String(taskId);
  const existing = pending.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve(null);
    pending.delete(key);
  }

  return new Promise<SubagentApprovalResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(key);
      resolve(null); // null = timeout = auto-deny
    }, timeoutMs);

    pending.set(key, { resolve, timer });
  });
}

/**
 * Resolve a pending approval request.
 */
export function resolveSubagentApproval(
  taskId: number,
  result: SubagentApprovalResult
): boolean {
  const key = String(taskId);
  const entry = pending.get(key);
  if (!entry) return false;

  clearTimeout(entry.timer);
  entry.resolve(result);
  pending.delete(key);
  return true;
}
