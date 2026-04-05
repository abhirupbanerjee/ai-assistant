import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getActiveModels } from '@/lib/db/compat/enabled-models';
import { getRoutesSettings } from '@/lib/db/compat/config';
import { isRoute2Model, isRoute3Model } from '@/lib/llm-fallback';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const models = await getActiveModels();
  const routesSettings = await getRoutesSettings();

  // Filter models by active routes
  const filteredModels = models.filter(m => {
    if (isRoute3Model(m.id)) return routesSettings.route3Enabled;
    if (isRoute2Model(m.id)) return routesSettings.route2Enabled;
    return routesSettings.route1Enabled;
  });

  return NextResponse.json({ models: filteredModels });
}
