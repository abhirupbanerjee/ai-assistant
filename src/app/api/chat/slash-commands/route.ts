/**
 * Public Slash Commands API
 *
 * GET /api/chat/slash-commands - List enabled slash commands for the chat UI
 */

import { NextResponse } from 'next/server';
import { getEnabledSlashCommands } from '@/lib/db/compat/slash-commands';
import { isToolEnabled } from '@/lib/tools';

export async function GET() {
  try {
    const commands = await getEnabledSlashCommands();

    // Filter out commands whose underlying tool is disabled
    const availableCommands = [];
    for (const cmd of commands) {
      if (await isToolEnabled(cmd.toolName)) {
        availableCommands.push({
          commandKey: cmd.commandKey,
          label: cmd.label,
          description: cmd.description,
          aliases: cmd.aliases,
          icon: cmd.icon,
        });
      }
    }

    return NextResponse.json({ commands: availableCommands });
  } catch (error) {
    console.error('Failed to fetch chat slash commands:', error);
    return NextResponse.json(
      { error: 'Failed to fetch slash commands' },
      { status: 500 }
    );
  }
}
