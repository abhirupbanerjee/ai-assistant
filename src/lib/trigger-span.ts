/** Tracks the span of a @ or / trigger token being typed in the textarea. */
export interface TriggerSpan {
  /** Absolute index in the message where @ or / appears. */
  start: number;
  kind: 'at' | 'slash';
}

/**
 * Remove a trigger token [start, endIndex) from the message and collapse
 * resulting double spaces into a single space.
 *
 * @param message The full textarea value.
 * @param start   Start index of the trigger token (from TriggerSpan.start).
 * @param end     End index (e.g., cursor position at selection time).
 */
export function removeTriggerSpan(message: string, start: number, end: number): string {
  return (message.slice(0, start) + message.slice(end)).replace(/  +/g, ' ');
}
