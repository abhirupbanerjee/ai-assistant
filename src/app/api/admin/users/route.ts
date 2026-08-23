import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAllowedUsers, addAllowedUser, removeAllowedUser, updateUserRole, isRootAdmin } from '@/lib/users';
import { getDb } from '@/lib/db/kysely';
import {
  addSubscription,
  assignCategoryToSuperUser,
  getSubscriptionsByUsers,
  getAssignmentsByUsers,
  getOrganizationMembershipsForUsers,
  getCategoryById,
} from '@/lib/db/compat';
import type { UserRole } from '@/lib/users';

const VALID_ROLES: UserRole[] = ['admin', 'superuser', 'user'];

// GET /api/admin/users - List all allowed users with their subscriptions/assignments
export async function GET() {
  try {
    await requireAdmin();
    const users = await getAllowedUsers();

    // Batch load subscriptions + assignments in two queries (previously O(n)
    // per-user lookups that made this endpoint slow enough to time out).
    const userIds = users.map((u) => u.id);
    const [subsRows, assignRows, membershipRows] = await Promise.all([
      getSubscriptionsByUsers(userIds),
      getAssignmentsByUsers(userIds),
      getOrganizationMembershipsForUsers(userIds),
    ]);

    const subsByUser = new Map<number, { categoryId: number; categoryName: string; isActive: boolean }[]>();
    for (const s of subsRows) {
      const list = subsByUser.get(s.userId) ?? [];
      list.push({ categoryId: s.categoryId, categoryName: s.categoryName, isActive: s.isActive });
      subsByUser.set(s.userId, list);
    }

    const assignsByUser = new Map<number, { categoryId: number; categoryName: string }[]>();
    for (const a of assignRows) {
      const list = assignsByUser.get(a.userId) ?? [];
      list.push({ categoryId: a.categoryId, categoryName: a.categoryName });
      assignsByUser.set(a.userId, list);
    }

    const membershipsByUser = new Map<number, { organizationId: number; organizationName: string; role: string }[]>();
    for (const m of membershipRows) {
      const list = membershipsByUser.get(m.userId) ?? [];
      list.push({ organizationId: m.organizationId, organizationName: m.organizationName, role: m.role });
      membershipsByUser.set(m.userId, list);
    }

    const enhancedUsers = users.map((u) => {
      let subscriptions: { categoryId: number; categoryName: string; isActive: boolean }[] = [];
      let assignedCategories: { categoryId: number; categoryName: string }[] = [];

      if (u.role === 'superuser') {
        assignedCategories = assignsByUser.get(u.id) ?? [];
        subscriptions = subsByUser.get(u.id) ?? [];
      } else if (u.role === 'user') {
        subscriptions = subsByUser.get(u.id) ?? [];
      }

      return {
        ...u,
        addedAt: u.addedAt.toISOString(),
        subscriptions,
        assignedCategories,
        organizations: membershipsByUser.get(u.id) ?? [],
      };
    });

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

    const { email, role, name, subscriptions, assignedCategories, organizationId } = body;

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

    // addAllowedUser returns the user row including its PK id, so we avoid an
    // extra lookup here.
    const userId = user.id;

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

    // Organization scoping: when an organization is provided, add the user as a
    // member. The first active member of an organization is automatically tagged
    // as `org_admin` (plan §4 / Decision 2); subsequent members are `member`.
    if (userId && typeof organizationId === 'number' && Number.isFinite(organizationId)) {
      const db = await getDb();

      const organization = await db
        .selectFrom('organizations')
        .select('id')
        .where('id', '=', organizationId)
        .executeTakeFirst();
      if (!organization) {
        return NextResponse.json(
          { error: `Organization with ID ${organizationId} not found` },
          { status: 404 }
        );
      }

      const existing = await db
        .selectFrom('organization_memberships')
        .select('user_id')
        .where('organization_id', '=', organizationId)
        .where('status', '=', 'active')
        .executeTakeFirst();

      const membershipRole = existing ? 'member' : 'org_admin';
      await db
        .insertInto('organization_memberships')
        .values({
          organization_id: organizationId,
          user_id: userId,
          role: membershipRole,
          status: 'active',
        })
        .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doNothing())
        .execute();
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

    // Prevent admin/super_admin from changing their own role
    if (email.toLowerCase() === admin.email.toLowerCase() && role !== admin.role) {
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
