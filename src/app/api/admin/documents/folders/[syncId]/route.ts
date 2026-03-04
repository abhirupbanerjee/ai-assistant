/**
 * Admin - Folder Sync Management API
 * GET /api/admin/documents/folders/[syncId] - Get folder sync details
 * POST /api/admin/documents/folders/[syncId]/resync - Re-sync folder
 * DELETE /api/admin/documents/folders/[syncId] - Delete folder sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getFolderSyncById,
  getFolderSyncFiles,
  deleteFolderSync,
  updateFolderSync,
  updateFolderSyncFile,
  createFolderSyncFile,
  findFolderSyncFileByPath,
} from '@/lib/db/compat/folder-syncs';
import { ingestDocument } from '@/lib/ingest';
import { isSupportedMimeType } from '@/lib/document-extractor';
import { updateDocumentFolderSync, deleteDocument as dbDeleteDocument } from '@/lib/db/compat';
import { calculateFileHash, needsResync, MAX_FILE_SIZE_BYTES } from '@/lib/folder-sync-utils';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ syncId: string }>;
}

/**
 * GET - Get folder sync details with files
 */
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

    const { syncId } = await params;
    const folderSync = await getFolderSyncById(syncId);

    if (!folderSync) {
      return NextResponse.json<ApiError>(
        { error: 'Folder sync not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const files = await getFolderSyncFiles(syncId);

    return NextResponse.json({
      ...folderSync,
      files,
    });
  } catch (error) {
    console.error('Get folder sync error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get folder sync', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * POST - Re-sync folder with new files
 */
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

    const { syncId } = await params;
    const folderSync = await getFolderSyncById(syncId);

    if (!folderSync) {
      return NextResponse.json<ApiError>(
        { error: 'Folder sync not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get existing files for comparison
    const existingFiles = await getFolderSyncFiles(syncId);
    const existingByPath = new Map(existingFiles.map(f => [f.relativePath, f]));

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const paths = formData.getAll('paths') as string[];

    if (files.length === 0) {
      return NextResponse.json<ApiError>(
        { error: 'No files provided', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (files.length !== paths.length) {
      return NextResponse.json<ApiError>(
        { error: 'Files and paths count mismatch', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Mark as syncing
    await updateFolderSync(syncId, { status: 'syncing' });

    const results: Array<{
      path: string;
      action: 'added' | 'updated' | 'skipped' | 'error';
      documentId?: string;
      oldDocumentId?: string;
      error?: string;
    }> = [];

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = paths[i];

      // Skip unsupported file types
      if (!isSupportedMimeType(file.type)) {
        results.push({
          path: relativePath,
          action: 'skipped',
          error: 'Unsupported file type',
        });
        skipped++;
        continue;
      }

      // Skip files that are too large
      if (file.size > MAX_FILE_SIZE_BYTES) {
        results.push({
          path: relativePath,
          action: 'error',
          error: 'File too large (max 50MB)',
        });
        failed++;
        continue;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileHash = calculateFileHash(buffer);

        const existing = existingByPath.get(relativePath);

        if (!existing) {
          // NEW file - add it
          const syncFile = await createFolderSyncFile({
            folderSyncId: syncId,
            relativePath,
            filename: file.name,
            fileSize: file.size,
            fileHash,
            lastModified: file.lastModified,
          });

          const doc = await ingestDocument(buffer, file.name, user.email, {
            categoryIds: folderSync.categoryIds,
            isGlobal: folderSync.isGlobal,
            mimeType: file.type,
          });

          // Update document with folder sync metadata
          await updateDocumentFolderSync(doc.id, syncId, relativePath);

          await updateFolderSyncFile(syncFile.id, {
            documentId: parseInt(doc.id),
            status: 'synced',
            syncedAt: new Date().toISOString(),
          });

          results.push({
            path: relativePath,
            action: 'added',
            documentId: doc.id,
          });
          added++;
        } else if (needsResync(existing, fileHash, file.lastModified)) {
          // CHANGED file - delete old doc and create new one
          const oldDocId = existing.documentId;

          // Delete old document if it exists
          if (oldDocId) {
            dbDeleteDocument(oldDocId);
          }

          // Ingest the new version
          const doc = await ingestDocument(buffer, file.name, user.email, {
            categoryIds: folderSync.categoryIds,
            isGlobal: folderSync.isGlobal,
            mimeType: file.type,
          });

          // Update document with folder sync metadata
          await updateDocumentFolderSync(doc.id, syncId, relativePath);

          // Update sync file record
          await updateFolderSyncFile(existing.id, {
            documentId: parseInt(doc.id),
            fileHash,
            status: 'synced',
            syncedAt: new Date().toISOString(),
          });

          results.push({
            path: relativePath,
            action: 'updated',
            documentId: doc.id,
            oldDocumentId: oldDocId?.toString(),
          });
          updated++;
        } else {
          // UNCHANGED file - skip
          results.push({
            path: relativePath,
            action: 'skipped',
          });
          skipped++;
        }
      } catch (error) {
        // Try to find or create the sync file record
        let syncFile = await findFolderSyncFileByPath(syncId, relativePath);
        if (syncFile) {
          await updateFolderSyncFile(syncFile.id, {
            status: 'error',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        results.push({
          path: relativePath,
          action: 'error',
          error: error instanceof Error ? error.message : 'Failed to process file',
        });
        failed++;
      }
    }

    // Update folder sync record
    await updateFolderSync(syncId, {
      totalFiles: folderSync.totalFiles + added,
      syncedFiles: folderSync.syncedFiles + added + updated,
      failedFiles: folderSync.failedFiles + failed,
      lastSyncedAt: new Date().toISOString(),
      status: 'active',
    });

    return NextResponse.json({
      syncId,
      summary: {
        added,
        updated,
        skipped,
        failed,
      },
      results,
    }, { status: failed === 0 ? 200 : 207 });
  } catch (error) {
    console.error('Folder resync error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to resync folder',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete folder sync and optionally its documents
 */
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

    const { syncId } = await params;
    const folderSync = await getFolderSyncById(syncId);

    if (!folderSync) {
      return NextResponse.json<ApiError>(
        { error: 'Folder sync not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Check if we should delete documents too
    const url = new URL(request.url);
    const deleteDocuments = url.searchParams.get('deleteDocuments') === 'true';

    const deleted = await deleteFolderSync(syncId, deleteDocuments);

    if (!deleted) {
      return NextResponse.json<ApiError>(
        { error: 'Failed to delete folder sync', code: 'SERVICE_ERROR' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedDocuments: deleteDocuments,
    });
  } catch (error) {
    console.error('Delete folder sync error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to delete folder sync',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
