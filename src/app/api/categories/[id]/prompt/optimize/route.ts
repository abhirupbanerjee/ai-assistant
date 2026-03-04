/**
 * Category Prompt Optimization API
 *
 * POST /api/categories/[id]/prompt/optimize
 *
 * Uses LLM to analyze and optimize category prompt addendums
 * by removing redundancies with the global system prompt.
 *
 * Both admins and super users can access this endpoint.
 * Super users can only optimize categories they are assigned to.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCategoryById, getUserByEmail, superUserHasCategory, getSystemPrompt } from '@/lib/db/compat';
import { optimizeCategoryPrompt, OptimizationResult } from '@/lib/prompt-optimizer';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Check if user has permission to optimize category prompts
 */
async function checkCategoryAccess(categoryId: number): Promise<void> {
  const authUser = await requireAuth();

  const dbUser = await getUserByEmail(authUser.email);
  if (!dbUser) {
    throw new Error('User not found');
  }

  const isAdmin = dbUser.role === 'admin';
  const isSuperUser = dbUser.role === 'superuser';

  // Admins can access all categories
  if (isAdmin) {
    return;
  }

  // Super users can only access their assigned categories
  if (isSuperUser) {
    const hasAccess = await superUserHasCategory(dbUser.id, categoryId);
    if (!hasAccess) {
      throw new Error('No access to this category');
    }
    return;
  }

  // Regular users cannot access this endpoint
  throw new Error('Admin or super user access required');
}

/**
 * POST /api/categories/[id]/prompt/optimize
 *
 * Body: { categoryAddendum: string }
 *
 * Returns optimized prompt with diff information.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse<OptimizationResult | { error: string }>> {
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

    const body = await request.json();
    const { categoryAddendum } = body;

    if (typeof categoryAddendum !== 'string') {
      return NextResponse.json(
        { error: 'categoryAddendum must be a string' },
        { status: 400 }
      );
    }

    // Get global prompt for context
    const globalPrompt = await getSystemPrompt();

    // Run optimization
    const result = await optimizeCategoryPrompt(globalPrompt, categoryAddendum);

    return NextResponse.json(result);
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

    console.error('Error optimizing category prompt:', error);
    return NextResponse.json(
      { error: 'Failed to optimize category prompt' },
      { status: 500 }
    );
  }
}
