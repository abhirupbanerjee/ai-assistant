/**
 * PUT /api/me/organizations/active — set the organization the current user is
 * representing in chats. Body: { organizationId: number | null }. The selection
 * is validated server-side against the user's representable organizations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/lib/db/kysely';
import { setActiveOrganization } from '@/lib/org-membership';

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireAuth();
    const body = await request.json().catch(() => null);

    const organizationId = body?.organizationId ?? null;
    if (
      organizationId !== null &&
      (typeof organizationId !== 'number' || !Number.isFinite(organizationId))
    ) {
      return NextResponse.json(
        { error: 'organizationId must be a number or null' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const updated = await setActiveOrganization(user, organizationId, db);
    if (updated === null && organizationId !== null) {
      return NextResponse.json(
        { error: 'You do not have access to this organization' },
        { status: 403 }
      );
    }

    return NextResponse.json({ activeOrganizationId: updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[me/organizations/active] failed:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}
