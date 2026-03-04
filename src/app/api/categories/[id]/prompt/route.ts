/**
 * Category Prompt API
 *
 * GET    /api/categories/[id]/prompt - Get category prompt info (admin/superuser)
 * PUT    /api/categories/[id]/prompt - Update category prompt (admin/superuser)
 * DELETE /api/categories/[id]/prompt - Reset to global prompt (admin/superuser)
 *
 * Both admins and super users can access this endpoint.
 * Super users can only edit categories they are assigned to.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCategoryById, getCategorySlugsByIds, getUserByEmail, superUserHasCategory, getSystemPrompt } from '@/lib/db/compat';
import {
  getCategoryPrompt,
  setCategoryPrompt,
  deleteCategoryPrompt,
  getPromptCharacterInfo,
  validatePromptAddendum,
  validateStarterPrompts,
  setCategoryStarterPrompts,
  setCategoryWelcome,
  getResolvedSystemPrompt,
  getMaxStarterPrompts,
  getMaxStarterLabelLength,
  getMaxStarterPromptLength,
  MAX_COMBINED_PROMPT_LENGTH,
  StarterPrompt,
} from '@/lib/db/compat/category-prompts';
import { invalidateCategoryCache } from '@/lib/redis';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Check if user has permission to access/edit category prompts
 * Returns user info or throws error
 */
async function checkCategoryAccess(categoryId: number): Promise<{
  user: { email: string; isAdmin: boolean };
  canEdit: boolean;
}> {
  const authUser = await requireAuth();

  const dbUser = await getUserByEmail(authUser.email);
  if (!dbUser) {
    throw new Error('User not found');
  }

  const isAdmin = dbUser.role === 'admin';
  const isSuperUser = dbUser.role === 'superuser';

  // Admins can access all categories
  if (isAdmin) {
    return {
      user: { email: authUser.email, isAdmin: true },
      canEdit: true,
    };
  }

  // Super users can only access their assigned categories
  if (isSuperUser) {
    const hasAccess = await superUserHasCategory(dbUser.id, categoryId);
    if (!hasAccess) {
      throw new Error('No access to this category');
    }
    return {
      user: { email: authUser.email, isAdmin: false },
      canEdit: true,
    };
  }

  // Regular users cannot access this endpoint
  throw new Error('Admin or super user access required');
}

