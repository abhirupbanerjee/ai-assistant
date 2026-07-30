/**
 * Public Slash Commands API
 *
 * GET /api/chat/slash-commands - List enabled slash commands for the chat UI
 */

import { NextResponse } from 'next/server';
import { getEnabledSlashCommands } from '@/lib/db/compat/slash-commands';
import { isToolEnabled, AVAILABLE_TOOLS } from '@/lib/tools';

export async function GET() {
  try {
    const dbCommands = await getEnabledSlashCommands();
    const dbKeys = new Set(dbCommands.map((c) => c.commandKey));

    // Fallback: auto-derive from ToolDefinition.slashCommand for tools
    // whose slash command hasn't been seeded to the DB yet (new tools).
    // This makes / commands fully dynamic — like @ agent mentions.
    const autoCommands: typeof dbCommands = [];
    for (const [toolName, tool] of Object.entries(AVAILABLE_TOOLS)) {
      const cmd = tool.slashCommand;
      if (!cmd || dbKeys.has(cmd.commandKey)) continue;
      autoCommands.push({
        id: '',
        commandKey: cmd.commandKey,
        toolName,
        label: cmd.label,
        description: cmd.description,
        aliases: cmd.aliases,
        hint: '',
        icon: cmd.icon ?? '',
        formatHint: null,
        enabled: true,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
        updatedBy: '',
      });
    }

    const allCommands = [...dbCommands, ...autoCommands];

    // Filter out commands whose underlying tool is disabled
    const availableCommands = [];
    for (const cmd of allCommands) {
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
