import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAllowedUsers, addAllowedUser, removeAllowedUser, updateUserRole, getUserId, isRootAdmin } from '@/lib/users';
import {
  addSubscription,
  assignCategoryToSuperUser,
  getUserWithSubscriptions,
  getSuperUserWithAssignments,
  getCategoryById,
} from '@/lib/db/compat';
import type { UserRole } from '@/lib/users';

const VALID_ROLES: UserRole[] = ['admin', 'superuser', 'user'];

// GET /api/admin/users - List all allowed users with their subscriptions/assignments
export async function GET() {
  try {
    await requireAdmin();
    const users = await getAllowedUsers();

    // Enhance users with subscriptions/assignments
    const enhancedUsers = await Promise.all(
      users.map(async (u) => {
        const userId = await getUserId(u.email);
        let subscriptions: { categoryId: number; categoryName: string; isActive: boolean }[] = [];
        let assignedCategories: { categoryId: number; categoryName: string }[] = [];

        if (userId) {
          if (u.role === 'superuser') {
            // Get category assignments (for management access)
            const withAssignments = await getSuperUserWithAssignments(userId);
            assignedCategories = withAssignments?.assignedCategories.map(c => ({
              categoryId: c.categoryId,
              categoryName: c.categoryName,
            })) || [];
            // Also get subscriptions (for read access to other categories)
            const withSubs = await getUserWithSubscriptions(userId);
            subscriptions = withSubs?.subscriptions.map(s => ({
              categoryId: s.categoryId,
              categoryName: s.categoryName,
              isActive: s.isActive,
            })) || [];
          } else if (u.role === 'user') {
            const withSubs = await getUserWithSubscriptions(userId);
            subscriptions = withSubs?.subscriptions.map(s => ({
              categoryId: s.categoryId,
              categoryName: s.categoryName,
              isActive: s.isActive,
            })) || [];
          }
        }

        return {
          ...u,
          id: userId,
          addedAt: u.addedAt.toISOString(),
          subscriptions,
          assignedCategories,
        };
      })
    );

    return NextResponse.json({ users: enhancedUsers });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST /api/admin/users - Add a new user with optional subscriptions/assignments
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();

    const { email, role, name, subscriptions, assignedCategories } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: 'Role must be "admin", "superuser", or "user"' },
        { status: 400 }
      );
    }

    // Validate category IDs if provided
    const categoryIdsToSubscribe: number[] = subscriptions || [];
    const categoryIdsToAssign: number[] = assignedCategories || [];

    for (const catId of [...categoryIdsToSubscribe, ...categoryIdsToAssign]) {
      const cat = await getCategoryById(catId);
      if (!cat) {
        return NextResponse.json(
          { error: `Category with ID ${catId} not found` },
          { status: 400 }
        );
      }
    }

    // Create the user
    const user = await addAllowedUser(email, role, admin.email, name);

    // Get the user ID for subscriptions/assignments
    const userId = await getUserId(email);

    if (userId) {
      // Add subscriptions for regular users and super users
      if ((role === 'user' || role === 'superuser') && categoryIdsToSubscribe.length > 0) {
        for (const catId of categoryIdsToSubscribe) {
          await addSubscription(userId, catId, admin.email);
        }
      }

      // Add category assignments for super users
      if (role === 'superuser' && categoryIdsToAssign.length > 0) {
        for (const catId of categoryIdsToAssign) {
          await assignCategoryToSuperUser(userId, catId, admin.email);
        }
      }
    }

    return NextResponse.json({
      user: {
        ...user,
        addedAt: user.addedAt.toISOString(),
      },
      message: 'User added successfully',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error adding user:', error);
    return NextResponse.json({ error: 'Failed to add user' }, { status: 500 });
  }
}

// DELETE /api/admin/users - Remove a user
export async function DELETE(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Prevent admin from removing themselves
    if (email.toLowerCase() === admin.email.toLowerCase()) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
    }

    // Prevent deletion of root admins (defined in ADMIN_EMAILS env var)
    if (isRootAdmin(email)) {
      return NextResponse.json({ error: 'Cannot remove a root admin' }, { status: 403 });
    }

    const removed = await removeAllowedUser(email);

    if (!removed) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'User removed successfully' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error removing user:', error);
    return NextResponse.json({ error: 'Failed to remove user' }, { status: 500 });
  }
}

// PATCH /api/admin/users - Update user role
export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();

    const { email, role } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: 'Role must be "admin", "superuser", or "user"' },
        { status: 400 }
      );
    }

    // Prevent admin from demoting themselves
    if (email.toLowerCase() === admin.email.toLowerCase() && role !== 'admin') {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    // Prevent role change for root admins (defined in ADMIN_EMAILS env var)
    if (isRootAdmin(email)) {
      return NextResponse.json({ error: 'Cannot change role of a root admin' }, { status: 403 });
    }

    const updated = await updateUserRole(email, role);

    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'User role updated successfully' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
