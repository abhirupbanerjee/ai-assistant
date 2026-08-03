/**
 * Tool registry — OpenAI-function-style schemas describing every operation
 * the connector exposes. Served at GET /tools so the host app can render
 * them as a Function API config.
 *
 * Each tool declares an optional `userId` (string) for forward compatibility
 * with Phase 2 per-user OAuth. In Phase 1 it is accepted but ignored —
 * all calls run under the shared service-account identity.
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
  category: 'sheets' | 'drive' | 'docs' | 'slides' | 'onedrive';
}

export const TOOLS: ToolDef[] = [
  // ── Sheets ────────────────────────────────────────────────────────────────
  {
    name: 'sheets_get_values',
    category: 'sheets',
    summary: 'Read a range of cells from a Google Sheet.',
    description:
      'Reads a single range (A1 notation) from a Google Spreadsheet and ' +
      'returns a 2D array of values. Requires the sheet to be shared with ' +
      'the service-account client_email (Viewer or higher).',
    params: [
      { name: 'spreadsheetId', type: 'string', required: true, description: 'The spreadsheet ID (from the sheet URL: /d/<id>/edit).' },
      { name: 'range', type: 'string', required: true, description: 'A1 notation range, e.g. "Sheet1!A1:D20" or "Data!A:Z".' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2). Ignored in Phase 1.' },
    ],
  },
  {
    name: 'sheets_batch_get_values',
    category: 'sheets',
    summary: 'Read multiple ranges from a Google Sheet in one call.',
    description:
      'Reads multiple A1 ranges from a spreadsheet in a single round-trip. ' +
      'Returns an array of value-range objects, one per requested range.',
    params: [
      { name: 'spreadsheetId', type: 'string', required: true, description: 'The spreadsheet ID.' },
      {
        name: 'ranges',
        type: 'array',
        required: true,
        description: 'Array of A1 notation ranges.',
        items: { type: 'string' },
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'sheets_update_values',
    category: 'sheets',
    summary: 'Write values into a range of a Google Sheet.',
    description:
      'Writes a 2D array of values into the specified range. Requires ' +
      'Editor access on the sheet for the service account.',
    params: [
      { name: 'spreadsheetId', type: 'string', required: true, description: 'The spreadsheet ID.' },
      { name: 'range', type: 'string', required: true, description: 'A1 notation range to write into.' },
      {
        name: 'values',
        type: 'array',
        required: true,
        description: '2D array of cell values (rows of columns). Strings or numbers.',
        items: { type: 'array' },
      },
      {
        name: 'valueInputOption',
        type: 'string',
        description: 'How to interpret the input data.',
        enum: ['RAW', 'USER_ENTERED'],
        default: 'USER_ENTERED',
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'sheets_append_values',
    category: 'sheets',
    summary: 'Append rows after the last row of data in a sheet.',
    description:
      'Appends a 2D array of values after the existing data in the given range. ' +
      'Use a range like "Sheet1!A1" to let the API find the last row.',
    params: [
      { name: 'spreadsheetId', type: 'string', required: true, description: 'The spreadsheet ID.' },
      { name: 'range', type: 'string', required: true, description: 'A1 notation of the table to append to, e.g. "Sheet1!A1:E1".' },
      {
        name: 'values',
        type: 'array',
        required: true,
        description: '2D array of row values to append.',
        items: { type: 'array' },
      },
      {
        name: 'valueInputOption',
        type: 'string',
        description: 'How to interpret the input data.',
        enum: ['RAW', 'USER_ENTERED'],
        default: 'USER_ENTERED',
      },
      {
        name: 'insertDataOption',
        type: 'string',
        description: 'Whether to overwrite existing data or insert new rows.',
        enum: ['OVERWRITE', 'INSERT_ROWS'],
        default: 'INSERT_ROWS',
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'sheets_get_spreadsheet',
    category: 'sheets',
    summary: 'Get spreadsheet metadata (sheets, named ranges, properties).',
    description:
      'Returns metadata about the spreadsheet including all sheet tabs, ' +
      'their grid dimensions, and named ranges. Useful for discovering ' +
      'what tabs exist before reading values.',
    params: [
      { name: 'spreadsheetId', type: 'string', required: true, description: 'The spreadsheet ID.' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },

  // ── Drive ─────────────────────────────────────────────────────────────────
  {
    name: 'drive_list_files',
    category: 'drive',
    summary: 'List files in the service account\'s Drive.',
    description:
      'Lists files visible to the service account. Use pageSize and a ' +
      'query string to filter. Remember: the service account only sees ' +
      'files explicitly shared with its client_email.',
    params: [
      {
        name: 'q',
        type: 'string',
        description:
          'Drive query string, e.g. "mimeType=\'application/vnd.google-apps.spreadsheet\'". ' +
          'See https://developers.google.com/drive/api/guides/search-files',
      },
      { name: 'pageSize', type: 'number', description: 'Max results (1-1000).', default: 100 },
      { name: 'pageToken', type: 'string', description: 'Next-page token from a previous call.' },
      { name: 'fields', type: 'string', description: 'Fields to return (Drive files.list `fields` param).' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'drive_get_file',
    category: 'drive',
    summary: 'Get metadata for a single Drive file.',
    description: 'Returns metadata (name, mimeType, modifiedTime, etc.) for a file ID.',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The Drive file ID.' },
      { name: 'fields', type: 'string', description: 'Comma-separated fields to return.' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },

  // ── Docs ──────────────────────────────────────────────────────────────────
  {
    name: 'docs_export',
    category: 'docs',
    summary: 'Export a Google Doc as plain text or markdown.',
    description:
      'Exports a Google Docs document using the Drive export media ' +
      'download endpoint. Returns the document content as text.',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The Docs file ID.' },
      {
        name: 'mimeType',
        type: 'string',
        description: 'Export format.',
        enum: ['text/plain', 'text/markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        default: 'text/markdown',
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },

  // ── Slides ─────────────────────────────────────────────────────────────────
  {
    name: 'slides_export',
    category: 'slides',
    summary: 'Export a Google Slides presentation as plain text, PDF, or PPTX.',
    description:
      'Exports a Google Slides presentation using the Drive export media ' +
      'download endpoint. Returns the presentation content as text/binary.',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The Slides presentation file ID.' },
      {
        name: 'mimeType',
        type: 'string',
        description: 'Export format.',
        enum: [
          'text/plain',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        default: 'text/plain',
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'slides_get_presentation',
    category: 'slides',
    summary: 'Get a Google Slides presentation structure with text and speaker notes.',
    description:
      'Reads the presentation via the Slides API and returns a flattened ' +
      'structure: title, slide count, and per-slide text plus speaker notes.',
    params: [
      {
        name: 'presentationId',
        type: 'string',
        required: true,
        description: 'The Slides presentation ID (from the URL: /d/<id>/edit).',
      },
      {
        name: 'includeNotes',
        type: 'boolean',
        description: 'Whether to include speaker notes for each slide.',
        default: true,
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },

  // ── Microsoft OneDrive (Graph API) ─────────────────────────────────────────
  {
    name: 'ms_drive_list_files',
    category: 'onedrive',
    summary: 'List files and folders in the user\'s OneDrive root.',
    description:
      'Lists the children of the OneDrive root folder via the Microsoft Graph API. ' +
      'Returns file/folder metadata (id, name, size, mimeType). Requires the user ' +
      'to have connected their Microsoft account (Connect OneDrive).',
    params: [
      { name: 'top', type: 'number', description: 'Maximum number of items to return (page size). Default 50.' },
      { name: 'skip', type: 'number', description: 'Number of items to skip for pagination.' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_drive_get_file',
    category: 'onedrive',
    summary: 'Get metadata for a specific OneDrive file or folder.',
    description:
      'Fetches metadata (name, size, MIME type, modification date) for a single ' +
      'OneDrive item by its Graph API item ID.',
    params: [
      { name: 'itemId', type: 'string', required: true, description: 'The OneDrive item ID (from ms_drive_list_files).' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_drive_download_file',
    category: 'onedrive',
    summary: 'Download the content of a OneDrive file as text.',
    description:
      'Downloads the raw content of a OneDrive file via the Graph API content endpoint. ' +
      'Returns the file content as a string along with its MIME type.',
    params: [
      { name: 'itemId', type: 'string', required: true, description: 'The OneDrive item ID to download.' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
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
