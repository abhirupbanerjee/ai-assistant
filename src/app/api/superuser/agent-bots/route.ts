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
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import { getDb } from '@/lib/db/kysely';
import { sql } from 'kysely';


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
    const userCategoryIds = (superUserData?.assignedCategories || []).map(
      (c) => c.categoryId
    );

    if (userCategoryIds.length === 0) {
      return NextResponse.json({ agentBots: [] });
    }

    const db = await getDb();

    // Get all agent bots that have at least one version with a matching category
    const agentBotIdsResult = await db
      .selectFrom('agent_bot_version_categories as vc')
      .innerJoin('agent_bot_versions as v', 'vc.version_id', 'v.id')
      .select('v.agent_bot_id')
      .where('vc.category_id', 'in', userCategoryIds)
      .distinct()
      .execute();

    const agentBotIds = agentBotIdsResult.map((r) => r.agent_bot_id);

    if (agentBotIds.length === 0) {
      return NextResponse.json({ agentBots: [] });
    }

    // Get agent bot details
    const bots = await db
      .selectFrom('agent_bots')
      .select(['id', 'name', 'slug', 'description', 'is_active'])
      .where('id', 'in', agentBotIds)
      .orderBy('name')
      .execute();

    // Get category names for each agent bot
    const versionCategories = await db
      .selectFrom('agent_bot_version_categories as vc')
      .innerJoin('agent_bot_versions as v', 'vc.version_id', 'v.id')
      .innerJoin('categories as c', 'vc.category_id', 'c.id')
      .select(['v.agent_bot_id', 'vc.category_id', 'c.name as category_name'])
      .where('v.agent_bot_id', 'in', agentBotIds)
      .distinct()
      .execute();

    // Get default version number for each bot
    const defaultVersions = await db
      .selectFrom('agent_bot_versions')
      .select(['agent_bot_id', 'version_number'])
      .where('agent_bot_id', 'in', agentBotIds)
      .where('is_default', '=', 1)
      .execute();

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
