/**
 * Super User - Category Management API
 *
 * GET    /api/superuser/categories - List super user's assigned categories
 * POST   /api/superuser/categories - Create a new category
 * DELETE /api/superuser/categories - Delete a category (only if created by this super user)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import {
  createCategory,
  getCategoryById,
  getCreatedCategoriesCount,
  isCategoryCreatedBy,
  deleteCategoryWithRelatedData,
} from '@/lib/db/categories';
import { assignCategoryToSuperUser, getSuperUserWithAssignments } from '@/lib/db/users';
import { getSuperuserSettings } from '@/lib/db/config';
import { deleteDocument } from '@/lib/ingest';
import { getDocumentById } from '@/lib/db/documents';
import { deleteCategoryCollection } from '@/lib/chroma';

// GET - List super user's assigned categories
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const superUserData = getSuperUserWithAssignments(userId);
    const categories = (superUserData?.assignedCategories || []).map(c => ({
      id: c.categoryId,
      name: c.categoryName,
      slug: c.categorySlug,
    }));

    return NextResponse.json({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}

// POST - Create a new category
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }

    if (name.trim().length > 100) {
      return NextResponse.json({ error: 'Category name must be 100 characters or less' }, { status: 400 });
    }

    // Check category limit
    const settings = getSuperuserSettings();
    const currentCount = getCreatedCategoriesCount(user.email);

    if (currentCount >= settings.maxCategoriesPerSuperuser) {
      return NextResponse.json(
        {
          error: `Category limit reached. You can create up to ${settings.maxCategoriesPerSuperuser} categories.`,
          currentCount,
          limit: settings.maxCategoriesPerSuperuser,
        },
        { status: 403 }
      );
    }

    // Create the category
    const category = createCategory({
      name: name.trim(),
      description: description?.trim() || undefined,
      createdBy: user.email,
    });

    // Auto-assign the category to the superuser
    assignCategoryToSuperUser(userId, category.id, user.email);

    return NextResponse.json({
      success: true,
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        createdBy: category.created_by,
        createdAt: category.created_at,
      },
      quota: {
        used: currentCount + 1,
        limit: settings.maxCategoriesPerSuperuser,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating category:', error);
    if (error instanceof Error && error.message.includes('already exists')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}

// DELETE - Delete a category (only if created by this super user)
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const categoryId = parseInt(searchParams.get('categoryId') || '', 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    // Verify the category exists
    const category = getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Verify the superuser created this category
    if (!isCategoryCreatedBy(categoryId, user.email)) {
      return NextResponse.json(
        { error: 'You can only delete categories you created' },
        { status: 403 }
      );
    }

    // Delete category and get document IDs for cleanup
    const { documentIds, deleted } = deleteCategoryWithRelatedData(categoryId);

    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
    }

    // Delete documents (files + ChromaDB) - this is async but we'll await each
    let documentsDeleted = 0;
    const deleteErrors: string[] = [];

    for (const docId of documentIds) {
      try {
        const doc = getDocumentById(docId);
        if (doc) {
          await deleteDocument(docId.toString());
          documentsDeleted++;
        }
      } catch (err) {
        console.error(`Error deleting document ${docId}:`, err);
        deleteErrors.push(`Document ${docId}`);
      }
    }

    // Clean up ChromaDB collection for this category
    await deleteCategoryCollection(category.slug);

    return NextResponse.json({
      success: true,
      deleted: {
        categoryId,
        categoryName: category.name,
        documentsDeleted,
        deleteErrors: deleteErrors.length > 0 ? deleteErrors : undefined,
      },
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
}
