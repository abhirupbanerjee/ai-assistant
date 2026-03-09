/**
 * Admin Super User Categories API
 *
 * POST   /api/admin/super-users/[userId]/categories - Assign category to super user
 * DELETE /api/admin/super-users/[userId]/categories - Remove category from super user
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getUserById, assignCategoryToSuperUser, removeCategoryFromSuperUser, replaceSuperUserCategories, getCategoryById } from '@/lib/db/compat';

interface RouteParams {
  params: Promise<{ userId: string }>;
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

    if (user.role !== 'superuser') {
      return NextResponse.json(
        { error: 'User is not a super user' },
        { status: 400 }
      );
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

    const assigned = await assignCategoryToSuperUser(userIdNum, categoryId, admin.email);

    if (!assigned) {
      return NextResponse.json(
        { error: 'Category already assigned to this user' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      assignment: {
        userId: userIdNum,
        categoryId,
        categoryName: category.name,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error assigning category:', error);
    return NextResponse.json(
      { error: 'Failed to assign category' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
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

    if (user.role !== 'superuser') {
      return NextResponse.json(
        { error: 'User is not a super user' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { categoryIds } = body;

    if (!Array.isArray(categoryIds) || !categoryIds.every((id: unknown) => typeof id === 'number')) {
      return NextResponse.json(
        { error: 'categoryIds must be an array of numbers' },
        { status: 400 }
      );
    }

    for (const catId of categoryIds) {
      const cat = await getCategoryById(catId);
      if (!cat) {
        return NextResponse.json({ error: `Category ${catId} not found` }, { status: 400 });
      }
    }

    await replaceSuperUserCategories(userIdNum, categoryIds, admin.email);

    return NextResponse.json({ success: true, categoryIds });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error replacing categories:', error);
    return NextResponse.json(
      { error: 'Failed to replace categories' },
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

    const removed = await removeCategoryFromSuperUser(userIdNum, categoryId);

    if (!removed) {
      return NextResponse.json(
        { error: 'Category was not assigned to this user' },
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

    console.error('Error removing category assignment:', error);
    return NextResponse.json(
      { error: 'Failed to remove category assignment' },
      { status: 500 }
    );
  }
}
