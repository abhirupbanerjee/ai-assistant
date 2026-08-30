/**
 * Thread Share API
 *
 * POST - Create a direct, recipient-owned copy of a thread (organization-scoped).
 * GET  - List legacy public-link shares and direct-share history for a thread.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getUserByEmail,
  getThreadById,
  userOwnsThread,
  evaluateDirectThreadShareEligibility,
  createDirectShareCopy,
  getDirectSharesForThread,
} from '@/lib/db/compat';
import { canRoleShare } from '@/lib/tools/share-thread';
import { isToolEnabled } from '@/lib/tools';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

/**
 * GET /api/threads/[threadId]/share
 * List all shares for a thread (owner only), plus direct-share history.
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

    if (!(await isToolEnabled('share_thread'))) {
      return NextResponse.json<ApiError>(
        { error: 'Thread sharing is disabled', code: 'NOT_CONFIGURED' },
        { status: 403 }
      );
    }

    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const thread = await getThreadById(threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (!(await userOwnsThread(dbUser.id, threadId)) && dbUser.role !== 'admin' && dbUser.role !== 'super_admin') {
      return NextResponse.json<ApiError>(
        { error: 'Access denied', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    const directShares = await getDirectSharesForThread(threadId);

    return NextResponse.json({
      directShares,
      canShare: await canRoleShare(dbUser.role),
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
 *
 * Create a direct share: the recipient receives their own fully independent copy
 * of the thread (messages, attachments, artifacts, and latest summary). The copy
 * is created only after the recipient is proven eligible.
 *
 * Body: { recipientEmail: string }
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

    if (!(await isToolEnabled('share_thread'))) {
      return NextResponse.json<ApiError>(
        { error: 'Thread sharing is disabled', code: 'NOT_CONFIGURED' },
        { status: 403 }
      );
    }

    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Role gate — awaited so the async check is actually enforced.
    if (!(await canRoleShare(dbUser.role))) {
      return NextResponse.json<ApiError>(
        { error: 'Your role is not permitted to share threads', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    const thread = await getThreadById(threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (!(await userOwnsThread(dbUser.id, threadId)) && dbUser.role !== 'admin' && dbUser.role !== 'super_admin') {
      return NextResponse.json<ApiError>(
        { error: 'Access denied', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    let body: { recipientEmail?: string };
    try {
      body = (await request.json()) as { recipientEmail?: string };
    } catch {
      body = {};
    }

    const recipientEmail = typeof body.recipientEmail === 'string' ? body.recipientEmail.trim() : '';
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return NextResponse.json<ApiError>(
        { error: 'A valid recipient email is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Server-side eligibility (shareability pre-check + recipient eligibility).
    const eligibility = await evaluateDirectThreadShareEligibility({
      sourceThreadId: threadId,
      sharedByUserId: dbUser.id,
      recipientEmail,
    });

    if (!eligibility.ok) {
      // Source-thread shareability failures are safe to reveal to the owner;
      // recipient eligibility failures are generic for privacy.
      return NextResponse.json<ApiError>(
        { error: eligibility.message, code: eligibility.code },
        { status: 422 }
      );
    }

    // Idempotency: return the existing copy rather than silently duplicating.
    const existing = (await getDirectSharesForThread(threadId)).find(
      (s) => s.sharedWithUserId === eligibility.recipient.id
    );
    if (existing) {
      return NextResponse.json({
        share: {
          id: existing.id,
          recipientThreadId: existing.recipientThreadId,
          recipientEmail,
          status: 'active',
          sharedAt: existing.createdAt,
        },
      });
    }

    const { recipientThreadId, shareId } = await createDirectShareCopy({
      sourceThreadId: threadId,
      sharedByUserId: dbUser.id,
      sharedByName: dbUser.name || user.name || user.email,
      recipientUserId: eligibility.recipient.id,
      recipientEmail: eligibility.recipient.email,
      organizationId: eligibility.organizationId,
      categoryIds: eligibility.categoryIds,
      selectedModel: eligibility.selectedModel,
    });

    return NextResponse.json(
      {
        share: {
          id: shareId,
          recipientThreadId,
          recipientEmail,
          status: 'active',
          sharedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create direct share error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to share thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
