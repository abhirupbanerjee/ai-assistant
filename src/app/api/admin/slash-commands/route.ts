/**
 * Admin Slash Commands API
 *
 * GET  /api/admin/slash-commands - List all slash command configs
 * POST /api/admin/slash-commands - Reset all to defaults
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getSlashCommandConfigs,
  resetSlashCommandsToDefaults,
} from '@/lib/db/compat/slash-commands';
import { isToolEnabled } from '@/lib/tools';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const commands = await getSlashCommandConfigs();

    // Augment with underlying tool enabled status
    const commandsWithToolStatus = await Promise.all(
      commands.map(async (cmd) => ({
        ...cmd,
        toolEnabled: await isToolEnabled(cmd.toolName),
      }))
    );

    return NextResponse.json({ commands: commandsWithToolStatus });
  } catch (error) {
    console.error('Failed to fetch slash commands:', error);
    return NextResponse.json(
      { error: 'Failed to fetch slash commands' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    if (body.action !== 'reset') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    await resetSlashCommandsToDefaults(user.email);

    return NextResponse.json({
      success: true,
      message: 'Slash commands reset to defaults',
    });
  } catch (error) {
    console.error('Failed to reset slash commands:', error);
    return NextResponse.json(
      { error: 'Failed to reset slash commands' },
      { status: 500 }
    );
  }
}
