/**
 * Tool registry — 7 curated Notion operations as OpenAI function schemas.
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
  category: 'notion';
}

export const TOOLS: ToolDef[] = [
  // ── Search ──────────────────────────────────────────────────────────────────
  {
    name: 'notion_search',
    category: 'notion',
    summary: 'Search Notion pages and databases by title.',
    description:
      'Searches all pages and databases that the connected user has access to. ' +
      'Returns matching results with title, id, and type. Supports filtering ' +
      'by object type (page or database) and sorting by last edited time.',
    params: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Search query text to match against page/database titles.',
      },
      {
        name: 'filter',
        type: 'string',
        description: 'Filter by object type.',
        enum: ['page', 'database'],
      },
      {
        name: 'sort',
        type: 'string',
        description: 'Sort direction for last_edited_time.',
        enum: ['ascending', 'descending'],
        default: 'descending',
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
      {
        name: 'start_cursor',
        type: 'string',
        description: 'Pagination cursor from a previous response (next_cursor).',
      },
    ],
  },

  // ── Pages ───────────────────────────────────────────────────────────────────
  {
    name: 'notion_get_page',
    category: 'notion',
    summary: 'Get a Notion page by ID.',
    description:
      'Returns the full page object including properties and content structure. ' +
      'The page ID can be extracted from a Notion URL: ' +
      'https://notion.so/workspace/Page-Title-{page_id}.',
    params: [
      {
        name: 'page_id',
        type: 'string',
        required: true,
        description: 'The UUID of the Notion page (with or without hyphens).',
      },
    ],
  },
  {
    name: 'notion_get_block_children',
    category: 'notion',
    summary: 'Get child blocks of a Notion page or block.',
    description:
      'Returns a paginated list of block children for a given block or page. ' +
      'Use this to read the actual content (text, headings, lists, etc.) of a page.',
    params: [
      {
        name: 'block_id',
        type: 'string',
        required: true,
        description: 'The UUID of the block or page (with or without hyphens).',
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 50,
      },
      {
        name: 'start_cursor',
        type: 'string',
        description: 'Pagination cursor from a previous response (next_cursor).',
      },
    ],
  },

  // ── Databases ───────────────────────────────────────────────────────────────
  {
    name: 'notion_get_database',
    category: 'notion',
    summary: 'Get a Notion database by ID.',
    description:
      'Returns the database object including title, properties schema, and metadata. ' +
      'Use this to understand the structure of a database before querying it.',
    params: [
      {
        name: 'database_id',
        type: 'string',
        required: true,
        description: 'The UUID of the Notion database (with or without hyphens).',
      },
    ],
  },
  {
    name: 'notion_query_database',
    category: 'notion',
    summary: 'Query a Notion database with filters and sorts.',
    description:
      'Queries a Notion database and returns matching pages with their properties. ' +
      'Supports filters, sorts, and pagination. The filter/sorts should be provided ' +
      'as JSON objects matching the Notion API format.',
    params: [
      {
        name: 'database_id',
        type: 'string',
        required: true,
        description: 'The UUID of the Notion database (with or without hyphens).',
      },
      {
        name: 'filter',
        type: 'object',
        description: 'JSON filter object following Notion API filter syntax.',
      },
      {
        name: 'sorts',
        type: 'array',
        description: 'Array of sort objects following Notion API sort syntax.',
        items: { type: 'object' },
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
      {
        name: 'start_cursor',
        type: 'string',
        description: 'Pagination cursor from a previous response (next_cursor).',
      },
    ],
  },

  // ── Users ───────────────────────────────────────────────────────────────────
  {
    name: 'notion_get_user',
    category: 'notion',
    summary: 'Get a specific Notion user by ID.',
    description:
      'Returns information about a specific user in the workspace, ' +
      'including name, avatar, and contact info.',
    params: [
      {
        name: 'user_id',
        type: 'string',
        required: true,
        description: 'The UUID of the Notion user (with or without hyphens).',
      },
    ],
  },
  {
    name: 'notion_list_users',
    category: 'notion',
    summary: 'List all users in the Notion workspace.',
    description:
      'Returns a paginated list of all users in the workspace, including ' +
      'names, avatars, and contact information.',
    params: [
      {
        name: 'page_size',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 50,
      },
      {
        name: 'start_cursor',
        type: 'string',
        description: 'Pagination cursor from a previous response (next_cursor).',
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
