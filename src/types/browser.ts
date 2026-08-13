/**
 * Remote browser session types (app-side).
 *
 * Shared between the browser tools, the `/api/browser-sessions/*` routes, the
 * `browser_sessions` compat layer, and the right-panel `BrowserSessionViewer`.
 *
 * The worker sidecar (`services/browser-worker/`) is a standalone package and
 * keeps its own wire types; the shapes here intentionally mirror the worker
 * contract so the transport client can map 1:1.
 */

/** Persisted session state (also the first-class checkpoint machine). */
export type BrowserSessionState =
  | 'created'
  | 'observing'
  | 'needs_form_input'
  | 'takeover'
  | 'final_confirm'
  | 'completed'
  | 'expired'
  | 'terminated'
  | 'error';

/**
 * Checkpoints that require human involvement. `needs_form_input` asks the user
 * for values; `takeover` suspends agent observation/control; `final_confirm`
 * requires the user to click the final irreversible action.
 */
export type BrowserCheckpoint = 'needs_form_input' | 'takeover' | 'final_confirm';

/** Safe, DTO-only view of a browser session (never contains secrets). */
export interface BrowserSessionInfo {
  sessionId: string;
  threadId: string | null;
  task: string | null;
  state: BrowserSessionState;
  currentUrl: string | null;
  pageTitle: string | null;
  pendingCheckpoint: BrowserCheckpoint | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An action issued against a live session. `click` and `fill`/`select` take a
 * Playwright selector. The worker validates every action against the domain
 * allowlist and the irreversible-action denylist.
 */
export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'select'; selector: string; value: string };

/** A sanitized accessibility node. `value` attributes are always stripped. */
export interface BrowserAriaNode {
  role: string;
  name: string;
  selector: string;
  children?: BrowserAriaNode[];
}

/** Observation returned to the model (optionally with a screenshot data URL). */
export interface BrowserObservation {
  url: string;
  title: string;
  state: BrowserSessionState;
  checkpoint: BrowserCheckpoint | null;
  aria: BrowserAriaNode[];
  screenshotDataUrl?: string;
  message?: string;
}

/** Result of an agent/user command against the worker. */
export interface BrowserCommandResult {
  success: boolean;
  state: BrowserSessionState;
  checkpoint: BrowserCheckpoint | null;
  message?: string;
  observation?: BrowserObservation;
}

/** SSE event carrying a new screenshot frame for the viewer. */
export interface BrowserFrame {
  type: 'frame';
  sessionId: string;
  dataUrl: string;
}

/** SSE event carrying a state/checkpoint transition for the viewer. */
export interface BrowserStateUpdate {
  type: 'state';
  sessionId: string;
  state: BrowserSessionState;
  url: string | null;
  title: string | null;
  checkpoint: BrowserCheckpoint | null;
  message?: string;
}

/** Union of events emitted on the `/api/browser-sessions/:id/stream` channel. */
export type BrowserPanelEvent = BrowserFrame | BrowserStateUpdate;
