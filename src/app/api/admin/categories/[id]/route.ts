/**
 * Admin Category API - Individual Category Operations
 *
 * GET    /api/admin/categories/[id] - Get category details
 * PUT    /api/admin/categories/[id] - Update category
 * DELETE /api/admin/categories/[id] - Delete category
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getCategoryById,
  updateCategory,
  deleteCategory,
  getSuperUsersForCategory,
  getSubscribersForCategory,
  getCategoryDocumentCount,
} from '@/lib/db/categories';
import { getVectorStore, getCollectionNames } from '@/lib/vector-store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
    }

    const category = getCategoryById(categoryId);

    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Get additional details
    const superUsers = getSuperUsersForCategory(categoryId);
    const subscribers = getSubscribersForCategory(categoryId, false);
    const documentCount = getCategoryDocumentCount(categoryId);

    return NextResponse.json({
      category,
      superUsers,
      subscribers,
      documentCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching category:', error);
    return NextResponse.json(
      { error: 'Failed to fetch category' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
    }

    const existing = getCategoryById(categoryId);
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, description } = body;

    const updates: { name?: string; description?: string } = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Category name cannot be empty' },
          { status: 400 }
        );
      }
      updates.name = name.trim();
    }

    if (description !== undefined) {
      updates.description = description?.trim() || '';
    }

    const category = updateCategory(categoryId, updates);

    return NextResponse.json({ category });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    if (error instanceof Error && error.message.includes('already exists')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    console.error('Error updating category:', error);
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
    }

    const existing = getCategoryById(categoryId);
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Get document count before deletion (they will become unassigned)
    const documentCount = getCategoryDocumentCount(categoryId);

    const deleted = deleteCategory(categoryId);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete category' },
        { status: 500 }
      );
    }

    // Clean up vector store collection for this category
    const store = await getVectorStore();
    const collNames = getCollectionNames();
    await store.deleteCollection(collNames.forCategory(existing.slug));

    return NextResponse.json({
      success: true,
      deleted: {
        id: categoryId,
        name: existing.name,
        documentsUnassigned: documentCount,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error deleting category:', error);
    return NextResponse.json(
      { error: 'Failed to delete category' },
      { status: 500 }
    );
  }
}
