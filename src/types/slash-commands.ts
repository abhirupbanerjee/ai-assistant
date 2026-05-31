/**
 * Slash Command Types
 *
 * Type definitions for the slash command system used to trigger
 * terminal/creative tools via inline commands in the chat input.
 */

export interface SlashCommandConfig {
  id: string;
  commandKey: string;
  toolName: string;
  label: string;
  description: string;
  aliases: string[];
  hint: string;
  icon: string;
  formatHint: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SlashCommandUpdate {
  label?: string;
  description?: string;
  aliases?: string[];
  hint?: string;
  icon?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface ResolvedSlashCommand {
  command: SlashCommandConfig;
  remainingText: string;
}

export interface SlashCommandPublic {
  commandKey: string;
  label: string;
  description: string;
  aliases: string[];
  icon: string;
}
