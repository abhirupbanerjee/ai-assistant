/**
 * Shared Thread View API
 * GET - View a shared thread (authenticated users only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getUserByEmail,
  getShareByToken,
  validateShareAccess,
  recordShareView,
  logShareAccess,
  getThreadWithDetails,
  getMessagesForThread,
  getThreadUploads,
  getThreadOutputs,
} from '@/lib/db/compat';
import { isToolEnabled } from '@/lib/tools';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/shared/[token]
 * View a shared thread (requires authentication)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Authentication required to view shared threads', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { token } = await params;

    // Check if share_thread tool is enabled
    if (!(await isToolEnabled('share_thread'))) {
      return NextResponse.json<ApiError>(
        { error: 'Thread sharing is currently disabled', code: 'NOT_CONFIGURED' },
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

    // Get share by token
    const share = await getShareByToken(token);
    if (!share) {
      return NextResponse.json<ApiError>(
        { error: 'Share not found or invalid link', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Validate share access (check if expired or revoked)
    const validationError = validateShareAccess(share);
    if (validationError) {
      return NextResponse.json<ApiError>(
        { error: validationError, code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    // Get thread details
    const thread = await getThreadWithDetails(share.threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get thread messages
    const messages = await getMessagesForThread(share.threadId);

    // Record the view and log access
    await recordShareView(share.id);
    await logShareAccess(share.id, dbUser.id, 'view');

    // Determine if this user is the thread owner or share creator
    const isOwner = thread.user_id === dbUser.id;
    const isShareCreator = share.createdBy === dbUser.id;

    // Build response
    const response = {
      share: {
        id: share.id,
        allowDownload: share.allowDownload,
        expiresAt: share.expiresAt?.toISOString() || null,
        viewCount: share.viewCount + 1, // Include current view
        createdByName: share.createdByName,
        createdAt: share.createdAt.toISOString(),
      },
      thread: {
        id: thread.id,
        title: thread.title,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        messageCount: thread.messageCount,
        categories: thread.categories,
      },
      messages: messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        sources: msg.sources,
        toolCalls: msg.toolCalls,
        toolCallId: msg.toolCallId,
        toolName: msg.toolName,
        generatedDocuments: share.allowDownload ? msg.generatedDocuments : null,
        visualizations: msg.visualizations,
        generatedImages: share.allowDownload ? msg.generatedImages : null,
        createdAt: msg.createdAt.toISOString(),
      })),
      permissions: {
        canDownload: share.allowDownload,
        isOwner,
        isShareCreator,
      },
    };

    // Include uploads and outputs if downloads are allowed
    if (share.allowDownload) {
      const uploads = await getThreadUploads(share.threadId);
      const outputs = await getThreadOutputs(share.threadId);

      return NextResponse.json({
        ...response,
        uploads: uploads.map(u => ({
          id: u.id,
          filename: u.filename,
          fileSize: u.file_size,
          uploadedAt: u.uploaded_at,
        })),
        outputs: outputs.map(o => ({
          id: o.id,
          messageId: o.message_id,  // Include message_id for inline rendering
          filename: o.filename,
          fileType: o.file_type,
          fileSize: o.file_size,
          createdAt: o.created_at,
        })),
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('View shared thread error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to load shared thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
