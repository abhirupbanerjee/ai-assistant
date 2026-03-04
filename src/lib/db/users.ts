/**
 * User Database Operations
 *
 * CRUD operations for users with role management
 * Supports: admin, superuser, user roles
 */

import { execute, queryAll, queryOne, transaction } from './index';

// ============ Types ============

export type UserRole = 'admin' | 'superuser' | 'user';

export interface DbUser {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  added_by: string | null;
  password_hash: string | null;
  credentials_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  email: string;
  name?: string;
  role: UserRole;
  addedBy?: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
}

export interface UserWithSubscriptions extends DbUser {
  subscriptions: {
    categoryId: number;
    categoryName: string;
    categorySlug: string;
    isActive: boolean;
  }[];
}

export interface UserWithAssignments extends DbUser {
  assignedCategories: {
    categoryId: number;
    categoryName: string;
    categorySlug: string;
    createdBy: string;
  }[];
}

// ============ User CRUD ============

/**
 * Get all users
 */
export function getAllUsers(): DbUser[] {
  return queryAll<DbUser>(`
    SELECT id, email, name, role, added_by, password_hash, credentials_enabled, created_at, updated_at
    FROM users
    ORDER BY created_at DESC
  `);
}

/**
 * Get user by ID
 */
export function getUserById(id: number): DbUser | undefined {
  return queryOne<DbUser>(`
    SELECT id, email, name, role, added_by, password_hash, credentials_enabled, created_at, updated_at
    FROM users
    WHERE id = ?
  `, [id]);
}

/**
 * Get user by email
 */
export function getUserByEmail(email: string): DbUser | undefined {
  return queryOne<DbUser>(`
    SELECT id, email, name, role, added_by, password_hash, credentials_enabled, created_at, updated_at
    FROM users
    WHERE email = ?
  `, [email.toLowerCase()]);
}

/**
 * Create a new user
 */
export function createUser(input: CreateUserInput): DbUser {
  const result = execute(`
    INSERT INTO users (email, name, role, added_by)
    VALUES (?, ?, ?, ?)
  `, [
    input.email.toLowerCase(),
    input.name || null,
    input.role,
    input.addedBy || null,
  ]);

  return getUserById(result.lastInsertRowid as number)!;
}

/**
 * Update a user
 */
export function updateUser(id: number, input: UpdateUserInput): DbUser | undefined {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name);
  }

  if (input.role !== undefined) {
    updates.push('role = ?');
    params.push(input.role);
  }

  if (updates.length === 0) {
    return getUserById(id);
  }

  params.push(id);
  execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  return getUserById(id);
}

/**
 * Delete a user
 */
