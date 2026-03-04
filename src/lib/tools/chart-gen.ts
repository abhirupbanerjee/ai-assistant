/**
 * Chart Generator Tool
 *
 * Generates interactive charts from LLM-constructed data.
 * Uses the same visualization infrastructure as data_source tool.
 */

import { getToolConfig } from '../db/compat/tool-config';
import type { ToolDefinition, ValidationResult } from '../tools';
import type { ChartType } from '../../types/data-sources';
import type {
  ChartGenToolArgs,
  ChartGenResponse,
  ChartGenConfig,
  ChartGenValidation,
  SeriesMode,
} from '../../types/chart-gen';

// ===== Default Configuration =====

/**
 * Default configuration values for chart_gen tool
 */
export const CHART_GEN_DEFAULTS: ChartGenConfig = {
  maxDataRows: 500,
  defaultChartType: 'bar',
  enabledChartTypes: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
};

// ===== Configuration Schema =====

/**
 * Configuration schema for admin UI
 */
const chartGenConfigSchema = {
  type: 'object',
  properties: {
    maxDataRows: {
      type: 'number',
      title: 'Maximum Data Rows',
      description: 'Maximum number of data rows allowed per chart',
      minimum: 10,
      maximum: 1000,
      default: 500,
    },
    defaultChartType: {
      type: 'string',
      title: 'Default Chart Type',
      description: 'Chart type when "auto" is selected and no clear recommendation',
      enum: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
      default: 'bar',
    },
    enabledChartTypes: {
      type: 'array',
      title: 'Enabled Chart Types',
      description: 'Chart types available for generation',
      items: {
        type: 'string',
        enum: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
      },
      default: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
    },
  },
};

// ===== Helper Functions =====

/**
 * Get tool configuration with defaults
 */
async function getChartGenConfig(): Promise<ChartGenConfig> {
  const config = await getToolConfig('chart_gen');
  if (config?.config) {
    const c = config.config as Record<string, unknown>;
    return {
      maxDataRows: (c.maxDataRows as number) || CHART_GEN_DEFAULTS.maxDataRows,
      defaultChartType: (c.defaultChartType as ChartType) || CHART_GEN_DEFAULTS.defaultChartType,
      enabledChartTypes: (c.enabledChartTypes as ChartType[]) || CHART_GEN_DEFAULTS.enabledChartTypes,
    };
  }
  return CHART_GEN_DEFAULTS;
}

/**
 * Validate tool arguments
 */
