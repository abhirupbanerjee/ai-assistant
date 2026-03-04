/**
 * Admin - Folder Upload API
 * POST /api/admin/documents/folder - Upload entire folder
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { ingestDocument } from '@/lib/ingest';
import { isSupportedMimeType } from '@/lib/document-extractor';
import {
  createFolderSync,
  createFolderSyncFile,
  updateFolderSync,
  updateFolderSyncFile,
} from '@/lib/db/compat/folder-syncs';
import { updateDocumentFolderSync } from '@/lib/db/compat';
import { calculateFileHash, MAX_FILES_PER_FOLDER, MAX_FILE_SIZE_BYTES } from '@/lib/folder-sync-utils';
import type { ApiError } from '@/types';

interface FolderUploadResult {
  syncId: string;
  folderName: string;
  summary: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  };
  results: Array<{
    path: string;
    status: 'success' | 'error' | 'skipped';
    documentId?: string;
    filename?: string;
    error?: string;
  }>;
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

    // Get folder metadata
    const folderName = formData.get('folderName') as string;
    if (!folderName) {
      return NextResponse.json<ApiError>(
        { error: 'Folder name is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Get category IDs and global flag
    const categoryIdsStr = formData.get('categoryIds') as string | null;
    const isGlobalStr = formData.get('isGlobal') as string | null;
    const categoryIds = categoryIdsStr ? JSON.parse(categoryIdsStr) as number[] : [];
    const isGlobal = isGlobalStr === 'true';

    // Get all files and their paths
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

    if (files.length > MAX_FILES_PER_FOLDER) {
      return NextResponse.json<ApiError>(
        { error: `Too many files. Maximum ${MAX_FILES_PER_FOLDER} files per folder.`, code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Create folder sync record
    const folderSync = await createFolderSync({
      folderName,
      originalPath: folderName,
      uploadedBy: user.email,
      categoryIds,
      isGlobal,
    });

    // Process each file
    const results: FolderUploadResult['results'] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = paths[i];

      // Skip unsupported file types
      if (!isSupportedMimeType(file.type)) {
        // Create file record as skipped
        await createFolderSyncFile({
          folderSyncId: folderSync.id,
          relativePath,
          filename: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
        });

        await updateFolderSyncFile(
          (await getFolderSyncFileByPath(folderSync.id, relativePath))!.id,
          {
            status: 'skipped',
            errorMessage: 'Unsupported file type',
          }
        );

        results.push({
          path: relativePath,
          status: 'skipped',
          error: 'Unsupported file type',
        });
        skipped++;
        continue;
      }

      // Skip files that are too large
      if (file.size > MAX_FILE_SIZE_BYTES) {
        await createFolderSyncFile({
          folderSyncId: folderSync.id,
          relativePath,
          filename: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
        });

        const syncFile = await getFolderSyncFileByPath(folderSync.id, relativePath);
        if (syncFile) {
          await updateFolderSyncFile(syncFile.id, {
            status: 'error',
            errorMessage: 'File too large (max 50MB)',
          });
        }

        results.push({
          path: relativePath,
          status: 'error',
          error: 'File too large (max 50MB)',
        });
        failed++;
        continue;
      }

      try {
        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Calculate file hash
        const fileHash = calculateFileHash(buffer);

        // Create folder sync file record
        const syncFile = await createFolderSyncFile({
          folderSyncId: folderSync.id,
          relativePath,
          filename: file.name,
          fileSize: file.size,
          fileHash,
          lastModified: file.lastModified,
        });

        // Ingest the document
        const doc = await ingestDocument(buffer, file.name, user.email, {
          categoryIds,
          isGlobal,
          mimeType: file.type,
        });

        // Update document with folder sync metadata
        await updateDocumentFolderSync(doc.id, folderSync.id, relativePath);

        // Update sync file record
        await updateFolderSyncFile(syncFile.id, {
          documentId: parseInt(doc.id),
          status: 'synced',
          syncedAt: new Date().toISOString(),
        });

        results.push({
          path: relativePath,
          status: 'success',
          documentId: doc.id,
          filename: doc.filename,
        });
        successful++;
      } catch (error) {
        // Get or create the sync file record
        let syncFile = await getFolderSyncFileByPath(folderSync.id, relativePath);
        if (!syncFile) {
          syncFile = await createFolderSyncFile({
            folderSyncId: folderSync.id,
            relativePath,
            filename: file.name,
            fileSize: file.size,
            lastModified: file.lastModified,
          });
        }

        await updateFolderSyncFile(syncFile.id, {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });

        results.push({
          path: relativePath,
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to process file',
        });
        failed++;
      }
    }

    // Update folder sync totals
    await updateFolderSync(folderSync.id, {
      totalFiles: files.length,
      syncedFiles: successful,
      failedFiles: failed,
      lastSyncedAt: new Date().toISOString(),
      status: failed === files.length ? 'error' : 'active',
    });

    const response: FolderUploadResult = {
      syncId: folderSync.id,
      folderName,
      summary: {
        total: files.length,
        successful,
        failed,
        skipped,
      },
      results,
    };

    // Use appropriate status code
    const status = failed === 0 ? 202 : successful === 0 ? 400 : 207;
    return NextResponse.json(response, { status });
  } catch (error) {
    console.error('Folder upload error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to upload folder',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// Helper to get folder sync file by path (inline to avoid circular dependency)
async function getFolderSyncFileByPath(folderSyncId: string, relativePath: string) {
  const { findFolderSyncFileByPath } = await import('@/lib/db/compat/folder-syncs');
  return findFolderSyncFileByPath(folderSyncId, relativePath);
}
