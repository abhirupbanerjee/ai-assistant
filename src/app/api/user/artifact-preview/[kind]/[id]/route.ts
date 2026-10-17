import { authorize, body, failure, json, type RouteContext } from '@/lib/artifact-preview/http';
import { commentsFor } from '@/lib/artifact-preview/comments';
import { preparePreview } from '@/lib/artifact-preview/service';
import { PreviewError, version } from '@/lib/artifact-preview/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: Request, context: RouteContext) {
  let stage: 'authorize' | 'comments' = 'authorize';
  try {
    const src = await authorize(request, context);
    stage = 'comments';
    const comments = await commentsFor(src);
    return json({ source: { kind: src.ref.kind, id: String(src.ref.id) }, sourceVersion: src.sourceVersion,
      format: src.format, title: src.title, previewSupported: ['pdf', 'pptx', 'xlsx'].includes(src.format), comments });
  } catch (error) {
    if (!(error instanceof PreviewError)) {
      // Do not log the exception or request: DB errors may embed private data.
      // PostgreSQL SQLSTATEs are fixed-length diagnostic codes, not query text.
      const code = (error as { code?: unknown } | null)?.code;
      console.error('[ArtifactPreview] GET failed', {
        stage,
        sqlstate: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined,
        errorType: error instanceof Error ? error.name : 'NonError',
      });
    }
    return failure(error);
  }
}
export async function POST(request: Request, context: RouteContext) {
  try {
    const src = await authorize(request, context, true);
    // An empty POST prepares the current source. Supplying a version prevents
    // an old viewer from silently preparing newly replaced bytes.
    if (request.body !== null) {
      const input = await body(request);
      if (input.sourceVersion !== undefined && version(input.sourceVersion) !== src.sourceVersion) throw new PreviewError('SOURCE_CHANGED', 409);
    }
    return json(await preparePreview(src, request.signal));
  } catch (error) { return failure(error); }
}
