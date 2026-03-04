/**
 * Admin Single Skill API
 *
 * GET    /api/admin/skills/[id] - Get skill by ID
 * PUT    /api/admin/skills/[id] - Update skill
 * DELETE /api/admin/skills/[id] - Delete skill
 * PATCH  /api/admin/skills/[id] - Toggle active status
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireElevated } from '@/lib/auth';
import {
  getSkillById,
  updateSkill,
  deleteSkill,
  toggleSkillActive,
} from '@/lib/db/compat/skills';
import type { CreateSkillInput, TriggerType } from '@/lib/skills/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireElevated();

    const { id } = await params;
    const skillId = parseInt(id, 10);
    if (isNaN(skillId)) {
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    const skill = await getSkillById(skillId);
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    return NextResponse.json({ skill });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json({ error: 'Elevated access required' }, { status: 403 });
    }

    console.error('Error fetching skill:', error);
    return NextResponse.json(
      { error: 'Failed to fetch skill' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireElevated();

    const { id } = await params;
    const skillId = parseInt(id, 10);
    if (isNaN(skillId)) {
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    const existing = await getSkillById(skillId);
    if (!existing) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: Partial<CreateSkillInput> & { is_active?: boolean } = {};

    // Only include fields that are provided
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description?.trim() || undefined;
    if (body.prompt_content !== undefined) updates.prompt_content = body.prompt_content.trim();
    if (body.trigger_type !== undefined) {
      const validTriggerTypes: TriggerType[] = ['always', 'category', 'keyword'];
      if (!validTriggerTypes.includes(body.trigger_type)) {
        return NextResponse.json(
          { error: 'Invalid trigger type' },
          { status: 400 }
        );
      }
      updates.trigger_type = body.trigger_type;
    }
    if (body.trigger_value !== undefined) updates.trigger_value = body.trigger_value?.trim() || undefined;
    if (body.category_restricted !== undefined) updates.category_restricted = Boolean(body.category_restricted);
    if (body.is_index !== undefined) updates.is_index = Boolean(body.is_index);
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
    if (body.category_ids !== undefined) updates.category_ids = body.category_ids;

    // Tool routing fields
    if (body.match_type !== undefined) updates.match_type = body.match_type;
    if (body.tool_name !== undefined) updates.tool_name = body.tool_name || undefined;
    if (body.force_mode !== undefined) updates.force_mode = body.force_mode || undefined;
    if (body.tool_config_override !== undefined) updates.tool_config_override = body.tool_config_override || undefined;
    if (body.data_source_filter !== undefined) updates.data_source_filter = body.data_source_filter || undefined;

    // Compliance configuration
    if (body.compliance_config !== undefined) updates.compliance_config = body.compliance_config || undefined;

    await updateSkill(skillId, updates, user.email);

    return NextResponse.json({ message: 'Skill updated' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json({ error: 'Elevated access required' }, { status: 403 });
    }

    console.error('Error updating skill:', error);
    return NextResponse.json(
      { error: 'Failed to update skill' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await requireElevated();

    const { id } = await params;
    const skillId = parseInt(id, 10);
    if (isNaN(skillId)) {
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    const result = await deleteSkill(skillId);
    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: result.message === 'Skill not found' ? 404 : 403 }
      );
    }

    return NextResponse.json({ message: result.message });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json({ error: 'Elevated access required' }, { status: 403 });
    }

    console.error('Error deleting skill:', error);
    return NextResponse.json(
      { error: 'Failed to delete skill' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireElevated();

    const { id } = await params;
    const skillId = parseInt(id, 10);
    if (isNaN(skillId)) {
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    const newStatus = await toggleSkillActive(skillId, user.email);

    return NextResponse.json({
      message: `Skill ${newStatus ? 'activated' : 'deactivated'}`,
      is_active: newStatus,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json({ error: 'Elevated access required' }, { status: 403 });
    }

    console.error('Error toggling skill:', error);
    return NextResponse.json(
      { error: 'Failed to toggle skill' },
      { status: 500 }
    );
  }
}
