/**
 * Current User API
 *
 * GET /api/auth/me
 * Returns the current authenticated user's information including role
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { resolveUserMembership } from '@/lib/org-membership';
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

    // Include the organization membership role so the admin dashboard can
    // admit BYOK `org_admin` users whose global role is `user`.
    const membership = await resolveUserMembership(user);

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role || 'user',
      isAdmin: user.isAdmin,
      isSuperAdmin: user.isSuperAdmin || false,
      membershipRole: membership.membershipRole,
      organizationId: membership.organizationId,
    });
  } catch (error) {
    console.error('Failed to get current user:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get user info', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
