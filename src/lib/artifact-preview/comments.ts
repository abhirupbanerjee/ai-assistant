import { randomUUID } from 'node:crypto';
import { createArtifactComment, listArtifactComments, type CommentRow } from '@/lib/db/compat';
import { PreviewError, version } from './policy';
import { reauthorize, type ResolvedSource } from './source';
import { servePreview } from './service';

export function commentSnapshot(row: CommentRow, src: ResolvedSource) {
  if (row.partition_key !== src.row.partition || row.source_version !== src.sourceVersion) throw new PreviewError('COMMENT_STALE', 409);
  return {
    commentId: row.id, artifactId: src.ref.kind === 'upload' ? `upload-${src.ref.id}` : String(src.ref.id),
    artifactType: src.format, artifactTitle: src.title, commentText: row.comment_text,
    ...(row.selected_text ? { selectedText: row.selected_text } : {}),
    ...(row.surrounding_context ? { surroundingContext: row.surrounding_context } : {}),
    ...(row.page_number !== null ? { pageNumber: row.page_number } : {}),
    createdAt: Date.parse(row.created_at), persisted: true as const,
    source: { kind: src.ref.kind, id: String(src.ref.id) }, sourceVersion: row.source_version,
    renderVersion: row.render_version, kind: row.kind,
  };
}
export function text(value: unknown, max: number, required = false): string | null {
  if (value === undefined || value === null) { if (required) throw new PreviewError('INVALID_COMMENT'); return null; }
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) throw new PreviewError('INVALID_COMMENT');
  return value || null;
}
export function commentInput(body: Record<string, unknown>) {
  const sourceVersion = version(body.sourceVersion);
  const commentText = text(body.commentText, 4000, true)!;
  const selectedText = text(body.selectedText, 8000);
  const surroundingContext = text(body.surroundingContext, 16000);
  const clientToken = text(body.clientToken, 100, true)!;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientToken)) throw new PreviewError('INVALID_COMMENT');
  const pageNumber = body.pageNumber === undefined || body.pageNumber === null ? null : body.pageNumber;
  if (pageNumber !== null && (typeof pageNumber !== 'number' || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 200)) throw new PreviewError('INVALID_PAGE');
  const renderVersion = body.renderVersion === undefined || body.renderVersion === null ? null : version(body.renderVersion);
  return { sourceVersion, commentText, selectedText, surroundingContext, clientToken, pageNumber: pageNumber as number | null, renderVersion,
    kind: selectedText ? 'selection' as const : pageNumber ? 'page' as const : 'general' as const };
}
export async function commentsFor(src: ResolvedSource) {
  const rows = await listArtifactComments(src.ref, src.sourceVersion);
  await reauthorize(src);
  return rows.filter(row => row.partition_key === src.row.partition).map(row => commentSnapshot(row, src));
}
export async function saveComment(src: ResolvedSource, body: Record<string, unknown>) {
  const input = commentInput(body);
  if (input.sourceVersion !== src.sourceVersion) throw new PreviewError('SOURCE_CHANGED', 409);
  if (input.renderVersion) {
    const { row } = await servePreview(src, input.renderVersion);
    if (input.pageNumber && input.pageNumber > row.page_count!) throw new PreviewError('INVALID_PAGE');
  }
  if ((input.selectedText || input.kind === 'page') && ['pdf', 'ppt', 'pptx', 'xls', 'xlsx'].includes(src.format) && !input.renderVersion) throw new PreviewError('RENDER_REQUIRED', 409);
  await reauthorize(src);
  const row = await createArtifactComment(src.ref, {
    id: randomUUID(), upload_id: src.ref.kind === 'upload' ? src.ref.id : null, output_id: src.ref.kind === 'output' ? src.ref.id : null,
    thread_id: src.row.thread_id, owner_id: src.ref.owner, partition_key: src.row.partition,
    source_version: src.sourceVersion, render_version: input.renderVersion, kind: input.kind,
    comment_text: input.commentText, selected_text: input.selectedText, surrounding_context: input.surroundingContext,
    page_number: input.pageNumber, client_token: input.clientToken,
  });
  await reauthorize(src);
  return commentSnapshot(row, src);
}