function validateArgs(args: ChartGenToolArgs, config: ChartGenConfig): ChartGenValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!args.title || typeof args.title !== 'string') {
    errors.push('title is required and must be a string');
  }

  if (!args.data || !Array.isArray(args.data)) {
    errors.push('data is required and must be an array');
  } else {
    // Data row limit
    if (args.data.length === 0) {
      errors.push('data array cannot be empty');
    } else if (args.data.length > config.maxDataRows) {
      errors.push(`data exceeds maximum ${config.maxDataRows} rows (received ${args.data.length})`);
    }

    // Check data consistency
    if (args.data.length > 0) {
      const firstKeys = Object.keys(args.data[0]).sort().join(',');
      const inconsistent = args.data.some(
        (row, idx) => idx > 0 && Object.keys(row).sort().join(',') !== firstKeys
      );
      if (inconsistent) {
        warnings.push('Data objects have inconsistent keys - chart may not render correctly');
      }
    }
  }

  if (!args.x_field || typeof args.x_field !== 'string') {
    errors.push('x_field is required and must be a string');
  } else if (args.data?.length > 0 && !(args.x_field in args.data[0])) {
    errors.push(`x_field "${args.x_field}" not found in data`);
  }

  if (!args.y_fields || !Array.isArray(args.y_fields) || args.y_fields.length === 0) {
    errors.push('y_fields is required and must be a non-empty array');
  } else if (args.data?.length > 0) {
    const missingFields = args.y_fields.filter(f => !(f in args.data[0]));
    if (missingFields.length > 0) {
      errors.push(`y_fields not found in data: ${missingFields.join(', ')}`);
    }
  }

  // Validate recommended_chart
  const validCharts = ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table', 'auto'];
  if (args.recommended_chart && !validCharts.includes(args.recommended_chart)) {
    warnings.push(`Invalid recommended_chart "${args.recommended_chart}", using auto`);
  }

  // Validate series_mode
  const validSeriesModes = ['grouped', 'stacked', 'auto'];
  if (args.series_mode && !validSeriesModes.includes(args.series_mode)) {
    warnings.push(`Invalid series_mode "${args.series_mode}", using auto`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Auto-select chart type based on data characteristics
 */
function autoSelectChartType(
  data: Record<string, unknown>[],
  xField: string,
  yFields: string[],
  defaultType: ChartType
): ChartType {
  if (data.length === 0) return 'table';

  const firstRow = data[0];

  // Check if x_field is categorical (string) or numeric
  const xValue = firstRow[xField];
  const isCategorical = typeof xValue === 'string' && isNaN(Number(xValue));

  // Check for date patterns in x_field
  const isDateField = /date|time|year|month|day|week/i.test(xField) ||
    (typeof xValue === 'string' && !isNaN(Date.parse(xValue)));

  // Count unique categories
  const uniqueCategories = new Set(data.map(d => d[xField])).size;

  // Multiple Y fields = grouped/stacked bar
  if (yFields.length > 1) {
    return 'bar';
  }

  // Time series = line chart
  if (isDateField) {
    return 'line';
  }

  // Few categories = pie chart
  if (isCategorical && uniqueCategories >= 2 && uniqueCategories <= 8 && data.length <= 20) {
    return 'pie';
  }

  // Multi-dimensional comparison with few items = radar
  if (yFields.length >= 3 && data.length <= 10) {
    return 'radar';
  }

  // Default to bar for categorical comparisons
  if (isCategorical) {
    return 'bar';
  }

  return defaultType;
}

/**
 * Format successful response for LLM consumption and frontend rendering
 */
function formatResponse(
  args: ChartGenToolArgs,
  chartType: ChartType
): string {
  const seriesMode: SeriesMode = args.series_mode || 'auto';

  const response: ChartGenResponse = {
    success: true,
    data: args.data,
    metadata: {
      source: 'LLM Generated',
      sourceType: 'chart_gen',
      recordCount: args.data.length,
      fields: Object.keys(args.data[0] || {}),
      executionTimeMs: 0,
      cached: false,
    },
    visualizationHint: {
      chartType,
      xField: args.x_field,
      yField: args.y_fields[0],
      // Pass all y_fields for multi-series charts
      yFields: args.y_fields,
    },
    chartTitle: args.title,
    notes: args.notes,
    seriesMode: args.y_fields.length > 1 ? seriesMode : undefined,
  };

  return JSON.stringify(response, null, 2);
}

/**
 * Format error response
 */
function formatError(code: string, message: string, details?: string): string {
  const response: ChartGenResponse = {
    success: false,
    error: { code, message, details },
  };
  return JSON.stringify(response, null, 2);
}

// ===== Validation Function =====

/**
 * Validate chart_gen tool configuration
 */
function validateChartGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate maxDataRows
  if (config.maxDataRows !== undefined) {
    const rows = config.maxDataRows as number;
    if (typeof rows !== 'number' || rows < 10 || rows > 1000) {
      errors.push('maxDataRows must be between 10 and 1000');
    }
  }

  // Validate defaultChartType
  const validTypes = ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'];
  if (config.defaultChartType && !validTypes.includes(config.defaultChartType as string)) {
    errors.push(`defaultChartType must be one of: ${validTypes.join(', ')}`);
  }

  // Validate enabledChartTypes
  if (config.enabledChartTypes) {
    if (!Array.isArray(config.enabledChartTypes)) {
      errors.push('enabledChartTypes must be an array');
    } else {
      for (const t of config.enabledChartTypes as string[]) {
        if (!validTypes.includes(t)) {
          errors.push(`Invalid chart type: ${t}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== Tool Definition =====

/**
 * Chart generator tool implementation
 */
export const chartGenTool: ToolDefinition = {
  name: 'chart_gen',
  displayName: 'Chart Generator',
  description: 'Generate interactive charts from LLM-constructed data with automatic chart type selection and PNG export.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'chart_gen',
      description: `Generate an interactive chart from structured data you have constructed. Use when you have data from analysis, knowledge base, or web search that would benefit from visualization. The chart will be rendered automatically with PNG download option.

When to use:
- User asks to visualize/chart/graph data you've gathered
- Comparative analysis would benefit from visual representation
- Trends, distributions, or relationships need illustration

Do NOT use:
- When a configured data_source can provide the data
- For simple lists or tables (just use markdown)
- When data has more than 500 rows

CRITICAL RULES:
- Ensure all data objects have consistent keys
- x_field and all y_fields must exist in every data object
- Use descriptive titles that explain what the chart shows
- Add notes to explain data sources, methodology, or scale definitions`,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Descriptive chart title (e.g., "Trinidad & Tobago SOEs - Fiscal Risk Assessment 2024")',
          },
          data: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of data objects with consistent keys. Maximum 500 rows. Example: [{"name": "Company A", "revenue": 100, "profit": 20}, ...]',
          },
          x_field: {
            type: 'string',
            description: 'Field name for X-axis (categories/labels). Must exist in data objects.',
          },
          y_fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Field name(s) for Y-axis values. Single field for simple charts, multiple fields for grouped/stacked charts. Must exist in data objects.',
          },
          recommended_chart: {
            type: 'string',
            enum: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table', 'auto'],
            description: 'Recommended chart type based on data characteristics. Use "auto" to let system decide. Guidelines: bar=comparisons, line=trends over time, pie=parts of whole (8 or fewer categories), area=cumulative trends, radar=multi-dimensional comparison, table=raw data display.',
          },
          series_mode: {
            type: 'string',
            enum: ['grouped', 'stacked', 'auto'],
            description: 'How to display multiple y_fields: "grouped" (bars side-by-side), "stacked" (bars on top of each other), or "auto" (let system decide). Only applies when multiple y_fields are provided.',
          },
          notes: {
            type: 'string',
            description: 'Optional notes about data sources, methodology, scale definitions, or caveats. Will be displayed below the chart in a collapsible section.',
          },
        },
        required: ['title', 'data', 'x_field', 'y_fields'],
      },
    },
  },

  configSchema: chartGenConfigSchema,

  defaultConfig: CHART_GEN_DEFAULTS as unknown as Record<string, unknown>,

  execute: async (args: Record<string, unknown>): Promise<string> => {
    const typedArgs = args as unknown as ChartGenToolArgs;
    const config = await getChartGenConfig();

    // Validate arguments
    const validation = validateArgs(typedArgs, config);
    if (!validation.valid) {
      return formatError(
        'VALIDATION_ERROR',
        'Invalid arguments provided',
        validation.errors.join('; ')
      );
    }

    // Log warnings
    if (validation.warnings.length > 0) {
      console.warn('[ChartGen] Warnings:', validation.warnings.join('; '));
    }

    // Determine chart type
    let chartType: ChartType;
    if (typedArgs.recommended_chart && typedArgs.recommended_chart !== 'auto') {
      // Use LLM recommendation if valid and enabled
      if (config.enabledChartTypes.includes(typedArgs.recommended_chart as ChartType)) {
        chartType = typedArgs.recommended_chart as ChartType;
      } else {
        chartType = autoSelectChartType(
          typedArgs.data,
          typedArgs.x_field,
          typedArgs.y_fields,
          config.defaultChartType
        );
      }
    } else {
      // Auto-select based on data characteristics
      chartType = autoSelectChartType(
        typedArgs.data,
        typedArgs.x_field,
        typedArgs.y_fields,
        config.defaultChartType
      );
    }

    return formatResponse(typedArgs, chartType);
  },

  validateConfig: validateChartGenConfig,
};

export default chartGenTool;
