import { CONVERT_MS, OUTPUT_LIMIT, SUBMIT_GRACE_MS, PreviewError, providerUrl } from './policy';

export function assertSubmissionLease(leaseUntil: number, now = Date.now()) {
  if (!Number.isFinite(leaseUntil) || leaseUntil - now < CONVERT_MS + SUBMIT_GRACE_MS) throw new PreviewError('PREVIEW_RETRY', 409);
}

export async function boundedBody(response: Response, limit: number, signal?: AbortSignal) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new PreviewError('OUTPUT_TOO_LARGE', 413); }
  const reader = response.body?.getReader();
  if (!reader) throw new PreviewError('CONVERSION_FAILED', 502);
  const chunks: Buffer[] = []; let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new PreviewError('OUTPUT_TOO_LARGE', 413);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function convert(bytes: Buffer, format: string, signal: AbortSignal, fetcher: typeof fetch = fetch, leaseUntil?: number) {
  const url = providerUrl();
  const form = new FormData();
  form.set('files', new Blob([new Uint8Array(bytes)]), `source.${format}`);
  form.set('skipHyperlinks', 'true');
  form.set('exportFormFields', 'false');
  form.set('exportBookmarks', 'false');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(CONVERT_MS)]);
  try {
    deadline.throwIfAborted();
    if (leaseUntil !== undefined) assertSubmissionLease(leaseUntil);
    const response = await fetcher(url, { method: 'POST', body: form, signal: deadline, redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) {
      await response.body?.cancel(); throw new PreviewError('CONVERSION_FAILED', 502);
    }
    return await boundedBody(response, OUTPUT_LIMIT, deadline);
  } catch (e) {
    if (e instanceof PreviewError) throw e;
    throw new PreviewError(signal.aborted ? 'REQUEST_CANCELLED' : deadline.aborted ? 'CONVERSION_TIMEOUT' : 'CONVERSION_FAILED', signal.aborted ? 499 : 502);
  }
}
