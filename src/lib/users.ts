/**
 * User Management Module
 *
 * Uses async compat layer for user storage (supports both SQLite and PostgreSQL).
 * Supports three roles: admin, superuser, user
 */

import {
  getAllUsers as dbGetAllUsers,
  getUserByEmail as dbGetUserByEmail,
  createUser as dbCreateUser,
  deleteUserByEmail as dbDeleteUserByEmail,
  updateUser as dbUpdateUser,
  initializeAdminsFromEnv,
  initializeAdminCredentialsFromEnv,
  type DbUser,
  type UserRole,
} from './db/compat/users';

// Re-export types
export type { UserRole } from './db/compat/users';

export interface AllowedUser {
  email: string;
  name?: string;
  role: UserRole;
  addedAt: Date;
  addedBy: string;
  hasCredentials?: boolean;
  isRootAdmin?: boolean;
}

/**
 * Check if an email belongs to a root admin (defined in ADMIN_EMAILS env var).
 * Root admins cannot be demoted or deleted through the UI.
 */
export function isRootAdmin(email: string): boolean {
  const envAdmins = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()).filter(Boolean) || [];
  return envAdmins.includes(email.toLowerCase());
}

/**
 * Convert DbUser to AllowedUser for API compatibility
 */
function toAllowedUser(dbUser: DbUser): AllowedUser {
  return {
    email: dbUser.email,
    name: dbUser.name || undefined,
    role: dbUser.role,
    addedAt: new Date(dbUser.created_at),
    addedBy: dbUser.added_by || 'system',
    hasCredentials: !!(dbUser.password_hash && dbUser.credentials_enabled === 1),
    isRootAdmin: isRootAdmin(dbUser.email),
  };
}

/**
 * Get all allowed users
 */
export async function getAllowedUsers(): Promise<AllowedUser[]> {
  const users = await dbGetAllUsers();
  return users.map(toAllowedUser);
}

/**
 * Check if a user is allowed to access the system
 */
export async function isUserAllowed(email: string): Promise<boolean> {
  if (!email) return false;
  const user = await dbGetUserByEmail(email);
  return !!user;
}

/**
 * Get user role by email
 */
export async function getUserRole(email: string): Promise<UserRole | null> {
  if (!email) return null;
  const user = await dbGetUserByEmail(email);
  return user?.role || null;
}

/**
 * Get user ID by email
 */
export async function getUserId(email: string): Promise<number | null> {
  if (!email) return null;
  const user = await dbGetUserByEmail(email);
  return user?.id || null;
}

/**
 * Get full user by email
 */
export async function getUserByEmail(email: string): Promise<AllowedUser | null> {
  if (!email) return null;
  const user = await dbGetUserByEmail(email);
  return user ? toAllowedUser(user) : null;
}

/**
 * Add or update an allowed user
 */
export async function addAllowedUser(
  email: string,
  role: UserRole,
  addedBy: string,
  name?: string
): Promise<AllowedUser> {
  // Check if user exists
  const existing = await dbGetUserByEmail(email);

  if (existing) {
    // Update existing user
    const updated = await dbUpdateUser(existing.id, { name, role });
    return toAllowedUser(updated!);
  }

  // Create new user
  const newUser = await dbCreateUser({
    email,
    name,
    role,
    addedBy,
  });

  return toAllowedUser(newUser);
}

/**
 * Remove an allowed user
 */
export async function removeAllowedUser(email: string): Promise<boolean> {
  return await dbDeleteUserByEmail(email);
}

/**
 * Update user role
 */
export async function updateUserRole(email: string, role: UserRole): Promise<boolean> {
  const user = await dbGetUserByEmail(email);
  if (!user) return false;

  await dbUpdateUser(user.id, { role });
  return true;
}

/**
 * Check if user is an admin
 */
export async function isUserAdmin(email: string): Promise<boolean> {
  const role = await getUserRole(email);
  return role === 'admin';
}

/**
 * Check if user is a super user
 */
export async function isUserSuperUser(email: string): Promise<boolean> {
  const role = await getUserRole(email);
  return role === 'superuser';
}

/**
 * Check if user has elevated privileges (admin or superuser)
 */
export async function hasElevatedAccess(email: string): Promise<boolean> {
  const role = await getUserRole(email);
  return role === 'admin' || role === 'superuser';
}
