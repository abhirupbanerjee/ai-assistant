/**
 * Direct share inbox — list shares received by the current user.
 *
 * GET /api/thread-shares/inbox
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getDirectSharesForRecipient } from '@/lib/db/compat';
import type { ApiError } from '@/types';

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const shares = await getDirectSharesForRecipient(dbUser.id);

    return NextResponse.json({ shares });
  } catch (error) {
    console.error('Direct share inbox error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to load shares', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
