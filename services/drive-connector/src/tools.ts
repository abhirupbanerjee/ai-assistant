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
  category: 'sheets' | 'drive' | 'docs' | 'slides' | 'onedrive' | 'teams' | 'outlook' | 'sharepoint';
}

export const TOOLS: ToolDef[] = [
  // ── Identity ──────────────────────────────────────────────────────────────
  {
    name: 'drive_get_user',
    category: 'drive',
    summary: 'Get the authenticated Google user profile.',
    description:
      'Returns the authenticated user\'s Google profile including display name, ' +
      'email address, and profile photo link. Use this to verify which Google ' +
      'account is connected.',
    params: [
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_get_user',
    category: 'onedrive',
    summary: 'Get the authenticated Microsoft user profile.',
    description:
      'Returns the authenticated Microsoft user\'s profile including display name, ' +
      'email, and user principal name. Use this to verify which Microsoft ' +
      'account is connected.',
    params: [
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },

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
  {
    name: 'drive_upload_file',
    category: 'drive',
    summary: 'Upload a file to Google Drive.',
    description:
      'Uploads a file to Google Drive via multipart upload. The file is placed ' +
      'in the specified folder (default "AI Assistant", created if necessary). ' +
      'Office formats (pptx, docx, xlsx) can optionally be converted to native ' +
      'Google formats. Returns the uploaded file ID and web view link.',
    params: [
      { name: 'filename', type: 'string', required: true, description: 'Target file name with extension, e.g. "Report.pptx".' },
      { name: 'mimeType', type: 'string', required: true, description: 'MIME type of the source file bytes, e.g. application/vnd.openxmlformats-officedocument.presentationml.presentation.' },
      { name: 'contentBase64', type: 'string', required: true, description: 'File contents encoded as base64.' },
      {
        name: 'folderName',
        type: 'string',
        description: 'Folder to upload into. The folder is created if it does not exist. Defaults to "AI Assistant".',
        default: 'AI Assistant',
      },
      { name: 'folderId', type: 'string', description: 'Optional Drive folder ID. Takes precedence over folderName if provided.' },
      {
        name: 'convertToGoogleFormat',
        type: 'boolean',
        description: 'When true and the file is a pptx/docx/xlsx, upload with conversion to Google Slides/Docs/Sheets.',
        default: true,
      },
      { name: 'description', type: 'string', description: 'Optional file description.' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'drive_list_folders',
    category: 'drive',
    summary: 'List app-created folders in Google Drive.',
    description:
      'Returns folders created by this app. Under the drive.file scope only ' +
      'app-created folders are visible, so this is intentionally limited to a ' +
      'picker-safe set (full Drive tree browsing requires the drive.readonly scope).',
    params: [
      { name: 'pageSize', type: 'number', description: 'Maximum number of folders to return (1-1000).', default: 50 },
      { name: 'pageToken', type: 'string', description: 'Next-page token from a previous call.' },
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
  {
    name: 'docs_create',
    category: 'docs',
    summary: 'Create a blank Google Doc.',
    description:
      'Creates a new Google Docs document with the given title under the ' +
      'service account (or connected user) and returns its ID and edit URL.',
    params: [
      { name: 'title', type: 'string', required: true, description: 'Title of the new document.' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'docs_get',
    category: 'docs',
    summary: 'Get a Google Doc structure and full body text.',
    description:
      'Reads a Google Docs document via the Docs API and returns the ' +
      'document ID, title, edit URL, and concatenated body text.',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The Docs file ID.' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'docs_append_text',
    category: 'docs',
    summary: 'Append text to the end of a Google Doc.',
    description:
      'Appends the supplied text to the end of the document body.',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The Docs file ID.' },
      { name: 'text', type: 'string', required: true, description: 'Text to append.' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'docs_replace_text',
    category: 'docs',
    summary: 'Replace all occurrences of a string in a Google Doc.',
    description:
      'Runs replaceAllText on the document and returns how many replacements ' +
      'were made. Use a unique placeholder (e.g. {{NAME}}) for precise edits.',
    params: [
      { name: 'fileId', type: 'string', required: true, description: 'The Docs file ID.' },
      { name: 'containsText', type: 'string', required: true, description: 'String to find.' },
      { name: 'replaceText', type: 'string', required: true, description: 'String to replace it with.' },
      {
        name: 'matchCase',
        type: 'boolean',
        description: 'Whether matching is case-sensitive.',
        default: true,
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
  {
    name: 'slides_create',
    category: 'slides',
    summary: 'Create a blank Google Slides presentation.',
    description:
      'Creates a new Google Slides presentation with the given title and ' +
      'returns its ID and edit URL.',
    params: [
      { name: 'title', type: 'string', required: true, description: 'Title of the new presentation.' },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'slides_add_slide',
    category: 'slides',
    summary: 'Add a new slide to a Google Slides presentation.',
    description:
      'Creates a new slide at the requested insertion index. Use the ' +
      'resulting slide objectId and placeholder IDs for follow-up insert_text calls.',
    params: [
      {
        name: 'presentationId',
        type: 'string',
        required: true,
        description: 'The presentation ID.',
      },
      {
        name: 'insertionIndex',
        type: 'number',
        description: 'Zero-based index where the slide should appear. Defaults to end.',
      },
      {
        name: 'layoutReferenceId',
        type: 'string',
        description: 'Predefined layout, e.g. BLANK, TITLE, TITLE_AND_TWO_COLUMNS.',
        default: 'BLANK',
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'slides_insert_text',
    category: 'slides',
    summary: 'Insert text into a shape on a Google Slide.',
    description:
      'Inserts text at a specific index in a shape identified by objectId. ' +
      'Use slides_get_presentation to discover shape objectIds.',
    params: [
      {
        name: 'presentationId',
        type: 'string',
        required: true,
        description: 'The presentation ID.',
      },
      {
        name: 'objectId',
        type: 'string',
        required: true,
        description: 'The objectId of the shape to write into.',
      },
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'Text to insert.',
      },
      {
        name: 'insertionIndex',
        type: 'number',
        description: 'Character index at which to insert. Default 0 (beginning).',
        default: 0,
      },
      { name: 'userId', type: 'string', description: 'Optional. Reserved for per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'slides_replace_all_text',
    category: 'slides',
    summary: 'Replace all occurrences of text across a presentation.',
    description:
      'Runs replaceAllText across all slides and returns the number of ' +
      'replacements. Useful for bulk placeholder substitution.',
    params: [
      {
        name: 'presentationId',
        type: 'string',
        required: true,
        description: 'The presentation ID.',
      },
      { name: 'containsText', type: 'string', required: true, description: 'String to find.' },
      { name: 'replaceText', type: 'string', required: true, description: 'String to replace it with.' },
      {
        name: 'matchCase',
        type: 'boolean',
        description: 'Whether matching is case-sensitive.',
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
  {
    name: 'ms_drive_create_folder',
    category: 'onedrive',
    summary: 'Create a folder in OneDrive.',
    description:
      'Creates a new folder under the OneDrive root or inside a parent folder.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Name of the new folder.' },
      { name: 'parentId', type: 'string', description: 'Optional parent folder item ID; defaults to root.' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_drive_upload_file',
    category: 'onedrive',
    summary: 'Upload a file to OneDrive (text or binary).',
    description:
      'Uploads a file to OneDrive using simple upload (<4 MB). Existing ' +
      'files are replaced by default. Use `contentBase64` for binary files ' +
      '(images, PDFs, audio) or `content` for plain text.',
    params: [
      {
        name: 'filename',
        type: 'string',
        description: 'Target filename, e.g. "report.pdf". Used when `folderName` is set.',
      },
      {
        name: 'contentBase64',
        type: 'string',
        description: 'File contents encoded as base64 (binary-safe).',
      },
      {
        name: 'content',
        type: 'string',
        description: 'Plain-text file content (legacy mode).',
      },
      {
        name: 'mimeType',
        type: 'string',
        description: 'MIME type of the content.',
        default: 'text/plain',
      },
      {
        name: 'folderName',
        type: 'string',
        description: 'Optional. Folder path under the OneDrive root (created on demand).',
      },
      {
        name: 'path',
        type: 'string',
        description: 'Legacy full path, e.g. "Reports/Q2.txt". Overrides filename+folderName.',
      },
      {
        name: 'conflictBehavior',
        type: 'string',
        description: 'What to do if the file already exists.',
        enum: ['replace', 'rename', 'fail'],
        default: 'replace',
      },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_drive_list_folders',
    category: 'onedrive',
    summary: 'List folders in the user\'s OneDrive root.',
    description:
      'Lists top-level folders in the OneDrive root via the Microsoft Graph API. ' +
      'Used by the Save to OneDrive UI to show folder choices.',
    params: [
      { name: 'top', type: 'number', description: 'Maximum number of items to return. Default 50.' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_excel_get_range',
    category: 'onedrive',
    summary: 'Read a range from an Excel workbook stored in OneDrive.',
    description:
      'Reads values from a worksheet range using the Graph Excel workbook API. ' +
      'The workbook must be closed (not locked by a desktop session) for edits to succeed.',
    params: [
      { name: 'itemId', type: 'string', required: true, description: 'The OneDrive item ID of the Excel file.' },
      { name: 'worksheet', type: 'string', required: true, description: 'Worksheet name, e.g. "Sheet1".' },
      { name: 'address', type: 'string', required: true, description: 'Range address, e.g. "A1:D10".' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_excel_update_range',
    category: 'onedrive',
    summary: 'Write values into a range of an Excel workbook in OneDrive.',
    description:
      'Updates values in a worksheet range using the Graph Excel workbook API. ' +
      'The values array must match the dimensions of the address.',
    params: [
      { name: 'itemId', type: 'string', required: true, description: 'The OneDrive item ID of the Excel file.' },
      { name: 'worksheet', type: 'string', required: true, description: 'Worksheet name, e.g. "Sheet1".' },
      { name: 'address', type: 'string', required: true, description: 'Range address, e.g. "A1:D10".' },
      {
        name: 'values',
        type: 'array',
        required: true,
        description: '2D array of values (rows of columns).',
        items: { type: 'array' },
      },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },

  // ── Microsoft Teams ────────────────────────────────────────────────────────
  {
    name: 'ms_teams_list_teams',
    category: 'teams',
    summary: 'List joined Microsoft Teams.',
    description:
      'Lists all Microsoft Teams that the authenticated user has joined. ' +
      'Returns team ID, display name, description, and visibility.',
    params: [
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_teams_list_channels',
    category: 'teams',
    summary: 'List channels in a Microsoft Team.',
    description:
      'Lists all channels within a specific Microsoft Team. Returns channel ' +
      'ID, display name, description, and membership type.',
    params: [
      { name: 'teamId', type: 'string', required: true, description: 'The team ID from ms_teams_list_teams.' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_teams_get_messages',
    category: 'teams',
    summary: 'Get messages from a Teams channel.',
    description:
      'Retrieves messages from a specific Teams channel. Returns message ' +
      'content, sender, timestamp, and attachments.',
    params: [
      { name: 'teamId', type: 'string', required: true, description: 'The team ID.' },
      { name: 'channelId', type: 'string', required: true, description: 'The channel ID from ms_teams_list_channels.' },
      { name: 'top', type: 'number', description: 'Maximum number of messages to return.', default: 20 },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },

  // ── Microsoft Outlook ──────────────────────────────────────────────────────
  {
    name: 'ms_outlook_list_messages',
    category: 'outlook',
    summary: 'List recent emails from Outlook.',
    description:
      'Retrieves recent email messages from the user\'s Outlook inbox. ' +
      'Returns subject, sender, received date, and preview text.',
    params: [
      { name: 'top', type: 'number', description: 'Maximum number of messages to return.', default: 20 },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_outlook_send_mail',
    category: 'outlook',
    summary: 'Send an email via Outlook.',
    description:
      'Sends an email through the authenticated user\'s Outlook account. ' +
      'Requires Mail.Send delegated permission.',
    params: [
      { name: 'to', type: 'string', required: true, description: 'Recipient email address (comma-separated for multiple).' },
      { name: 'subject', type: 'string', required: true, description: 'Email subject line.' },
      { name: 'body', type: 'string', required: true, description: 'Email body text.' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_outlook_get_calendar',
    category: 'outlook',
    summary: 'Get calendar events from Outlook.',
    description:
      'Retrieves upcoming calendar events from the user\'s Outlook calendar. ' +
      'Returns event subject, start/end times, location, and organizer.',
    params: [
      { name: 'top', type: 'number', description: 'Maximum number of events to return.', default: 20 },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },

  // ── Microsoft SharePoint ────────────────────────────────────────────────────
  {
    name: 'ms_sharepoint_search',
    category: 'sharepoint',
    summary: 'Search SharePoint sites.',
    description:
      'Searches SharePoint sites accessible to the authenticated user. ' +
      'Returns site name, URL, and description.',
    params: [
      { name: 'query', type: 'string', description: 'Search query for site names/descriptions.' },
      { name: 'userId', type: 'string', description: 'Optional. Per-user identity (Phase 2).' },
    ],
  },
  {
    name: 'ms_sharepoint_list_lists',
    category: 'sharepoint',
    summary: 'List SharePoint lists in a site.',
    description:
      'Lists all SharePoint lists within a specific site. Returns list ' +
      'name, display name, and description.',
    params: [
      { name: 'siteId', type: 'string', required: true, description: 'The SharePoint site ID.' },
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
