/**
 * Superuser Tool Configuration API - Manage per-category tool settings
 *
 * GET   /api/superuser/tools/[toolName] - Get tool config for all assigned categories
 * PATCH /api/superuser/tools/[toolName] - Update tool config for a specific category
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, superUserHasCategory } from '@/lib/db/compat';
import { getToolConfig, TOOL_DEFAULTS } from '@/lib/db/compat/tool-config';
import {
  getCategoryToolConfig,
  upsertCategoryToolConfig,
  deleteCategoryToolConfig,
  getEffectiveToolConfig,
  type BrandingConfig,
} from '@/lib/db/compat/category-tool-config';
import { getTool, initializeTools } from '@/lib/tools';

interface RouteParams {
  params: Promise<{ toolName: string }>;
}

/**
 * GET /api/superuser/tools/[toolName]
 * Returns detailed configuration for a specific tool across all assigned categories
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { toolName } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Superuser access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Initialize tools and validate tool exists
    await initializeTools();
    const tool = getTool(toolName);
    if (!tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
    }

    // Get superuser's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData) {
      return NextResponse.json({ error: 'Superuser data not found' }, { status: 404 });
    }

    // Get global config
    const globalConfig = await getToolConfig(toolName);
    const defaults = TOOL_DEFAULTS[toolName];
    const globalEnabled = globalConfig?.isEnabled ?? defaults?.enabled ?? false;

    // Get config for each assigned category
    const categoryConfigs = await Promise.all(superUserData.assignedCategories.map(async cat => {
      const categoryConfig = await getCategoryToolConfig(cat.categoryId, toolName);
      const effective = await getEffectiveToolConfig(toolName, cat.categoryId);

      return {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        categorySlug: cat.categorySlug,
        config: categoryConfig ? {
          id: categoryConfig.id,
          isEnabled: categoryConfig.isEnabled,
          branding: categoryConfig.branding,
          config: categoryConfig.config,
          updatedAt: categoryConfig.updatedAt,
          updatedBy: categoryConfig.updatedBy,
        } : null,
        effective: {
          enabled: effective.enabled,
          branding: effective.branding,
          config: effective.config,
        },
      };
    }));

    return NextResponse.json({
      tool: {
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        category: tool.category,
      },
      globalEnabled,
      categoryConfigs,
    });
  } catch (error) {
    console.error('Failed to fetch tool config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tool configuration' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/superuser/tools/[toolName]
 * Update tool configuration for a specific category
 *
 * Body:
 * {
 *   categoryId: number,
 *   isEnabled?: boolean | null,  // null = inherit from global
 *   branding?: BrandingConfig | null,  // null = inherit from global
 *   config?: Record<string, unknown> | null  // Tool-specific config (e.g., templates for task_planner)
 * }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { toolName } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Superuser access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Initialize tools and validate tool exists
    await initializeTools();
    const tool = getTool(toolName);
    if (!tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
    }

    // Parse request body
    const body = await request.json();
    const { categoryId, isEnabled, branding, config } = body as {
      categoryId: number;
      isEnabled?: boolean | null;
      branding?: BrandingConfig | null;
      config?: Record<string, unknown> | null;
    };

    if (!categoryId || typeof categoryId !== 'number') {
      return NextResponse.json({ error: 'categoryId is required' }, { status: 400 });
    }

    // Verify superuser has access to this category
    if (!(await superUserHasCategory(userId, categoryId))) {
      return NextResponse.json(
        { error: 'Access denied to this category' },
        { status: 403 }
      );
    }

    // Check if this is a "reset to inherit" operation
    // If all override fields are explicitly null, delete the override
    const shouldDelete =
      isEnabled === null &&
      branding === null &&
      config === null &&
      body.hasOwnProperty('isEnabled') &&
      body.hasOwnProperty('branding') &&
      body.hasOwnProperty('config');

    if (shouldDelete) {
      const deleted = await deleteCategoryToolConfig(categoryId, toolName);
      if (deleted) {
        return NextResponse.json({
          success: true,
          message: 'Category tool config reset to inherit from global',
        });
      }
    }

    // Validate branding if provided
    if (branding !== undefined && branding !== null) {
      const brandingErrors = validateBranding(branding);
      if (brandingErrors.length > 0) {
        return NextResponse.json(
          { error: 'Invalid branding config', details: brandingErrors },
          { status: 400 }
        );
      }
    }

    // Update or create the category tool config
    const updates: {
      isEnabled?: boolean | null;
      branding?: BrandingConfig | null;
      config?: Record<string, unknown> | null;
    } = {};

    if (body.hasOwnProperty('isEnabled')) {
      updates.isEnabled = isEnabled;
    }

    if (body.hasOwnProperty('branding')) {
      updates.branding = branding;
    }

    if (body.hasOwnProperty('config')) {
      updates.config = config;
    }

    const updated = await upsertCategoryToolConfig(
      categoryId,
      toolName,
      updates,
      user.email
    );

    // Get effective config after update
    const effective = await getEffectiveToolConfig(toolName, categoryId);

    return NextResponse.json({
      success: true,
      config: {
        id: updated.id,
        categoryId: updated.categoryId,
        toolName: updated.toolName,
        isEnabled: updated.isEnabled,
        branding: updated.branding,
        config: updated.config,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      },
      effective: {
        enabled: effective.enabled,
        branding: effective.branding,
        config: effective.config,
      },
    });
  } catch (error) {
    console.error('Failed to update tool config:', error);
    return NextResponse.json(
      { error: 'Failed to update tool configuration' },
      { status: 500 }
    );
  }
}

/**
 * Validate branding configuration
 */
function validateBranding(branding: BrandingConfig): string[] {
  const errors: string[] = [];

  if (typeof branding.enabled !== 'boolean') {
    errors.push('branding.enabled must be a boolean');
  }

  if (branding.logoUrl && typeof branding.logoUrl !== 'string') {
    errors.push('branding.logoUrl must be a string');
  }

  if (branding.organizationName && typeof branding.organizationName !== 'string') {
    errors.push('branding.organizationName must be a string');
  }

  if (branding.primaryColor && !/^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor)) {
    errors.push('branding.primaryColor must be a valid hex color (e.g., #003366)');
  }

  if (branding.fontFamily && typeof branding.fontFamily !== 'string') {
    errors.push('branding.fontFamily must be a string');
  }

  if (branding.header) {
    if (typeof branding.header.enabled !== 'boolean') {
      errors.push('branding.header.enabled must be a boolean');
    }
    if (typeof branding.header.content !== 'string') {
      errors.push('branding.header.content must be a string');
    }
  }

  if (branding.footer) {
    if (typeof branding.footer.enabled !== 'boolean') {
      errors.push('branding.footer.enabled must be a boolean');
    }
    if (typeof branding.footer.content !== 'string') {
      errors.push('branding.footer.content must be a string');
    }
    if (typeof branding.footer.includePageNumber !== 'boolean') {
      errors.push('branding.footer.includePageNumber must be a boolean');
    }
  }

  return errors;
}
