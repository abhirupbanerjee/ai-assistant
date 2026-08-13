/**
 * Wire types for the browser-worker. Standalone mirror of the app-side
 * `src/types/browser.ts` so the worker package has zero dependency on the app.
 */

export type BrowserState =
  | 'created'
  | 'observing'
  | 'needs_form_input'
  | 'takeover'
  | 'final_confirm'
  | 'completed'
  | 'expired'
  | 'terminated'
  | 'error';

export type Checkpoint = 'needs_form_input' | 'takeover' | 'final_confirm';

export type Action =
  | { type: 'navigate'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'select'; selector: string; value: string };

export interface AriaNode {
  role: string;
  name: string;
  selector: string;
  children?: AriaNode[];
}

export interface Observation {
  url: string;
  title: string;
  state: BrowserState;
  checkpoint: Checkpoint | null;
  aria: AriaNode[];
  screenshotDataUrl?: string;
  message?: string;
}

export interface CommandResult {
  success: boolean;
  state: BrowserState;
  checkpoint: Checkpoint | null;
  message?: string;
  observation?: Observation;
}

export interface SessionSnapshot {
  workerSessionId: string;
  state: BrowserState;
  checkpoint: Checkpoint | null;
  url: string;
  title: string;
}

export type StreamEvent =
  | { type: 'frame'; dataUrl: string }
  | { type: 'state'; state: BrowserState; checkpoint: Checkpoint | null; url: string; title: string };