/**
 * GET /api/categories/[id]/prompt
 *
 * Returns:
 * - globalPrompt: The global system prompt (read-only for super users)
 * - categoryAddendum: The category-specific addendum (editable)
 * - combinedPrompt: The merged prompt (read-only preview)
 * - charInfo: Character counts and limits
 * - isAdmin: Whether user is admin (can edit global prompt)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
    }

    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const { user } = await checkCategoryAccess(categoryId);

    // Get prompt data
    const globalPrompt = await getSystemPrompt();
    const categoryPrompt = await getCategoryPrompt(categoryId);
    const combinedPrompt = await getResolvedSystemPrompt(categoryId);
    const charInfo = await getPromptCharacterInfo(categoryId);

    return NextResponse.json({
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
      },
      globalPrompt,
      categoryAddendum: categoryPrompt?.promptAddendum || '',
      starterPrompts: categoryPrompt?.starterPrompts || [],
      starterLimits: {
        maxStarters: await getMaxStarterPrompts(),
        maxLabelLength: await getMaxStarterLabelLength(),
        maxPromptLength: await getMaxStarterPromptLength(),
      },
      welcomeTitle: categoryPrompt?.welcomeTitle || '',
      welcomeMessage: categoryPrompt?.welcomeMessage || '',
      combinedPrompt,
      charInfo: {
        globalLength: charInfo.globalLength,
        categoryLength: charInfo.categoryLength,
        combinedLength: charInfo.combinedLength,
        availableForCategory: charInfo.availableForCategory,
        maxCombined: MAX_COMBINED_PROMPT_LENGTH,
      },
      metadata: categoryPrompt
        ? {
            updatedAt: categoryPrompt.updatedAt,
            updatedBy: categoryPrompt.updatedBy,
          }
        : null,
      isAdmin: user.isAdmin,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (
        error.message === 'Admin or super user access required' ||
        error.message === 'No access to this category'
      ) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }

    console.error('Error fetching category prompt:', error);
    return NextResponse.json(
      { error: 'Failed to fetch category prompt' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/categories/[id]/prompt
 *
 * Body: { promptAddendum: string }
 *
 * Updates the category-specific prompt addendum.
 * Validates against forbidden phrases and character limits.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
    }

    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const { user } = await checkCategoryAccess(categoryId);

    const body = await request.json();
    const { promptAddendum, starterPrompts, welcomeTitle, welcomeMessage } = body;

    // Handle welcome messages if provided
    if (welcomeTitle !== undefined || welcomeMessage !== undefined) {
      const title = welcomeTitle === '' ? null : (welcomeTitle || null);
      const message = welcomeMessage === '' ? null : (welcomeMessage || null);

      // Validate lengths
      if (title && title.length > 50) {
        return NextResponse.json(
          { error: 'Welcome title exceeds 50 characters' },
          { status: 400 }
        );
      }
      if (message && message.length > 200) {
        return NextResponse.json(
          { error: 'Welcome message exceeds 200 characters' },
          { status: 400 }
        );
      }

      await setCategoryWelcome(categoryId, title, message, user.email);
    }

    // Handle starterPrompts if provided (can be independent of promptAddendum)
    if (starterPrompts !== undefined) {
      if (starterPrompts === null || (Array.isArray(starterPrompts) && starterPrompts.length === 0)) {
        // Clear starters
        await setCategoryStarterPrompts(categoryId, null, user.email);
      } else if (Array.isArray(starterPrompts)) {
        // Validate and save
        const starterErrors = await validateStarterPrompts(starterPrompts as StarterPrompt[]);
        if (starterErrors.length > 0) {
          return NextResponse.json(
            { error: 'Starter prompts validation failed', details: starterErrors },
            { status: 400 }
          );
        }
        await setCategoryStarterPrompts(categoryId, starterPrompts as StarterPrompt[], user.email);
      } else {
        return NextResponse.json(
          { error: 'starterPrompts must be an array or null' },
          { status: 400 }
        );
      }
    }

    // If only starterPrompts was provided (no promptAddendum), return updated data
    if (promptAddendum === undefined) {
      const updatedPrompt = await getCategoryPrompt(categoryId);
      const charInfo = await getPromptCharacterInfo(categoryId);

      // Invalidate cache
      const [slug] = await getCategorySlugsByIds([categoryId]);
      if (slug) {
        await invalidateCategoryCache(slug);
      }

      return NextResponse.json({
        success: true,
        categoryAddendum: updatedPrompt?.promptAddendum || '',
        starterPrompts: updatedPrompt?.starterPrompts || [],
        combinedPrompt: await getResolvedSystemPrompt(categoryId),
        charInfo: {
          globalLength: charInfo.globalLength,
          categoryLength: charInfo.categoryLength,
          combinedLength: charInfo.combinedLength,
          availableForCategory: charInfo.availableForCategory,
          maxCombined: MAX_COMBINED_PROMPT_LENGTH,
        },
        metadata: updatedPrompt
          ? {
              updatedAt: updatedPrompt.updatedAt,
              updatedBy: updatedPrompt.updatedBy,
            }
          : null,
      });
    }

    if (typeof promptAddendum !== 'string') {
      return NextResponse.json(
        { error: 'promptAddendum must be a string' },
        { status: 400 }
      );
    }

    // If empty string, treat as delete (reset to global)
    if (promptAddendum.trim() === '') {
      const deleted = await deleteCategoryPrompt(categoryId);

      // Invalidate cache
      const [slug] = await getCategorySlugsByIds([categoryId]);
      if (slug) {
        await invalidateCategoryCache(slug);
      }

      return NextResponse.json({
        success: true,
        deleted: deleted,
        message: 'Category prompt reset to global default',
      });
    }

    // Validate content
    const errors = await validatePromptAddendum(promptAddendum);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Validation failed', details: errors },
        { status: 400 }
      );
    }

    // Save the prompt
    const saved = await setCategoryPrompt(categoryId, promptAddendum.trim(), user.email);

    // Invalidate cache
    const [slug] = await getCategorySlugsByIds([categoryId]);
    if (slug) {
      await invalidateCategoryCache(slug);
    }

    // Get updated character info
    const charInfo = await getPromptCharacterInfo(categoryId);

    return NextResponse.json({
      success: true,
      categoryAddendum: saved.promptAddendum,
      starterPrompts: saved.starterPrompts || [],
      combinedPrompt: await getResolvedSystemPrompt(categoryId),
      charInfo: {
        globalLength: charInfo.globalLength,
        categoryLength: charInfo.categoryLength,
        combinedLength: charInfo.combinedLength,
        availableForCategory: charInfo.availableForCategory,
        maxCombined: MAX_COMBINED_PROMPT_LENGTH,
      },
      metadata: {
        updatedAt: saved.updatedAt,
        updatedBy: saved.updatedBy,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (
        error.message === 'Admin or super user access required' ||
        error.message === 'No access to this category'
      ) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.message.includes('character limit')) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    console.error('Error updating category prompt:', error);
    return NextResponse.json(
      { error: 'Failed to update category prompt' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/categories/[id]/prompt
 *
 * Removes the category-specific prompt addendum.
 * Category will fall back to using global prompt only.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
    }

    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    await checkCategoryAccess(categoryId);

    const deleted = await deleteCategoryPrompt(categoryId);

    // Invalidate cache
    const [slug] = await getCategorySlugsByIds([categoryId]);
    if (slug) {
      await invalidateCategoryCache(slug);
    }

    return NextResponse.json({
      success: true,
      deleted,
      message: deleted
        ? 'Category prompt removed, using global default'
        : 'No category prompt was set',
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (
        error.message === 'Admin or super user access required' ||
        error.message === 'No access to this category'
      ) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }

    console.error('Error deleting category prompt:', error);
    return NextResponse.json(
      { error: 'Failed to delete category prompt' },
      { status: 500 }
    );
  }
}
