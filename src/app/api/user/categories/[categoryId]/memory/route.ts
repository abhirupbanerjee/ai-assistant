import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  createCategoryMemory,
  createCategoryMemorySuggestion,
  clearCategoryMemories,
  createNotifications,
  getCategoryMemoryAccess,
  getMemorySettings,
  getUserByEmail,
  listCategoryMemories,
  listCategoryMemoryReviewerIds,
  listUserCategoryMemorySuggestions,
  setCategoryMemoryEnabled,
  type CategoryMemoryInput,
} from '@/lib/db/compat';
import { deleteCategoryMemoryVector } from '@/lib/category-memory';

interface Params { params: Promise<{ categoryId: string }> }

async function context(request: Request, categoryIdRaw: string) {
  if (request.headers.get('x-agent-bot-api-key') || request.headers.get('x-workspace-slug')) return { error: 'SURFACE' as const };
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return { error: 'AUTH' as const };
  const user = await getUserByEmail(sessionUser.email);
  const categoryId = Number(categoryIdRaw);
  if (!user || !Number.isInteger(categoryId) || categoryId <= 0) return { error: 'INVALID' as const };
  return { user, categoryId, access: await getCategoryMemoryAccess(user.id, user.role, categoryId) };
}

function errorResponse(error: 'SURFACE' | 'AUTH' | 'INVALID') {
  if (error === 'AUTH') return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  if (error === 'INVALID') return NextResponse.json({ error: 'Invalid category', code: 'VALIDATION_ERROR' }, { status: 400 });
  return NextResponse.json({ error: 'Main chat user session required', code: 'ACCESS_DENIED' }, { status: 403 });
}

export async function GET(request: Request, { params }: Params) {
  const { categoryId: raw } = await params;
  const ctx = await context(request, raw);
  if (ctx.error) return errorResponse(ctx.error);
  if (!ctx.access.canRead || !ctx.access.categoryEnabled) return NextResponse.json({ error: 'Category access denied', code: 'ACCESS_DENIED' }, { status: 403 });
  const [items, ownSuggestions, settings] = await Promise.all([
    listCategoryMemories(ctx.categoryId, ctx.access.canManage),
    ctx.access.canManage ? Promise.resolve([]) : listUserCategoryMemorySuggestions(ctx.categoryId, ctx.user.id),
    getMemorySettings(),
  ]);
  return NextResponse.json({ items, ownSuggestions, canManage: ctx.access.canManage, categoryEnabled: ctx.access.categoryEnabled, suggestionsEnabled: settings.suggestionsEnabled });
}

export async function POST(request: Request, { params }: Params) {
  const { categoryId: raw } = await params;
  const ctx = await context(request, raw);
  if (ctx.error) return errorResponse(ctx.error);
  try {
    const body = await request.json() as CategoryMemoryInput & { suggestion?: boolean };
    const submitSuggestion = body.suggestion === true || !ctx.access.canManage;
    if (submitSuggestion && (!ctx.access.canRead || !ctx.access.categoryEnabled)) {
      return NextResponse.json({ error: 'Effective category access required', code: 'ACCESS_DENIED' }, { status: 403 });
    }
    const item = submitSuggestion
      ? await createCategoryMemorySuggestion(ctx.categoryId, ctx.user.id, body)
      : await createCategoryMemory(ctx.categoryId, ctx.user.id, body);
    if (submitSuggestion) {
      const reviewerIds = await listCategoryMemoryReviewerIds(ctx.categoryId);
      await createNotifications({
        userIds: [...reviewerIds, ctx.user.id], type: 'category_memory_suggestion_submitted',
        title: 'Category Memory suggestion submitted', message: `“${item.title}” is awaiting review.`,
        resourceId: item.id, metadata: { categoryId: ctx.categoryId, suggestionId: item.id },
      });
    }
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid memory';
    const duplicate = /unique|duplicate/i.test(message);
    return NextResponse.json({ error: duplicate ? 'A memory with this title already exists in the category' : message, code: duplicate ? 'CONFLICT' : 'VALIDATION_ERROR' }, { status: duplicate ? 409 : 400 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { categoryId: raw } = await params;
  const ctx = await context(request, raw);
  if (ctx.error) return errorResponse(ctx.error);
  if (ctx.user.role !== 'admin' && ctx.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Administrator access required', code: 'ACCESS_DENIED' }, { status: 403 });
  }
  const body = await request.json() as { enabled?: boolean };
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Enabled must be boolean', code: 'VALIDATION_ERROR' }, { status: 400 });
  await setCategoryMemoryEnabled(ctx.categoryId, body.enabled);
  return NextResponse.json({ success: true, categoryEnabled: body.enabled });
}

export async function DELETE(request: Request, { params }: Params) {
  const { categoryId: raw } = await params;
  const ctx = await context(request, raw);
  if (ctx.error) return errorResponse(ctx.error);
  if (ctx.user.role !== 'admin' && ctx.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Administrator access required', code: 'ACCESS_DENIED' }, { status: 403 });
  }
  const ids = await clearCategoryMemories(ctx.categoryId);
  await Promise.all(ids.map((id) => deleteCategoryMemoryVector(id)));
  return NextResponse.json({ success: true, deletedCount: ids.length });
}
