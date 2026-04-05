/**
 * User Database Operations
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';

// Re-export types
export type {
  UserRole,
  DbUser,
  CreateUserInput,
  UpdateUserInput,
  UserWithSubscriptions,
  UserWithAssignments,
} from '../users';

import type {
  UserRole,
  DbUser,
  CreateUserInput,
  UpdateUserInput,
  UserWithSubscriptions,
  UserWithAssignments,
} from '../users';

// ============ User CRUD ============

export async function getAllUsers(): Promise<DbUser[]> {
  const db = await getDb();
  return db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbUser[]>;
}

export async function getUserById(id: number): Promise<DbUser | undefined> {
  const db = await getDb();
  return db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .where('id', '=', id)
    .executeTakeFirst() as Promise<DbUser | undefined>;
}

export async function getUserByEmail(email: string): Promise<DbUser | undefined> {
  const db = await getDb();
  return db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst() as Promise<DbUser | undefined>;
}

export async function createUser(input: CreateUserInput): Promise<DbUser> {
  const db = await getDb();
  const result = await db
    .insertInto('users')
    .values({
      email: input.email.toLowerCase(),
      name: input.name || null,
      role: input.role,
      added_by: input.addedBy || null,
    })
    .returning(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .executeTakeFirstOrThrow();
  return result as DbUser;
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<DbUser | undefined> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.role !== undefined) updates.role = input.role;

  if (Object.keys(updates).length === 0) {
    return getUserById(id);
  }

  const db = await getDb();
  await db.updateTable('users').set(updates).where('id', '=', id).execute();
  return getUserById(id);
}

export async function deleteUser(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('users').where('id', '=', id).executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function deleteUserByEmail(email: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('users').where('email', '=', email.toLowerCase()).executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function userExists(email: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('users')
    .select(db.fn.count<number>('id').as('count'))
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

export async function isAdmin(email: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  return user?.role === 'admin';
}

export async function isSuperUser(email: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  return user?.role === 'superuser';
}

// ============ Users by Role ============

export async function getAdmins(): Promise<DbUser[]> {
  const db = await getDb();
  return db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .where('role', '=', 'admin')
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbUser[]>;
}

export async function getSuperUsers(): Promise<DbUser[]> {
  const db = await getDb();
  return db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .where('role', '=', 'superuser')
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbUser[]>;
}

export async function getRegularUsers(): Promise<DbUser[]> {
  const db = await getDb();
  return db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .where('role', '=', 'user')
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbUser[]>;
}

// ============ Super User Category Assignments ============

export async function getSuperUserWithAssignments(userId: number): Promise<UserWithAssignments | undefined> {
  const user = await getUserById(userId);
  if (!user || user.role !== 'superuser') return undefined;

  const db = await getDb();
  const assignments = await db
    .selectFrom('super_user_categories as suc')
    .innerJoin('categories as c', 'suc.category_id', 'c.id')
    .select([
      'c.id as categoryId',
      'c.name as categoryName',
      'c.slug as categorySlug',
      'c.created_by as createdBy',
    ])
    .where('suc.user_id', '=', userId)
    .orderBy('c.name')
    .execute();

  return {
    ...user,
    assignedCategories: assignments,
  };
}

export async function assignCategoryToSuperUser(
  userId: number,
  categoryId: number,
  assignedBy: string
): Promise<boolean> {
  try {
    const db = await getDb();
    await db
      .insertInto('super_user_categories')
      .values({ user_id: userId, category_id: categoryId, assigned_by: assignedBy })
      .execute();
    return true;
  } catch {
    return false;
  }
}

export async function removeCategoryFromSuperUser(userId: number, categoryId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('super_user_categories')
    .where('user_id', '=', userId)
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function replaceSuperUserCategories(
  userId: number,
  categoryIds: number[],
  assignedBy: string
): Promise<void> {
  return transaction(async (trx) => {
    await trx
      .deleteFrom('super_user_categories')
      .where('user_id', '=', userId)
      .execute();

    if (categoryIds.length > 0) {
      await trx
        .insertInto('super_user_categories')
        .values(categoryIds.map(cid => ({ user_id: userId, category_id: cid, assigned_by: assignedBy })))
        .execute();
    }
  });
}

export async function getSuperUserCategories(userId: number): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('super_user_categories')
    .select('category_id')
    .where('user_id', '=', userId)
    .execute();
  return results.map((r) => r.category_id);
}

export async function superUserHasCategory(userId: number, categoryId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('super_user_categories')
    .select(db.fn.count<number>('user_id').as('count'))
    .where('user_id', '=', userId)
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

// ============ User Subscriptions ============

export async function getUserWithSubscriptions(userId: number): Promise<UserWithSubscriptions | undefined> {
  const user = await getUserById(userId);
  if (!user) return undefined;

  const db = await getDb();
  const subscriptions = await db
    .selectFrom('user_subscriptions as us')
    .innerJoin('categories as c', 'us.category_id', 'c.id')
    .select([
      'c.id as categoryId',
      'c.name as categoryName',
      'c.slug as categorySlug',
      'us.is_active as isActive',
    ])
    .where('us.user_id', '=', userId)
    .orderBy('c.name')
    .execute();

  return {
    ...user,
    subscriptions: subscriptions.map((s) => ({
      categoryId: s.categoryId,
      categoryName: s.categoryName,
      categorySlug: s.categorySlug,
      isActive: Boolean(s.isActive),
    })),
  };
}

export async function addSubscription(
  userId: number,
  categoryId: number,
  subscribedBy: string
): Promise<boolean> {
  try {
    const db = await getDb();
    await db
      .insertInto('user_subscriptions')
      .values({ user_id: userId, category_id: categoryId, subscribed_by: subscribedBy })
      .execute();
    return true;
  } catch {
    return false;
  }
}

export async function removeSubscription(userId: number, categoryId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('user_subscriptions')
    .where('user_id', '=', userId)
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function toggleSubscriptionActive(
  userId: number,
  categoryId: number,
  isActive: boolean
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('user_subscriptions')
    .set({ is_active: isActive ? 1 : 0 })
    .where('user_id', '=', userId)
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

export async function getActiveSubscriptions(userId: number): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('user_subscriptions')
    .select('category_id')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .execute();
  return results.map((r) => r.category_id);
}

export async function userHasSubscription(userId: number, categoryId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('user_subscriptions')
    .select(db.fn.count<number>('user_id').as('count'))
    .where('user_id', '=', userId)
    .where('category_id', '=', categoryId)
    .where('is_active', '=', 1)
    .executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

export async function getUsersSubscribedToCategory(categoryId: number): Promise<
  Array<{
    userId: number;
    isActive: boolean;
    subscribedBy: string;
    subscribedAt: string;
  }>
> {
  const db = await getDb();
  const results = await db
    .selectFrom('user_subscriptions')
    .select(['user_id', 'is_active', 'subscribed_by', 'subscribed_at'])
    .where('category_id', '=', categoryId)
    .execute();

  return results.map((r) => ({
    userId: r.user_id,
    isActive: r.is_active === 1,
    subscribedBy: r.subscribed_by,
    subscribedAt: r.subscribed_at as string,
  }));
}

// ============ Bulk Operations ============

export async function createUserWithSubscriptions(
  input: CreateUserInput,
  categoryIds: number[],
  subscribedBy: string
): Promise<DbUser> {
  return transaction(async (trx) => {
    const result = await trx
      .insertInto('users')
      .values({
        email: input.email.toLowerCase(),
        name: input.name || null,
        role: input.role,
        added_by: input.addedBy || null,
      })
      .returning(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();

    const user = result as DbUser;

    if (categoryIds.length > 0) {
      await trx
        .insertInto('user_subscriptions')
        .values(categoryIds.map(cid => ({ user_id: user.id, category_id: cid, subscribed_by: subscribedBy })))
        .execute();
    }

    return user;
  });
}

export async function createSuperUserWithAssignments(
  input: Omit<CreateUserInput, 'role'>,
  categoryIds: number[],
  assignedBy: string
): Promise<DbUser> {
  return transaction(async (trx) => {
    const result = await trx
      .insertInto('users')
      .values({
        email: input.email.toLowerCase(),
        name: input.name || null,
        role: 'superuser' as UserRole,
        added_by: input.addedBy || null,
      })
      .returning(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();

    const user = result as DbUser;

    if (categoryIds.length > 0) {
      await trx
        .insertInto('super_user_categories')
        .values(categoryIds.map(cid => ({ user_id: user.id, category_id: cid, assigned_by: assignedBy })))
        .execute();
    }

    return user;
  });
}

// ============ Initialize from Environment ============

export async function initializeAdminsFromEnv(): Promise<void> {
  const adminEmails =
    process.env.ADMIN_EMAILS?.split(',')
      .map((e) => e.trim())
      .filter(Boolean) || [];

  for (const email of adminEmails) {
    const existing = await getUserByEmail(email);
    if (!existing) {
      await createUser({
        email,
        role: 'admin',
        addedBy: 'system',
      });
    } else if (existing.role !== 'admin') {
      await updateUser(existing.id, { role: 'admin' });
      console.log(`[Auth] Re-promoted env admin: ${email}`);
    }
  }
}

// ============ Credentials Management ============

export async function setUserPassword(userId: number, passwordHash: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('users')
    .set({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    .where('id', '=', userId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

export async function setCredentialsEnabled(userId: number, enabled: boolean): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('users')
    .set({ credentials_enabled: enabled ? 1 : 0, updated_at: new Date().toISOString() })
    .where('id', '=', userId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

export async function clearUserPassword(userId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('users')
    .set({ password_hash: null, updated_at: new Date().toISOString() })
    .where('id', '=', userId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

export async function getCredentialUsers(): Promise<DbUser[]> {
  const db = await getDb();
  return db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'added_by', 'password_hash', 'credentials_enabled', 'created_at', 'updated_at'])
    .where('password_hash', 'is not', null)
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbUser[]>;
}

export async function canLoginWithCredentials(email: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  return !!(user && user.password_hash && user.credentials_enabled === 1);
}

export async function initializeAdminCredentialsFromEnv(): Promise<void> {
  const adminPassword = process.env.CREDENTIALS_ADMIN_PASSWORD;
  if (!adminPassword) return;

  const adminEmails =
    process.env.ADMIN_EMAILS?.split(',')
      .map((e) => e.trim())
      .filter(Boolean) || [];
  const firstAdmin = adminEmails[0];
  if (!firstAdmin) return;

  const user = await getUserByEmail(firstAdmin);
  if (user && !user.password_hash) {
    const { hashPassword } = await import('../../password');
    const hash = await hashPassword(adminPassword);
    await setUserPassword(user.id, hash);
    await setCredentialsEnabled(user.id, true);
    console.log(`[Auth] Credentials set for admin: ${firstAdmin}`);
  }
}
