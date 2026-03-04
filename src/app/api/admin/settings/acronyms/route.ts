/**
 * Admin - Acronym Mappings Settings API
 *
 * GET  /api/admin/settings/acronyms - Get acronym mappings
 * PUT  /api/admin/settings/acronyms - Update acronym mappings
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getAcronymMappings,
  setAcronymMappings,
  getSettingMetadata,
  type AcronymMappings,
} from '@/lib/db/compat';

// GET - Get acronym mappings
export async function GET() {
  try {
    await requireAdmin();
    const mappings = await getAcronymMappings();
    const meta = await getSettingMetadata('acronym-mappings');
    return NextResponse.json({
      mappings,
      updatedAt: meta?.updatedAt || new Date().toISOString(),
      updatedBy: meta?.updatedBy || 'system',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error fetching acronym mappings:', error);
    return NextResponse.json({ error: 'Failed to fetch acronym mappings' }, { status: 500 });
  }
}

// PUT - Update acronym mappings
export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const { mappings } = body;

    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
      return NextResponse.json({ error: 'mappings must be an object' }, { status: 400 });
    }

    // Normalize: keys uppercase, values as string arrays
    const normalized: AcronymMappings = {};
    for (const [key, value] of Object.entries(mappings)) {
      if (typeof key !== 'string') {
        return NextResponse.json({ error: 'All mapping keys must be strings' }, { status: 400 });
      }
      if (typeof value === 'string') {
        normalized[key.toUpperCase()] = [value];
      } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
        normalized[key.toUpperCase()] = value as string[];
      } else {
        return NextResponse.json(
          { error: `Value for "${key}" must be a string or array of strings` },
          { status: 400 }
        );
      }
    }

    await setAcronymMappings(normalized, admin.email);
    const meta = await getSettingMetadata('acronym-mappings');

    return NextResponse.json({
      success: true,
      mappings: normalized,
      updatedAt: meta?.updatedAt || new Date().toISOString(),
      updatedBy: meta?.updatedBy || admin.email,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error updating acronym mappings:', error);
    return NextResponse.json({ error: 'Failed to update acronym mappings' }, { status: 500 });
  }
}
