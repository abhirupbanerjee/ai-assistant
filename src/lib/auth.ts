import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getUserRole } from '@/lib/users';
import type { User } from '@/types';

const AUTH_DISABLED = ((): boolean => {
  const disabled = process.env.AUTH_DISABLED === 'true';
  if (disabled && process.env.NODE_ENV === 'production') {
    console.error(
      '\n' +
      '╔══════════════════════════════════════════════════════════════╗\n' +
      '║  FATAL: AUTH_DISABLED=true is set in production!            ║\n' +
      '║  This bypasses ALL authentication and creates a huge        ║\n' +
      '║  security hole. Remove this setting from production env.    ║\n' +
      '╚══════════════════════════════════════════════════════════════╝\n'
    );
    process.exit(1);
  }
  return disabled;
})();

export async function isAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const role = await getUserRole(email);
  return role === 'admin';
}

export async function canAccessAdminDashboard(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const role = await getUserRole(email);
  return role === 'admin' || role === 'superuser';
}

export async function getCurrentUser(): Promise<User | null> {
  if (AUTH_DISABLED) {
    return {
      id: 'dev-user',
      email: 'dev@localhost',
      name: 'Development User',
      isAdmin: true,
      role: 'admin',
    };
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return null;
  }

  const role = await getUserRole(session.user.email);

  return {
    id: session.user.email,
    email: session.user.email,
    name: session.user.name || 'User',
    image: session.user.image || undefined,
    isAdmin: role === 'admin',
    role: role || 'user',
  };
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireAuth();
  if (!user.isAdmin) {
    throw new Error('Admin access required');
  }
  return user;
}

export async function requireElevated(): Promise<User & { role: 'admin' | 'superuser' }> {
  const user = await requireAuth();
  // Use the role already computed in getCurrentUser instead of doing another lookup
  if (user.role !== 'admin' && user.role !== 'superuser') {
    throw new Error('Elevated access required');
  }
  return { ...user, role: user.role as 'admin' | 'superuser' };
}
