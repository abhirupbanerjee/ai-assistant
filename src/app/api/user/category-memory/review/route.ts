import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getUserByEmail,
  getCategoryMemoryLearningMetrics,
  listCategoryMemoryReviewQueue,
  listEffectiveCategoryMemoryCategories,
} from '@/lib/db/compat';

export async function GET(request: Request) {
  if (request.headers.get('x-agent-bot-api-key') || request.headers.get('x-workspace-slug')) {
    return NextResponse.json({ error: 'Main chat user session required', code: 'ACCESS_DENIED' }, { status: 403 });
  }
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  const user = await getUserByEmail(session.email);
  if (!user) return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  const categories = await listEffectiveCategoryMemoryCategories(user.id, user.role);
  const manageable = categories.filter((category) => category.canManage && category.memoryEnabled);
  const categoryIds = manageable.map((category) => category.id);
  const [items, metrics] = await Promise.all([
    listCategoryMemoryReviewQueue(categoryIds),
    getCategoryMemoryLearningMetrics(categoryIds),
  ]);
  return NextResponse.json({
    items,
    categories: manageable.map(({ id, name }) => ({ id, name })),
    metrics,
  });
}
