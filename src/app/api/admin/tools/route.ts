/**
 * Admin Tools API - List and manage all tools
 *
 * GET  /api/admin/tools - Get all tool configurations
 * POST /api/admin/tools - Initialize/reset all tools to defaults
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAllToolConfigs,
  ensureToolConfigsExist,
  TOOL_DEFAULTS,
} from '@/lib/db/compat/tool-config';
import { getAllTools, initializeTools, HYBRID_TOOLS } from '@/lib/tools';
import { TERMINAL_TOOLS } from '@/lib/openai';

/**
 * Mask sensitive data like API keys in responses
 */
function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey || apiKey.length < 8) return '••••••••';
  const visible = apiKey.substring(0, 4);
  const hidden = '•'.repeat(Math.min(apiKey.length - 4, 16));
  return `${visible}${hidden}`;
}

/**
 * GET /api/admin/tools
 * Returns all registered tools with their configurations
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Initialize tools system if needed
    await initializeTools();

    // Get all tool definitions from registry
    const toolDefinitions = getAllTools();

    // Get all tool configurations from database
    const toolConfigs = await getAllToolConfigs();
    const configMap = new Map(toolConfigs.map(tc => [tc.toolName, tc]));

    // Combine tool definitions with their configurations
    const tools = toolDefinitions.map(tool => {
      const config = configMap.get(tool.name);
      const defaults = TOOL_DEFAULTS[tool.name];

      // Mask API keys in config
      let safeConfig = config?.config || defaults?.config || {};
      if (safeConfig && typeof safeConfig === 'object' && 'apiKey' in safeConfig) {
        safeConfig = {
          ...safeConfig,
          apiKey: maskApiKey(safeConfig.apiKey as string),
        };
      }

      return {
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        category: tool.category,
        enabled: config?.isEnabled ?? defaults?.enabled ?? false,
        config: safeConfig,
        configSchema: tool.configSchema,
        defaultConfig: tool.defaultConfig,
        isTerminal: TERMINAL_TOOLS.has(tool.name),
        isHybrid: HYBRID_TOOLS.has(tool.name),
        metadata: config ? {
          id: config.id,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
          updatedBy: config.updatedBy,
        } : null,
      };
    });

    return NextResponse.json({ tools });
  } catch (error) {
    console.error('Failed to fetch tools:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tools' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/tools
 * Initialize or reset all tools to their default configurations
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Ensure all tools have configurations
    await ensureToolConfigsExist(user.email);

    return NextResponse.json({
      success: true,
      message: 'Tools initialized successfully',
    });
  } catch (error) {
    console.error('Failed to initialize tools:', error);
    return NextResponse.json(
      { error: 'Failed to initialize tools' },
      { status: 500 }
    );
  }
}
