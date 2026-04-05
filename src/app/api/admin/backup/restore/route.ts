import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  restoreBackup,
  validateBackupFile,
  getBackupContents,
  type RestoreOptions,
} from '@/lib/backup';
import type { ApiError } from '@/types';

// Route segment config for large backup file uploads (up to 500MB)
export const runtime = 'nodejs';
export const maxDuration = 1800; // 30 minutes — must be static literal (Next.js 16 requirement)

/**
 * POST /api/admin/backup/restore
 * Restore from a backup ZIP file
 */
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

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiError>(
        { error: 'No backup file provided', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Check file type
    if (!file.name.endsWith('.zip')) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid file type. Please upload a .zip backup file', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Get restore options from form data
    const options: RestoreOptions = {
      clearExisting: formData.get('clearExisting') === 'true',
      restoreDocuments: formData.get('restoreDocuments') !== 'false',
      restoreDocumentFiles: formData.get('restoreDocumentFiles') !== 'false',
      restoreCategories: formData.get('restoreCategories') !== 'false',
      restoreSettings: formData.get('restoreSettings') !== 'false',
      restoreUsers: formData.get('restoreUsers') !== 'false',
      restoreThreads: formData.get('restoreThreads') === 'true',
      restoreTools: formData.get('restoreTools') !== 'false',
      restoreSkills: formData.get('restoreSkills') !== 'false',
      restoreCategoryPrompts: formData.get('restoreCategoryPrompts') !== 'false',
      restoreDataSources: formData.get('restoreDataSources') !== 'false',
      refreshVectorDb: formData.get('refreshVectorDb') === 'true',
      // NEW restore options
      restoreWorkspaces: formData.get('restoreWorkspaces') !== 'false',
      restoreFunctionApis: formData.get('restoreFunctionApis') !== 'false',
      restoreUserMemories: formData.get('restoreUserMemories') !== 'false',
      restoreToolRouting: formData.get('restoreToolRouting') !== 'false',
      restoreThreadShares: formData.get('restoreThreadShares') === 'true',
      restoreAgentBots: formData.get('restoreAgentBots') !== 'false',
    };

    // Read file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate backup file
    const validation = validateBackupFile(buffer);
    if (!validation.valid) {
      return NextResponse.json<ApiError>(
        { error: validation.error || 'Invalid backup file', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Restore backup
    const result = await restoreBackup(buffer, options);

    // Trigger vector DB refresh if requested and restore was successful
    if (result.success && options.refreshVectorDb) {
      try {
        // Call the refresh endpoint
        const refreshResponse = await fetch(new URL('/api/admin/refresh', request.url), {
          method: 'POST',
          headers: {
            'Cookie': request.headers.get('cookie') || '',
          },
        });

        if (!refreshResponse.ok) {
          result.warnings.push('Vector DB refresh failed - you may need to manually trigger it from the admin dashboard');
        } else {
          result.warnings.push('Vector DB refresh initiated - this may take a few minutes to complete');
        }
      } catch {
        result.warnings.push('Vector DB refresh could not be initiated - please refresh manually');
      }
    }

    if (!result.success) {
      return NextResponse.json<ApiError>(
        { error: result.message, code: 'SERVICE_ERROR' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      details: result.details,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error('Restore error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to restore backup',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/backup/restore?validate=true
 * Validate a backup file and return its contents
 * Used to preview what will be restored before actually restoring
 */
export async function PUT(request: NextRequest) {
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

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiError>(
        { error: 'No backup file provided', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Read file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate and get contents
    const validation = validateBackupFile(buffer);
    if (!validation.valid) {
      return NextResponse.json<ApiError>(
        { error: validation.error || 'Invalid backup file', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const manifest = getBackupContents(buffer);

    return NextResponse.json({
      valid: true,
      manifest,
    });
  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to validate backup file',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
