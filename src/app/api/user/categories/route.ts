/**
 * User Categories API
 *
 * GET /api/user/categories
 * Returns categories available to the current user based on their role:
 * - Admin: All categories
 * - Super User: Assigned categories
 * - Regular User: Subscribed categories
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getUserByEmail } from '@/lib/db/compat';
import { getAllCategories, getCategoriesForUser, getCategoriesForSuperUser } from '@/lib/db/compat';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    let categories;

    switch (user.role) {
      case 'admin':
        // Admins can access all categories
        categories = await getAllCategories();
        break;

      case 'superuser':
        // Super users can access their assigned categories
        categories = await getCategoriesForSuperUser(user.id);
        break;

      case 'user':
      default:
        // Regular users can access their subscribed categories
        categories = await getCategoriesForUser(user.id);
        break;
    }

    // Transform to API format
    const response = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description || undefined,
    }));

    return NextResponse.json({ categories: response });
  } catch (error) {
    console.error('Failed to fetch user categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
