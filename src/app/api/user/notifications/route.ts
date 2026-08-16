import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, listNotifications, markNotificationRead } from '@/lib/db/compat';

async function currentDbUser(request: Request) {
  if (request.headers.get('x-agent-bot-api-key') || request.headers.get('x-workspace-slug')) return null;
  const session = await getCurrentUser();
  return session ? getUserByEmail(session.email) : null;
}

export async function GET(request: Request) {
  const user = await currentDbUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  return NextResponse.json(await listNotifications(user.id));
}

export async function PATCH(request: Request) {
  const user = await currentDbUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 });
  const body = await request.json() as { id?: number; all?: boolean };
  if (!body.all && (!Number.isInteger(body.id) || Number(body.id) <= 0)) {
    return NextResponse.json({ error: 'A positive notification id or all=true is required', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  await markNotificationRead(user.id, body.all ? undefined : body.id);
  return NextResponse.json({ success: true });
}
