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
import { getDb } from '@/lib/db/kysely';
import { resolvePlatformProviderCredential } from '@/lib/provider-credential';
import { verifyProviderCredential } from '@/lib/provider-verification';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/admin/llm/providers/[id]/test
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isSuperAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Super-admin access required', code: 'ADMIN_REQUIRED' },
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
    const hasProvidedBase = typeof body.apiBase === 'string' && body.apiBase.trim().length > 0;

    if (hasProvidedKey || hasProvidedBase) {
      // Test unsaved input directly. Base-only providers such as Ollama must be
      // able to verify an edited endpoint without first saving it.
      const result = await verifyProviderCredential({
        providerId: id,
        apiKey: hasProvidedKey ? body.apiKey!.trim() : null,
        apiBase: hasProvidedBase ? body.apiBase!.trim() : null,
      });
      return NextResponse.json({ provider: id, success: result.ok, ...result });
    }

    // Resolve the same canonical platform source and revision used by runtime
    // provider clients; do not use a separate DB/environment lookup here.
    const db = await getDb();
    const resolved = await resolvePlatformProviderCredential(db, id);
    const result = await verifyProviderCredential(resolved);
    return NextResponse.json({
      provider: id,
      success: result.ok,
      credentialVersion: resolved.credentialVersion,
      ...result,
    });
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
