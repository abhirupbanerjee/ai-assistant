/**
 * Admin Tool API - Get and update a specific tool configuration
 *
 * GET   /api/admin/tools/[toolName] - Get tool configuration
 * PATCH /api/admin/tools/[toolName] - Update tool configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getToolConfig,
  updateToolConfig,
  createToolConfig,
  resetToolToDefaults,
  getToolConfigAuditHistory,
  TOOL_DEFAULTS,
} from '@/lib/db/compat/tool-config';
import { getTool, validateToolConfig, initializeTools } from '@/lib/tools';
import { invalidateTavilyCache } from '@/lib/redis';
import { upsertToolConfigAsync } from '@/lib/db/compat';

/**
 * Mask sensitive data like API keys in responses
 */
function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey || apiKey.length < 8) return '••••••••';
  const visible = apiKey.substring(0, 4);
  const hidden = '•'.repeat(Math.min(apiKey.length - 4, 16));
  return `${visible}${hidden}`;
}

interface RouteParams {
  params: Promise<{ toolName: string }>;
}

/**
 * GET /api/admin/tools/[toolName]
 * Get a specific tool's configuration
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { toolName } = await params;

    // Initialize tools system
    await initializeTools();

    // Get tool definition
    const tool = getTool(toolName);
    if (!tool) {
      return NextResponse.json(
        { error: `Unknown tool: ${toolName}` },
        { status: 404 }
      );
    }

    // Get tool configuration from database
    const config = await getToolConfig(toolName);
    const defaults = TOOL_DEFAULTS[toolName];

    // Mask API keys
    let safeConfig = config?.config || defaults?.config || {};
    if (safeConfig && typeof safeConfig === 'object' && 'apiKey' in safeConfig) {
      safeConfig = {
        ...safeConfig,
        apiKey: maskApiKey(safeConfig.apiKey as string),
      };
    }

    // Get audit history
    const auditHistory = await getToolConfigAuditHistory(toolName, 10);

    // Get default description from tool definition
    const defaultDescription = tool.definition?.function?.description ?? tool.description;

    return NextResponse.json({
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      category: tool.category,
      enabled: config?.isEnabled ?? defaults?.enabled ?? false,
      config: safeConfig,
      configSchema: tool.configSchema,
      defaultConfig: tool.defaultConfig,
      descriptionOverride: config?.descriptionOverride ?? null,
      defaultDescription,
      metadata: config ? {
        id: config.id,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      } : null,
      auditHistory: auditHistory.map(entry => ({
        id: entry.id,
        operation: entry.operation,
        changedBy: entry.changedBy,
        changedAt: entry.changedAt,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch tool:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tool' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/tools/[toolName]
 * Update a tool's configuration
 *
 * Request body:
 * {
 *   enabled?: boolean,
 *   config?: Record<string, unknown>,
 *   reset?: boolean  // If true, reset to defaults
 * }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { toolName } = await params;

    // Initialize tools system
    await initializeTools();

    // Get tool definition
    const tool = getTool(toolName);
    if (!tool) {
      return NextResponse.json(
        { error: `Unknown tool: ${toolName}` },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { enabled, config, reset, descriptionOverride } = body;

    // Handle reset to defaults
    if (reset === true) {
      const updated = await resetToolToDefaults(toolName, user.email);
      if (!updated) {
        return NextResponse.json(
          { error: 'Failed to reset tool' },
          { status: 500 }
        );
      }

      // Mirror reset to PostgreSQL
      await upsertToolConfigAsync(toolName, {
        isEnabled: updated.isEnabled,
        config: updated.config,
        descriptionOverride: updated.descriptionOverride,
      }, user.email);

      // Invalidate cache for web_search
      if (toolName === 'web_search') {
        await invalidateTavilyCache();
      }

      return NextResponse.json({
        success: true,
        message: 'Tool reset to defaults',
      });
    }

    // Validate configuration if provided
    if (config !== undefined) {
      // Get current config to merge with updates
      const currentConfig = await getToolConfig(toolName);
      const mergedConfig = {
        ...(currentConfig?.config || tool.defaultConfig),
        ...config,
      };

      // Handle API key: if masked value is sent, keep the existing key
      if (typeof mergedConfig.apiKey === 'string' && mergedConfig.apiKey.includes('•')) {
        // Masked API key was sent back - keep the original
        if (currentConfig?.config && 'apiKey' in currentConfig.config) {
          mergedConfig.apiKey = currentConfig.config.apiKey;
        } else {
          mergedConfig.apiKey = '';
        }
      }

      // Validate the configuration
      const validation = validateToolConfig(toolName, mergedConfig);
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'Invalid configuration', details: validation.errors },
          { status: 400 }
        );
      }

      // Update configuration (or create if doesn't exist)
      let updated = await updateToolConfig(toolName, {
        isEnabled: enabled,
        config: mergedConfig,
        ...(descriptionOverride !== undefined && { descriptionOverride }),
      }, user.email);

      // If update failed because config doesn't exist, create it
      if (!updated) {
        const created = await createToolConfig(
          toolName,
          mergedConfig,
          enabled ?? false,
          user.email
        );
        if (!created) {
          return NextResponse.json(
            { error: 'Failed to create tool configuration' },
            { status: 500 }
          );
        }
        updated = created;
      }

      // Mirror to PostgreSQL
      await upsertToolConfigAsync(toolName, {
        isEnabled: updated.isEnabled,
        config: updated.config,
        descriptionOverride: updated.descriptionOverride,
      }, user.email);

      // Invalidate cache for web_search
      if (toolName === 'web_search') {
        await invalidateTavilyCache();
      }

      // Return updated config with masked API key
      let safeConfig = updated.config;
      if (safeConfig && typeof safeConfig === 'object' && 'apiKey' in safeConfig) {
        safeConfig = {
          ...safeConfig,
          apiKey: maskApiKey(safeConfig.apiKey as string),
        };
      }

      return NextResponse.json({
        success: true,
        tool: {
          name: tool.name,
          displayName: tool.displayName,
          enabled: updated.isEnabled,
          config: safeConfig,
          updatedAt: updated.updatedAt,
          updatedBy: updated.updatedBy,
        },
      });
    }

    // If only enabled status and/or descriptionOverride is being updated
    if (enabled !== undefined || descriptionOverride !== undefined) {
      const updates: { isEnabled?: boolean; descriptionOverride?: string | null } = {};
      if (enabled !== undefined) updates.isEnabled = enabled;
      if (descriptionOverride !== undefined) updates.descriptionOverride = descriptionOverride;

      let updated = await updateToolConfig(toolName, updates, user.email);

      // If update failed because config doesn't exist, create it
      if (!updated) {
        const created = await createToolConfig(
          toolName,
          tool.defaultConfig,
          enabled ?? false,
          user.email
        );
        if (!created) {
          return NextResponse.json(
            { error: 'Failed to create tool configuration' },
            { status: 500 }
          );
        }
        updated = created;
      }

      // Mirror to PostgreSQL
      await upsertToolConfigAsync(toolName, {
        isEnabled: updated.isEnabled,
        config: updated.config,
        descriptionOverride: updated.descriptionOverride,
      }, user.email);

      return NextResponse.json({
        success: true,
        tool: {
          name: tool.name,
          displayName: tool.displayName,
          enabled: updated.isEnabled,
          descriptionOverride: updated.descriptionOverride,
          updatedAt: updated.updatedAt,
          updatedBy: updated.updatedBy,
        },
      });
    }

    return NextResponse.json(
      { error: 'No updates provided' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Failed to update tool:', error);
    return NextResponse.json(
      { error: 'Failed to update tool' },
      { status: 500 }
    );
  }
}