export function deleteUser(id: number): boolean {
  const result = execute('DELETE FROM users WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Delete a user by email
 */
export function deleteUserByEmail(email: string): boolean {
  const result = execute('DELETE FROM users WHERE email = ?', [email.toLowerCase()]);
  return result.changes > 0;
}

/**
 * Check if user exists
 */
export function userExists(email: string): boolean {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM users WHERE email = ?
  `, [email.toLowerCase()]);
  return (result?.count ?? 0) > 0;
}

/**
 * Check if user is admin
 */
export function isAdmin(email: string): boolean {
  const user = getUserByEmail(email);
  return user?.role === 'admin';
}

/**
 * Check if user is superuser
 */
export function isSuperUser(email: string): boolean {
  const user = getUserByEmail(email);
  return user?.role === 'superuser';
}

// ============ Users by Role ============

/**
 * Get all admins
 */
export function getAdmins(): DbUser[] {
  return queryAll<DbUser>(`
    SELECT id, email, name, role, added_by, password_hash, credentials_enabled, created_at, updated_at
    FROM users
    WHERE role = 'admin'
    ORDER BY created_at DESC
  `);
}

/**
 * Get all super users
 */
export function getSuperUsers(): DbUser[] {
  return queryAll<DbUser>(`
    SELECT id, email, name, role, added_by, password_hash, credentials_enabled, created_at, updated_at
    FROM users
    WHERE role = 'superuser'
    ORDER BY created_at DESC
  `);
}

/**
 * Get all regular users
 */
export function getRegularUsers(): DbUser[] {
  return queryAll<DbUser>(`
    SELECT id, email, name, role, added_by, password_hash, credentials_enabled, created_at, updated_at
    FROM users
    WHERE role = 'user'
    ORDER BY created_at DESC
  `);
}

// ============ Super User Category Assignments ============

/**
 * Get super user with their assigned categories
 */
export function getSuperUserWithAssignments(userId: number): UserWithAssignments | undefined {
  const user = getUserById(userId);
  if (!user || user.role !== 'superuser') return undefined;

  const assignments = queryAll<{
    categoryId: number;
    categoryName: string;
    categorySlug: string;
    createdBy: string;
  }>(`
    SELECT
      c.id as categoryId,
      c.name as categoryName,
      c.slug as categorySlug,
      c.created_by as createdBy
    FROM super_user_categories suc
    JOIN categories c ON suc.category_id = c.id
    WHERE suc.user_id = ?
    ORDER BY c.name
  `, [userId]);

  return {
    ...user,
    assignedCategories: assignments,
  };
}

/**
 * Assign category to super user
 */
export function assignCategoryToSuperUser(
  userId: number,
  categoryId: number,
  assignedBy: string
): boolean {
  try {
    execute(`
      INSERT INTO super_user_categories (user_id, category_id, assigned_by)
      VALUES (?, ?, ?)
    `, [userId, categoryId, assignedBy]);
    return true;
  } catch {
    return false; // Already assigned or invalid IDs
  }
}

/**
 * Remove category assignment from super user
 */
export function removeCategoryFromSuperUser(userId: number, categoryId: number): boolean {
  const result = execute(`
    DELETE FROM super_user_categories
    WHERE user_id = ? AND category_id = ?
  `, [userId, categoryId]);
  return result.changes > 0;
}

/**
 * Get categories assigned to super user
 */
export function getSuperUserCategories(userId: number): number[] {
  const results = queryAll<{ category_id: number }>(`
    SELECT category_id FROM super_user_categories WHERE user_id = ?
  `, [userId]);
  return results.map(r => r.category_id);
}

/**
 * Check if super user has access to category
 */
export function superUserHasCategory(userId: number, categoryId: number): boolean {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count
    FROM super_user_categories
    WHERE user_id = ? AND category_id = ?
  `, [userId, categoryId]);
  return (result?.count ?? 0) > 0;
}

// ============ User Subscriptions ============

/**
 * Get user with their subscriptions
 */
export function getUserWithSubscriptions(userId: number): UserWithSubscriptions | undefined {
  const user = getUserById(userId);
  if (!user) return undefined;

  const subscriptions = queryAll<{
    categoryId: number;
    categoryName: string;
    categorySlug: string;
    isActive: number;
  }>(`
    SELECT
      c.id as categoryId,
      c.name as categoryName,
      c.slug as categorySlug,
      us.is_active as isActive
    FROM user_subscriptions us
    JOIN categories c ON us.category_id = c.id
    WHERE us.user_id = ?
    ORDER BY c.name
  `, [userId]);

  return {
    ...user,
    subscriptions: subscriptions.map(s => ({
      ...s,
      isActive: Boolean(s.isActive),
    })),
  };
}

/**
 * Add subscription for user
 */
export function addSubscription(
  userId: number,
  categoryId: number,
  subscribedBy: string
): boolean {
  try {
    execute(`
      INSERT INTO user_subscriptions (user_id, category_id, subscribed_by)
      VALUES (?, ?, ?)
    `, [userId, categoryId, subscribedBy]);
    return true;
  } catch {
    return false; // Already subscribed or invalid IDs
  }
}

/**
 * Remove subscription from user
 */
export function removeSubscription(userId: number, categoryId: number): boolean {
  const result = execute(`
    DELETE FROM user_subscriptions
    WHERE user_id = ? AND category_id = ?
  `, [userId, categoryId]);
  return result.changes > 0;
}

/**
 * Toggle subscription active status
 */
export function toggleSubscriptionActive(
  userId: number,
  categoryId: number,
  isActive: boolean
): boolean {
  const result = execute(`
    UPDATE user_subscriptions
    SET is_active = ?
    WHERE user_id = ? AND category_id = ?
  `, [isActive ? 1 : 0, userId, categoryId]);
  return result.changes > 0;
}

/**
 * Get active subscriptions for user
 */
export function getActiveSubscriptions(userId: number): number[] {
  const results = queryAll<{ category_id: number }>(`
    SELECT category_id
    FROM user_subscriptions
    WHERE user_id = ? AND is_active = 1
  `, [userId]);
  return results.map(r => r.category_id);
}

/**
 * Check if user has active subscription to category
 */
export function userHasSubscription(userId: number, categoryId: number): boolean {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count
    FROM user_subscriptions
    WHERE user_id = ? AND category_id = ? AND is_active = 1
  `, [userId, categoryId]);
  return (result?.count ?? 0) > 0;
}

/**
 * Get all users subscribed to a category
 */
export function getUsersSubscribedToCategory(categoryId: number): Array<{
  userId: number;
  isActive: boolean;
  subscribedBy: string;
  subscribedAt: string;
}> {
  const results = queryAll<{
    user_id: number;
    is_active: number;
    subscribed_by: string;
    subscribed_at: string;
  }>(`
    SELECT user_id, is_active, subscribed_by, subscribed_at
    FROM user_subscriptions
    WHERE category_id = ?
  `, [categoryId]);

  return results.map(r => ({
    userId: r.user_id,
    isActive: r.is_active === 1,
    subscribedBy: r.subscribed_by,
    subscribedAt: r.subscribed_at,
  }));
}

// ============ Bulk Operations ============

/**
 * Create user with subscriptions in a single transaction
 */
export function createUserWithSubscriptions(
  input: CreateUserInput,
  categoryIds: number[],
  subscribedBy: string
): DbUser {
  return transaction(() => {
    const user = createUser(input);

    for (const categoryId of categoryIds) {
      addSubscription(user.id, categoryId, subscribedBy);
    }

    return user;
  });
}

/**
 * Create super user with category assignments in a single transaction
 */
export function createSuperUserWithAssignments(
  input: Omit<CreateUserInput, 'role'>,
  categoryIds: number[],
  assignedBy: string
): DbUser {
  return transaction(() => {
    const user = createUser({ ...input, role: 'superuser' });

    for (const categoryId of categoryIds) {
      assignCategoryToSuperUser(user.id, categoryId, assignedBy);
    }

    return user;
  });
}

// ============ Credentials Management ============

/**
 * Set password hash for a user
 */
export function setUserPassword(userId: number, passwordHash: string): boolean {
  const result = execute(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [passwordHash, userId]
  );
  return result.changes > 0;
}

/**
 * Enable or disable credentials login for a user
 */
export function setCredentialsEnabled(userId: number, enabled: boolean): boolean {
  const result = execute(
    'UPDATE users SET credentials_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [enabled ? 1 : 0, userId]
  );
  return result.changes > 0;
}

/**
 * Clear password for a user (removes credentials login)
 */
export function clearUserPassword(userId: number): boolean {
  const result = execute(
    'UPDATE users SET password_hash = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [userId]
  );
  return result.changes > 0;
}

/**
 * Get users that have credentials set up
 */
export function getCredentialUsers(): DbUser[] {
  return queryAll<DbUser>(`
    SELECT id, email, name, role, added_by, password_hash, credentials_enabled, created_at, updated_at
    FROM users
    WHERE password_hash IS NOT NULL
    ORDER BY created_at DESC
  `);
}

/**
 * Check if user can login with credentials
 */
export function canLoginWithCredentials(email: string): boolean {
  const user = getUserByEmail(email);
  return !!(user && user.password_hash && user.credentials_enabled === 1);
}

// ============ Initialize from Environment ============

/**
 * Initialize admin users from ADMIN_EMAILS environment variable
 * Called during first run
 */
export function initializeAdminsFromEnv(): void {
  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim()).filter(Boolean) || [];

  for (const email of adminEmails) {
    if (!userExists(email)) {
      createUser({
        email,
        role: 'admin',
        addedBy: 'system',
      });
    }
  }
}

/**
 * Initialize admin credentials from CREDENTIALS_ADMIN_PASSWORD environment variable
 * Sets password for the first admin in ADMIN_EMAILS list (only if no password exists)
 * Called during first run
 */
export async function initializeAdminCredentialsFromEnv(): Promise<void> {
  const adminPassword = process.env.CREDENTIALS_ADMIN_PASSWORD;
  if (!adminPassword) return;

  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim()).filter(Boolean) || [];
  const firstAdmin = adminEmails[0];
  if (!firstAdmin) return;

  const user = getUserByEmail(firstAdmin);
  if (user && !user.password_hash) {
    // Only set if no password exists (don't overwrite)
    const { hashPassword } = await import('../password');
    const hash = await hashPassword(adminPassword);
    setUserPassword(user.id, hash);
    setCredentialsEnabled(user.id, true);
    console.log(`[Auth] Credentials set for admin: ${firstAdmin}`);
  }
}
