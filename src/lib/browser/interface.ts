/**
 * Narrow transport interface for the browser worker.
 *
 * Every caller (tools, API routes) depends only on this interface, never on a
 * concrete HTTP client. This is the seam that lets the worker be swapped
 * between a sidecar container, an in-process implementation, or a different
 * backend without touching callers.
 */

import type {
  BrowserAction,
  BrowserCommandResult,
  BrowserObservation,
  BrowserSessionState,
  BrowserCheckpoint,
} from '@/types/browser';

/** Snapshot of a live worker session (not the persisted DB record). */
export interface BrowserWorkerSnapshot {
  workerSessionId: string;
  state: BrowserSessionState;
  checkpoint: BrowserCheckpoint | null;
  url: string;
  title: string;
}

export interface BrowserWorkerClient {
  createSession(sessionId: string, allowlist: string[]): Promise<BrowserWorkerSnapshot>;
  observe(sessionId: string, includeScreenshot: boolean): Promise<BrowserObservation>;
  executeAction(
    sessionId: string,
    action: BrowserAction,
    confirmToken?: string
  ): Promise<BrowserCommandResult>;
  takeover(sessionId: string): Promise<BrowserWorkerSnapshot>;
  resume(sessionId: string): Promise<BrowserWorkerSnapshot>;
  terminate(sessionId: string): Promise<void>;
}
