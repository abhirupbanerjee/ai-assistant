/**
 * Test Provider Connection API
 *
 * POST - Test provider connection by attempting to list models.
 *        Accepts an optional `{ apiKey?: string }` body to test an
 *        unsaved/edited key directly against the provider API without
 *        reading from DB/ENV. When no body is provided, falls back to
 *        testing the persisted credential.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getProvider } from '@/lib/db/compat/llm-providers';
import { testProviderConnection, testProviderConnectionWithKey } from '@/lib/services/model-discovery';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/admin/llm/providers/[id]/test
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const provider = await getProvider(id);

    if (!provider) {
      return NextResponse.json<ApiError>(
        { error: 'Provider not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Parse optional body — may contain { apiKey?: string, apiBase?: string }
    // to test an unsaved/edited key directly instead of persisted credentials.
    let body: { apiKey?: string; apiBase?: string } = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text) as { apiKey?: string; apiBase?: string };
      }
    } catch {
      // Body is optional; ignore parse errors
    }

    const hasProvidedKey = !!body.apiKey && !body.apiKey.includes('••');

    if (hasProvidedKey) {
      // Test the provided key directly — no DB/ENV read, no storage.
      const result = await testProviderConnectionWithKey(id, body.apiKey!, body.apiBase);
      return NextResponse.json({ provider: id, ...result });
    }

    // Fall back to testing the persisted credential (existing behavior)
    const result = await testProviderConnection(id);
    return NextResponse.json({ provider: id, ...result });
  } catch (error) {
    console.error('[LLM Provider] Test error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to test provider connection',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
