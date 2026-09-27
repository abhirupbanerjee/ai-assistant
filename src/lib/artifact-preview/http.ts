import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/compat';
import { PreviewError, assertSurface, expectedArtifactOrigin, version } from './policy';
import { resolveSource } from './source';
import { boundedBody } from './provider';

export type RouteContext = { params: Promise<{ kind: string; id: string }> };
export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: privateHeaders }); }
export function failure(error: unknown) {
  const safe = error instanceof PreviewError ? error : error instanceof Error && error.name === 'AbortError' ? new PreviewError('REQUEST_CANCELLED', 499) : new PreviewError('PREVIEW_UNAVAILABLE', 503);
  return json({ error: safe.code.replaceAll('_', ' ').toLowerCase(), code: safe.code }, safe.status);
}
export async function authorize(request: Request, context: RouteContext, mutation = false) {
  assertSurface(request.headers, mutation, expectedArtifactOrigin(request.url));
  const session = await getCurrentUser();
  if (!session) throw new PreviewError('AUTH_REQUIRED', 401);
  const user = await getUserByEmail(session.email);
  if (!user) throw new PreviewError('AUTH_REQUIRED', 401);
  const { kind, id } = await context.params;
  return await resolveSource(user.id, kind, id);
}
export function requestedVersion(request: Request, actual: string) {
  if (version(new URL(request.url).searchParams.get('version')) !== actual) throw new PreviewError('SOURCE_CHANGED', 409);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new PreviewError('INVALID_REQUEST');
  const data = await boundedBody(new Response(request.body), 40 * 1024, request.signal);
  try {
    const parsed = JSON.parse(data.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new PreviewError('INVALID_REQUEST'); }
}
