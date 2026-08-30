/**
 * Payload reference remapping for thread copies.
 *
 * When a thread is copied, messages and artifacts receive fresh ids and the
 * thread id changes. Any JSON payload column that embeds the old thread id or
 * old message ids must be rewritten so the copy does not point back at the
 * source. Kept dependency-free so it can be unit-tested in isolation.
 */

export function remapPayloadReferences(
  text: string | null,
  oldThreadId: string,
  newThreadId: string,
  messageIdMap: Map<string, string>
): string | null {
  if (text === null) return null;
  let out = text.split(oldThreadId).join(newThreadId);
  for (const [oldId, newId] of messageIdMap) {
    out = out.split(oldId).join(newId);
  }
  return out;
}
