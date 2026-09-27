import { setTimeout as sleep } from 'node:timers/promises';
import { getArtifactPreview, invalidateArtifactPreview, reserveArtifactPreview, activateArtifactPreview, authorizeArtifactSubmission, finishArtifactPreview, releaseArtifactPreview, type PreviewRow } from '@/lib/db/compat';
import { hash, SETTINGS_VERSION, PreviewError, QUEUE_MS, providerUrl } from './policy';
import { reauthorize, reauthorizeContent, type ResolvedSource } from './source';
import { inspect } from './validation';
import { convert } from './provider';
import { readCache, writeCache } from './cache';
import { waitForSlot } from './queue';

const preparationDependencies = { reserveArtifactPreview, activateArtifactPreview, authorizeArtifactSubmission,
  getArtifactPreview, finishArtifactPreview, releaseArtifactPreview, reauthorize, reauthorizeContent, inspect, convert, writeCache, servePreview };
export type PreparationDependencies = typeof preparationDependencies;

export function ready(src: ResolvedSource, row: PreviewRow) {
  return { sourceVersion: src.sourceVersion, renderVersion: row.render_version!, pageCount: row.page_count!,
    pdfUrl: `/api/user/artifact-preview/${src.ref.kind}/${src.ref.id}/pdf?version=${src.sourceVersion}&render=${row.render_version}`,
    converted: row.converted, state: 'ready' as const };
}
export async function servePreview(src: ResolvedSource, render: string) {
  const row = await getArtifactPreview(src.key);
  if (!row || row.state !== 'ready' || row.render_version !== render || Date.parse(row.expires_at) <= Date.now()) throw new PreviewError('PREVIEW_EXPIRED', 409);
  let bytes: Buffer;
  try {
    bytes = row.converted ? await readCache(src.key, render) : src.bytes;
    if (hash(`${SETTINGS_VERSION}:${hash(bytes)}`) !== render) throw new PreviewError('PREVIEW_INVALID', 409);
  } catch {
    await invalidateArtifactPreview(src.key, row.token);
    throw new PreviewError('PREVIEW_RETRY', 409);
  }
  await reauthorize(src);
  return { bytes, row };
}
export async function preparePreview(src: ResolvedSource, signal: AbortSignal, dependencies: PreparationDependencies = preparationDependencies) {
  const { reserveArtifactPreview, activateArtifactPreview, authorizeArtifactSubmission, getArtifactPreview,
    finishArtifactPreview, releaseArtifactPreview, reauthorize, reauthorizeContent, inspect, convert, writeCache, servePreview } = dependencies;
  const converted = src.format !== 'pdf';
  // Legacy binary Office is deliberately fail-closed until active content can
  // be inspected safely; never pass renamed/macro/encrypted bytes to LO.
  if (!['pdf', 'xlsx', 'pptx'].includes(src.format)) throw new PreviewError('UNSUPPORTED_FORMAT', 415);
  if (converted) providerUrl();
  const deadline = Date.now() + QUEUE_MS;
  const reservation = await reserveArtifactPreview(src.ref, { key: src.key, partition: src.row.partition, version: src.sourceVersion, expires: src.expires, converted, deadline });
  const { row, owned } = reservation;
  if (!owned) {
    while (true) {
      signal.throwIfAborted();
      const existing = await getArtifactPreview(src.key);
      if (existing?.state === 'ready') { const checked = await servePreview(src, existing.render_version!); return ready(src, checked.row); }
      if (!existing || existing.state === 'failed') throw new PreviewError('PREVIEW_RETRY', 409);
      if (Date.now() >= deadline) throw new PreviewError('PREVIEW_BUSY', 409);
      await sleep(200, undefined, { signal });
    }
  }
  let providerSettled = true;
  let render: string | undefined;
  try {
    await waitForSlot(() => activateArtifactPreview(src.key, row.token), signal, Date.now, undefined, deadline);
    await reauthorize(src);
    signal.throwIfAborted();
    const originalPages = await inspect(src.bytes, src.format, signal);
    let pdf = src.bytes;
    if (converted) {
      await reauthorize(src);
      const leaseUntil = await authorizeArtifactSubmission(src.key, row.token);
      providerSettled = false;
      pdf = await convert(src.bytes, src.format, signal, fetch, leaseUntil);
      providerSettled = true;
    }
    const pages = converted ? await inspect(pdf, 'pdf', signal) : originalPages;
    render = hash(`${SETTINGS_VERSION}:${hash(pdf)}`);
    signal.throwIfAborted();
    await reauthorize(src);
    await finishArtifactPreview(src.ref, src.key, row.token, src.row.partition, render, pages, converted ? pdf.length : 0, async () => {
      signal.throwIfAborted();
      await reauthorizeContent(src);
      if (converted) await writeCache(src.key, render!, pdf, row.token);
    });
    return ready(src, { ...row, state: 'ready', render_version: render, page_count: pages });
  } finally {
    // Failed finalization files are swept as orphans. Do not unlink here: a
    // newer fenced retry can legitimately own the same content-addressed file.
    await releaseArtifactPreview(src.key, row.token, providerSettled);
  }
}
