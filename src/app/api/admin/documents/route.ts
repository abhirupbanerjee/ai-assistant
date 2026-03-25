import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listGlobalDocuments, ingestDocument } from '@/lib/ingest';
import { isSupportedMimeType } from '@/lib/document-extractor';
import type { AdminDocumentsResponse, AdminUploadResponse, ApiError } from '@/types';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const documents = await listGlobalDocuments();
    // Calculate total chunks from database data
    const totalChunks = documents.reduce((sum, doc) => sum + doc.chunkCount, 0);

    return NextResponse.json<AdminDocumentsResponse>({
      documents,
      totalChunks,
    });
  } catch (error) {
    console.error('List documents error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to list documents', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiError>(
        { error: 'No file provided', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!isSupportedMimeType(file.type)) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid file type. Allowed: PDF, DOCX, XLSX, PPTX, TXT, MD, JSON, PNG, JPG, WEBP, GIF', code: 'INVALID_FILE_TYPE' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json<ApiError>(
        { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, code: 'FILE_TOO_LARGE' },
        { status: 413 }
      );
    }

    // Check for duplicate filename
    const existingDocs = await listGlobalDocuments();
    if (existingDocs.some(d => d.filename === file.name)) {
      return NextResponse.json<ApiError>(
        { error: 'Document already exists', code: 'VALIDATION_ERROR' },
        { status: 409 }
      );
    }

    // Get optional category IDs and global flag from form data
    const categoryIdsStr = formData.get('categoryIds') as string | null;
    const isGlobalStr = formData.get('isGlobal') as string | null;

    const categoryIds = categoryIdsStr ? JSON.parse(categoryIdsStr) as number[] : [];
    const isGlobal = isGlobalStr === 'true';

    // Convert to buffer and ingest
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const doc = await ingestDocument(buffer, file.name, user.email, {
      categoryIds,
      isGlobal,
      mimeType: file.type,
    });

    return NextResponse.json<AdminUploadResponse>(
      {
        id: doc.id,
        filename: doc.filename,
        size: doc.size,
        status: 'processing',
        message: 'Document is being processed',
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('Upload document error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to upload document',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
