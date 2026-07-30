/**
 * Slash Command Configuration Database Operations
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import type { SlashCommandConfig, SlashCommandUpdate } from '@/types/slash-commands';

// ============ Default Seed Data ============

const DEFAULT_COMMANDS: Omit<SlashCommandConfig, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>[] = [
  // Type/format-specific variants only — generic commands are auto-derived from ToolDefinition.slashCommand.
  // Document format-specific commands
  {
    commandKey: 'pdf',
    toolName: 'doc_gen',
    label: 'Generate PDF',
    description: 'Create a PDF document',
    aliases: ['pdf'],
    hint: "The user wants to generate a PDF document. Use the doc_gen tool to fulfill this request. Use format='pdf'.",
    icon: 'FileText',
    formatHint: 'pdf',
    enabled: true,
    sortOrder: 3,
  },
  {
    commandKey: 'docx',
    toolName: 'doc_gen',
    label: 'Generate Word Doc',
    description: 'Create an editable Word document',
    aliases: ['doc', 'docx', 'word'],
    hint: "The user wants to generate a Word document. Use the doc_gen tool to fulfill this request. Use format='docx'.",
    icon: 'FileText',
    formatHint: 'docx',
    enabled: true,
    sortOrder: 4,
  },
  // Diagram type-specific commands
  {
    commandKey: 'flowchart',
    toolName: 'diagram_gen',
    label: 'Generate Flowchart',
    description: 'Create a flowchart diagram for processes and decisions',
    aliases: ['flowchart', 'flow'],
    hint: "The user wants to generate a flowchart diagram. Use the diagram_gen tool with diagram_type='flowchart'.",
    icon: 'Workflow',
    formatHint: null,
    enabled: true,
    sortOrder: 8,
  },
  {
    commandKey: 'sequence',
    toolName: 'diagram_gen',
    label: 'Generate Sequence Diagram',
    description: 'Create a sequence diagram for actor interactions over time',
    aliases: ['sequence', 'seq'],
    hint: "The user wants to generate a sequence diagram. Use the diagram_gen tool with diagram_type='sequence'.",
    icon: 'Workflow',
    formatHint: null,
    enabled: true,
    sortOrder: 9,
  },
  {
    commandKey: 'c4',
    toolName: 'diagram_gen',
    label: 'Generate C4 Diagram',
    description: 'Create a C4 architecture diagram (containers, components, context)',
    aliases: ['c4', 'c4diagram', 'architecture'],
    hint: "The user wants to generate a C4 architecture diagram. Use the diagram_gen tool with diagram_type='c4-container'.",
    icon: 'Workflow',
    formatHint: null,
    enabled: true,
    sortOrder: 10,
  },
  {
    commandKey: 'gantt',
    toolName: 'diagram_gen',
    label: 'Generate Gantt Chart',
    description: 'Create a Gantt chart for project schedules and timelines',
    aliases: ['gantt', 'timeline'],
    hint: "The user wants to generate a Gantt chart. Use the diagram_gen tool with diagram_type='gantt'.",
    icon: 'Workflow',
    formatHint: null,
    enabled: true,
    sortOrder: 11,
  },
  // Chart type-specific commands
  {
    commandKey: 'bar-chart',
    toolName: 'chart_gen',
    label: 'Generate Bar Chart',
    description: 'Create a bar chart for comparisons and distributions',
    aliases: ['bar-chart', 'bar', 'barchart'],
    hint: "The user wants to generate a bar chart. Use the chart_gen tool with recommended_chart='bar'.",
    icon: 'BarChart3',
    formatHint: null,
    enabled: true,
    sortOrder: 12,
  },
  {
    commandKey: 'line-chart',
    toolName: 'chart_gen',
    label: 'Generate Line Chart',
    description: 'Create a line chart for trends over time',
    aliases: ['line-chart', 'line', 'linechart'],
    hint: "The user wants to generate a line chart. Use the chart_gen tool with recommended_chart='line'.",
    icon: 'BarChart3',
    formatHint: null,
    enabled: true,
    sortOrder: 13,
  },
  // Image style-specific commands
  {
    commandKey: 'infographic',
    toolName: 'image_gen',
    label: 'Generate Infographic',
    description: 'Create an infographic-style image with text and data visuals',
    aliases: ['infographic', 'info'],
    hint: "The user wants to generate an infographic. Use the image_gen tool with style='infographic'.",
    icon: 'Image',
    formatHint: null,
    enabled: true,
    sortOrder: 14,
  },
  {
    commandKey: 'photo',
    toolName: 'image_gen',
    label: 'Generate Photo',
    description: 'Create a photorealistic image',
    aliases: ['photo', 'photorealistic'],
    hint: "The user wants to generate a photorealistic image. Use the image_gen tool with style='photo'.",
    icon: 'Image',
    formatHint: null,
    enabled: true,
    sortOrder: 15,
  },
];

// ============ Helper Functions ============

function mapDbToConfig(row: {
  id: string;
  command_key: string;
  tool_name: string;
  label: string;
  description: string;
  aliases: string;
  hint: string;
  icon: string | null;
  format_hint: string | null;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string;
}): SlashCommandConfig {
  return {
    id: row.id,
    commandKey: row.command_key,
    toolName: row.tool_name,
    label: row.label,
    description: row.description,
    aliases: JSON.parse(row.aliases),
    hint: row.hint,
    icon: row.icon || 'FileText',
    formatHint: row.format_hint,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// ============ CRUD Operations ============

/**
 * Get all slash command configurations
 */
