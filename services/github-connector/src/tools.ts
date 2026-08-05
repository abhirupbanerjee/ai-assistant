/**
 * Tool registry — 12 curated GitHub operations as OpenAI function schemas.
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
  category: 'repos' | 'search' | 'code' | 'issues' | 'prs';
}

export const TOOLS: ToolDef[] = [
  // ── Repos ──────────────────────────────────────────────────────────────────
  {
    name: 'github_list_repos',
    category: 'repos',
    summary: 'List your GitHub repositories.',
    description:
      'Lists repositories owned by or accessible to the authenticated user. ' +
      'Supports filtering by visibility (public/private), type (owner/member/all), ' +
      'and sorting. Returns repo name, description, language, stars, and visibility.',
    params: [
      {
        name: 'visibility',
        type: 'string',
        description: 'Filter by visibility.',
        enum: ['public', 'private', 'all'],
        default: 'all',
      },
      {
        name: 'type',
        type: 'string',
        description: 'Filter by ownership.',
        enum: ['owner', 'member', 'all'],
        default: 'all',
      },
      {
        name: 'sort',
        type: 'string',
        description: 'Sort order.',
        enum: ['created', 'updated', 'pushed', 'full_name'],
        default: 'updated',
      },
      {
        name: 'per_page',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },
  {
    name: 'github_get_repo',
    category: 'repos',
    summary: 'Get metadata for a specific GitHub repository.',
    description:
      'Returns full repository metadata including description, language, ' +
      'stars, forks, open issues, license, and default branch.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner (user or org).' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
    ],
  },
  {
    name: 'github_get_readme',
    category: 'repos',
    summary: 'Get the README of a GitHub repository.',
    description:
      'Returns the rendered README content (HTML) for a repository. ' +
      'Useful for understanding what a project does.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner (user or org).' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
    ],
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  {
    name: 'github_search_repos',
    category: 'search',
    summary: 'Search GitHub repositories.',
    description:
      'Searches public and private repositories using GitHub\'s search syntax. ' +
      'Supports qualifiers like language:, stars:, topic:, org:, etc.',
    params: [
      {
        name: 'q',
        type: 'string',
        required: true,
        description: 'Search query. Supports GitHub search qualifiers (language:python, stars:>100, etc.).',
      },
      {
        name: 'sort',
        type: 'string',
        description: 'Sort order.',
        enum: ['stars', 'forks', 'updated'],
        default: 'stars',
      },
      {
        name: 'per_page',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },
  {
    name: 'github_search_code',
    category: 'search',
    summary: 'Search code across GitHub repositories.',
    description:
      'Searches code in public and private repositories using GitHub code search. ' +
      'Returns matching files with repository, path, and text matches.',
    params: [
      {
        name: 'q',
        type: 'string',
        required: true,
        description: 'Search query. Supports qualifiers like repo:, language:, path:, org:.',
      },
      {
        name: 'per_page',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },

  // ── Code ───────────────────────────────────────────────────────────────────
  {
    name: 'github_get_file',
    category: 'code',
    summary: 'Read a file from a GitHub repository.',
    description:
      'Reads file content from a repository path. For text files, returns ' +
      'the content as a UTF-8 string (base64-decoded). For binary files, ' +
      'returns base64-encoded content.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner.' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
      { name: 'path', type: 'string', required: true, description: 'File path within the repository.' },
      {
        name: 'ref',
        type: 'string',
        description: 'Branch, tag, or commit SHA. Defaults to the default branch.',
      },
    ],
  },
  {
    name: 'github_list_dir',
    category: 'code',
    summary: 'List directory contents in a GitHub repository.',
    description:
      'Lists files and subdirectories at a given path in a repository. ' +
      'Returns name, path, type (file/dir), size, and SHA for each entry.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner.' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
      {
        name: 'path',
        type: 'string',
        description: 'Directory path within the repository. Defaults to root.',
        default: '',
      },
      {
        name: 'ref',
        type: 'string',
        description: 'Branch, tag, or commit SHA. Defaults to the default branch.',
      },
    ],
  },
  {
    name: 'github_list_commits',
    category: 'code',
    summary: 'List commits on a branch.',
    description:
      'Lists commits on a repository branch with author, message, date, and SHA.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner.' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
      {
        name: 'sha',
        type: 'string',
        description: 'Branch name or commit SHA. Defaults to the default branch.',
      },
      {
        name: 'per_page',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },

  // ── Issues ─────────────────────────────────────────────────────────────────
  {
    name: 'github_list_issues',
    category: 'issues',
    summary: 'List issues in a GitHub repository.',
    description:
      'Lists issues with optional filters for state, labels, assignee, and milestone.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner.' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
      {
        name: 'state',
        type: 'string',
        description: 'Filter by state.',
        enum: ['open', 'closed', 'all'],
        default: 'open',
      },
      {
        name: 'labels',
        type: 'string',
        description: 'Comma-separated label names to filter by.',
      },
      {
        name: 'assignee',
        type: 'string',
        description: 'GitHub username of the assignee.',
      },
      {
        name: 'per_page',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
      },
    ],
  },
  {
    name: 'github_get_issue',
    category: 'issues',
    summary: 'Get details of a specific GitHub issue.',
    description:
      'Returns issue details including title, body, state, labels, assignees, ' +
      'and milestone. Includes issue comments as well.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner.' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
      { name: 'issue_number', type: 'number', required: true, description: 'Issue number.' },
    ],
  },
  {
    name: 'github_create_issue',
    category: 'issues',
    summary: 'Create a new issue in a GitHub repository.',
    description:
      'Creates a new issue with the given title and optional body, labels, and assignees.',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner.' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
      { name: 'title', type: 'string', required: true, description: 'Issue title.' },
      { name: 'body', type: 'string', description: 'Issue body (markdown).' },
      {
        name: 'labels',
        type: 'array',
        description: 'Array of label names.',
        items: { type: 'string' },
      },
      {
        name: 'assignees',
        type: 'array',
        description: 'Array of GitHub usernames.',
        items: { type: 'string' },
      },
    ],
  },

  // ── Pull Requests ──────────────────────────────────────────────────────────
  {
    name: 'github_list_prs',
    category: 'prs',
    summary: 'List pull requests in a GitHub repository.',
    description:
      'Lists pull requests with optional state filter (open, closed, all).',
    params: [
      { name: 'owner', type: 'string', required: true, description: 'Repository owner.' },
      { name: 'repo', type: 'string', required: true, description: 'Repository name.' },
      {
        name: 'state',
        type: 'string',
        description: 'Filter by state.',
        enum: ['open', 'closed', 'all'],
        default: 'open',
      },
      {
        name: 'per_page',
        type: 'number',
        description: 'Results per page (max 100).',
        default: 30,
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
