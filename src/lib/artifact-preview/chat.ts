import type { ArtifactComment } from '@/types/artifact-canvas';
import { getArtifactComment, getArtifactImageOutput } from '@/lib/db/compat';
import { PreviewError, assertSurface, identity } from './policy';
import { resolveSource, type ResolvedSource } from './source';
import { commentSnapshot, text } from './comments';

export function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())) return 'image/gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}
export async function resolveChatComments(input: unknown, owner: number, threadId: string, headers: Headers, origin: string,
  dependencies: { getArtifactComment: typeof getArtifactComment; resolveSource: typeof resolveSource; getArtifactImageOutput?: typeof getArtifactImageOutput } = { getArtifactComment, resolveSource, getArtifactImageOutput }) {
  const comments: ArtifactComment[] = [];
  const images = new Map<string, { base64: string; mimeType: string; filename: string }>();
  if (input === undefined || input === null) return { comments, images };
  assertSurface(headers, true, origin);
  if (!Array.isArray(input) || input.length > 50) throw new PreviewError('INVALID_COMMENT');
  const seen = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== 'object') throw new PreviewError('INVALID_COMMENT');
    const item = value as Record<string, unknown>;
    const id = text(item.commentId, 100, true)!;
    if (seen.has(id)) continue;
    seen.add(id);
    let src: ResolvedSource | undefined;
    let snapshot: ArtifactComment;
    if (item.persisted === true || item.source !== undefined || item.sourceVersion !== undefined) {
      const row = await dependencies.getArtifactComment(id, owner);
      if (!row) throw new PreviewError('COMMENT_UNAVAILABLE', 403);
      src = await dependencies.resolveSource(owner, row.upload_id !== null ? 'upload' : 'output', String(row.upload_id ?? row.output_id));
      if (src.row.thread_id !== threadId) throw new PreviewError('ACCESS_DENIED', 403);
      snapshot = commentSnapshot(row, src);
      if (item.sourceVersion !== undefined && item.sourceVersion !== src.sourceVersion) throw new PreviewError('COMMENT_STALE', 409);
      if (item.source !== undefined) {
        const claimed = item.source as { kind?: unknown; id?: unknown } | null;
        if (!claimed || claimed.kind !== src.ref.kind || claimed.id !== String(src.ref.id)) throw new PreviewError('ACCESS_DENIED', 403);
      }
      // Ignore browser text/title/page/image fields; the saved record is authority.
    } else {
      const artifactId = text(item.artifactId, 200, true)!;
      const type = text(item.artifactType, 40, true)!;
      const numeric = /^(?:upload-)?[1-9]\d*$/.test(artifactId);
      if (numeric) {
        const kind = artifactId.startsWith('upload-') ? 'upload' : 'output';
        const sourceId = kind === 'upload' ? artifactId.slice(7) : artifactId;
        identity(kind, sourceId);
        src = await dependencies.resolveSource(owner, kind, sourceId);
        if (src.row.thread_id !== threadId) throw new PreviewError('ACCESS_DENIED', 403);
      } else if (type === 'image' && /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(artifactId)) {
        const outputId = await (dependencies.getArtifactImageOutput ?? getArtifactImageOutput)(owner, threadId, artifactId);
        src = await dependencies.resolveSource(owner, 'output', String(outputId));
        if (src.row.thread_id !== threadId || !imageMime(src.bytes)) throw new PreviewError('ACCESS_DENIED', 403);
      } else if (!['chart', 'diagram', 'image', 'html'].includes(type)) {
        throw new PreviewError('PERSISTED_COMMENT_REQUIRED', 400);
      }
      snapshot = { commentId: id, artifactId, artifactType: src?.format || type,
        artifactTitle: src?.title || text(item.artifactTitle, 255, true)!, commentText: text(item.commentText, 4000, true)!,
        selectedText: text(item.selectedText, 8000) || undefined, surroundingContext: text(item.surroundingContext, 16000) || undefined,
        createdAt: Date.now() };
      if (typeof item.pageNumber === 'number' && Number.isInteger(item.pageNumber) && item.pageNumber > 0 && item.pageNumber <= 200) snapshot.pageNumber = item.pageNumber;
    }
    const mime = src && imageMime(src.bytes);
    if (mime) {
      if (src!.bytes.length > 5 * 1024 * 1024 || (!images.has(snapshot.artifactId) && images.size >= 5)) throw new PreviewError('IMAGE_LIMIT', 413);
      // Marker only, never fetched. Genuine images come from authorized bytes.
      snapshot.imageUrl = `/api/artifact-image/${src!.ref.kind}/${src!.ref.id}`;
      images.set(snapshot.artifactId, { base64: src!.bytes.toString('base64'), mimeType: mime, filename: src!.title });
    }
    comments.push(snapshot);
  }
  return { comments, images };
}
