import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getActiveModels } from '@/lib/db/compat/enabled-models';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const models = await getActiveModels();
  return NextResponse.json({ models });
}
