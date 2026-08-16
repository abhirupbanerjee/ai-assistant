import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  deleteCategoryMemory,
  createNotifications,
  getCategoryMemoryAccess,
  getCategoryMemoryById,
  getUserByEmail,
  isCategoryMemoryActive,
  listCategoryMemoryEvents,
  transitionCategoryMemory,
  updateCategoryMemory,
  type CategoryMemoryInput,
} from '@/lib/db/compat';
import { deleteCategoryMemoryVector, syncCategoryMemoryVector } from '@/lib/category-memory';

interface Params { params: Promise<{ categoryId: string; memoryId: string }> }

async function ownerContext(request: Request, params: Params['params']) {
  if (request.headers.get('x-agent-bot-api-key') || request.headers.get('x-workspace-slug')) return null;
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return null;
  const user = await getUserByEmail(sessionUser.email);
  const parsed = await params;
  const categoryId = Number(parsed.categoryId);
  const memoryId = Number(parsed.memoryId);
  if (!user || !Number.isInteger(categoryId) || !Number.isInteger(memoryId)) return null;
  const access = await getCategoryMemoryAccess(user.id, user.role, categoryId);
  return { user, categoryId, memoryId, access };
}

export async function GET(request: Request, { params }: Params) {
  const ctx = await ownerContext(request, params);
  if (!ctx) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.access.canRead) return NextResponse.json({ error: 'Access denied', code: 'ACCESS_DENIED' }, { status: 403 });
  const item = await getCategoryMemoryById(ctx.categoryId, ctx.memoryId);
  if (!item || !ctx.access.categoryEnabled || (!ctx.access.canManage && !isCategoryMemoryActive(item))) return NextResponse.json({ error: 'Memory not found', code: 'NOT_FOUND' }, { status: 404 });
  const events = ctx.access.canManage ? await listCategoryMemoryEvents(ctx.categoryId, ctx.memoryId) : [];
  return NextResponse.json({ item, events, canManage: ctx.access.canManage });
}

export async function PUT(request: Request, { params }: Params) {
  const ctx = await ownerContext(request, params);
  if (!ctx) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.access.canManage) return NextResponse.json({ error: 'Category owner access required', code: 'ACCESS_DENIED' }, { status: 403 });
  try {
    const body = await request.json() as CategoryMemoryInput & { action?: 'approve' | 'reject' | 'archive' | 'restore' };
    const before = await getCategoryMemoryById(ctx.categoryId, ctx.memoryId);
    if (!before) return NextResponse.json({ error: 'Memory not found', code: 'NOT_FOUND' }, { status: 404 });
    let item;
    if ((body.action === 'approve' || body.action === 'reject') && before.status === 'suggested'
      && body.title !== undefined && body.content !== undefined && body.memoryType !== undefined) {
      item = await updateCategoryMemory(ctx.categoryId, ctx.memoryId, ctx.user.id, body);
      item = await transitionCategoryMemory(ctx.categoryId, ctx.memoryId, ctx.user.id, body.action);
    } else {
      item = body.action
        ? await transitionCategoryMemory(ctx.categoryId, ctx.memoryId, ctx.user.id, body.action)
        : await updateCategoryMemory(ctx.categoryId, ctx.memoryId, ctx.user.id, body);
    }
    if (item.status === 'approved') await syncCategoryMemoryVector(item);
    else await deleteCategoryMemoryVector(item.id);
    if (before.status === 'suggested' && (body.action === 'approve' || body.action === 'reject') && before.createdBy) {
      await createNotifications({
        userIds: [before.createdBy],
        type: body.action === 'approve' ? 'category_memory_suggestion_approved' : 'category_memory_suggestion_rejected',
        title: `Category Memory suggestion ${body.action === 'approve' ? 'approved' : 'rejected'}`,
        message: `“${item.title}” was ${body.action === 'approve' ? 'approved and published' : 'rejected'}.`,
        resourceId: item.id, metadata: { categoryId: ctx.categoryId, suggestionId: item.id },
      });
    }
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid operation', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await ownerContext(request, params);
  if (!ctx) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.access.canManage) return NextResponse.json({ error: 'Category owner access required', code: 'ACCESS_DENIED' }, { status: 403 });
  const deleted = await deleteCategoryMemory(ctx.categoryId, ctx.memoryId);
  await deleteCategoryMemoryVector(ctx.memoryId);
  return deleted ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Memory not found', code: 'NOT_FOUND' }, { status: 404 });
}
