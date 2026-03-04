/**
 * Super User - User Management API
 *
 * GET  /api/superuser/users - Get users subscribed to super user's categories
 * POST /api/superuser/users - Add subscription for a user to one of super user's categories
 *                             (creates user if they don't exist)
 * DELETE /api/superuser/users - Remove subscription from one of super user's categories
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId, addAllowedUser } from '@/lib/users';
import {
  getSuperUserWithAssignments,
  getUsersSubscribedToCategory,
  getUserByEmail as dbGetUserByEmail,
  addSubscription,
  removeSubscription,
  getAllUsers,
} from '@/lib/db/compat';

// GET - Get users the super user can manage (subscribed to their assigned categories)
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

    // Get super user's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData || superUserData.assignedCategories.length === 0) {
      return NextResponse.json({
        assignedCategories: [],
        users: [],
      });
    }

    // Get all users and filter to those subscribed to super user's categories
    const allUsers = await getAllUsers();
    const regularUsers = allUsers.filter(u => u.role === 'user');

    // Build a map of users with their subscriptions to super user's categories
    const usersMap = new Map<number, {
      id: number;
      email: string;
      name: string | null;
      subscriptions: { categoryId: number; categoryName: string; isActive: boolean }[];
    }>();

    for (const category of superUserData.assignedCategories) {
      const subscribedUsers = await getUsersSubscribedToCategory(category.categoryId);

      for (const sub of subscribedUsers) {
        const regularUser = regularUsers.find(u => u.id === sub.userId);
        if (!regularUser) continue;

        if (!usersMap.has(sub.userId)) {
          usersMap.set(sub.userId, {
            id: sub.userId,
            email: regularUser.email,
            name: regularUser.name,
            subscriptions: [],
          });
        }

        const userData = usersMap.get(sub.userId)!;
        userData.subscriptions.push({
          categoryId: category.categoryId,
          categoryName: category.categoryName,
          isActive: sub.isActive,
        });
      }
    }

    return NextResponse.json({
      assignedCategories: superUserData.assignedCategories,
      users: Array.from(usersMap.values()),
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST - Add subscription for a user
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

    const superUserId = await getUserId(user.email);
    if (!superUserId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { userEmail, categoryId, userName } = body;

    if (!userEmail || typeof categoryId !== 'number') {
      return NextResponse.json(
        { error: 'userEmail and categoryId are required' },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Verify super user has access to this category
    const superUserData = await getSuperUserWithAssignments(superUserId);
    if (!superUserData) {
      return NextResponse.json({ error: 'Super user data not found' }, { status: 404 });
    }

    const hasAccess = superUserData.assignedCategories.some(c => c.categoryId === categoryId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to manage this category' },
        { status: 403 }
      );
    }

    // Get or create target user
    let targetUser = await dbGetUserByEmail(userEmail);
    let userCreated = false;

    if (!targetUser) {
      // Create the user with 'user' role
      try {
        await addAllowedUser(userEmail, 'user', user.email, userName || undefined);
        targetUser = await dbGetUserByEmail(userEmail);
        userCreated = true;

        if (!targetUser) {
          return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
        }
      } catch (err) {
        console.error('Error creating user:', err);
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
      }
    }

    if (targetUser.role !== 'user') {
      return NextResponse.json(
        { error: 'Can only manage subscriptions for regular users' },
        { status: 400 }
      );
    }

    // Add subscription
    const added = await addSubscription(targetUser.id, categoryId, user.email);

    if (!added) {
      return NextResponse.json(
        { error: 'User is already subscribed to this category' },
        { status: 409 }
      );
    }

    const category = superUserData.assignedCategories.find(c => c.categoryId === categoryId);

    return NextResponse.json({
      success: true,
      userCreated,
      subscription: {
        userId: targetUser.id,
        userEmail: targetUser.email,
        userName: targetUser.name,
        categoryId,
        categoryName: category?.categoryName,
        isActive: true,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding subscription:', error);
    return NextResponse.json({ error: 'Failed to add subscription' }, { status: 500 });
  }
}

// DELETE - Remove subscription from a user
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

    const superUserId = await getUserId(user.email);
    if (!superUserId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const userEmail = searchParams.get('userEmail');
    const categoryId = parseInt(searchParams.get('categoryId') || '', 10);

    if (!userEmail || isNaN(categoryId)) {
      return NextResponse.json(
        { error: 'userEmail and categoryId are required' },
        { status: 400 }
      );
    }

    // Verify super user has access to this category
    const superUserData = await getSuperUserWithAssignments(superUserId);
    if (!superUserData) {
      return NextResponse.json({ error: 'Super user data not found' }, { status: 404 });
    }

    const hasAccess = superUserData.assignedCategories.some(c => c.categoryId === categoryId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to manage this category' },
        { status: 403 }
      );
    }

    // Get target user
    const targetUser = await dbGetUserByEmail(userEmail);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Remove subscription
    const removed = await removeSubscription(targetUser.id, categoryId);

    if (!removed) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      removed: {
        userId: targetUser.id,
        categoryId,
      },
    });
  } catch (error) {
    console.error('Error removing subscription:', error);
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
  }
}
