import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMemorySettings, getUserByEmail, listEffectiveCategoryMemoryCategories } from '@/lib/db/compat';

export async function GET(request: Request) {
  if (request.headers.get('x-agent-bot-api-key') || request.headers.get('x-workspace-slug')) {
    return NextResponse.json({ error: 'Main chat user session required', code: 'ACCESS_DENIED' }, { status: 403 });
  }
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  const user = await getUserByEmail(sessionUser.email);
  if (!user) return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  const [categories, settings] = await Promise.all([
    listEffectiveCategoryMemoryCategories(user.id, user.role),
    getMemorySettings(),
  ]);
  return NextResponse.json({
    categories,
    canConfigure: user.role === 'admin' || user.role === 'super_admin',
    canExportCategoryMemory: user.role === 'admin' || user.role === 'super_admin' || user.role === 'superuser',
    suggestionsEnabled: settings.suggestionsEnabled,
  });
}
