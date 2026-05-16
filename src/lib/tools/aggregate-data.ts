/**
 * Aggregate Inline Data Tool
 *
 * Deterministically aggregates raw tabular data pasted by the user (or otherwise
 * passed into the chat). Accepts one or multiple tables in several formats:
 *
 *   - JSON array of row objects: [{a:1,b:2},...]
 *   - JSON object of named tables: {tabA: [...], tabB: [...]}
 *   - Markdown section headings + pipe-tables: "## TabA\n| col | ... |\n..."
 *   - CSV section markers + CSV blocks: "=== TabA ===\n...csv..."
 *   - Single pipe-delimited markdown table
 *   - Single CSV string
 *
 * Reuses the existing aggregation engine (data-sources/aggregation.ts).
 * Used BEFORE html_gen to eliminate arithmetic hallucination on large datasets,
 * especially for the pasted-inline data path (multi-table case).
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import { aggregateData } from '../data-sources/aggregation';
import type {
  AggregationConfig,
  AggregationMetric,
  AggregatedRow,
  DataFilter,
} from '../../types/data-sources';

// ============ Types ============

type Row = Record<string, unknown>;

interface ParsedBundle {
  /** Named tables keyed by detected name (or "default" for single-table input) */
  tables: Record<string, Row[]>;
  /** Whether multiple tables were detected */
  multiTable: boolean;
}

interface AggregateDataArgs {
  data: string;
  scope?: string;
  group_by: string | string[];
  metrics?: AggregationMetric[];
  top_n?: number;
  filters?: DataFilter[];
}

// ============ Parsing Helpers ============

/**
 * Try to parse raw text into a bundle of named tables.
 * Returns null only when all detection paths fail.
 */
function parseTabularBundle(raw: string): ParsedBundle | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1) JSON
  try {
    const parsed = JSON.parse(trimmed);
    // a) JSON array → single-table input
    if (Array.isArray(parsed)) {
      const rows = parsed.filter((r) => r && typeof r === 'object') as Row[];
      if (rows.length > 0) {
        return { tables: { default: rows }, multiTable: false };
      }
    }
    // b) JSON object whose values are arrays → multi-table input
    else if (parsed && typeof parsed === 'object') {
      const tables: Record<string, Row[]> = {};
      let hadTable = false;
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) {
          const rows = v.filter((r) => r && typeof r === 'object') as Row[];
          if (rows.length > 0) {
            tables[k] = rows;
            hadTable = true;
          }
        }
      }
      if (hadTable) {
        const names = Object.keys(tables);
        return { tables, multiTable: names.length > 1 };
      }
    }
  } catch {
    // not JSON; fall through
  }

  // 2) Markdown sections: `## SectionName` followed by a pipe table
  if (/^##\s+\S+/m.test(trimmed)) {
    const sections = splitMarkdownSections(trimmed);
    if (Object.keys(sections).length > 0) {
      const tables: Record<string, Row[]> = {};
      for (const [name, body] of Object.entries(sections)) {
        const rows = parseMarkdownTable(body);
        if (rows.length > 0) tables[name] = rows;
      }
      if (Object.keys(tables).length > 0) {
        return { tables, multiTable: Object.keys(tables).length > 1 };
      }
    }
  }

  // 3) CSV sections: `=== SectionName ===` markers
  if (/^===\s+.+\s+===/m.test(trimmed)) {
    const sections = splitCsvSections(trimmed);
    if (Object.keys(sections).length > 0) {
      const tables: Record<string, Row[]> = {};
      for (const [name, body] of Object.entries(sections)) {
        const rows = parseCsv(body);
        if (rows.length > 0) tables[name] = rows;
      }
      if (Object.keys(tables).length > 0) {
        return { tables, multiTable: Object.keys(tables).length > 1 };
      }
    }
  }

  // 4) Single markdown table
  if (/^\s*\|.*\|/m.test(trimmed)) {
    const rows = parseMarkdownTable(trimmed);
    if (rows.length > 0) return { tables: { default: rows }, multiTable: false };
  }

  // 5) Single CSV
  const csvRows = parseCsv(trimmed);
  if (csvRows.length > 0) return { tables: { default: csvRows }, multiTable: false };

  return null;
}

