/**
 * GET /api/me/organizations — organizations the current user may represent in
 * chats, plus their current active organization id. `super_admin` sees all
 * organizations; everyone else sees their active memberships.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/lib/db/kysely';
import { listRepresentableOrganizations } from '@/lib/org-membership';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireAuth();
    const db = await getDb();
    const result = await listRepresentableOrganizations(user, db);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[me/organizations] failed:', error);
    return NextResponse.json({ error: 'Failed to load organizations' }, { status: 500 });
  }
}
