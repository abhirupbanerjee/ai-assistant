/**
 * Share Management API
 * PATCH - Update share settings
 * DELETE - Revoke share
 * GET - Get share details (owner only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/compat';
import {
  getShareById,
  updateShareSettings,
  revokeShareById,
} from '@/lib/tools/share-thread';
import { getShareAccessLog } from '@/lib/db/compat';
import { isToolEnabled } from '@/lib/tools';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ shareId: string }>;
}

/**
 * GET /api/shares/[shareId]
 * Get share details and access log (owner only)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { shareId } = await params;

    // Get user from database
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get share
    const share = await getShareById(shareId);
    if (!share) {
      return NextResponse.json<ApiError>(
        { error: 'Share not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Only creator or admin can view share details
    if (share.createdBy !== dbUser.id && dbUser.role !== 'admin') {
      return NextResponse.json<ApiError>(
        { error: 'Access denied', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    // Get access log
    const accessLog = await getShareAccessLog(shareId, 50);

    // Build share URL
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';

    return NextResponse.json({
      share: {
        ...share,
        shareUrl: `${baseUrl}/shared/${share.shareToken}`,
      },
      accessLog,
    });
  } catch (error) {
    console.error('Get share error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get share', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/shares/[shareId]
 * Update share settings
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { shareId } = await params;

    // Check if share_thread tool is enabled
    if (!(await isToolEnabled('share_thread'))) {
      return NextResponse.json<ApiError>(
        { error: 'Thread sharing is disabled', code: 'NOT_CONFIGURED' },
        { status: 403 }
      );
    }

    // Get user from database
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get existing share
    const existingShare = await getShareById(shareId);
    if (!existingShare) {
      return NextResponse.json<ApiError>(
        { error: 'Share not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Only creator or admin can update
    if (existingShare.createdBy !== dbUser.id && dbUser.role !== 'admin') {
      return NextResponse.json<ApiError>(
        { error: 'Access denied', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { allowDownload, expiresInDays } = body;

    // Update share
    const updatedShare = await updateShareSettings(shareId, {
      allowDownload,
      expiresInDays,
    });

    if (!updatedShare) {
      return NextResponse.json<ApiError>(
        { error: 'Failed to update share', code: 'SERVICE_ERROR' },
        { status: 500 }
      );
    }

    // Build share URL
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';

    return NextResponse.json({
      success: true,
      share: {
        ...updatedShare,
        shareUrl: `${baseUrl}/shared/${updatedShare.shareToken}`,
      },
    });
  } catch (error) {
    console.error('Update share error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to update share', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/shares/[shareId]
 * Revoke share
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { shareId } = await params;

    // Get user from database
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get existing share
    const existingShare = await getShareById(shareId);
    if (!existingShare) {
      return NextResponse.json<ApiError>(
        { error: 'Share not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Only creator or admin can revoke
    if (existingShare.createdBy !== dbUser.id && dbUser.role !== 'admin') {
      return NextResponse.json<ApiError>(
        { error: 'Access denied', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    // Revoke share
    const revoked = await revokeShareById(shareId);

    if (!revoked) {
      return NextResponse.json<ApiError>(
        { error: 'Failed to revoke share', code: 'SERVICE_ERROR' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Revoke share error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to revoke share', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
