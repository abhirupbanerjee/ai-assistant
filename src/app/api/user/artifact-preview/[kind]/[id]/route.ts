import { authorize, body, failure, json, type RouteContext } from '@/lib/artifact-preview/http';
import { commentsFor } from '@/lib/artifact-preview/comments';
import { preparePreview } from '@/lib/artifact-preview/service';
import { PreviewError, version } from '@/lib/artifact-preview/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: Request, context: RouteContext) {
  try {
    const src = await authorize(request, context);
    return json({ source: { kind: src.ref.kind, id: String(src.ref.id) }, sourceVersion: src.sourceVersion,
      format: src.format, title: src.title, previewSupported: ['pdf', 'pptx', 'xlsx'].includes(src.format), comments: await commentsFor(src) });
  } catch (error) { return failure(error); }
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
