import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getUserByEmail,
  listCategoryMemories,
  listEffectiveCategoryMemoryCategories,
} from '@/lib/db/compat';

function download(content: string, filename: string, contentType: string) {
  return new NextResponse(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(request: Request) {
  if (request.headers.get('x-agent-bot-api-key') || request.headers.get('x-workspace-slug')) {
    return NextResponse.json({ error: 'Main chat user session required', code: 'ACCESS_DENIED' }, { status: 403 });
  }
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  const user = await getUserByEmail(sessionUser.email);
  if (!user) return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  if (!['superuser', 'admin', 'super_admin'].includes(user.role)) {
    return NextResponse.json({ error: 'Superuser or administrator access required', code: 'ACCESS_DENIED' }, { status: 403 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    return NextResponse.json({ error: 'Format must be json or text', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const categories = await listEffectiveCategoryMemoryCategories(user.id, user.role);
  const exportedAt = new Date().toISOString();
  const exportedCategories = await Promise.all(categories.map(async (category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    memoryEnabled: category.memoryEnabled,
    canManage: category.canManage,
    // Disabled categories retain their data; export remains a data-portability
    // operation and therefore includes every item visible to this role.
    items: await listCategoryMemories(category.id, category.canManage),
  })));
  const payload = { exportedAt, exportedBy: user.email, categories: exportedCategories };
  const date = exportedAt.slice(0, 10);

  if (format === 'json') {
    return download(`${JSON.stringify(payload, null, 2)}\n`, `category-memory-${date}.json`, 'application/json; charset=utf-8');
  }

  const lines = ['Category Memory Export', `Exported: ${exportedAt}`, `Exported by: ${user.email}`, ''];
  for (const category of exportedCategories) {
    lines.push(`# ${category.name}`, `Memory enabled: ${category.memoryEnabled ? 'yes' : 'no'}`, '');
    if (!category.items.length) lines.push('- No visible memory items', '');
    for (const item of category.items) {
      lines.push(`## ${item.title}`, `Type: ${item.memoryType}`, `Status: ${item.status}`, item.content);
      if (item.sourceReference) lines.push(`Source: ${item.sourceReference}`);
      if (item.expiresAt) lines.push(`Expires: ${item.expiresAt}`);
      lines.push('');
    }
  }
  return download(`${lines.join('\n')}\n`, `category-memory-${date}.txt`, 'text/plain; charset=utf-8');
}
