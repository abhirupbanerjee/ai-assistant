/**
 * Tool registry — OpenAI-function-style schemas describing every operation
 * the connector exposes. Served at GET /tools so the host app can render
 * them as a Function API config.
 *
 * Copy this file to your connector and replace the TOOLS array with your
 * service's curated operations.
 */

export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  /** For arrays/objects — a JSON-schema-ish description. */
  items?: { type: ToolParam['type']; description?: string };
  enum?: string[];
  default?: unknown;
}

export interface ToolDef {
  /** Stable operation name the host app calls with `op`. */
  name: string;
  summary: string;
  description: string;
  params: ToolParam[];
  /** Category — helps the host UI group tools. */
  category: string;
}

/**
 * REPLACE: Define your service's tool operations here.
 *
 * Each tool should use a prefix matching your service name
 * (e.g., github_list_repos, notion_search, slack_list_channels).
 *
 * The optional `userId` param is automatically handled by the server.
 */
export const TOOLS: ToolDef[] = [
  // TODO: Replace with your service's tool definitions.
  // Example:
  // {
  //   name: 'myservice_get_resource',
  //   category: 'core',
  //   summary: 'Get a resource by ID.',
  //   description: 'Fetches a resource from MyService using its unique ID.',
  //   params: [
  //     { name: 'resourceId', type: 'string', required: true, description: 'The resource ID.' },
  //   ],
  // },
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
