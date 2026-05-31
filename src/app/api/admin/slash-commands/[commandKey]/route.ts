/**
 * Admin Slash Command Single Item API
 *
 * PATCH /api/admin/slash-commands/:commandKey - Update a slash command
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getSlashCommandByKey,
  updateSlashCommand,
} from '@/lib/db/compat/slash-commands';
import { isToolEnabled } from '@/lib/tools';
import type { SlashCommandUpdate } from '@/types/slash-commands';

interface RouteParams {
  params: Promise<{ commandKey: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { commandKey } = await params;
    const body = (await request.json()) as SlashCommandUpdate;

    // Validate command exists
    const existing = await getSlashCommandByKey(commandKey);
    if (!existing) {
      return NextResponse.json({ error: 'Command not found' }, { status: 404 });
    }

    // Validation: cannot enable if underlying tool is disabled
    if (body.enabled === true) {
      const toolEnabled = await isToolEnabled(existing.toolName);
      if (!toolEnabled) {
        return NextResponse.json(
          { error: 'Cannot enable slash command when underlying tool is disabled' },
          { status: 400 }
        );
      }
    }

    // Validation: aliases must be valid
    if (body.aliases !== undefined) {
      if (!Array.isArray(body.aliases) || body.aliases.length === 0) {
        return NextResponse.json(
          { error: 'Aliases must be a non-empty array' },
          { status: 400 }
        );
      }
      const invalidAlias = body.aliases.find(
        (a) => !/^[a-z0-9_-]+$/.test(a)
      );
      if (invalidAlias) {
        return NextResponse.json(
          { error: `Invalid alias: '${invalidAlias}'. Use only lowercase letters, numbers, underscores, and hyphens.` },
          { status: 400 }
        );
      }
    }

    await updateSlashCommand(commandKey, body, user.email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Failed to update slash command:`, error);
    return NextResponse.json(
      { error: 'Failed to update slash command' },
      { status: 500 }
    );
  }
}
