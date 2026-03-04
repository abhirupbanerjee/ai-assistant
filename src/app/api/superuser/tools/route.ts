/**
 * Superuser Tools API - View tools with category overrides
 *
 * GET /api/superuser/tools
 * Returns all tools with their global config and category-specific overrides
 * for the superuser's assigned categories.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import { getAllToolConfigs, TOOL_DEFAULTS } from '@/lib/db/compat/tool-config';
import {
  getCategoryToolConfigs,
  getEffectiveToolConfig,
  type CategoryToolConfig,
} from '@/lib/db/compat/category-tool-config';
import { getAllTools, initializeTools, HYBRID_TOOLS } from '@/lib/tools';
import { TERMINAL_TOOLS } from '@/lib/openai';

interface CategoryToolStatus {
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  isEnabled: boolean | null; // null = inherit, true/false = override
  effectiveEnabled: boolean;
  branding: CategoryToolConfig['branding'];
}

interface ToolWithCategories {
  name: string;
  displayName: string;
  description: string;
  category: string;
  globalEnabled: boolean;
  isTerminal: boolean;
  isHybrid: boolean;
  categories: CategoryToolStatus[];
}

/**
 * GET /api/superuser/tools
 * Returns all tools with category-level configuration for superuser's assigned categories
 */
export async function GET() {
  try {
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

    // Get superuser's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData) {
      return NextResponse.json({ error: 'Superuser data not found' }, { status: 404 });
    }

    const assignedCategories = superUserData.assignedCategories;

    // Initialize tools system if needed
    await initializeTools();

    // Get all tool definitions from registry
    const toolDefinitions = getAllTools();

    // Get all global tool configurations
    const globalConfigs = await getAllToolConfigs();
    const globalConfigMap = new Map(globalConfigs.map(tc => [tc.toolName, tc]));

    // Build response with category-level configs
    const tools: ToolWithCategories[] = await Promise.all(toolDefinitions.map(async tool => {
      const globalConfig = globalConfigMap.get(tool.name);
      const defaults = TOOL_DEFAULTS[tool.name];
      const globalEnabled = globalConfig?.isEnabled ?? defaults?.enabled ?? false;

      // Get category-level status for each assigned category
      const categories: CategoryToolStatus[] = await Promise.all(assignedCategories.map(async cat => {
        const effective = await getEffectiveToolConfig(tool.name, cat.categoryId);
        const categoryConfigs = await getCategoryToolConfigs(cat.categoryId);
        const categoryConfig = categoryConfigs.find(c => c.toolName === tool.name);

        return {
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          categorySlug: cat.categorySlug,
          isEnabled: categoryConfig?.isEnabled ?? null, // null means inherit
          effectiveEnabled: effective.enabled,
          branding: categoryConfig?.branding ?? null,
        };
      }));

      return {
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        category: tool.category,
        globalEnabled,
        isTerminal: TERMINAL_TOOLS.has(tool.name),
        isHybrid: HYBRID_TOOLS.has(tool.name),
        categories,
      };
    }));

    return NextResponse.json({
      tools,
      assignedCategories: assignedCategories.map(c => ({
        id: c.categoryId,
        name: c.categoryName,
        slug: c.categorySlug,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch superuser tools:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tools' },
      { status: 500 }
    );
  }
}