/** Split markdown into `{sectionName: bodyText}` keyed on `## Heading` boundaries. */
function splitMarkdownSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = text.split('\n');
  let currentName: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentName !== null) {
      sections[currentName] = buffer.join('\n').trim();
    }
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      currentName = slugifySectionName(m[1]);
      buffer = [];
    } else if (currentName !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function splitCsvSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = text.split('\n');
  let currentName: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentName !== null) {
      sections[currentName] = buffer.join('\n').trim();
    }
  };
  for (const line of lines) {
    const m = line.match(/^===\s+(.+?)\s+===\s*$/);
    if (m) {
      flush();
      currentName = slugifySectionName(m[1]);
      buffer = [];
    } else if (currentName !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function slugifySectionName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unnamed';
}

/** Parse a GitHub-flavoured pipe table into row objects. */
function parseMarkdownTable(text: string): Row[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  // Find the first line that looks like a header row (contains '|').
  const headerIdx = lines.findIndex((l) => l.includes('|'));
  if (headerIdx < 0) return [];
  const headerCells = splitPipeRow(lines[headerIdx]);
  if (headerCells.length === 0) return [];

  // Skip the separator row if present (---|---|---)
  let dataStart = headerIdx + 1;
  if (dataStart < lines.length && /^[|\s\-:]+$/.test(lines[dataStart])) {
    dataStart++;
  }

  const rows: Row[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) break;
    const cells = splitPipeRow(line);
    if (cells.length === 0) continue;
    const row: Row = {};
    headerCells.forEach((h, idx) => {
      const raw = cells[idx] ?? '';
      row[h] = coerceCellValue(raw);
    });
    rows.push(row);
  }
  return rows;
}

function splitPipeRow(line: string): string[] {
  const trimmed = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  return trimmed.split('|').map((c) => c.trim()).filter((_, i, arr) => arr.length > 0);
}

/** Minimal CSV parser — handles quoted cells, commas inside quotes, escaped quotes. */
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { current.push(cell); cell = ''; }
      else if (ch === '\n') { current.push(cell); rows.push(current); current = []; cell = ''; }
      else if (ch === '\r') { /* skip */ }
      else cell += ch;
    }
  }
  if (cell.length > 0 || current.length > 0) { current.push(cell); rows.push(current); }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const out: Row[] = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue;
    const row: Row = {};
    header.forEach((h, idx) => {
      row[h] = coerceCellValue(rows[r][idx] ?? '');
    });
    out.push(row);
  }
  return out;
}

/** Convert string cells to numbers when they parse cleanly. */
function coerceCellValue(raw: string): unknown {
  const s = raw.trim();
  if (s === '' || s === '-' || s === '—' || s === 'N/A' || s === 'NA') return null;
  // Strip currency / percent symbols before testing as number
  const numeric = s.replace(/^[$£€¥]/, '').replace(/,/g, '').replace(/%$/, '');
  if (/^-?\d+(\.\d+)?$/.test(numeric)) {
    return parseFloat(numeric);
  }
  return s;
}

// ============ Filter & Top-N Helpers ============

function applyFilters(data: Row[], filters: DataFilter[]): Row[] {
  return data.filter((record) =>
    filters.every((f) => {
      const value = record[f.field];
      switch (f.operator) {
        case 'eq': return value === f.value;
        case 'ne': return value !== f.value;
        case 'gt': return typeof value === 'number' && typeof f.value === 'number' ? value > f.value : String(value) > String(f.value);
        case 'lt': return typeof value === 'number' && typeof f.value === 'number' ? value < f.value : String(value) < String(f.value);
        case 'gte': return typeof value === 'number' && typeof f.value === 'number' ? value >= f.value : String(value) >= String(f.value);
        case 'lte': return typeof value === 'number' && typeof f.value === 'number' ? value <= f.value : String(value) <= String(f.value);
        case 'contains': return typeof value === 'string' && typeof f.value === 'string' && value.toLowerCase().includes(f.value.toLowerCase());
        case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(value);
        default: return true;
      }
    })
  );
}

function topN(rows: AggregatedRow[], n: number, metrics?: AggregationMetric[]): AggregatedRow[] {
  // Sort by the first metric (descending) if metrics exist, else by count (which is already the default sort).
  if (metrics && metrics.length > 0) {
    const metricKey = `${metrics[0].field}_${metrics[0].operation}`;
    const sorted = [...rows].sort((a, b) => Number(b[metricKey] ?? 0) - Number(a[metricKey] ?? 0));
    return sorted.slice(0, n);
  }
  return rows.slice(0, n);
}

// ============ Schemas Compatibility Check ============

function schemasCompatible(tables: Record<string, Row[]>): boolean {
  const names = Object.keys(tables);
  if (names.length < 2) return true;
  const reference = Object.keys(tables[names[0]][0] || {}).sort().join(',');
  return names.every((n) => {
    const cols = Object.keys(tables[n][0] || {}).sort().join(',');
    return cols === reference;
  });
}

// ============ Tool Definition ============

