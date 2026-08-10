/**
 * Upload Download API
 *
 * GET /api/threads/{threadId}/uploads/{filename}/download
 * Streams an uploaded thread file back to the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, userOwnsThread } from '@/lib/db/compat';
import { getThreadUploads } from '@/lib/db/compat/threads';
import { readFileBuffer } from '@/lib/storage';
import { getMimeTypeFromFilename } from '@/lib/document-extractor';

interface RouteParams {
  params: Promise<{ threadId: string; filename: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { threadId, filename: encodedFilename } = await params;
    const filename = decodeURIComponent(encodedFilename);

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const ownsThread = await userOwnsThread(dbUser.id, threadId);
    if (!ownsThread && !user.isAdmin) {
      return NextResponse.json(
        { error: 'Access denied', code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    const uploads = await getThreadUploads(threadId);
    const upload = uploads.find((u) => u.filename === filename);
    if (!upload) {
      return NextResponse.json(
        { error: 'Upload not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const buffer = await readFileBuffer(upload.filepath);
    const bytes = new Uint8Array(buffer);
    const mimeType = getMimeTypeFromFilename(upload.filename);
    const isImage = mimeType.startsWith('image/');
    const isHtml = mimeType === 'text/html';
    const disposition = isImage || isHtml ? 'inline' : 'attachment';

    // RFC 6266: use the extended filename* parameter with UTF-8 percent-encoding
    // for non-ASCII filenames, and a fallback ASCII filename parameter for
    // legacy clients. encodeURIComponent mangles spaces as %20 which is
    // correct for the ext-value, but the fallback should strip non-ASCII chars.
    const asciiFallback = upload.filename.replace(/[^\x20-\x7E]/g, '').replace(/"/g, '\\"') || 'download';
    const percentEncodedFilename = encodeURIComponent(upload.filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    const contentDisposition = `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${percentEncodedFilename}`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': contentDisposition,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Upload Download] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to download upload';
    return NextResponse.json(
      { error: message, code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
