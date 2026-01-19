import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { toggleThreadPin } from '@/lib/threads';
import type { Thread, ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;
    const thread = await toggleThreadPin(user.id, threadId);

    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json<Thread>(thread);
  } catch (error) {
    console.error('Toggle pin error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to toggle pin', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
