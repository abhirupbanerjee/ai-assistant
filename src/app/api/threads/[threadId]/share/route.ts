/**
 * Thread Share API
 * POST - Create a new share
 * GET - List shares for a thread
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getThreadById, userOwnsThread } from '@/lib/db/compat';
import {
  createShare,
  getSharesForThread,
  canRoleShare,
  isSendEmailAvailable,
  getShareThreadConfig,
} from '@/lib/tools/share-thread';
import { sendShareNotificationEmail } from '@/lib/tools/send-email';
import { isToolEnabled } from '@/lib/tools';
import type { ApiError, CreateShareRequest, ThreadShare } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

/**
 * GET /api/threads/[threadId]/share
 * List all shares for a thread (owner only)
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

    const { threadId } = await params;

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

    // Check thread exists
    const thread = await getThreadById(threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Only owner can view shares (admin can also view)
    if (!(await userOwnsThread(dbUser.id, threadId)) && dbUser.role !== 'admin') {
      return NextResponse.json<ApiError>(
        { error: 'Access denied', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    const shares = await getSharesForThread(threadId);
    const { config } = await getShareThreadConfig();

    // Build share URLs
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const sharesWithUrls = shares.map((share) => ({
      ...share,
      shareUrl: `${baseUrl}/shared/${share.shareToken}`,
    }));

    return NextResponse.json({
      shares: sharesWithUrls,
      canShare: await canRoleShare(dbUser.role),
      sendEmailAvailable: await isSendEmailAvailable(),
      config: {
        defaultExpiryDays: config.defaultExpiryDays,
        allowDownloadsByDefault: config.allowDownloadsByDefault,
        maxSharesPerThread: config.maxSharesPerThread,
      },
    });
  } catch (error) {
    console.error('Get shares error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get shares', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/threads/[threadId]/share
 * Create a new share
 */
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

    // Check if user's role can share
    if (!canRoleShare(dbUser.role)) {
      return NextResponse.json<ApiError>(
        { error: 'Your role is not permitted to share threads', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    // Check thread exists
    const thread = await getThreadById(threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Only owner can share (admin can also share)
    if (!(await userOwnsThread(dbUser.id, threadId)) && dbUser.role !== 'admin') {
      return NextResponse.json<ApiError>(
        { error: 'Access denied', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = (await request.json()) as CreateShareRequest;
    const { allowDownload, expiresInDays, sendEmail, recipientEmail } = body;

    // Create share
    const result = await createShare({
      threadId,
      createdBy: dbUser.id,
      allowDownload,
      expiresInDays,
    });

    if (!result.success || !result.share) {
      return NextResponse.json<ApiError>(
        { error: result.error || 'Failed to create share', code: 'SERVICE_ERROR' },
        { status: 400 }
      );
    }

    const share = result.share;
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/shared/${share.shareToken}`;

    // Send email notification if requested
    let emailSent = false;
    let emailError: string | undefined;

    const sendEmailAvailable = await isSendEmailAvailable();
    console.log('[Share] Email notification request:', {
      sendEmail,
      recipientEmail,
      sendEmailAvailable,
    });

    if (sendEmail && recipientEmail && sendEmailAvailable) {
      console.log('[Share] Sending email notification to:', recipientEmail);
      const emailResult = await sendShareNotificationEmail({
        recipientEmail,
        sharedByName: dbUser.name || user.name || user.email,
        threadTitle: thread.title || 'Untitled conversation',
        shareUrl,
        expiresAt: share.expiresAt,
        allowDownload: share.allowDownload,
      });

      emailSent = emailResult.success;
      if (!emailResult.success) {
        emailError = emailResult.error;
        console.error('[Share] Email notification failed:', emailError);
      } else {
        console.log('[Share] Email notification sent successfully');
      }
    } else if (sendEmail && recipientEmail && !sendEmailAvailable) {
      console.log('[Share] Email requested but send_email tool is not available');
      emailError = 'Email notifications are not configured';
    }

    return NextResponse.json({
      success: true,
      share: {
        ...share,
        shareUrl,
      },
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Create share error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to create share', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
