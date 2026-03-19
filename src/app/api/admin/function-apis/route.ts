/**
 * Admin Function APIs - List and create Function API configurations
 *
 * GET  /api/admin/function-apis - Get all Function API configs
 * POST /api/admin/function-apis - Create a new Function API config
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAllFunctionAPIConfigs,
  createFunctionAPIConfig,
  validateToolsSchema,
  validateEndpointMappings,
} from '@/lib/db/compat';
import { maskSensitiveValue } from '@/lib/encryption';
import type { FunctionAPIConfig, CreateFunctionAPIRequest } from '@/types/function-api';

/**
 * Mask sensitive fields in Function API config
 */
function maskFunctionAPIConfig(config: FunctionAPIConfig): FunctionAPIConfig {
  const masked = { ...config };

  if (masked.authCredentials) {
    masked.authCredentials = maskSensitiveValue(masked.authCredentials);
  }

  return masked;
}

/**
 * GET /api/admin/function-apis
 * Returns all Function API configurations
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get query params for filtering
    const searchParams = request.nextUrl.searchParams;
    const categoryId = searchParams.get('categoryId');

    // Get all Function API configs
    let configs = await getAllFunctionAPIConfigs();

    // Filter by category if specified
    if (categoryId) {
      const catId = parseInt(categoryId, 10);
      configs = configs.filter(c => c.categoryIds.includes(catId));
    }

    // Mask sensitive data
    const maskedConfigs = configs.map(maskFunctionAPIConfig);

    return NextResponse.json({
      functionApis: maskedConfigs,
      count: maskedConfigs.length,
    });
  } catch (error) {
    console.error('Failed to fetch function APIs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch function APIs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/function-apis
 * Create a new Function API configuration
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = (await request.json()) as CreateFunctionAPIRequest;

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    if (!body.baseUrl) {
      return NextResponse.json(
        { error: 'Base URL is required' },
        { status: 400 }
      );
    }
    if (!body.toolsSchema || !Array.isArray(body.toolsSchema)) {
      return NextResponse.json(
        { error: 'Tools schema is required and must be an array' },
        { status: 400 }
      );
    }
    if (!body.endpointMappings || typeof body.endpointMappings !== 'object') {
      return NextResponse.json(
        { error: 'Endpoint mappings are required' },
        { status: 400 }
      );
    }

    // Validate tools schema
    const schemaValidation = validateToolsSchema(body.toolsSchema);
    if (!schemaValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid tools schema', details: schemaValidation.errors },
        { status: 400 }
      );
    }

    // Validate endpoint mappings
    const mappingsValidation = validateEndpointMappings(body.toolsSchema, body.endpointMappings);
    if (!mappingsValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid endpoint mappings', details: mappingsValidation.errors },
        { status: 400 }
      );
    }

    // Create the Function API config
    const created = await createFunctionAPIConfig(body, user.email);

    // Return masked config
    return NextResponse.json({
      success: true,
      functionApi: maskFunctionAPIConfig(created),
    });
  } catch (error) {
    console.error('Failed to create function API:', error);

    // Handle duplicate name error
    if (
      error instanceof Error && (
        error.message.includes('UNIQUE constraint') ||
        error.message.includes('duplicate key value violates unique constraint')
      )
    ) {
      return NextResponse.json(
        { error: 'A function API with this name already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create function API' },
      { status: 500 }
    );
  }
}
