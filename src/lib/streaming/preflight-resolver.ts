/**
 * Preflight Resolver
 *
 * In-memory Map that coordinates the SSE stream pause/resume for
 * pre-flight HITL clarification. The stream awaits a Promise that
 * is resolved when the user responds via POST /api/chat/preflight.
 *
 * Safe for v1 because:
 * - Single long-lived Node.js process (output: 'standalone')
 * - Timeout auto-resolves null on expiry
 * - AbortSignal cleans up on client disconnect
 * - Scaling path: replace Map with Redis pub/sub
 */

export interface PreflightResult {
  enrichedContext: string;
}

interface PendingResolver {
  resolve: (result: PreflightResult | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingResolver>();

/**
 * Create a Promise that pauses the stream until the user responds,
 * the timeout expires, or the client disconnects.
 *
 * @returns PreflightResult with enriched context, or null (timeout/skip/disconnect)
 */
export function createPreflightResolver(
  messageId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<PreflightResult | null> {
  // Warn if map is growing unexpectedly (potential leak)
  if (pending.size > 50) {
    console.log(`[PreflightResolver] ${pending.size} pending resolvers — check for leaks`);
  }

  // Guard: clear any existing resolver for this messageId (prevents timer leak)
  const existing = pending.get(messageId);
  if (existing) {
    console.warn(`[PreflightResolver] Overwriting existing resolver for messageId=${messageId}`);
    clearTimeout(existing.timer);
    existing.resolve(null);
    pending.delete(messageId);
  }

  return new Promise<PreflightResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(messageId);
      resolve(null);
    }, timeoutMs);

    pending.set(messageId, { resolve, timer });

    // Clean up on client disconnect
    if (abortSignal) {
      const onAbort = () => {
        const entry = pending.get(messageId);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(messageId);
          resolve(null);
        }
      };

      if (abortSignal.aborted) {
        clearTimeout(timer);
        pending.delete(messageId);
        resolve(null);
        return;
      }

      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Resolve a pending preflight request (called from POST /api/chat/preflight).
 * Returns true if resolved, false if messageId not found (expired/already resolved).
 */
export function resolvePreflightById(
  messageId: string,
  result: PreflightResult | null
): boolean {
  const entry = pending.get(messageId);
  if (!entry) return false;

  clearTimeout(entry.timer);
  pending.delete(messageId);
  entry.resolve(result);
  return true;
}
