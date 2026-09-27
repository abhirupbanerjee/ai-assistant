import { setTimeout as sleep } from 'node:timers/promises';
import { PreviewError, QUEUE_MS } from './policy';

/** A request-owned wait, never a detached/background job. DB callbacks own all
 * capacity decisions; this helper only polls an already reserved slot. */
export async function waitForSlot(activate: () => Promise<boolean>, signal: AbortSignal,
  clock = Date.now, pause = (ms: number) => sleep(ms, undefined, { signal }), deadline = clock() + QUEUE_MS) {
  while (true) {
    if (signal.aborted) throw new PreviewError('REQUEST_CANCELLED', 499);
    if (clock() >= deadline) throw new PreviewError('QUEUE_TIMEOUT', 429);
    let activated = false;
    try { activated = await activate(); }
    catch (error) { if (!(error instanceof PreviewError) || error.code !== 'PREVIEW_BUSY') throw error; }
    if (signal.aborted) throw new PreviewError('REQUEST_CANCELLED', 499);
    if (clock() >= deadline) throw new PreviewError('QUEUE_TIMEOUT', 429);
    if (activated) return;
    await pause(200);
  }
}
