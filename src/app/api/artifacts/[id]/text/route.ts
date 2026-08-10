/**
 * Artifact Text Extraction API
 *
 * GET /api/artifacts/{id}/text
 * Returns paginated, selectable text for PDF artifacts (Phase 2a Path A).
 * Other file types fall back through the unified document extractor as needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getThreadOutputById, getThreadOwner, getThreadUploadById } from '@/lib/db/compat';
import { readFileBuffer } from '@/lib/storage';
import { extractText, getMimeTypeFromFilename } from '@/lib/document-extractor';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    let filepath: string;
    let filename: string;

    if (id.startsWith('upload-')) {
      const uploadId = parseInt(id.slice('upload-'.length), 10);
      if (isNaN(uploadId)) {
        return NextResponse.json(
          { error: 'Invalid upload artifact ID', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      const upload = await getThreadUploadById(uploadId);
      if (!upload) {
        return NextResponse.json(
          { error: 'Upload not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      const owner = await getThreadOwner(upload.thread_id);
      if (!owner || (owner.user_id !== dbUser.id && !user.isAdmin)) {
        return NextResponse.json(
          { error: 'Access denied', code: 'ACCESS_DENIED' },
          { status: 403 }
        );
      }

      filepath = upload.filepath;
      filename = upload.filename;
    } else {
      const outputId = parseInt(id, 10);
      if (isNaN(outputId)) {
        return NextResponse.json(
          { error: 'Invalid artifact ID', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      const output = await getThreadOutputById(outputId);
      if (!output) {
        return NextResponse.json(
          { error: 'Artifact not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      const owner = await getThreadOwner(output.thread_id);
      if (!owner || (owner.user_id !== dbUser.id && !user.isAdmin)) {
        return NextResponse.json(
          { error: 'Access denied', code: 'ACCESS_DENIED' },
          { status: 403 }
        );
      }

      filepath = output.filepath;
      filename = output.filename;
    }

    const buffer = await readFileBuffer(filepath);
    const mimeType = getMimeTypeFromFilename(filename);
    const result = await extractText(buffer, mimeType, filename);

    return NextResponse.json(
      {
        pages: result.pages,
        totalPages: result.numPages,
        provider: result.provider,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=3600',
        },
      }
    );
  } catch (error) {
    console.error('[Artifact Text] Extraction error:', error);
    const message = error instanceof Error ? error.message : 'Failed to extract text';
    return NextResponse.json(
      { error: message, code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
