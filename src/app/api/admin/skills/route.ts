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
} from '@/lib/db/skills';
import { getSkillsSettings, getDiagramSettings } from '@/lib/db/config';
import { seedCoreSkills } from '@/lib/skills/seed';
import { clearConfigCache } from '@/lib/config-loader';
import type { CreateSkillInput, TriggerType } from '@/lib/skills/types';

export async function GET() {
  try {
    await requireElevated();

    const skills = getAllSkillsWithCategories();
    const settings = getSkillsSettings();
    const diagramSettings = getDiagramSettings();

    return NextResponse.json({ skills, settings, diagramSettings });
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
    };

    const skillId = createSkill(input, user.email, user.role);

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
    const deleted = resetCoreSkillsToDefaults();

    // Re-seed from config files
    seedCoreSkills();

    // Get updated skills list
    const skills = getAllSkillsWithCategories();
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
