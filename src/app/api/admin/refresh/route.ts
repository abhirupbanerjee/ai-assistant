import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listGlobalDocuments, reindexDocument } from '@/lib/ingest';
import { clearAllCache } from '@/lib/redis';
import { fileExists } from '@/lib/storage';
import { getGlobalDocsDir } from '@/lib/storage';
import path from 'path';
import type { ApiError } from '@/types';

/**
 * POST /api/admin/refresh
 *
 * Clears the Redis cache, then reindexes every document: re-extract from
 * disk, re-chunk, re-embed into Qdrant, and regenerate the per-document
 * summaries. There used to be a ?mode=vector|all parameter dating back to
 * the graph-DB era ("all" also rebuilt the graph); both modes have run
 * identical code since its removal, so the dead parameter was dropped.
 */
export async function POST() {
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

    // Clear Redis cache, then reindex all documents
    await clearAllCache();

    // Get all documents and reindex them
    const documents = await listGlobalDocuments();
    let reindexedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const missingFiles: { id: string; filename: string; filepath: string }[] = [];

    for (const doc of documents) {
      // Pre-check: verify document file exists on disk
      const globalDocsDir = getGlobalDocsDir();
      const filePath = path.join(globalDocsDir, doc.filepath);
      const exists = await fileExists(filePath);
      if (!exists) {
        missingFiles.push({ id: doc.id, filename: doc.filename, filepath: doc.filepath });
        errors.push(`${doc.filename}: Document file not found on disk — skipping reindex`);
        skippedCount++;
        continue;
      }

      try {
        await reindexDocument(doc.id);
        reindexedCount++;
      } catch (error) {
        errors.push(`${doc.filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Report missing files prominently so the admin can clean them up
    const response: Record<string, unknown> = {
      success: true,
      documentsReindexed: reindexedCount,
      totalDocuments: documents.length,
      documentsSkipped: skippedCount,
    };

    if (missingFiles.length > 0) {
      response.missingFiles = missingFiles.map(mf => ({
        id: mf.id,
        filename: mf.filename,
        filepath: mf.filepath,
      }));
      response.missingFilesMessage =
        `${missingFiles.length} document(s) have no file on disk. ` +
        `These records cannot be reindexed until the files are restored or the records are deleted from the database.`;
    }

    if (errors.length > 0) {
      response.errors = errors.slice(0, 20); // Limit errors to 20 to avoid huge responses
      if (errors.length > 20) {
        response.truncatedErrors = errors.length - 20;
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Refresh error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to refresh',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
