/**
 * Reindex API Endpoint
 *
 * POST: Start a new reindex job with a different embedding model
 * GET: Get status of currently running or recent reindex jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  createReindexJob,
  runReindexJob,
  getRunningReindexJob,
  getRecentReindexJobs,
  isReindexRunning,
} from '@/lib/reindex-job';
import { EMBEDDING_MODELS } from '@/lib/constants';
import { isProviderConfigured } from '@/lib/provider-helpers';
import type { ApiError } from '@/types';

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

    // Get current running job and recent jobs
    const runningJob = await getRunningReindexJob();
    const recentJobs = await getRecentReindexJobs(10);

    return NextResponse.json({
      isRunning: await isReindexRunning(),
      runningJob,
      recentJobs,
    });
  } catch (error) {
    console.error('Get reindex status error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get reindex status',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
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

    const body = await request.json();
    const { embeddingModel } = body;

    // Validate embedding model
    if (!embeddingModel || typeof embeddingModel !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Embedding model is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Check if model exists
    const modelDef = EMBEDDING_MODELS.find(m => m.id === embeddingModel);
    if (!modelDef) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid embedding model', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Check if model is available
    const modelAvailable = modelDef.local || await isProviderConfigured(modelDef.provider);
    if (!modelAvailable) {
      return NextResponse.json<ApiError>(
        { error: `Provider ${modelDef.provider} is not configured`, code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Check if a reindex is already running
    if (await isReindexRunning()) {
      const runningJob = await getRunningReindexJob();
      return NextResponse.json<ApiError>(
        {
          error: 'A reindex job is already running',
          code: 'INVALID_STATE',
          details: `Job ${runningJob?.id} is currently ${runningJob?.status}`,
        },
        { status: 409 }
      );
    }

    // Create the job
    const job = await createReindexJob(embeddingModel, user.email);

    // Start the job in the background (don't await)
    // Use setImmediate to ensure the response is sent first
    setImmediate(() => {
      runReindexJob(job.id).catch(error => {
        console.error(`[Reindex] Background job ${job.id} failed:`, error);
      });
    });

    return NextResponse.json({
      success: true,
      job,
      message: `Reindex job started. Switching from ${job.previousModel} to ${job.targetModel}`,
    });
  } catch (error) {
    console.error('Start reindex error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to start reindex',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
