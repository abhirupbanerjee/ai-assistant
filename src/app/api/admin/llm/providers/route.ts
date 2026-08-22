/**
 * LLM Providers API
 *
 * GET  - List all providers
 * POST - Create new provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isElevatedRole } from '@/lib/auth';
import {
  getAllProviders,
  createProvider,
  maskApiKey,
  PROVIDER_ENV_KEYS,
  type CreateProviderInput,
} from '@/lib/db/compat/llm-providers';
import { safeDecrypt } from '@/lib/encryption';
import { resetLlmClients as resetInternalClients } from '@/lib/llm-client';
import { resetLlmClients as resetOpenAiClients } from '@/lib/openai';
import { resetLlmClients as resetAgentClients } from '@/lib/agent/llm-router';
import type { ApiError } from '@/types';
import { blockLegacyWrite } from '@/lib/legacy-writes';

// GET /api/admin/llm/providers - List all providers
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!isElevatedRole(user?.role)) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const providers = await getAllProviders();

    // Mask API keys for security
    const safeProviders = providers.map(p => {
      const envConfig = PROVIDER_ENV_KEYS[p.id];
      const envVarName = envConfig?.apiKey ?? envConfig?.apiBase ?? '';
      const decryptedKey = safeDecrypt(p.apiKey);
      return {
        ...p,
        apiKey: maskApiKey(decryptedKey),
        apiKeyConfigured: !!decryptedKey,
        apiKeyFromEnv: !decryptedKey && !!process.env[envVarName],
      };
    });

    return NextResponse.json({ providers: safeProviders });
  } catch (error) {
    console.error('[LLM Providers] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch providers',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// POST /api/admin/llm/providers - Create new provider
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Phase F: provider rows (llm_providers) are now written via CredentialVault /
    // the consolidated AI & API Setup page. Reads (GET) remain functional.
    const blocked = await blockLegacyWrite();
    if (blocked) return blocked;

    const body = await request.json() as CreateProviderInput;

    // Validate required fields
    if (!body.id || !body.name) {
      return NextResponse.json<ApiError>(
        { error: 'Provider ID and name are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const provider = await createProvider(body);

    // Invalidate cached LLM clients so new keys take effect immediately
    resetInternalClients();
    resetOpenAiClients();
    resetAgentClients();
    return NextResponse.json({
      provider: {
        ...provider,
        apiKey: maskApiKey(safeDecrypt(provider.apiKey)),
        apiKeyConfigured: !!safeDecrypt(provider.apiKey),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[LLM Providers] POST error:', error);

    // Check for duplicate key error
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return NextResponse.json<ApiError>(
        { error: 'Provider already exists', code: 'DUPLICATE_ERROR' },
        { status: 409 }
      );
    }

    return NextResponse.json<ApiError>(
      {
        error: 'Failed to create provider',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
