import type { ArtifactCanvasItem } from '@/types/artifact-canvas';

export function artifactEndpoint(artifact: ArtifactCanvasItem): string | null {
  const source = artifact.source;
  if (!source || !['upload','output'].includes(source.kind) || !/^[1-9]\d*$/.test(source.id)) return null;
  return `/api/user/artifact-preview/${source.kind}/${source.id}`;
}
const explanations: Record<string,string> = {
  PREVIEW_DISABLED: 'Local Office preview is disabled. Your original file is unchanged.',
  PREVIEW_NOT_CONFIGURED: 'The local conversion service is not configured.',
  UNSUPPORTED_FORMAT: 'Visual preview is not supported for this format. You can still add general comments and download the original.',
  UNSAFE_OR_INVALID_DOCUMENT: 'This file is encrypted, invalid, or contains content that cannot be safely previewed.',
  SOURCE_CHANGED: 'This file changed. Close and reopen it before continuing.',
  SOURCE_UNAVAILABLE: 'This file has expired, was deleted, or is unavailable.',
  PREVIEW_BUSY: 'The preview service is busy. Retry shortly.',
  QUEUE_FULL: 'The preview queue is full. Retry shortly.',
  QUEUE_TIMEOUT: 'The preview queue timed out. Retry shortly.',
  CONVERSION_TIMEOUT: 'Conversion timed out. Wait briefly before retrying.',
  INPUT_TOO_LARGE: 'This file exceeds the 20 MiB preview limit.',
  OUTPUT_TOO_LARGE: 'The converted preview exceeds the size limit.',
  PREVIEW_RETRY: 'The preview is no longer available. Prepare it again.',
};
export async function artifactJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(explanations[result.code] || 'The operation failed. Retry or reopen the artifact.');
  return result as T;
}
