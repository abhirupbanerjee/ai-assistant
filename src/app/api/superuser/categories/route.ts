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
  getDocumentIdsForCategory,
  assignCategoryToSuperUser,
  getSuperUserWithAssignments,
  getSuperuserSettings,
} from '@/lib/db/compat';
import { deleteDocument } from '@/lib/ingest';
import { getDocumentById, getDocumentCategories } from '@/lib/db/compat';
import { getVectorStore, getCollectionNames } from '@/lib/vector-store';
import { invalidateCategoryCache } from '@/lib/redis';

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

    const superUserData = await getSuperUserWithAssignments(userId);
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
    const settings = await getSuperuserSettings();
    const currentCount = await getCreatedCategoriesCount(user.email);

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
    const category = await createCategory({
      name: name.trim(),
      description: description?.trim() || undefined,
      createdBy: user.email,
    });

    // Auto-assign the category to the superuser
    await assignCategoryToSuperUser(userId, category.id, user.email);

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
    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Verify the superuser created this category
    if (!(await isCategoryCreatedBy(categoryId, user.email))) {
      return NextResponse.json(
        { error: 'You can only delete categories you created' },
        { status: 403 }
      );
    }

    // 1. Get documents and check their other categories BEFORE deletion
    const categoryDocIds = await getDocumentIdsForCategory(categoryId);
    const docsToDelete: number[] = [];

    for (const docId of categoryDocIds) {
      const docCategoryIds = await getDocumentCategories(docId);
      const otherCategories = docCategoryIds.filter(catId => catId !== categoryId);

      if (otherCategories.length === 0) {
        // Document has no other categories - mark for deletion
        docsToDelete.push(docId);
      }
    }

    // 2. Delete category and all associations
    const { deleted } = await deleteCategoryWithRelatedData(categoryId);

    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
    }

    // 3. Delete documents that had no other categories
    const deleteErrors: string[] = [];
    for (const docId of docsToDelete) {
      try {
        const doc = await getDocumentById(docId);
        if (doc) {
          await deleteDocument(docId.toString());
        }
      } catch (err) {
        console.error(`Error deleting document ${docId}:`, err);
        deleteErrors.push(`Document ${docId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // 4. Delete vector store collection for this category
    const store = await getVectorStore();
    const collNames = getCollectionNames();
    await store.deleteCollection(collNames.forCategory(category.slug));

    // 5. Invalidate Redis cache
    await invalidateCategoryCache(category.slug);

    return NextResponse.json({
      success: true,
      deleted: {
        categoryId,
        categoryName: category.name,
        documentsDeleted: docsToDelete.length,
        documentsKept: categoryDocIds.length - docsToDelete.length,
        deleteErrors: deleteErrors.length > 0 ? deleteErrors : undefined,
      },
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
}
