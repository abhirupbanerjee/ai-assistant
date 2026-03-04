/**
 * Admin User Subscriptions API
 *
 * GET    /api/admin/users/[userId]/subscriptions - Get user's subscriptions
 * POST   /api/admin/users/[userId]/subscriptions - Add subscription
 * PUT    /api/admin/users/[userId]/subscriptions - Toggle subscription active status
 * DELETE /api/admin/users/[userId]/subscriptions - Remove subscription
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getUserById,
  getUserWithSubscriptions,
  addSubscription,
  removeSubscription,
  toggleSubscriptionActive,
  getCategoryById,
} from '@/lib/db/compat';

interface RouteParams {
  params: Promise<{ userId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { userId } = await params;
    const userIdNum = parseInt(userId, 10);

    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const userWithSubs = await getUserWithSubscriptions(userIdNum);

    if (!userWithSubs) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: userWithSubs.id,
        email: userWithSubs.email,
        name: userWithSubs.name,
        role: userWithSubs.role,
      },
      subscriptions: userWithSubs.subscriptions,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching subscriptions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();

    const { userId } = await params;
    const userIdNum = parseInt(userId, 10);

    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const user = await getUserById(userIdNum);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { categoryId } = body;

    if (typeof categoryId !== 'number') {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const added = await addSubscription(userIdNum, categoryId, admin.email);

    if (!added) {
      return NextResponse.json(
        { error: 'User is already subscribed to this category' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      subscription: {
        userId: userIdNum,
        categoryId,
        categoryName: category.name,
        isActive: true,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error adding subscription:', error);
    return NextResponse.json(
      { error: 'Failed to add subscription' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { userId } = await params;
    const userIdNum = parseInt(userId, 10);

    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const user = await getUserById(userIdNum);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { categoryId, isActive } = body;

    if (typeof categoryId !== 'number') {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    if (typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'isActive must be a boolean' },
        { status: 400 }
      );
    }

    const updated = await toggleSubscriptionActive(userIdNum, categoryId, isActive);

    if (!updated) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      subscription: {
        userId: userIdNum,
        categoryId,
        isActive,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error updating subscription:', error);
    return NextResponse.json(
      { error: 'Failed to update subscription' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { userId } = await params;
    const userIdNum = parseInt(userId, 10);

    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const user = await getUserById(userIdNum);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const categoryId = parseInt(searchParams.get('categoryId') || '', 10);

    if (isNaN(categoryId)) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    const removed = await removeSubscription(userIdNum, categoryId);

    if (!removed) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      removed: {
        userId: userIdNum,
        categoryId,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error removing subscription:', error);
    return NextResponse.json(
      { error: 'Failed to remove subscription' },
      { status: 500 }
    );
  }
}
