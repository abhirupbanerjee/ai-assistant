import { deleteArtifactComment } from '@/lib/db/compat';
import { authorize, body, failure, json, requestedVersion, type RouteContext } from '@/lib/artifact-preview/http';
import { commentsFor, saveComment } from '@/lib/artifact-preview/comments';
import { PreviewError } from '@/lib/artifact-preview/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  try {
    const src = await authorize(request, context); requestedVersion(request, src.sourceVersion);
    return json({ comments: await commentsFor(src) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: RouteContext) {
  try { const src = await authorize(request, context, true); return json({ comment: await saveComment(src, await body(request)) }); }
  catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const src = await authorize(request, context, true); requestedVersion(request, src.sourceVersion);
    const id = new URL(request.url).searchParams.get('commentId');
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new PreviewError('INVALID_COMMENT');
    await deleteArtifactComment(src.ref, src.sourceVersion, id);
    return json({ deleted: true });
  } catch (error) { return failure(error); }
}
