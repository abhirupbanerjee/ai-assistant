/**
 * Tool registry — 8 curated GitBook operations as OpenAI function schemas.
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
  category: 'gitbook';
}

export const TOOLS: ToolDef[] = [
  // ── Spaces ─────────────────────────────────────────────────────────────────
  {
    name: 'gitbook_list_spaces',
    category: 'gitbook',
    summary: 'List GitBook spaces in an organization.',
    description:
      'Returns all spaces (documentation sites) in a GitBook organization. ' +
      'Each space has a title, description, and unique ID used by other tools. ' +
      'Use this first to discover available spaces.',
    params: [
      {
        name: 'org_id',
        type: 'string',
        required: true,
        description: 'The GitBook organization ID (UUID or slug).',
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },
  {
    name: 'gitbook_get_space',
    category: 'gitbook',
    summary: 'Get GitBook space metadata.',
    description:
      'Returns metadata for a GitBook space including title, description, ' +
      'visibility settings, and URLs.',
    params: [
      {
        name: 'space_id',
        type: 'string',
        required: true,
        description: 'The GitBook space ID.',
      },
    ],
  },

  // ── Content ───────────────────────────────────────────────────────────────
  {
    name: 'gitbook_get_content',
    category: 'gitbook',
    summary: 'Get the table of contents for a GitBook space.',
    description:
      'Returns the full page tree (table of contents) for a space, including ' +
      'page titles, IDs, and parent-child relationships. Use this to navigate ' +
      'the structure before fetching individual pages.',
    params: [
      {
        name: 'space_id',
        type: 'string',
        required: true,
        description: 'The GitBook space ID.',
      },
    ],
  },
  {
    name: 'gitbook_get_page',
    category: 'gitbook',
    summary: 'Get a GitBook page by ID with full content.',
    description:
      'Returns the full content of a GitBook page in GitBook-flavored Markdown. ' +
      'Page IDs can be found via gitbook_get_content or gitbook_search.',
    params: [
      {
        name: 'space_id',
        type: 'string',
        required: true,
        description: 'The GitBook space ID.',
      },
      {
        name: 'page_id',
        type: 'string',
        required: true,
        description: 'The GitBook page ID.',
      },
    ],
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  {
    name: 'gitbook_search',
    category: 'gitbook',
    summary: 'Search across all content in a GitBook space.',
    description:
      'Searches pages and content within a GitBook space. Returns matching ' +
      'pages with titles, IDs, and content snippets. Supports full-text search.',
    params: [
      {
        name: 'space_id',
        type: 'string',
        required: true,
        description: 'The GitBook space ID.',
      },
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Search query text.',
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },

  // ── Collections / Categories ──────────────────────────────────────────────
  {
    name: 'gitbook_get_collection',
    category: 'gitbook',
    summary: 'Get a GitBook collection (category) with its pages.',
    description:
      'Returns a collection (category/group) including its title, description, ' +
      'and all pages within it. Collections are used to group related pages.',
    params: [
      {
        name: 'space_id',
        type: 'string',
        required: true,
        description: 'The GitBook space ID.',
      },
      {
        name: 'collection_id',
        type: 'string',
        required: true,
        description: 'The GitBook collection ID.',
      },
    ],
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  {
    name: 'gitbook_list_comments',
    category: 'gitbook',
    summary: 'List reader comments in a GitBook space.',
    description:
      'Returns all comments (reader feedback) across pages in a GitBook space. ' +
      'Includes comment text, author, page reference, and resolution status.',
    params: [
      {
        name: 'space_id',
        type: 'string',
        required: true,
        description: 'The GitBook space ID.',
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  {
    name: 'gitbook_get_user',
    category: 'gitbook',
    summary: 'Get the authenticated GitBook user profile.',
    description:
      'Returns the profile of the currently authenticated GitBook user, ' +
      'including display name, email, and avatar URL.',
    params: [],
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
