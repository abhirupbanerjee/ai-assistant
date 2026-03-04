/**
 * Superuser - Folder Upload API
 * POST /api/superuser/documents/folder - Upload entire folder
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getCategoryById } from '@/lib/db/compat';
import { ingestDocument } from '@/lib/ingest';
import { isSupportedMimeType } from '@/lib/document-extractor';
import {
  createFolderSync,
  createFolderSyncFile,
  updateFolderSync,
  updateFolderSyncFile,
  findFolderSyncFileByPath,
} from '@/lib/db/compat/folder-syncs';
import { updateDocumentFolderSync } from '@/lib/db/compat';
import { calculateFileHash, MAX_FILES_PER_FOLDER, MAX_FILE_SIZE_BYTES } from '@/lib/folder-sync-utils';

interface FolderUploadResult {
  syncId: string;
  folderName: string;
  category: {
    categoryId: number;
    categoryName: string;
  };
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get super user's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData || superUserData.assignedCategories.length === 0) {
      return NextResponse.json(
        { error: 'No categories assigned to you' },
        { status: 403 }
      );
    }

    const formData = await request.formData();

    // Get folder metadata
    const folderName = formData.get('folderName') as string;
    if (!folderName) {
      return NextResponse.json(
        { error: 'Folder name is required' },
        { status: 400 }
      );
    }

    // Get category ID (required for superuser)
    const categoryIdStr = formData.get('categoryId') as string;
    const categoryId = categoryIdStr ? parseInt(categoryIdStr, 10) : null;

    if (!categoryId) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    // Verify super user has access to this category
    const hasAccess = superUserData.assignedCategories.some(c => c.categoryId === categoryId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to upload to this category' },
        { status: 403 }
      );
    }

    // Verify category exists
    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Get all files and their paths
    const files = formData.getAll('files') as File[];
    const paths = formData.getAll('paths') as string[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    if (files.length !== paths.length) {
      return NextResponse.json(
        { error: 'Files and paths count mismatch' },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES_PER_FOLDER) {
      return NextResponse.json(
        { error: `Too many files. Maximum ${MAX_FILES_PER_FOLDER} files per folder.` },
        { status: 400 }
      );
    }

    // Create folder sync record (superuser: single category, no global)
    const folderSync = await createFolderSync({
      folderName,
      originalPath: folderName,
      uploadedBy: user.email,
      categoryIds: [categoryId],
      isGlobal: false,
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
        await createFolderSyncFile({
          folderSyncId: folderSync.id,
          relativePath,
          filename: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
        });

        const syncFile = await findFolderSyncFileByPath(folderSync.id, relativePath);
        if (syncFile) {
          await updateFolderSyncFile(syncFile.id, {
            status: 'skipped',
            errorMessage: 'Unsupported file type',
          });
        }

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

        const syncFile = await findFolderSyncFileByPath(folderSync.id, relativePath);
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

        // Ingest the document (superuser: single category, no global)
        const doc = await ingestDocument(buffer, file.name, user.email, {
          categoryIds: [categoryId],
          isGlobal: false,
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
        let syncFile = await findFolderSyncFileByPath(folderSync.id, relativePath);
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
      category: {
        categoryId: category.id,
        categoryName: category.name,
      },
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
    return NextResponse.json(
      {
        error: 'Failed to upload folder',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
