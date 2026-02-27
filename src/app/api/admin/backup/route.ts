import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createBackup, type BackupOptions } from '@/lib/backup';
import type { ApiError } from '@/types';

/**
 * POST /api/admin/backup
 * Create and download a backup ZIP file
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

    // Parse backup options from request body
    const body = await request.json();
    const options: BackupOptions = {
      includeDocuments: body.includeDocuments !== false,
      includeDocumentFiles: body.includeDocumentFiles !== false,
      includeCategories: body.includeCategories !== false,
      includeSettings: body.includeSettings !== false,
      includeUsers: body.includeUsers !== false,
      includeThreads: body.includeThreads === true, // Default false (can be large)
      includeTools: body.includeTools !== false, // Default true
      includeSkills: body.includeSkills !== false, // Default true
      includeCategoryPrompts: body.includeCategoryPrompts !== false, // Default true
      includeDataSources: body.includeDataSources !== false, // Default true
      // NEW backup options
      includeWorkspaces: body.includeWorkspaces !== false, // Default true
      includeFunctionApis: body.includeFunctionApis !== false, // Default true
      includeUserMemories: body.includeUserMemories !== false, // Default true
      includeToolRouting: body.includeToolRouting !== false, // Default true
      includeThreadShares: body.includeThreadShares === true, // Default false
      includeAgentBots: body.includeAgentBots !== false, // Default true
      // Category filter
      categoryFilter: body.categoryFilter ? {
        mode: body.categoryFilter.mode || 'all',
        categoryIds: body.categoryFilter.categoryIds,
      } : undefined,
      // Skill filter (Level 2)
      skillFilter: body.skillFilter ? {
        mode: body.skillFilter.mode || 'all',
        skillIds: body.skillFilter.skillIds,
      } : undefined,
      // Tool filter (Level 3)
      toolFilter: body.toolFilter ? {
        mode: body.toolFilter.mode || 'all',
        toolNames: body.toolFilter.toolNames,
      } : undefined,
    };

    // Create backup
    const { stream, filename } = await createBackup(options, user.email);

    // Convert Node.js stream to Web ReadableStream
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: Buffer) => {
          controller.enqueue(chunk);
        });
        stream.on('end', () => {
          controller.close();
        });
        stream.on('error', (err: Error) => {
          controller.error(err);
        });
      },
    });

    // Return streaming response
    return new Response(webStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Backup error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to create backup',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
