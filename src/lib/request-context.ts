/**
 * Request Context using AsyncLocalStorage
 *
 * Provides context propagation through async call stacks without
 * explicitly passing parameters. Used to pass threadId, messageId,
 * and categoryId to autonomous tools during execution.
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Context available during request processing
 */
export interface RequestContext {
  /** Thread ID for the current chat */
  threadId?: string;
  /** Message ID being processed */
  messageId?: string;
  /** Category IDs for branding/config resolution and tool access */
  categoryIds?: number[];
  /** User ID making the request */
  userId?: string;
  /** User message for context-aware tool decisions */
  userMessage?: string;
}

/**
 * AsyncLocalStorage instance for request context
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context
 * Returns empty object if no context is set
 */
export function getRequestContext(): RequestContext {
  return requestContextStorage.getStore() || {};
}

/**
 * Run a function with request context
 *
 * @param context - Context to make available during execution
 * @param fn - Function to run with context
 * @returns Result of the function
 *
 * @example
 * ```ts
 * const result = await runWithContext(
 *   { threadId: '123', categoryIds: [1, 2] },
 *   () => ragQuery(message, history)
 * );
 * ```
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

/**
 * Run an async function with request context
 *
 * @param context - Context to make available during execution
 * @param fn - Async function to run with context
 * @returns Promise with result of the function
 */
export async function runWithContextAsync<T>(
  context: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, fn);
}
