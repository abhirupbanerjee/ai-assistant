/**
 * Tool registry — 5 curated Slack operations as OpenAI function schemas.
 * Served at GET /tools so the host app can auto-import them.
 */

export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  items?: { type: ToolParam['type']; description?: string };
  enum?: string[];
  default?: unknown;
}

export interface ToolDef {
  name: string;
  summary: string;
  description: string;
  params: ToolParam[];
  category: 'messages' | 'channels' | 'users';
}

export const TOOLS: ToolDef[] = [
  // ── Messages ─────────────────────────────────────────────────────────────
  {
    name: 'slack_search_messages',
    category: 'messages',
    summary: 'Search messages across Slack channels.',
    description:
      'Searches messages across all accessible Slack channels using the given ' +
      'query string. Returns matching messages with channel, user, timestamp, ' +
      'and text. Supports pagination via page parameter.',
    params: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Search query string.',
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results to return.',
        default: 20,
      },
    ],
  },
  {
    name: 'slack_get_channel_history',
    category: 'messages',
    summary: 'Get message history from a Slack channel.',
    description:
      'Retrieves recent messages from a specific Slack channel. Returns ' +
      'message text, user, timestamp, and thread info. Supports pagination ' +
      'via the limit parameter.',
    params: [
      {
        name: 'channel',
        type: 'string',
        required: true,
        description: 'Slack channel ID to fetch history from.',
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of messages to return.',
        default: 20,
      },
    ],
  },

  // ── Channels ─────────────────────────────────────────────────────────────
  {
    name: 'slack_list_channels',
    category: 'channels',
    summary: 'List public channels in the Slack workspace.',
    description:
      'Lists all public channels in the workspace. Returns channel ID, ' +
      'name, topic, purpose, and member count. Supports filtering by ' +
      'channel types and pagination.',
    params: [
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of channels to return.',
        default: 20,
      },
    ],
  },

  // ── Users ────────────────────────────────────────────────────────────────
  {
    name: 'slack_list_users',
    category: 'users',
    summary: 'List users in the Slack workspace.',
    description:
      'Lists all users in the Slack workspace. Returns user ID, name, ' +
      'real name, email, and profile information.',
    params: [
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of users to return.',
        default: 20,
      },
    ],
  },
  {
    name: 'slack_get_user_info',
    category: 'users',
    summary: 'Get detailed user profile by ID.',
    description:
      'Returns detailed profile information for a specific Slack user, ' +
      'including real name, display name, email, timezone, and status.',
    params: [
      {
        name: 'user',
        type: 'string',
        required: true,
        description: 'Slack user ID to look up.',
      },
    ],
  },
];

/** Map of tool name → definition for fast lookup. */
export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t])
);

/** Render a ToolDef as an OpenAI function-tool schema. */
export function toOpenAISchema(t: ToolDef): unknown {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of t.params) {
    const schema: Record<string, unknown> = {
      type: p.type,
      description: p.description,
    };
    if (p.enum) schema.enum = p.enum;
    if (p.default !== undefined) schema.default = p.default;
    if (p.items) schema.items = p.items;
    properties[p.name] = schema;
    if (p.required) required.push(p.name);
  }
  return {
    type: 'function',
    function: {
      name: t.name,
      description: `${t.summary}\n\n${t.description}`,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  };
}
