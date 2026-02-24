/**
 * Agent Bot Configuration Constants
 *
 * Centralized configuration for agent bot settings.
 * Update these values when adding new capabilities.
 */

// ============ File Upload Types ============

/**
 * Allowed file types for agent bot file uploads.
 * Add new MIME types here when supporting additional file formats.
 */
export const ALLOWED_FILE_TYPES = [
  { value: 'application/pdf', label: 'PDF', extension: '.pdf' },
  {
    value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word Document',
    extension: '.docx',
  },
  {
    value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel Spreadsheet',
    extension: '.xlsx',
  },
  {
    value: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PowerPoint',
    extension: '.pptx',
  },
  { value: 'image/*', label: 'Images', extension: '.jpg, .png, .gif, .webp' },
  { value: 'text/plain', label: 'Text File', extension: '.txt' },
  { value: 'text/csv', label: 'CSV', extension: '.csv' },
  { value: 'application/json', label: 'JSON', extension: '.json' },
  { value: 'text/markdown', label: 'Markdown', extension: '.md' },
] as const;

// ============ Output Types ============

/**
 * Base output types always available (don't require specific tools).
 */
export const BASE_OUTPUT_TYPES = [
  { id: 'text', label: 'Text', description: 'Plain text response', toolRequired: null },
  { id: 'json', label: 'JSON', description: 'Structured JSON data', toolRequired: null },
  { id: 'md', label: 'Markdown', description: 'Formatted markdown', toolRequired: null },
] as const;

/**
 * Tool-dependent output types.
 * These become available when the corresponding tool is enabled.
 */
export const TOOL_OUTPUT_TYPES = [
  { id: 'pdf', label: 'PDF', description: 'PDF document', toolRequired: 'doc_gen' },
  { id: 'docx', label: 'Word', description: 'Word document', toolRequired: 'doc_gen' },
  { id: 'xlsx', label: 'Excel', description: 'Excel spreadsheet', toolRequired: 'xlsx_gen' },
  { id: 'pptx', label: 'PowerPoint', description: 'PowerPoint presentation', toolRequired: 'pptx_gen' },
  { id: 'image', label: 'Image', description: 'Generated image', toolRequired: 'image_gen' },
  { id: 'podcast', label: 'Podcast', description: 'Audio podcast', toolRequired: 'podcast_gen' },
  { id: 'chart', label: 'Chart', description: 'Data visualization chart', toolRequired: 'chart_gen' },
  { id: 'diagram', label: 'Diagram', description: 'Generated diagram', toolRequired: 'diagram_gen' },
] as const;

/**
 * All possible output types (base + tool-dependent).
 */
export const ALL_OUTPUT_TYPES = [...BASE_OUTPUT_TYPES, ...TOOL_OUTPUT_TYPES] as const;

// ============ Parameter Types ============

/**
 * JSON Schema parameter types for input schema builder.
 * These are standard JSON Schema types and should rarely change.
 */
export const PARAMETER_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
] as const;

// ============ Helper Functions ============

/**
 * Get available output types based on enabled tools.
 * @param enabledToolNames - Array of enabled tool names
 * @returns Array of available output types
 */
export function getAvailableOutputTypes(enabledToolNames: string[]) {
  const toolOutputTypes = TOOL_OUTPUT_TYPES.filter(
    (type) => type.toolRequired && enabledToolNames.includes(type.toolRequired)
  );

  return [
    ...BASE_OUTPUT_TYPES.map((t) => ({ ...t, toolRequired: null as string | null })),
    ...toolOutputTypes.map((t) => ({ ...t, toolRequired: t.toolRequired as string | null })),
  ];
}

/**
 * Check if an output type is available given enabled tools.
 */
export function isOutputTypeAvailable(outputTypeId: string, enabledToolNames: string[]): boolean {
  const baseType = BASE_OUTPUT_TYPES.find((t) => t.id === outputTypeId);
  if (baseType) return true;

  const toolType = TOOL_OUTPUT_TYPES.find((t) => t.id === outputTypeId);
  if (toolType && toolType.toolRequired) {
    return enabledToolNames.includes(toolType.toolRequired);
  }

  return false;
}
