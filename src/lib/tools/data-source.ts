/**
 * Data Source Tool
 *
 * Provides data querying capabilities from external APIs and CSV files
 * with category-based access control and visualization support.
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getDataSourceByName, getAllDataSourcesForCategories } from '../db/compat/data-sources';
import { wouldToolSkillMatch } from '../db/compat/skills';
import { callDataAPI } from '../data-sources/api-caller';
import { queryCSVData, queryCSVDataWithAggregation } from '../data-sources/csv-handler';
import { aggregateData } from '../data-sources/aggregation';
import { getRequestContext } from '../request-context';
import type { ToolDefinition, ValidationResult } from '../tools';
import type {
  DataFilter,
  DataSort,
  DataQueryResponse,
  ChartType,
  VisualizationHint,
  AggregationConfig,
  AggregationMetric,
} from '../../types/data-sources';

// ===== Configuration Schema =====

/**
 * Data source tool configuration schema for admin UI
 */
const dataSourceConfigSchema = {
  type: 'object',
  properties: {
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'How long to cache API responses',
      minimum: 60,
      maximum: 86400,
      default: 3600,
    },
    timeout: {
      type: 'number',
      title: 'Request Timeout (seconds)',
      description: 'Maximum time to wait for API responses',
      minimum: 5,
      maximum: 120,
      default: 30,
    },
    defaultLimit: {
      type: 'number',
      title: 'Default Record Limit',
      description: 'Default number of records to return (keep low to avoid token limits)',
      minimum: 1,
      maximum: 200,
      default: 30,
    },
    maxLimit: {
      type: 'number',
      title: 'Maximum Record Limit',
      description: 'Maximum number of records allowed per query (keep low to avoid token limits)',
      minimum: 1,
      maximum: 500,
      default: 200,
    },
    defaultChartType: {
      type: 'string',
      title: 'Default Chart Type',
      description: 'Default visualization type when not specified',
      enum: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
      default: 'bar',
    },
    enabledChartTypes: {
      type: 'array',
      title: 'Enabled Chart Types',
      description: 'Chart types available for visualization',
      items: {
        type: 'string',
        enum: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
      },
      default: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
    },
  },
  required: ['cacheTTLSeconds', 'timeout', 'defaultLimit', 'maxLimit'],
};

// ===== Validation =====

/**
 * Validate data source tool configuration
 */
function validateDataSourceConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate cacheTTLSeconds
  if (config.cacheTTLSeconds !== undefined) {
    const cacheTTL = config.cacheTTLSeconds as number;
    if (typeof cacheTTL !== 'number' || cacheTTL < 60 || cacheTTL > 86400) {
      errors.push('cacheTTLSeconds must be a number between 60 and 86400');
    }
  }

  // Validate timeout
  if (config.timeout !== undefined) {
    const timeout = config.timeout as number;
    if (typeof timeout !== 'number' || timeout < 5 || timeout > 120) {
      errors.push('timeout must be a number between 5 and 120');
    }
  }

  // Validate defaultLimit
  if (config.defaultLimit !== undefined) {
    const defaultLimit = config.defaultLimit as number;
    if (typeof defaultLimit !== 'number' || defaultLimit < 1 || defaultLimit > 200) {
      errors.push('defaultLimit must be a number between 1 and 200');
    }
  }

  // Validate maxLimit
  if (config.maxLimit !== undefined) {
    const maxLimit = config.maxLimit as number;
    if (typeof maxLimit !== 'number' || maxLimit < 1 || maxLimit > 500) {
      errors.push('maxLimit must be a number between 1 and 500');
    }
  }

  // Validate defaultChartType
  const validChartTypes = ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'];
  if (config.defaultChartType && !validChartTypes.includes(config.defaultChartType as string)) {
    errors.push(`defaultChartType must be one of: ${validChartTypes.join(', ')}`);
  }

  // Validate enabledChartTypes
  if (config.enabledChartTypes) {
    if (!Array.isArray(config.enabledChartTypes)) {
      errors.push('enabledChartTypes must be an array');
    } else {
      for (const chartType of config.enabledChartTypes as string[]) {
        if (!validChartTypes.includes(chartType)) {
          errors.push(`Invalid chart type in enabledChartTypes: ${chartType}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== Helper Functions =====

/**
 * Get data source tool configuration
 */
async function getDataSourceToolConfig(): Promise<{
  cacheTTLSeconds: number;
  timeout: number;
  defaultLimit: number;
  maxLimit: number;
  defaultChartType: ChartType;
  enabledChartTypes: ChartType[];
}> {
  const config = await getToolConfig('data_source');
  if (config?.config) {
    const c = config.config as Record<string, unknown>;
    return {
      cacheTTLSeconds: (c.cacheTTLSeconds as number) || 3600,
      timeout: (c.timeout as number) || 30,
      defaultLimit: (c.defaultLimit as number) || 30,
      maxLimit: (c.maxLimit as number) || 200,
      defaultChartType: (c.defaultChartType as ChartType) || 'bar',
      enabledChartTypes: (c.enabledChartTypes as ChartType[]) || ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
    };
  }
  return {
    cacheTTLSeconds: 3600,
    timeout: 30,
    defaultLimit: 30,
    maxLimit: 200,
    defaultChartType: 'bar',
    enabledChartTypes: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
  };
}

/**
 * Parse filter arguments from the LLM
 */
function parseFilters(filterArgs?: Array<{
  field: string;
  operator: string;
  value: unknown;
}>): DataFilter[] | undefined {
  if (!filterArgs || !Array.isArray(filterArgs) || filterArgs.length === 0) {
    return undefined;
  }

  const validOperators = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'in'];

  return filterArgs
    .filter(f => f.field && validOperators.includes(f.operator))
    .map(f => ({
      field: f.field,
      operator: f.operator as DataFilter['operator'],
      value: f.value,
    }));
}

/**
 * Parse sort argument from the LLM
 */
function parseSort(sortArg?: { field: string; direction?: string }): DataSort | undefined {
  if (!sortArg?.field) return undefined;

  return {
    field: sortArg.field,
    direction: sortArg.direction === 'desc' ? 'desc' : 'asc',
  };
}

/**
 * Check if visualization was requested via keywords or explicit param
 * Uses skills with tool_name='chart_gen' for keyword matching (database-driven)
 */
async function isVisualizationRequested(
  userMessage: string,
  explicitVizParam: boolean
): Promise<boolean> {
  if (explicitVizParam) return true;

  // Check if any chart_gen skill would match the message
  // This is database-driven via skills with tool_name='chart_gen'
  return await wouldToolSkillMatch('chart_gen', userMessage);
}

/**
 * Recommend chart type and fields based on data characteristics
 * Smart auto-detection for best visualization
 */
function recommendVisualization(
  data: Record<string, unknown>[],
  fields: string[],
  aggregation?: AggregationConfig,
  defaultChartType: ChartType = 'bar'
): VisualizationHint {
  if (data.length === 0) {
    return { chartType: 'table' };
  }

  // Suppress charts for data that doesn't benefit from visualization:
  // 1. Single record (simple counts, totals)
  // 2. Very few records (1-2) that are just aggregate results
  if (data.length <= 2) {
    const firstRow = data[0];
    // Check if this looks like an aggregate result (mostly numeric/count fields)
    const categoricalFields = fields.filter(f => {
      const val = firstRow[f];
      return typeof val === 'string' && isNaN(Number(val as string)) && f !== 'count';
    });
    // If no categorical fields, or only numeric/count fields, use table
    if (categoricalFields.length === 0) {
      return { chartType: 'table' };
    }
    // For 1-2 records, charts aren't useful unless we have clear categories
    if (data.length === 1 && categoricalFields.length < 2) {
      return { chartType: 'table' };
    }
  }

  const firstRow = data[0];

  // Categorize fields
  const stringFields = fields.filter(f => {
    const val = firstRow[f];
    return typeof val === 'string' && isNaN(Number(val as string));
  });

  const numericFields = fields.filter(f => {
    const val = firstRow[f];
    return typeof val === 'number' || (!isNaN(Number(val)) && val !== null && val !== '');
  });

  // Count unique values for categorical detection
  const getUniqueCount = (field: string) =>
    new Set(data.map(d => d[field])).size;

  // ===== CHART TYPE SELECTION RULES =====

  // Normalize group_by to array for easier handling
  const groupByFields = aggregation?.group_by
    ? (Array.isArray(aggregation.group_by) ? aggregation.group_by : [aggregation.group_by])
    : [];

  // Rule 1: Multi-field aggregation → Stacked Bar (for cross-tabulation)
  if (groupByFields.length >= 2) {
    // First field is X-axis, second is groupBy for stacking
    return {
      chartType: 'bar',
      xField: groupByFields[0],
      yField: numericFields[0] || 'count',
      groupBy: groupByFields[1],
    };
  }

  // Rule 1b: Single-field aggregation with multiple string fields → Stacked Bar
  if (groupByFields.length === 1 && stringFields.length >= 2) {
    const xField = stringFields.find(f => f !== groupByFields[0]) || stringFields[0];
    return {
      chartType: 'bar',
      xField,
      yField: numericFields[0] || 'count',
      groupBy: groupByFields[0],
    };
  }

  // Rule 2: Time series data → Line Chart
  const dateFields = fields.filter(f =>
    /date|time|year|month|day/i.test(f) ||
    !isNaN(Date.parse(String(firstRow[f])))
  );
  if (dateFields.length > 0 && numericFields.length > 0) {
    return {
      chartType: 'line',
      xField: dateFields[0],
      yField: numericFields[0],
    };
  }

  // Rule 3: Few categories with values → Pie Chart
  const bestCategoryField = stringFields.find(f => {
    const uniqueCount = getUniqueCount(f);
    return uniqueCount >= 2 && uniqueCount <= 8;
  });
  if (bestCategoryField && numericFields.length > 0 && data.length <= 20) {
    return {
      chartType: 'pie',
      xField: bestCategoryField,
      yField: numericFields[0],
    };
  }

  // Rule 4: Many data points with 2 numeric fields → Scatter
  if (numericFields.length >= 2 && data.length > 30) {
    return {
      chartType: 'scatter',
      xField: numericFields[0],
      yField: numericFields[1],
      groupBy: stringFields[0],
    };
  }

  // Rule 5: Comparing multiple metrics → Radar
  if (numericFields.length >= 3 && data.length <= 10) {
    return {
      chartType: 'radar',
      xField: stringFields[0] || fields[0],
      yField: numericFields[0],
    };
  }

  // Rule 6: Default → Bar Chart (most versatile)
  return {
    chartType: defaultChartType,
    xField: stringFields[0] || fields[0],
    yField: numericFields[0] || 'count',
  };
}

/**
 * Format the query response for LLM consumption
 */
function formatResponseForLLM(
  response: DataQueryResponse,
  visualization?: VisualizationHint
): string {
  if (!response.success) {
    return JSON.stringify({
      success: false,
      error: response.error,
      metadata: response.metadata,
    });
  }

  const result: Record<string, unknown> = {
    success: true,
    metadata: {
      source: response.metadata.source,
      sourceType: response.metadata.sourceType,
      recordCount: response.metadata.recordCount,
      totalRecords: response.metadata.totalRecords,
      fields: response.metadata.fields,
      executionTimeMs: response.metadata.executionTimeMs,
      cached: response.metadata.cached,
    },
    data: response.data,
  };

  // Include visualization hint if requested
  if (visualization) {
    result.visualizationHint = visualization;
  }

  return JSON.stringify(result, null, 2);
}

// ===== Tool Arguments Interface =====

interface DataSourceToolArgs {
  source_name: string;
  parameters?: Record<string, unknown>;
  filters?: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
  sort?: {
    field: string;
    direction?: string;
  };
  limit?: number;
  offset?: number;
  visualization?: {
    chart_type?: ChartType;
    x_field?: string;
    y_field?: string;
    group_by?: string;
  };
  aggregation?: {
    group_by: string | string[];
    metrics?: Array<{
      field: string;
      operation: string;
    }>;
  };
  category_ids: number[];
}

// ===== Tool Definition =====

/**
 * Data source tool implementation
 * Provides data querying capabilities from configured external APIs and CSV files
 */
export const dataSourceTool: ToolDefinition = {
  name: 'data_source',
  displayName: 'Data Source Query',
  description: 'Query external data sources (APIs and CSV files) configured by administrators. Returns structured data with optional visualization hints.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'data_source',
      description: `Query external data sources (APIs and CSV files) to retrieve structured data. Use this when users ask about data from external systems, reports, statistics, or when you need to fetch and analyze external data. The available data sources are context-dependent based on the current category.

CRITICAL - DO NOT GENERATE CODE:
- DO NOT generate Python, matplotlib, pandas, seaborn, plotly, or any programming code
- DO NOT use print(), plt., import, df., pd., np., fig., ax., or any code syntax
- DO NOT output code blocks with python, javascript, or any programming language
- DO NOT suggest running scripts or code to visualize data

CRITICAL - AUTOMATIC VISUALIZATION:
- The system AUTOMATICALLY renders interactive charts from the data
- You do NOT need to generate any chart code, markup, or visualization syntax
- DO NOT use <chart>, <graph>, display_*(), datavisualizer, or any constructs
- DO NOT generate image markdown like ![chart](url) or reference any image URLs
- JUST describe the data insights in plain text - the interactive chart will appear automatically

OTHER RULES:
- Only data sources linked to the current category are accessible
- Use filters to narrow results
- Always provide analysis along with the data

IMPORTANT FOR LARGE DATASETS:
- For analysis questions (counts, averages, distributions), use the 'aggregation' parameter
- aggregation.group_by: field(s) to group results by - can be a single field or ARRAY of fields for cross-tabulation
  - Single field: "residence" → groups by residence only
  - Multiple fields: ["residence", "education"] → groups by both (creates stacked/multi-series data)
- aggregation.metrics: [{field, operation}] where operation is count/sum/avg/min/max
- This returns compact summaries instead of raw records, enabling analysis of 5000+ row datasets
- Only request raw records (without aggregation) when you need specific individual records`,
      parameters: {
        type: 'object',
        properties: {
          source_name: {
            type: 'string',
            description: 'Name of the data source to query. Must be an available source for the current category.',
          },
          parameters: {
            type: 'object',
            description: 'Parameters to pass to the data source (for API sources). Use based on source documentation.',
            additionalProperties: true,
          },
          filters: {
            type: 'array',
            description: 'Filter conditions to apply to the results',
            items: {
              type: 'object',
              properties: {
                field: {
                  type: 'string',
                  description: 'Field name to filter on',
                },
                operator: {
                  type: 'string',
                  enum: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'in'],
                  description: 'Comparison operator',
                },
                value: {
                  description: 'Value to compare against',
                },
              },
              required: ['field', 'operator', 'value'],
            },
          },
          sort: {
            type: 'object',
            description: 'Sort configuration',
            properties: {
              field: {
                type: 'string',
                description: 'Field to sort by',
              },
              direction: {
                type: 'string',
                enum: ['asc', 'desc'],
                description: 'Sort direction (default: asc)',
              },
            },
            required: ['field'],
          },
          limit: {
            type: 'number',
            description: 'Maximum number of records to return (default: 100)',
          },
          offset: {
            type: 'number',
            description: 'Number of records to skip for pagination',
          },
          visualization: {
            type: 'object',
            description: 'Request visualization of the data. Include this when users want charts or visual representations.',
            properties: {
              chart_type: {
                type: 'string',
                enum: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
                description: 'Type of chart to generate',
              },
              x_field: {
                type: 'string',
                description: 'Field to use for X axis',
              },
              y_field: {
                type: 'string',
                description: 'Field to use for Y axis',
              },
              group_by: {
                type: 'string',
                description: 'Field to group data by',
              },
            },
          },
          aggregation: {
            type: 'object',
            description: 'Server-side aggregation for large datasets. Use this for counts, sums, averages instead of fetching raw records.',
            properties: {
              group_by: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description: 'Field(s) to group results by. Use array for multi-dimensional grouping (e.g., ["residence", "education"])',
              },
              metrics: {
                type: 'array',
                description: 'Metrics to compute for each group',
                items: {
                  type: 'object',
                  properties: {
                    field: {
                      type: 'string',
                      description: 'Field to aggregate',
                    },
                    operation: {
                      type: 'string',
                      enum: ['count', 'sum', 'avg', 'min', 'max'],
                      description: 'Aggregation operation',
                    },
                  },
                  required: ['field', 'operation'],
                },
              },
            },
            required: ['group_by'],
          },
          category_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Category IDs to check for data source access (automatically resolved from context if not provided)',
          },
        },
        required: ['source_name'],
      },
    },
  },

  validateConfig: validateDataSourceConfig,

  defaultConfig: {
    cacheTTLSeconds: 3600,
    timeout: 30,
    defaultLimit: 30,
    maxLimit: 200,
    defaultChartType: 'bar',
    enabledChartTypes: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
  },

  configSchema: dataSourceConfigSchema,

  execute: async (args: DataSourceToolArgs) => {
    console.log('[DataSource] Tool called with args:', JSON.stringify(args, null, 2));
    const toolConfig = await getDataSourceToolConfig();

    // Validate required arguments
    if (!args.source_name) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'MISSING_SOURCE_NAME',
          message: 'source_name is required',
        },
      });
    }

    // Get category IDs from args or fallback to request context
    let categoryIds = args.category_ids;
    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      // Try to get from request context (set by chat API route)
      const context = getRequestContext();
      if (context.categoryIds && context.categoryIds.length > 0) {
        categoryIds = context.categoryIds;
      }
    }

    if (!categoryIds || categoryIds.length === 0) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'NO_CATEGORIES',
          message: 'No category context provided. Data sources require category access.',
        },
      });
    }

    try {
      // Get the data source by name
      const dataSource = await getDataSourceByName(args.source_name);

      if (!dataSource) {
        // List available sources for this category
        const availableSources = await getAllDataSourcesForCategories(categoryIds);
        const sourceNames = availableSources.map(s => s.type === 'api' ? s.config.name : s.config.name);

        return JSON.stringify({
          success: false,
          error: {
            code: 'SOURCE_NOT_FOUND',
            message: `Data source '${args.source_name}' not found`,
            availableSources: sourceNames,
          },
        });
      }

      // Check category access
      const sourceCategoryIds = dataSource.type === 'api'
        ? dataSource.config.categoryIds
        : dataSource.config.categoryIds;

      const hasAccess = categoryIds.some(catId => sourceCategoryIds.includes(catId));

      if (!hasAccess) {
        return JSON.stringify({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: `Data source '${args.source_name}' is not available for the current categories`,
          },
        });
      }

      // Apply limit constraints
      const limit = Math.min(args.limit || toolConfig.defaultLimit, toolConfig.maxLimit);
      const offset = args.offset || 0;

      // Parse filters and sort
      const filters = parseFilters(args.filters);
      const sort = parseSort(args.sort);

      // Parse aggregation config if provided
      const aggregationConfig: AggregationConfig | undefined = args.aggregation
        ? {
            group_by: args.aggregation.group_by,
            metrics: args.aggregation.metrics?.map(m => ({
              field: m.field,
              operation: m.operation as AggregationMetric['operation'],
            })),
          }
        : undefined;

      let response: DataQueryResponse;

      if (dataSource.type === 'api') {
        // Check if API is active
        if (dataSource.config.status !== 'active') {
          return JSON.stringify({
            success: false,
            error: {
              code: 'SOURCE_INACTIVE',
              message: `Data source '${args.source_name}' is currently ${dataSource.config.status}`,
              lastError: dataSource.config.lastError,
            },
          });
        }

        // Call the external API
        response = await callDataAPI(dataSource.config, args.parameters || {});

        // Apply filters to API response (if the API doesn't support server-side filtering)
        if (response.success && response.data && filters && filters.length > 0) {
          response = applyClientSideFilters(response, filters);
        }

        // Apply sort to API response
        if (response.success && response.data && sort) {
          response = applyClientSideSort(response, sort);
        }

        // Apply aggregation OR pagination (not both)
        if (response.success && response.data) {
          if (aggregationConfig) {
            // Aggregate the data server-side
            const totalRecords = response.data.length;
            const aggregatedData = aggregateData(response.data, aggregationConfig);
            response.data = aggregatedData as unknown as Record<string, unknown>[];
            response.metadata.totalRecords = totalRecords;
            response.metadata.recordCount = aggregatedData.length;
          } else {
            // Apply pagination for raw data
            const totalRecords = response.data.length;
            response.data = response.data.slice(offset, offset + limit);
            response.metadata.totalRecords = totalRecords;
            response.metadata.recordCount = response.data.length;
          }
        }
      } else {
        // Query CSV data
        if (aggregationConfig) {
          // Use aggregation query for CSV
          response = queryCSVDataWithAggregation(
            dataSource.config.filePath,
            aggregationConfig,
            filters
          );
        } else {
          // Use regular query for CSV
          response = queryCSVData(
            dataSource.config.filePath,
            filters,
            sort,
            limit,
            offset
          );
        }
      }

      // Build visualization hint - only when explicitly requested
      let visualizationHint: VisualizationHint | undefined;
      if (response.success && response.data && response.data.length > 0) {
        // Get the original user message from request context
        const context = getRequestContext();
        const userMessage = context.userMessage || '';

        // Only generate viz hint if explicitly requested
        const vizRequested = await isVisualizationRequested(
          userMessage,
          !!args.visualization
        );

        console.log('[DataSource] Visualization check:', {
          userMessage: userMessage.substring(0, 100),
          explicitVizParam: !!args.visualization,
          vizRequested,
        });

        if (vizRequested) {
          if (args.visualization) {
            // Use explicit visualization request from LLM
            const chartType = args.visualization.chart_type || toolConfig.defaultChartType;
            visualizationHint = {
              chartType: toolConfig.enabledChartTypes.includes(chartType) ? chartType : toolConfig.defaultChartType,
              xField: args.visualization.x_field,
              yField: args.visualization.y_field,
              groupBy: args.visualization.group_by,
            };
          } else {
            // Auto-recommend based on data characteristics
            const fields = response.metadata?.fields || Object.keys(response.data[0]);
            visualizationHint = recommendVisualization(
              response.data,
              fields,
              aggregationConfig,
              toolConfig.defaultChartType
            );
          }
        }
        // If not requested, visualizationHint remains undefined (no chart)
      }

      return formatResponseForLLM(response, visualizationHint);
    } catch (error) {
      console.error('[DataSource] Query error:', error);
      return JSON.stringify({
        success: false,
        error: {
          code: 'QUERY_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error querying data source',
        },
      });
    }
  },
};

// ===== Client-side Filtering =====

/**
 * Apply filters to response data (client-side)
 */
function applyClientSideFilters(
  response: DataQueryResponse,
  filters: DataFilter[]
): DataQueryResponse {
  if (!response.data) return response;

  const filteredData = response.data.filter(record => {
    return filters.every(filter => {
      const value = record[filter.field];
      const filterValue = filter.value;

      switch (filter.operator) {
        case 'eq':
          return value === filterValue;
        case 'ne':
          return value !== filterValue;
        case 'gt':
          return typeof value === 'number' && typeof filterValue === 'number'
            ? value > filterValue
            : String(value) > String(filterValue);
        case 'lt':
          return typeof value === 'number' && typeof filterValue === 'number'
            ? value < filterValue
            : String(value) < String(filterValue);
        case 'gte':
          return typeof value === 'number' && typeof filterValue === 'number'
            ? value >= filterValue
            : String(value) >= String(filterValue);
        case 'lte':
          return typeof value === 'number' && typeof filterValue === 'number'
            ? value <= filterValue
            : String(value) <= String(filterValue);
        case 'contains':
          return typeof value === 'string' && typeof filterValue === 'string'
            ? value.toLowerCase().includes(filterValue.toLowerCase())
            : false;
        case 'in':
          return Array.isArray(filterValue) && filterValue.includes(value);
        default:
          return true;
      }
    });
  });

  return {
    ...response,
    data: filteredData,
    metadata: {
      ...response.metadata,
      recordCount: filteredData.length,
    },
  };
}

/**
 * Apply sort to response data (client-side)
 */
function applyClientSideSort(
  response: DataQueryResponse,
  sort: DataSort
): DataQueryResponse {
  if (!response.data) return response;

  const sortedData = [...response.data].sort((a, b) => {
    const aVal = a[sort.field];
    const bVal = b[sort.field];

    // Handle nulls
    if (aVal === null || aVal === undefined) return sort.direction === 'asc' ? 1 : -1;
    if (bVal === null || bVal === undefined) return sort.direction === 'asc' ? -1 : 1;

    // Compare values
    let comparison: number;
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }

    return sort.direction === 'asc' ? comparison : -comparison;
  });

  return {
    ...response,
    data: sortedData,
  };
}

/**
 * Get available data sources for categories (for system prompt injection)
 */
export async function getAvailableDataSourcesDescription(categoryIds: number[]): Promise<string> {
  if (!categoryIds || categoryIds.length === 0) {
    return '';
  }

  const sources = await getAllDataSourcesForCategories(categoryIds);
  if (sources.length === 0) {
    return '';
  }

  // Start with critical anti-code rules that apply to ALL models (including Gemini)
  const descriptions: string[] = [
    '## Data Visualization Rules (MANDATORY)',
    '',
    '⚠️ CRITICAL - NEVER OUTPUT CODE IN YOUR RESPONSE:',
    '- NEVER write print(), data_source.query(), SELECT, or ANY code syntax',
    '- NEVER output Python, SQL, JavaScript, or any programming code',
    '- NEVER use matplotlib, pandas, plotly, seaborn, or any library calls',
    '- NEVER output ```python, ```sql, or any code blocks',
    '- NEVER write function calls like display_chart(), create_pie_chart(), etc.',
    '',
    '✅ CORRECT APPROACH:',
    '1. Call the data_source TOOL (not print/code) to fetch data',
    '2. The system AUTOMATICALLY renders charts from the tool result',
    '3. In your response, just describe insights in PLAIN TEXT - no code!',
    '',
    'EXAMPLE OF WHAT NOT TO DO:',
    '❌ print(data_source.query("SELECT...", "bar_chart"))',
    '❌ ```python import pandas...```',
    '',
    'EXAMPLE OF CORRECT RESPONSE:',
    '✅ "Based on the survey data, St. George has 200 respondents (40%)..."',
    '',
    'Available Data Sources:',
  ];

  for (const source of sources) {
    if (source.type === 'api') {
      const api = source.config;
      if (api.status !== 'active') continue;

      descriptions.push(`\n- ${api.name} (API): ${api.description}`);

      // Add parameter info
      const requiredParams = api.parameters.filter(p => p.required);
      if (requiredParams.length > 0) {
        descriptions.push(`  Required parameters: ${requiredParams.map(p => p.name).join(', ')}`);
      }

      // Add field info
      if (api.responseStructure.fields.length > 0) {
        descriptions.push(`  Available fields: ${api.responseStructure.fields.map(f => f.name).join(', ')}`);
      }
    } else {
      const csv = source.config;
      descriptions.push(`\n- ${csv.name} (CSV): ${csv.description}`);
      descriptions.push(`  Rows: ${csv.rowCount}`);
      descriptions.push(`  Columns: ${csv.columns.map(c => c.name).join(', ')}`);
    }
  }

  return descriptions.join('\n');
}
