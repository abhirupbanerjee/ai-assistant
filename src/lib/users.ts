/**
 * User Management Module
 *
 * Now uses SQLite database for user storage
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
} from './db/users';
import { getDatabase } from './db';

// Re-export types
export type { UserRole } from './db/users';

export interface AllowedUser {
  email: string;
  name?: string;
  role: UserRole;
  addedAt: Date;
  addedBy: string;
}

// Initialize database on first access
let initialized = false;
let credentialsInitialized = false;

function ensureInitialized(): void {
  if (!initialized) {
    getDatabase(); // This triggers schema creation and default settings
    initializeAdminsFromEnv();
    initialized = true;

    // Initialize admin credentials async (fire-and-forget, non-blocking)
    if (!credentialsInitialized) {
      credentialsInitialized = true;
      initializeAdminCredentialsFromEnv().catch((err) => {
        console.error('[Auth] Failed to initialize admin credentials:', err);
      });
    }
  }
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
  };
}

/**
 * Get all allowed users
 */
export async function getAllowedUsers(): Promise<AllowedUser[]> {
  ensureInitialized();
  const users = dbGetAllUsers();
  return users.map(toAllowedUser);
}

/**
 * Check if a user is allowed to access the system
 */
export async function isUserAllowed(email: string): Promise<boolean> {
  if (!email) return false;
  ensureInitialized();
  const user = dbGetUserByEmail(email);
  return !!user;
}

/**
 * Get user role by email
 */
export async function getUserRole(email: string): Promise<UserRole | null> {
  if (!email) return null;
  ensureInitialized();
  const user = dbGetUserByEmail(email);
  return user?.role || null;
}

/**
 * Get user ID by email
 */
export async function getUserId(email: string): Promise<number | null> {
  if (!email) return null;
  ensureInitialized();
  const user = dbGetUserByEmail(email);
  return user?.id || null;
}

/**
 * Get full user by email
 */
export async function getUserByEmail(email: string): Promise<AllowedUser | null> {
  if (!email) return null;
  ensureInitialized();
  const user = dbGetUserByEmail(email);
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
  ensureInitialized();

  // Check if user exists
  const existing = dbGetUserByEmail(email);

  if (existing) {
    // Update existing user
    const updated = dbUpdateUser(existing.id, { name, role });
    return toAllowedUser(updated!);
  }

  // Create new user
  const newUser = dbCreateUser({
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
  ensureInitialized();
  return dbDeleteUserByEmail(email);
}

/**
 * Update user role
 */
export async function updateUserRole(email: string, role: UserRole): Promise<boolean> {
  ensureInitialized();
  const user = dbGetUserByEmail(email);
  if (!user) return false;

  dbUpdateUser(user.id, { role });
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
