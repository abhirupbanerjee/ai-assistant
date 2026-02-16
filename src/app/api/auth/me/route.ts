/**
 * Current User API
 *
 * GET /api/auth/me
 * Returns the current authenticated user's information including role
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
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

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role || 'user',
      isAdmin: user.isAdmin,
    });
  } catch (error) {
    console.error('Failed to get current user:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get user info', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
