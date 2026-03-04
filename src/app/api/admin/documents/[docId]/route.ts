import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getGlobalDocument, deleteDocument, reindexDocument, updateDocumentCategories, toggleDocumentGlobal } from '@/lib/ingest';
import { getDocumentWithCategories } from '@/lib/db/compat';
import type { GlobalDocument, AdminDeleteResponse, AdminUploadResponse, ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ docId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const { docId } = await params;
    const doc = await getGlobalDocument(docId);

    if (!doc) {
      return NextResponse.json<ApiError>(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json<GlobalDocument>(doc);
  } catch (error) {
    console.error('Get document error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get document', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const { docId } = await params;
    const result = await deleteDocument(docId);

    if (!result) {
      return NextResponse.json<ApiError>(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json<AdminDeleteResponse>({
      success: true,
      deleted: {
        id: docId,
        filename: result.filename,
        chunksRemoved: result.chunksRemoved,
      },
    });
  } catch (error) {
    console.error('Delete document error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to delete document', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

// Reindex endpoint
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    const { docId } = await params;

    // Check if this is a reindex request
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/reindex') && !url.searchParams.has('reindex')) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid request', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const doc = await reindexDocument(docId);

    if (!doc) {
      return NextResponse.json<ApiError>(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json<AdminUploadResponse>(
      {
        id: doc.id,
        filename: doc.filename,
        size: doc.size,
        status: 'processing',
        message: 'Document is being reindexed',
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('Reindex document error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to reindex document',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// Update document categories and global status
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

    const { docId } = await params;
    const body = await request.json();

    // Check document exists
    const doc = await getGlobalDocument(docId);
    if (!doc) {
      return NextResponse.json<ApiError>(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Update categories if provided
    if (body.categoryIds !== undefined) {
      await updateDocumentCategories(docId, body.categoryIds);
    }

    // Update global status if provided
    if (body.isGlobal !== undefined) {
      await toggleDocumentGlobal(docId, body.isGlobal);
    }

    // Get updated document with categories
    const updatedDoc = await getDocumentWithCategories(parseInt(docId, 10));

    return NextResponse.json({
      success: true,
      document: {
        id: String(updatedDoc?.id),
        filename: updatedDoc?.filename,
        isGlobal: updatedDoc?.isGlobal,
        categories: updatedDoc?.categories || [],
      },
    });
  } catch (error) {
    console.error('Update document error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update document',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
