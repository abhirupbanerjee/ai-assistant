import { createHash } from 'node:crypto';

export const SETTINGS_VERSION = 'gotenberg-libreoffice-8.34.0-libreoffice@sha256:3c23aeb3a027a63d7c71745fc9d83724bd58cf9dfa470396ac82c0896028db2a-v1';
export const INPUT_LIMIT = 20 * 1024 * 1024;
export const OUTPUT_LIMIT = 40 * 1024 * 1024;
export const STORAGE_LIMIT = 512 * 1024 * 1024;
export const QUEUE_MS = 15_000;
export const CONVERT_MS = 60_000;
export const DB_LOCK_MS = 250;
export const DB_STATEMENT_MS = 2_000;
export const SUBMIT_GRACE_MS = 5_000;
// Must exceed the deployment's hard provider timeout plus transport grace.
export const LEASE_MS = 130_000;
export const TTL_MS = 24 * 60 * 60 * 1000;
export type SourceKind = 'upload' | 'output';
export function assertRecordScope(ref: { kind: SourceKind; id: number; owner: number }, thread: string,
  record: { owner_id: number; thread_id: string; upload_id: number | null; output_id: number | null }) {
  if (record.owner_id !== ref.owner || record.thread_id !== thread ||
    (ref.kind === 'upload' ? record.upload_id !== ref.id || record.output_id !== null : record.output_id !== ref.id || record.upload_id !== null)) {
    throw new PreviewError('ACCESS_DENIED', 403);
  }
}
export class PreviewError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function identity(kind: string, id: string): { kind: SourceKind; id: number } {
  if ((kind !== 'upload' && kind !== 'output') || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) {
    throw new PreviewError('INVALID_SOURCE');
  }
  return { kind, id: Number(id) };
}
export const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function partition(owner: number, org: number | null) {
  if (!Number.isSafeInteger(owner) || owner <= 0 || (org !== null && (!Number.isSafeInteger(org) || org <= 0))) throw new PreviewError('ACCESS_DENIED', 403);
  return org === null ? `owner:${owner}` : `org:${org}:owner:${owner}`;
}
export function cacheKey(scope: string, kind: SourceKind, id: number, version: string) {
  return hash(JSON.stringify([scope, kind, id, version, SETTINGS_VERSION]));
}
export function version(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new PreviewError('INVALID_VERSION');
  return value;
}
export function assertSurface(headers: Headers, mutation = false, origin?: string) {
  if (headers.has('x-agent-bot-api-key') || headers.has('x-workspace-slug')) throw new PreviewError('ACCESS_DENIED', 403);
  if (mutation && (!origin || headers.get('origin') !== origin || (headers.get('sec-fetch-site') && headers.get('sec-fetch-site') !== 'same-origin'))) throw new PreviewError('CSRF_REJECTED', 403);
}
// Behind TLS-terminating proxies the internal request URL can be http://app:3000.
// Use the trusted deployment origin, never Origin or forwarded headers, as the
// expected value. When unset, retain the existing direct-request behavior.
export function expectedArtifactOrigin(requestUrl: string, configured = process.env.NEXTAUTH_URL): string {
  try {
    const url = new URL(configured || requestUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (configured && (url.pathname !== '/' || url.search || url.hash))) throw new Error('Invalid origin');
    return url.origin;
  } catch {
    throw new PreviewError('CSRF_REJECTED', 403);
  }
}
export function providerUrl(raw = process.env.ARTIFACT_GOTENBERG_URL): string {
  if (process.env.ARTIFACT_PREVIEW_ENABLED !== 'true' || !raw) throw new PreviewError('PREVIEW_DISABLED', 503);
  let url: URL;
  try { url = new URL(raw); } catch { throw new PreviewError('PREVIEW_NOT_CONFIGURED', 503); }
  // Explicit local allowlist. Never accept a browser URL, public host, redirect or credentials.
  if (url.protocol !== 'http:' || !['gotenberg', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new PreviewError('PREVIEW_NOT_CONFIGURED', 503);
  return new URL('/forms/libreoffice/convert', url).href;
}
