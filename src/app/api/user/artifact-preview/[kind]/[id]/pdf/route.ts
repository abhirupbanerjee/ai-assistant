import { authorize, failure, privateHeaders, requestedVersion, type RouteContext } from '@/lib/artifact-preview/http';
import { servePreview } from '@/lib/artifact-preview/service';
import { version } from '@/lib/artifact-preview/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  try {
    const src = await authorize(request, context);
    requestedVersion(request, src.sourceVersion);
    const { bytes } = await servePreview(src, version(new URL(request.url).searchParams.get('render')));
    // Deliberately no range support: at most 40 MiB, and every read is authorized.
    return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders, 'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length), 'Content-Disposition': 'inline; filename="preview.pdf"',
      'Content-Security-Policy': "sandbox; default-src 'none'", 'Accept-Ranges': 'none' } });
  } catch (error) { return failure(error); }
}
