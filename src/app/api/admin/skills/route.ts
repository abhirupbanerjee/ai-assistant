/**
 * Admin Skills API
 *
 * GET  /api/admin/skills - List all skills with categories
 * POST /api/admin/skills - Create a new skill
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireElevated } from '@/lib/auth';
import {
  getAllSkillsWithCategories,
  createSkill,
  resetCoreSkillsToDefaults,
} from '@/lib/db/compat/skills';
import { getSkillsSettings } from '@/lib/db/compat';
import { seedCoreSkills } from '@/lib/skills/seed';
import { clearConfigCache } from '@/lib/config-loader';
import type { CreateSkillInput, TriggerType, SkillWithCategories } from '@/lib/skills/types';

/**
 * Get skills filtered by category IDs (includes global skills)
 * Returns skills where:
 * - category_restricted = false (global, available to all)
 * - OR linked to one of the given categories via category_skills
 */
async function getSkillsForCategories(categoryIds: number[]): Promise<SkillWithCategories[]> {
  if (categoryIds.length === 0) return [];

  const categoryIdSet = new Set(categoryIds);
  const allSkills = await getAllSkillsWithCategories();

  return allSkills.filter(skill => {
    // Include global skills (not category-restricted)
    if (!skill.category_restricted) return true;

    // Include skills linked to any of the selected categories
    return skill.categories.some(cat => categoryIdSet.has(cat.id));
  });
}

export async function GET(request: NextRequest) {
  try {
    await requireElevated();

    // Check for categoryIds query parameter
    const { searchParams } = new URL(request.url);
    const categoryIdsParam = searchParams.get('categoryIds');

    let skills: SkillWithCategories[];

    if (categoryIdsParam) {
      // Filter by categories - returns global skills + skills linked to given categories
      const categoryIds = categoryIdsParam.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      skills = await getSkillsForCategories(categoryIds);
    } else {
      // Return all skills
      skills = await getAllSkillsWithCategories();
    }

    const settings = await getSkillsSettings();

    return NextResponse.json({ skills, settings });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json({ error: 'Elevated access required' }, { status: 403 });
    }

    console.error('Error fetching skills:', error);
    return NextResponse.json(
      { error: 'Failed to fetch skills' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireElevated();

    const body = await request.json();
    const {
      name,
      description,
      prompt_content,
      trigger_type,
      trigger_value,
      category_restricted,
      is_index,
      priority,
      category_ids,
      // Tool routing fields
      match_type,
      tool_name,
      force_mode,
      tool_config_override,
      data_source_filter,
      // Compliance configuration
      compliance_config,
    } = body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Skill name is required' },
        { status: 400 }
      );
    }

    if (!prompt_content || typeof prompt_content !== 'string' || prompt_content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Prompt content is required' },
        { status: 400 }
      );
    }

    const validTriggerTypes: TriggerType[] = ['always', 'category', 'keyword'];
    if (!trigger_type || !validTriggerTypes.includes(trigger_type)) {
      return NextResponse.json(
        { error: 'Valid trigger type is required (always, category, keyword)' },
        { status: 400 }
      );
    }

    // Keyword trigger requires trigger_value
    if (trigger_type === 'keyword' && (!trigger_value || trigger_value.trim().length === 0)) {
      return NextResponse.json(
        { error: 'Keywords are required for keyword-triggered skills' },
        { status: 400 }
      );
    }

    // Category trigger requires category_ids
    if (trigger_type === 'category' && (!category_ids || category_ids.length === 0)) {
      return NextResponse.json(
        { error: 'At least one category is required for category-triggered skills' },
        { status: 400 }
      );
    }

    const input: CreateSkillInput = {
      name: name.trim(),
      description: description?.trim() || undefined,
      prompt_content: prompt_content.trim(),
      trigger_type,
      trigger_value: trigger_value?.trim() || undefined,
      category_restricted: Boolean(category_restricted),
      is_index: Boolean(is_index),
      priority: typeof priority === 'number' ? priority : 100,
      category_ids: category_ids || [],
      // Tool routing fields
      match_type: match_type || 'keyword',
      tool_name: tool_name || undefined,
      force_mode: force_mode || undefined,
      tool_config_override: tool_config_override || undefined,
      data_source_filter: data_source_filter || undefined,
      // Compliance configuration
      compliance_config: compliance_config || undefined,
    };

    const skillId = await createSkill(input, user.email, user.role);

    return NextResponse.json({ id: skillId, message: 'Skill created' }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json({ error: 'Elevated access required' }, { status: 403 });
    }

    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json(
        { error: 'A skill with this name already exists' },
        { status: 409 }
      );
    }

    console.error('Error creating skill:', error);
    return NextResponse.json(
      { error: 'Failed to create skill' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/skills - Restore core skills to config defaults
 * Deletes all core skills and re-seeds from config files
 */
export async function DELETE() {
  try {
    await requireElevated();

    // Clear config cache to reload fresh from files
    clearConfigCache();

    // Delete existing core skills
    const deleted = await resetCoreSkillsToDefaults();

    // Re-seed from config files
    await seedCoreSkills();

    // Get updated skills list
    const skills = await getAllSkillsWithCategories();
    const coreSkillsCount = skills.filter(s => s.is_core).length;

    return NextResponse.json({
      success: true,
      message: `Restored ${coreSkillsCount} core skills from config`,
      deleted,
      created: coreSkillsCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json({ error: 'Elevated access required' }, { status: 403 });
    }

    console.error('Error restoring skills:', error);
    return NextResponse.json(
      { error: 'Failed to restore skills to defaults' },
      { status: 500 }
    );
  }
}
