/**
 * User Subscriptions API
 *
 * GET /api/user/subscriptions
 * Returns the current user's effective subscriptions based on role:
 * - Admin: all categories (treated as active subscriptions)
 * - Superuser: assigned categories + subscribed categories
 * - Regular user: subscribed categories
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  getUserByEmail,
  getUserWithSubscriptions,
  getAllCategories,
  getCategoriesForSuperUser,
} from '@/lib/db/compat';

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

    let response;

    switch (user.role) {
      case 'admin': {
        // Admins can access all categories — treat them as active subscriptions
        const categories = await getAllCategories();
        response = categories.map((cat) => ({
          categoryId: cat.id,
          categoryName: cat.name,
          categorySlug: cat.slug,
          isActive: true,
        }));
        break;
      }

      case 'superuser': {
        // Super users can access their assigned categories + subscribed categories
        const categories = await getCategoriesForSuperUser(user.id);
        response = categories.map((cat) => ({
          categoryId: cat.id,
          categoryName: cat.name,
          categorySlug: cat.slug,
          isActive: true,
        }));
        break;
      }

      case 'user':
      default: {
        // Regular users can access their subscribed categories
        const userWithSubs = await getUserWithSubscriptions(user.id);
        response =
          userWithSubs?.subscriptions.map((sub) => ({
            categoryId: sub.categoryId,
            categoryName: sub.categoryName,
            categorySlug: sub.categorySlug,
            isActive: sub.isActive,
          })) || [];
        break;
      }
    }

    return NextResponse.json({ subscriptions: response });
  } catch (error) {
    console.error('Failed to fetch user subscriptions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
}
