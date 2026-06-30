/**
 * LLM Routes Settings API
 *
 * Manages primary/fallback routing between direct provider paths.
 * Route 2: Direct providers (OpenAI, Claude, Gemini, Mistral, DeepSeek, Moonshot, Fireworks)
 * Route 3: Local / Ollama direct (air-gapped capable)
 * Route 5: Aggregator gateways (Azure AI Foundry, Fireworks AI, Ollama Cloud)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdminRole, isElevatedRole } from '@/lib/auth';
import {
  getRoutesSettings,
  setRoutesSettings,
  type RoutesSettings,
} from '@/lib/db/compat';

/**
 * GET - Retrieve current routes settings
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has elevated role (admin, super_admin, or superuser)
    if (!isElevatedRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const settings = await getRoutesSettings();

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[Routes Settings API] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routes settings' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update routes settings
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has admin role (only admins/super_admins can modify settings)
    if (!isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { route2Enabled, route3Enabled, route5Enabled, primaryRoute } = body;

    // Validate types
    if (route2Enabled !== undefined && typeof route2Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route2Enabled must be a boolean' }, { status: 400 });
    }
    if (route3Enabled !== undefined && typeof route3Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route3Enabled must be a boolean' }, { status: 400 });
    }
    if (route5Enabled !== undefined && typeof route5Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route5Enabled must be a boolean' }, { status: 400 });
    }
    if (primaryRoute !== undefined && !['route2', 'route3', 'route5'].includes(primaryRoute)) {
      return NextResponse.json({ error: 'primaryRoute must be "route2", "route3", or "route5"' }, { status: 400 });
    }

    // Cannot disable all routes
    const current = await getRoutesSettings();
    const newR2 = route2Enabled ?? current.route2Enabled;
    const newR3 = route3Enabled ?? current.route3Enabled;
    const newR5 = route5Enabled ?? current.route5Enabled;
    if (!newR2 && !newR3 && !newR5) {
      return NextResponse.json({ error: 'At least one route must be enabled' }, { status: 400 });
    }

    // Primary route must be enabled
    const newPrimary = primaryRoute ?? current.primaryRoute;
    const routeEnabled: Record<string, boolean> = {
      route2: newR2, route3: newR3, route5: newR5,
    };
    if (!routeEnabled[newPrimary]) {
      return NextResponse.json({ error: 'Primary route must be enabled' }, { status: 400 });
    }

    // Build update
    const updates: Partial<RoutesSettings> = {};
    if (route2Enabled !== undefined) updates.route2Enabled = route2Enabled;
    if (route3Enabled !== undefined) updates.route3Enabled = route3Enabled;
    if (route5Enabled !== undefined) updates.route5Enabled = route5Enabled;
    if (primaryRoute !== undefined) updates.primaryRoute = primaryRoute;

    const updatedSettings = await setRoutesSettings(updates, user.email);

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (error) {
    console.error('[Routes Settings API] Error saving settings:', error);
    return NextResponse.json(
      { error: 'Failed to save routes settings' },
      { status: 500 }
    );
  }
}
