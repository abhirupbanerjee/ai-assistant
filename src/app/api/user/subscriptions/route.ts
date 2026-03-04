/**
 * User Subscriptions API
 *
 * GET /api/user/subscriptions
 * Returns the current user's active subscriptions
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getUserByEmail, getUserWithSubscriptions } from '@/lib/db/compat';

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

    // Get subscriptions with full category details
    const userWithSubs = await getUserWithSubscriptions(user.id);
    const subscriptions = userWithSubs?.subscriptions || [];

    // Transform to API format matching UserSubscription type
    const response = subscriptions.map(sub => ({
      categoryId: sub.categoryId,
      categoryName: sub.categoryName,
      categorySlug: sub.categorySlug,
      isActive: sub.isActive,
    }));

    return NextResponse.json({ subscriptions: response });
  } catch (error) {
    console.error('Failed to fetch user subscriptions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
}
