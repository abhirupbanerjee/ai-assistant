import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAutoToolModelMap, setAutoToolModelMap } from '@/lib/db/compat/config';
import { getActiveModels } from '@/lib/db/compat/enabled-models';
import { getAllTools, initializeTools } from '@/lib/tools';

/**
 * GET /api/admin/auto-model-map
 *
 * Returns the tool→model preference map for Auto model selection,
 * along with the list of available tools and active models for the UI.
 */
export async function GET() {
  try {
    const admin = await requireAdmin();

    const [map, models] = await Promise.all([
      getAutoToolModelMap(),
      getActiveModels(),
    ]);

    // Get tool definitions for the UI
    await initializeTools();
    const tools = getAllTools().map(t => ({
      name: t.name,
      displayName: t.displayName,
    }));

    return NextResponse.json({
      map,
      tools,
      models: models.map(m => ({
        id: m.id,
        displayName: m.displayName || m.id,
        toolCapable: m.toolCapable,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[Auto Model Map] GET error:', error);
    return NextResponse.json({ error: 'Failed to load auto model map' }, { status: 500 });
  }
}

/**
 * PUT /api/admin/auto-model-map
 *
 * Saves the tool→model preference map. Validates that each model id
 * references an active enabled model. Invalid entries are rejected.
 */
export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();

    if (!body || typeof body.map !== 'object' || Array.isArray(body.map)) {
      return NextResponse.json({ error: 'Invalid request: map must be an object' }, { status: 400 });
    }

    const map: Record<string, string> = body.map;

    // Validate that each model id references an active enabled model
    const activeModels = await getActiveModels();
    const activeModelIds = new Set(activeModels.map(m => m.id));

    const invalidEntries: string[] = [];
    for (const [toolName, modelId] of Object.entries(map)) {
      if (modelId && typeof modelId === 'string' && modelId.trim() && !activeModelIds.has(modelId.trim())) {
        invalidEntries.push(`${toolName}: ${modelId}`);
      }
    }

    if (invalidEntries.length > 0) {
      return NextResponse.json({
        error: `Invalid model ids: ${invalidEntries.join(', ')}`,
        code: 'INVALID_MODELS',
      }, { status: 400 });
    }

    await setAutoToolModelMap(map, admin.email);

    return NextResponse.json({ success: true, map: await getAutoToolModelMap() });
  } catch (error) {
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[Auto Model Map] PUT error:', error);
    return NextResponse.json({ error: 'Failed to save auto model map' }, { status: 500 });
  }
}
