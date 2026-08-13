/**
 * Shared helpers for the /api/browser-sessions/* routes.
 * (Underscore-prefixed files are ignored by the App Router but importable.)
 */

import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getBrowserSessionForUser } from '@/lib/db/compat';
import type { BrowserSessionInfo } from '@/types/browser';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Resolve the authenticated user to their integer DB id. */
export async function requireDbUserId(): Promise<number> {
  const user = await getCurrentUser();
  if (!user?.email) throw new ApiError(401, 'AUTH_REQUIRED');
  const dbUser = await getUserByEmail(user.email);
  if (!dbUser) throw new ApiError(404, 'USER_NOT_FOUND');
  return dbUser.id;
}

/** Auth + ownership check, returning the owned session. */
export async function requireOwnedSession(sessionId: string): Promise<BrowserSessionInfo> {
  const userId = await requireDbUserId();
  const session = await getBrowserSessionForUser(sessionId, userId);
  if (!session) throw new ApiError(404, 'NOT_FOUND');
  return session;
}

/** Normalize an error into a JSON response. */
export function toErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  const status = err instanceof ApiError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Unknown error';
  const code = status === 401 ? 'AUTH_REQUIRED' : status === 404 ? 'NOT_FOUND' : 'SERVICE_ERROR';
  return { status, body: { error: message, code } };
}
