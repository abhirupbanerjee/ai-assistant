/**
 * Superuser Agent Bots API
 *
 * GET /api/superuser/agent-bots - List agent bots accessible to the superuser
 *
 * Returns agent bots whose categories overlap with the superuser's assigned categories.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/users';
import { queryAll } from '@/lib/db';

interface AgentBotRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: number;
}

interface VersionCategoryRow {
  agent_bot_id: string;
  category_id: number;
  category_name: string;
}

interface DefaultVersionRow {
  agent_bot_id: string;
  version_number: number;
}

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
    const superUserData = getSuperUserWithAssignments(userId);
    const userCategoryIds = (superUserData?.assignedCategories || []).map(
      (c) => c.categoryId
    );

    if (userCategoryIds.length === 0) {
      return NextResponse.json({ agentBots: [] });
    }

    // Get all agent bots that have at least one version with a matching category
    const placeholders = userCategoryIds.map(() => '?').join(',');
    const agentBotIds = queryAll<{ agent_bot_id: string }>(
      `SELECT DISTINCT v.agent_bot_id
       FROM agent_bot_version_categories vc
       JOIN agent_bot_versions v ON vc.version_id = v.id
       WHERE vc.category_id IN (${placeholders})`,
      userCategoryIds
    ).map((r) => r.agent_bot_id);

    if (agentBotIds.length === 0) {
      return NextResponse.json({ agentBots: [] });
    }

    // Get agent bot details
    const botPlaceholders = agentBotIds.map(() => '?').join(',');
    const bots = queryAll<AgentBotRow>(
      `SELECT id, name, slug, description, is_active
       FROM agent_bots
       WHERE id IN (${botPlaceholders})
       ORDER BY name`,
      agentBotIds
    );

    // Get category names for each agent bot
    const versionCategories = queryAll<VersionCategoryRow>(
      `SELECT DISTINCT v.agent_bot_id, vc.category_id, c.name as category_name
       FROM agent_bot_version_categories vc
       JOIN agent_bot_versions v ON vc.version_id = v.id
       JOIN categories c ON vc.category_id = c.id
       WHERE v.agent_bot_id IN (${botPlaceholders})`,
      agentBotIds
    );

    // Get default version number for each bot
    const defaultVersions = queryAll<DefaultVersionRow>(
      `SELECT agent_bot_id, version_number
       FROM agent_bot_versions
       WHERE agent_bot_id IN (${botPlaceholders}) AND is_default = 1`,
      agentBotIds
    );

    // Build category map
    const categoryMap = new Map<string, string[]>();
    versionCategories.forEach((vc) => {
      if (!categoryMap.has(vc.agent_bot_id)) {
        categoryMap.set(vc.agent_bot_id, []);
      }
      const cats = categoryMap.get(vc.agent_bot_id)!;
      if (!cats.includes(vc.category_name)) {
        cats.push(vc.category_name);
      }
    });

    // Build default version map
    const defaultVersionMap = new Map<string, number>();
    defaultVersions.forEach((dv) => {
      defaultVersionMap.set(dv.agent_bot_id, dv.version_number);
    });

    // Build response
    const agentBots = bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      slug: bot.slug,
      description: bot.description,
      is_active: bot.is_active === 1,
      categories: categoryMap.get(bot.id) || [],
      default_version: defaultVersionMap.get(bot.id) || null,
    }));

    return NextResponse.json({ agentBots });
  } catch (error) {
    console.error('Failed to fetch agent bots for superuser:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent bots' },
      { status: 500 }
    );
  }
}
