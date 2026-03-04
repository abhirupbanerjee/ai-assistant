/**
 * Admin Function API - Individual Function API operations
 *
 * GET    /api/admin/function-apis/[id] - Get a specific Function API config
 * PUT    /api/admin/function-apis/[id] - Update a Function API config
 * DELETE /api/admin/function-apis/[id] - Delete a Function API config
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getFunctionAPIConfig,
  updateFunctionAPIConfig,
  deleteFunctionAPIConfig,
  validateToolsSchema,
  validateEndpointMappings,
} from '@/lib/db/compat';
import { maskSensitiveValue } from '@/lib/encryption';
import type { FunctionAPIConfig, UpdateFunctionAPIRequest } from '@/types/function-api';

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
 * GET /api/admin/function-apis/[id]
 * Returns a specific Function API configuration
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const config = await getFunctionAPIConfig(id);

    if (!config) {
      return NextResponse.json(
        { error: 'Function API not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      functionApi: maskFunctionAPIConfig(config),
    });
  } catch (error) {
    console.error('Failed to fetch function API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch function API' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/function-apis/[id]
 * Update a Function API configuration
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateFunctionAPIRequest;

    // Check if config exists
    const existing = await getFunctionAPIConfig(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Function API not found' },
        { status: 404 }
      );
    }

    // Validate tools schema if provided
    if (body.toolsSchema) {
      const schemaValidation = validateToolsSchema(body.toolsSchema);
      if (!schemaValidation.valid) {
        return NextResponse.json(
          { error: 'Invalid tools schema', details: schemaValidation.errors },
          { status: 400 }
        );
      }

      // If endpoint mappings are also provided, validate them together
      if (body.endpointMappings) {
        const mappingsValidation = validateEndpointMappings(body.toolsSchema, body.endpointMappings);
        if (!mappingsValidation.valid) {
          return NextResponse.json(
            { error: 'Invalid endpoint mappings', details: mappingsValidation.errors },
            { status: 400 }
          );
        }
      } else {
        // Validate with existing mappings
        const mappingsValidation = validateEndpointMappings(body.toolsSchema, existing.endpointMappings);
        if (!mappingsValidation.valid) {
          return NextResponse.json(
            { error: 'Invalid endpoint mappings for new schema', details: mappingsValidation.errors },
            { status: 400 }
          );
        }
      }
    } else if (body.endpointMappings) {
      // Only endpoint mappings provided - validate with existing schema
      const mappingsValidation = validateEndpointMappings(existing.toolsSchema, body.endpointMappings);
      if (!mappingsValidation.valid) {
        return NextResponse.json(
          { error: 'Invalid endpoint mappings', details: mappingsValidation.errors },
          { status: 400 }
        );
      }
    }

    // Update the Function API config
    const updated = await updateFunctionAPIConfig(id, body, user.email);

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update function API' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      functionApi: maskFunctionAPIConfig(updated),
    });
  } catch (error) {
    console.error('Failed to update function API:', error);

    // Handle duplicate name error
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return NextResponse.json(
        { error: 'A function API with this name already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update function API' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/function-apis/[id]
 * Delete a Function API configuration
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;

    // Check if config exists
    const existing = await getFunctionAPIConfig(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Function API not found' },
        { status: 404 }
      );
    }

    // Delete the Function API config
    const deleted = await deleteFunctionAPIConfig(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete function API' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Function API '${existing.name}' deleted successfully`,
    });
  } catch (error) {
    console.error('Failed to delete function API:', error);
    return NextResponse.json(
      { error: 'Failed to delete function API' },
      { status: 500 }
    );
  }
}