export const aggregateDataTool: ToolDefinition = {
  name: 'aggregate_data',
  displayName: 'Aggregate Inline Data',
  description:
    'Aggregate raw tabular data the user pasted (or otherwise supplied as text). Accepts JSON, CSV, or markdown tables — single or multiple tables. Returns deterministic count/sum/avg/min/max group-by results. Use BEFORE html_gen when the user has pasted a dataset and wants a dashboard, to eliminate arithmetic errors.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'aggregate_data',
      description: [
        'Aggregate inline tabular data deterministically. Use this tool BEFORE html_gen whenever the user pastes raw data and asks for a dashboard, analysis, or chart.',
        '',
        'ACCEPTED INPUT FORMATS for `data`:',
        '  1. JSON array of row objects: [{"id":1,"status":"open"},...]',
        '  2. JSON object whose values are arrays of rows (multi-table): {"tabA":[...],"tabB":[...]}',
        '  3. Markdown with ## headings followed by pipe tables (multi-table)',
        '  4. CSV sections separated by "=== Name ===" markers (multi-table)',
        '  5. A single pipe-delimited markdown table',
        '  6. A single CSV string',
        '',
        'WORKFLOW for multi-table input:',
        '  - First call: omit `scope`. The tool returns a tables_detected inventory.',
        '  - Subsequent calls: set `scope` to one of the detected table names, or "all" to union schema-compatible tables.',
        '',
        'NEVER compute counts or sums yourself when this tool is available.',
        'Returns: aggregated_rows (at most ~30 rows per call). Pass these into chart blocks of html_gen.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description: 'Raw tabular input. One or more tables in JSON, CSV, or markdown-table form. See description.',
          },
          scope: {
            type: 'string',
            description: 'Which table to aggregate when the input contains multiple tables. Use a detected table name or "all" to union schema-compatible tables. Omit on first call to receive the tables_detected inventory.',
          },
          group_by: {
            description: 'Column(s) to group on. String for single-field grouping, array for cross-tab.',
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          metrics: {
            type: 'array',
            description: 'Metrics to compute per group. Defaults to just count when omitted.',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                operation: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
              },
              required: ['field', 'operation'],
            },
          },
          top_n: {
            type: 'number',
            description: 'Optional: return only the top N rows by the first metric (descending).',
          },
          filters: {
            type: 'array',
            description: 'Optional row filters applied before aggregation.',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                operator: { type: 'string', enum: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'in'] },
                value: {},
              },
              required: ['field', 'operator', 'value'],
            },
          },
        },
        required: ['data', 'group_by'],
      },
    },
  },

  validateConfig: (): ValidationResult => ({ valid: true, errors: [] }),
  defaultConfig: {},
  configSchema: { type: 'object', properties: {} },

  execute: async (args: AggregateDataArgs): Promise<string> => {
    try {
      if (!args.data || typeof args.data !== 'string') {
        return JSON.stringify({ success: false, error: 'data parameter is required and must be a string' });
      }
      if (!args.group_by) {
        return JSON.stringify({ success: false, error: 'group_by parameter is required' });
      }

      const bundle = parseTabularBundle(args.data);
      if (!bundle || Object.keys(bundle.tables).length === 0) {
        return JSON.stringify({
          success: false,
          error: 'Could not parse data as JSON, CSV, or markdown table. Check the input format.',
        });
      }

      // Multi-table input without scope → return inventory and stop.
      if (bundle.multiTable && !args.scope) {
        const inventory = Object.entries(bundle.tables).map(([name, rows]) => ({
          name,
          rows: rows.length,
          columns: Object.keys(rows[0] || {}),
        }));
        return JSON.stringify({
          success: true,
          tables_detected: inventory,
          schemas_compatible: schemasCompatible(bundle.tables),
          hint: 'Multiple tables detected. Re-call this tool with scope="<name>" to aggregate one table, or scope="all" to union all schema-compatible tables.',
        });
      }

      // Resolve the rows to aggregate based on scope.
      let rowsToAggregate: Row[] = [];
      let resolvedScope = args.scope ?? Object.keys(bundle.tables)[0];
      if (args.scope === 'all') {
        if (!schemasCompatible(bundle.tables)) {
          return JSON.stringify({
            success: false,
            error: 'scope="all" requires all tables to share the same column set. Use a specific table name instead.',
          });
        }
        rowsToAggregate = Object.values(bundle.tables).flat();
        resolvedScope = 'all';
      } else if (args.scope) {
        const t = bundle.tables[args.scope];
        if (!t) {
          return JSON.stringify({
            success: false,
            error: `Table "${args.scope}" not found. Detected tables: ${Object.keys(bundle.tables).join(', ')}`,
          });
        }
        rowsToAggregate = t;
      } else {
        // Single-table input — use the only table.
        rowsToAggregate = bundle.tables[Object.keys(bundle.tables)[0]];
      }

      // Apply pre-aggregation filters
      if (Array.isArray(args.filters) && args.filters.length > 0) {
        rowsToAggregate = applyFilters(rowsToAggregate, args.filters);
      }

      const config: AggregationConfig = {
        group_by: args.group_by,
        metrics: args.metrics,
      };
      let aggregated = aggregateData(rowsToAggregate, config);
      if (typeof args.top_n === 'number' && args.top_n > 0) {
        aggregated = topN(aggregated, args.top_n, args.metrics);
      }

      return JSON.stringify({
        success: true,
        scope: resolvedScope,
        total_input_rows: rowsToAggregate.length,
        aggregated_rows: aggregated,
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error during aggregation',
      });
    }
  },
};