export async function getSlashCommandConfigs(): Promise<SlashCommandConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('slash_command_configs')
    .selectAll()
    .orderBy('sort_order', 'asc')
    .execute();

  return rows.map((row) => mapDbToConfig(row as unknown as ReturnType<typeof mapDbToConfig> extends SlashCommandConfig ? Parameters<typeof mapDbToConfig>[0] : never));
}

/**
 * Get enabled slash commands only
 */
export async function getEnabledSlashCommands(): Promise<SlashCommandConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('slash_command_configs')
    .selectAll()
    .where('enabled', '=', 1)
    .orderBy('sort_order', 'asc')
    .execute();

  return rows.map((row) => mapDbToConfig(row as unknown as Parameters<typeof mapDbToConfig>[0]));
}

/**
 * Get a slash command by its command key
 */
export async function getSlashCommandByKey(commandKey: string): Promise<SlashCommandConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('slash_command_configs')
    .selectAll()
    .where('command_key', '=', commandKey)
    .executeTakeFirst();

  return row ? mapDbToConfig(row as unknown as Parameters<typeof mapDbToConfig>[0]) : undefined;
}

/**
 * Update a slash command configuration
 */
export async function updateSlashCommand(
  commandKey: string,
  updates: SlashCommandUpdate,
  updatedBy: string
): Promise<void> {
  const db = await getDb();

  const existing = await getSlashCommandByKey(commandKey);
  if (!existing) {
    throw new Error(`Slash command '${commandKey}' not found`);
  }

  const setValues: Record<string, unknown> = {
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  if (updates.label !== undefined) setValues.label = updates.label;
  if (updates.description !== undefined) setValues.description = updates.description;
  if (updates.aliases !== undefined) setValues.aliases = JSON.stringify(updates.aliases);
  if (updates.hint !== undefined) setValues.hint = updates.hint;
  if (updates.icon !== undefined) setValues.icon = updates.icon;
  if (updates.enabled !== undefined) setValues.enabled = updates.enabled ? 1 : 0;
  if (updates.sortOrder !== undefined) setValues.sort_order = updates.sortOrder;

  await db
    .updateTable('slash_command_configs')
    .set(setValues)
    .where('command_key', '=', commandKey)
    .execute();
}

/**
 * Reset all slash commands to their default values
 */
export async function resetSlashCommandsToDefaults(updatedBy: string): Promise<void> {
  const db = await getDb();

  // Delete existing and re-seed
  await db.deleteFrom('slash_command_configs').execute();

  for (const cmd of DEFAULT_COMMANDS) {
    await db
      .insertInto('slash_command_configs')
      .values({
        id: uuidv4(),
        command_key: cmd.commandKey,
        tool_name: cmd.toolName,
        label: cmd.label,
        description: cmd.description,
        aliases: JSON.stringify(cmd.aliases),
        hint: cmd.hint,
        icon: cmd.icon,
        format_hint: cmd.formatHint,
        enabled: cmd.enabled ? 1 : 0,
        sort_order: cmd.sortOrder,
        updated_by: updatedBy,
      })
      .execute();
  }
}

/**
 * Ensure all default slash commands exist in the database.
 * Idempotent — skips commands that already exist.
 *
 * Two sources:
 * 1. Auto-derived from ToolDefinition.slashCommand (per-tool metadata, like @ mentions).
 * 2. Hardcoded DEFAULT_COMMANDS (type/format-specific variants that don't map 1:1 to tools).
 *
 * Auto-derived entries are inserted with a synthetic hint; DB-managed entries (from
 * DEFAULT_COMMANDS or admin edits) are never overwritten.
 */
export async function ensureSlashCommandsExist(updatedBy: string): Promise<void> {
  const db = await getDb();

  // Lazy-import to avoid circular deps at module load time
  const { AVAILABLE_TOOLS } = await import('@/lib/tools');

  // --- Step 1: Auto-derive from ToolDefinition.slashCommand ---
  for (const [toolName, tool] of Object.entries(AVAILABLE_TOOLS)) {
    const cmd = tool.slashCommand;
    if (!cmd) continue;

    const existing = await db
      .selectFrom('slash_command_configs')
      .select('id')
      .where('command_key', '=', cmd.commandKey)
      .executeTakeFirst();

    if (!existing) {
      // Auto-generate hint from label + description
      const hint = `The user wants to ${cmd.description.toLowerCase()}. Use the ${toolName} tool to fulfill this request.`;

      await db
        .insertInto('slash_command_configs')
        .values({
          id: uuidv4(),
          command_key: cmd.commandKey,
          tool_name: toolName,
          label: cmd.label,
          description: cmd.description,
          aliases: JSON.stringify(cmd.aliases),
          hint,
          icon: cmd.icon ?? null,
          format_hint: null,
          enabled: 1,
          sort_order: 0,
          updated_by: updatedBy,
        })
        .execute();
    }
  }

  // --- Step 2: Insert hardcoded type/format-specific variants ---
  for (const cmd of DEFAULT_COMMANDS) {
    const existing = await db
      .selectFrom('slash_command_configs')
      .select('id')
      .where('command_key', '=', cmd.commandKey)
      .executeTakeFirst();

    if (!existing) {
      await db
        .insertInto('slash_command_configs')
        .values({
          id: uuidv4(),
          command_key: cmd.commandKey,
          tool_name: cmd.toolName,
          label: cmd.label,
          description: cmd.description,
          aliases: JSON.stringify(cmd.aliases),
          hint: cmd.hint,
          icon: cmd.icon,
          format_hint: cmd.formatHint,
          enabled: cmd.enabled ? 1 : 0,
          sort_order: cmd.sortOrder,
          updated_by: updatedBy,
        })
        .execute();
    }
  }
}

/**
 * Resolve an alias to a slash command config from a given list.
 * Used client-side or server-side for quick lookups.
 */
export function resolveSlashCommandAlias(
  alias: string,
  commands: SlashCommandConfig[]
): SlashCommandConfig | undefined {
  const normalized = alias.toLowerCase().trim();
  return commands.find(
    (cmd) =>
      cmd.enabled &&
      (cmd.commandKey.toLowerCase() === normalized ||
        cmd.aliases.some((a) => a.toLowerCase() === normalized))
  );
}
