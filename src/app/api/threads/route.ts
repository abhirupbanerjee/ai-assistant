import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createThread, listThreads } from '@/lib/threads';
import { getEnabledModel } from '@/lib/db/compat/enabled-models';
import { isAutoSentinel } from '@/lib/auto-model-selector';
import type { Thread, ThreadListResponse, CreateThreadRequest, ApiError } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const allThreads = await listThreads(user.id);
    const paginatedThreads = allThreads.slice(offset, offset + limit);

    return NextResponse.json<ThreadListResponse>({
      threads: paginatedThreads,
      total: allThreads.length,
    });
  } catch (error) {
    console.error('List threads error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to list threads', code: 'SERVICE_ERROR' },
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

    let title: string | undefined;
    let categoryIds: number[] | undefined;
    let selectedModel: string | null | undefined;

    try {
      const body = await request.json() as CreateThreadRequest;
      title = body.title;
      categoryIds = body.categoryIds;
      selectedModel = body.selectedModel;
    } catch {
      // Body is optional
    }

    if (selectedModel !== null && selectedModel !== undefined && !isAutoSentinel(selectedModel)) {
      const model = await getEnabledModel(selectedModel);

      if (!model || !model.enabled) {
        return NextResponse.json<ApiError>(
          {
            error: `Model '${selectedModel}' is not available`,
            code: 'VALIDATION_ERROR',
          },
          { status: 400 }
        );
      }
    }

    const thread = await createThread(user.id, title, categoryIds, selectedModel || null);

    return NextResponse.json<Thread>(thread, { status: 201 });
  } catch (error) {
    console.error('Create thread error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to create thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
