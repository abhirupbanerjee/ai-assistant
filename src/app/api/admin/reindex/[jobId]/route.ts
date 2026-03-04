/**
 * Reindex Job Status API Endpoint
 *
 * GET: Get status of a specific reindex job
 * DELETE: Cancel a running reindex job
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getReindexJob, cancelReindexJob } from '@/lib/reindex-job';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
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

    const { jobId } = await params;
    const job = await getReindexJob(jobId);

    if (!job) {
      return NextResponse.json<ApiError>(
        { error: 'Job not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Calculate progress percentage
    const progress = job.totalDocuments > 0
      ? Math.round((job.processedDocuments / job.totalDocuments) * 100)
      : 0;

    return NextResponse.json({
      job,
      progress,
    });
  } catch (error) {
    console.error('Get reindex job error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get job status',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
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

    const { jobId } = await params;
    const job = await getReindexJob(jobId);

    if (!job) {
      return NextResponse.json<ApiError>(
        { error: 'Job not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (job.status !== 'running') {
      return NextResponse.json<ApiError>(
        { error: 'Only running jobs can be cancelled', code: 'INVALID_STATE' },
        { status: 400 }
      );
    }

    const cancelled = await cancelReindexJob(jobId);

    if (!cancelled) {
      return NextResponse.json<ApiError>(
        { error: 'Failed to cancel job', code: 'SERVICE_ERROR' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Job cancellation requested',
    });
  } catch (error) {
    console.error('Cancel reindex job error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to cancel job',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
