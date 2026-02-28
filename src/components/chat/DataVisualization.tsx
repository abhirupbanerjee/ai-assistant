'use client';

import React, { useState, useMemo, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, Table, Download, ChevronDown, ChevronUp, Activity, Radar as RadarIcon, AlertCircle, Image as ImageIcon } from 'lucide-react';
import type { ChartType, VisualizationHint } from '@/types/data-sources';

// ===== Error Boundary =====

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ChartErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Chart rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center gap-2 p-4 bg-red-50 text-red-600 rounded-lg">
          <AlertCircle size={20} />
          <span>Unable to render chart. View data in table format instead.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ===== Types =====

interface DataVisualizationProps {
  /** Chart type to render */
  chartType: ChartType;
  /** Data to visualize */
  data: Record<string, unknown>[];
  /** Field for X axis (category axis) */
  xField?: string;
  /** Field for Y axis (value axis) */
  yField?: string;
  /** Multiple Y fields for multi-series/stacked charts (from chart_gen) */
  yFields?: string[];
  /** Field to group data by */
  groupBy?: string;
  /** Source name for attribution */
  sourceName?: string;
  /** Whether data was cached */
  cached?: boolean;
  /** Available fields for axis selection */
  fields?: string[];
  /** Title for the chart */
  title?: string;
  /** Notes about data sources/methodology (displayed in collapsible section) */
  notes?: string;
  /** Series display mode for multi-series charts */
  seriesMode?: 'grouped' | 'stacked' | 'auto';
}

// ===== Constants =====

const CHART_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

const CHART_ICONS: Record<ChartType, React.ReactNode> = {
  bar: <BarChart3 size={16} />,
  line: <LineChartIcon size={16} />,
  pie: <PieChartIcon size={16} />,
  area: <Activity size={16} />,
  scatter: <Activity size={16} />,
  radar: <RadarIcon size={16} />,
  table: <Table size={16} />,
};

// ===== Helper Functions =====

/**
 * Get numeric fields from data
 */
function getNumericFields(data: Record<string, unknown>[]): string[] {
  if (!data || data.length === 0) return [];

  const firstRow = data[0];
  return Object.entries(firstRow)
    .filter(([, value]) => typeof value === 'number')
    .map(([key]) => key);
}

/**
 * Get string fields from data
 */
function getStringFields(data: Record<string, unknown>[]): string[] {
  if (!data || data.length === 0) return [];

  const firstRow = data[0];
  return Object.entries(firstRow)
    .filter(([, value]) => typeof value === 'string')
    .map(([key]) => key);
}

/**
 * Aggregate data by a field (sum values)
 */
function aggregateData(
  data: Record<string, unknown>[],
  groupField: string,
  valueField: string
): Record<string, unknown>[] {
  const groups: Record<string, number> = {};

  for (const row of data) {
    const key = String(row[groupField] ?? 'Unknown');
    const value = Number(row[valueField]) || 0;
    groups[key] = (groups[key] || 0) + value;
  }

  return Object.entries(groups).map(([name, value]) => ({
    name,
    value,
  }));
}

/**
 * Count occurrences by category (for categorical/survey data)
 */
function countByCategory(
  data: Record<string, unknown>[],
  categoryField: string
): Record<string, unknown>[] {
  const counts: Record<string, number> = {};

  for (const row of data) {
    const key = String(row[categoryField] ?? 'Unknown');
    // Skip empty/Nan values
    if (key && key !== 'Nan' && key !== 'null' && key !== 'undefined' && key !== '') {
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  // Sort by count descending
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
    }));
}

/**
 * Check if data is categorical (no numeric fields or all values are non-numeric strings)
 */
function isCategoricalData(data: Record<string, unknown>[]): boolean {
  if (!data || data.length === 0) return false;

  const numericFields = getNumericFields(data);

  // If there are no numeric fields, it's categorical
  if (numericFields.length === 0) return true;

  // Check if numeric fields are actually just IDs or dates (not useful for Y-axis)
  const firstRow = data[0];
  const usefulNumericFields = numericFields.filter(field => {
    const value = firstRow[field];
    const strValue = String(value);
    // Exclude date-like values and UUID-like values
    return !strValue.includes('-') && !strValue.includes('T') && !strValue.includes(':');
  });

  return usefulNumericFields.length === 0;
}

/**
 * Generate user-friendly title from field name
 * Converts snake_case/camelCase to Title Case
 */
function formatFieldName(fieldName: string): string {
  return fieldName
    // Split on underscores, hyphens, and camelCase
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    // Capitalize first letter of each word
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Pivot data for multi-series charts
 * Transforms grouped data into a format suitable for stacked/multi-series charts
 *
 * Input:  [{ location: "NYC", education: "HS", count: 10 }, { location: "NYC", education: "BS", count: 20 }]
 * Output: { pivotedData: [{ location: "NYC", "HS": 10, "BS": 20 }], seriesKeys: ["HS", "BS"] }
 */
function pivotDataForMultiSeries(
  data: Record<string, unknown>[],
  xField: string,
  groupBy: string,
  valueField: string
): { pivotedData: Record<string, unknown>[]; seriesKeys: string[] } {
  const grouped = new Map<string, Record<string, unknown>>();
  const seriesKeysSet = new Set<string>();

  for (const row of data) {
    const xValue = String(row[xField] ?? 'Unknown');
    const groupValue = String(row[groupBy] ?? 'Unknown');
    const value = row[valueField];

    seriesKeysSet.add(groupValue);

    if (!grouped.has(xValue)) {
      grouped.set(xValue, { [xField]: xValue });
    }
    grouped.get(xValue)![groupValue] = value;
  }

  return {
    pivotedData: Array.from(grouped.values()),
    seriesKeys: Array.from(seriesKeysSet),
  };
}

/**
 * Check if any labels exceed the maximum length for legend display
 * Long labels (>50 chars) should only show in tooltips, not legends
 */
function hasLongLabels(labels: (string | undefined)[], maxLength = 50): boolean {
  return labels.some(label => label !== undefined && label.length > maxLength);
}

/**
 * Generate user-friendly chart title
 */
function generateChartTitle(
  categoryField: string,
  isCategorical: boolean,
  sourceName?: string
): string {
  const fieldLabel = formatFieldName(categoryField);

  if (isCategorical) {
    return `Survey Results: ${fieldLabel}`;
  }

  return sourceName ? `Data: ${fieldLabel}` : `Chart: ${fieldLabel}`;
}

/**
 * Format number for display
 */
function formatNumber(value: unknown): string {
  // Handle non-numeric values
  if (value === null || value === undefined) return '-';

  const num = typeof value === 'number' ? value : Number(value);

  // If conversion failed, return as string
  if (isNaN(num)) return String(value);

  if (Math.abs(num) >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(num) >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toFixed(num % 1 === 0 ? 0 : 2);
}

// ===== Sub-Components =====

/**
 * Chart selector buttons
 */
function ChartTypeSelector({
  currentType,
  onTypeChange,
  availableTypes,
}: {
  currentType: ChartType;
  onTypeChange: (type: ChartType) => void;
  availableTypes: ChartType[];
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {availableTypes.map(type => (
        <button
          key={type}
          onClick={() => onTypeChange(type)}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
            currentType === type
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title={type.charAt(0).toUpperCase() + type.slice(1)}
        >
          {CHART_ICONS[type]}
          <span className="hidden sm:inline capitalize">{type}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Field selector dropdown
 */
function FieldSelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-gray-500">{label}:</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2 py-1 border border-gray-200 rounded text-sm bg-white"
      >
        {options.map(opt => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Data table component
 */
function DataTable({ data, maxRows = 10 }: { data: Record<string, unknown>[]; maxRows?: number }) {
  const [showAll, setShowAll] = useState(false);

  if (!data || data.length === 0) {
    return <p className="text-gray-500 text-sm">No data available</p>;
  }

  const columns = Object.keys(data[0]);
  const displayData = showAll ? data : data.slice(0, maxRows);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50">
            {columns.map(col => (
              <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 border-b">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayData.map((row, idx) => (
            <tr key={idx} className="hover:bg-gray-50">
              {columns.map(col => (
                <td key={col} className="px-3 py-2 border-b text-gray-700">
                  {formatCellValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > maxRows && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
        >
          {showAll ? (
            <>
              <ChevronUp size={16} /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={16} /> Show all {data.length} rows
            </>
          )}
        </button>
      )}
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ===== Chart Components =====

function BarChartComponent({
  data,
  xField,
  yField,
  stacked,
  seriesKeys,
}: {
  data: Record<string, unknown>[];
  xField: string;
  yField: string;
  stacked?: boolean;
  seriesKeys?: string[];
}) {
  const dataKeys = seriesKeys && seriesKeys.length > 0 ? seriesKeys : [yField];
  const isMultiSeries = dataKeys.length > 1;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey={xField} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNumber} />
        <Tooltip formatter={(value) => formatNumber(value as number)} />
        {isMultiSeries && !hasLongLabels(dataKeys) && <Legend />}
        {dataKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={key}
            stackId={stacked ? 'stack' : undefined}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            radius={stacked ? undefined : [4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineChartComponent({
  data,
  xField,
  yField,
  seriesKeys,
}: {
  data: Record<string, unknown>[];
  xField: string;
  yField: string;
  seriesKeys?: string[];
}) {
  const dataKeys = seriesKeys && seriesKeys.length > 0 ? seriesKeys : [yField];
  const isMultiSeries = dataKeys.length > 1;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey={xField} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNumber} />
        <Tooltip formatter={(value) => formatNumber(value as number)} />
        {isMultiSeries && !hasLongLabels(dataKeys) && <Legend />}
        {dataKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ fill: CHART_COLORS[i % CHART_COLORS.length], r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function AreaChartComponent({
  data,
  xField,
  yField,
  stacked,
  seriesKeys,
}: {
  data: Record<string, unknown>[];
  xField: string;
  yField: string;
  stacked?: boolean;
  seriesKeys?: string[];
}) {
  const dataKeys = seriesKeys && seriesKeys.length > 0 ? seriesKeys : [yField];
  const isMultiSeries = dataKeys.length > 1;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey={xField} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNumber} />
        <Tooltip formatter={(value) => formatNumber(value as number)} />
        {isMultiSeries && !hasLongLabels(dataKeys) && <Legend />}
        {dataKeys.map((key, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stackId={stacked ? 'stack' : undefined}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={`${CHART_COLORS[i % CHART_COLORS.length]}40`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PieChartComponent({
  data,
  nameField,
  valueField,
}: {
  data: Record<string, unknown>[];
  nameField: string;
  valueField: string;
}) {
  // Aggregate data for pie chart
  const pieData = useMemo(() => {
    return aggregateData(data, nameField, valueField);
  }, [data, nameField, valueField]);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {pieData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatNumber(value as number)} />
        {!hasLongLabels(pieData.map(d => String(d.name ?? ''))) && <Legend />}
      </PieChart>
    </ResponsiveContainer>
  );
}

function ScatterChartComponent({
  data,
  xField,
  yField,
  groupBy,
}: {
  data: Record<string, unknown>[];
  xField: string;
  yField: string;
  groupBy?: string;
}) {
  // Group data by groupBy field if provided for multi-series scatter
  const scatterData = useMemo(() => {
    if (!groupBy) return [{ name: 'Data', data, color: CHART_COLORS[0] }];

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of data) {
      const key = String(row[groupBy] ?? 'Unknown');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    return Array.from(groups.entries()).map(([name, groupData], i) => ({
      name,
      data: groupData,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [data, groupBy]);

  const isMultiSeries = scatterData.length > 1;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey={xField} tick={{ fontSize: 12 }} name={xField} />
        <YAxis dataKey={yField} tick={{ fontSize: 12 }} name={yField} tickFormatter={formatNumber} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
        {isMultiSeries && !hasLongLabels(scatterData.map(s => s.name)) && <Legend />}
        {scatterData.map(({ name, data: seriesData, color }) => (
          <Scatter key={name} name={name} data={seriesData} fill={color} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function RadarChartComponent({
  data,
  nameField,
  valueField,
  seriesKeys,
}: {
  data: Record<string, unknown>[];
  nameField: string;
  valueField: string;
  seriesKeys?: string[];
}) {
  // If seriesKeys provided, use pivoted data with multiple radar polygons
  // Otherwise, aggregate data by nameField (existing behavior)
  const { chartData, dataKeys } = useMemo(() => {
    if (seriesKeys && seriesKeys.length > 0) {
      // Data is already pivoted - each row has multiple series values
      return { chartData: data, dataKeys: seriesKeys };
    }

    // Existing aggregation behavior for single series
    const aggregated = aggregateData(data, nameField, valueField);
    return { chartData: aggregated, dataKeys: ['value'] };
  }, [data, nameField, valueField, seriesKeys]);

  const isMultiSeries = dataKeys.length > 1;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
        <PolarGrid />
        <PolarAngleAxis dataKey={seriesKeys ? nameField : 'name'} tick={{ fontSize: 11 }} />
        <PolarRadiusAxis tick={{ fontSize: 10 }} tickFormatter={formatNumber} />
        {dataKeys.map((key, i) => (
          <Radar
            key={key}
            name={key}
            dataKey={key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            fillOpacity={0.3}
          />
        ))}
        {isMultiSeries && !hasLongLabels(dataKeys) && <Legend />}
        <Tooltip formatter={(value) => formatNumber(value as number)} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ===== Main Component =====

export default function DataVisualization({
  chartType: initialChartType,
  data,
  xField: initialXField,
  yField: initialYField,
  yFields: initialYFields,
  groupBy,
  sourceName,
  cached,
  fields,
  title,
  notes,
  seriesMode,
}: DataVisualizationProps) {
  const [chartType, setChartType] = useState<ChartType>(initialChartType);
  const [showRawData, setShowRawData] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [disclaimerConfig, setDisclaimerConfig] = useState<{
    enabled: boolean;
    fullText: string;
    fontSize: number;
    color: string;
  } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Delay chart rendering until after hydration to avoid SSR mismatch
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch disclaimer config for export watermarking
  useEffect(() => {
    fetch('/api/config/disclaimer')
      .then((res) => res.json())
      .then((data) => {
        if (data.enabled && data.config) {
          setDisclaimerConfig({
            enabled: true,
            fullText: data.config.fullText,
            fontSize: data.config.fontSize,
            color: data.config.color,
          });
        }
      })
      .catch(() => {
        // Silently fail - disclaimer is optional
      });
  }, []);

  // Derive available fields from data
  const numericFields = useMemo(() => getNumericFields(data), [data]);
  const stringFields = useMemo(() => getStringFields(data), [data]);
  const allFields = useMemo(() => fields || [...stringFields, ...numericFields], [fields, stringFields, numericFields]);

  // Detect if data is categorical (no useful numeric fields - needs count aggregation)
  const isCategorical = useMemo(() => isCategoricalData(data), [data]);

  // Field selections with defaults
  const [xField, setXField] = useState(initialXField || stringFields[0] || allFields[0] || 'name');
  const [yField, setYField] = useState(() => {
    if (isCategoricalData(data)) return 'count'; // For categorical data, Y is always count
    return initialYField || numericFields[0] || allFields[1] || 'value';
  });

  // Check if we have multiple Y fields from chart_gen (multi-series without pivoting)
  const hasMultipleYFields = initialYFields && initialYFields.length > 1;

  // Pivot data for multi-series charts when groupBy is provided
  const { pivotedData, seriesKeys } = useMemo(() => {
    // If yFields are provided directly (from chart_gen), use them as series keys
    // Data is already in the right format: each row has x_field + multiple y_field values
    if (hasMultipleYFields && chartType !== 'table') {
      return { pivotedData: data, seriesKeys: initialYFields };
    }

    // Legacy groupBy-based pivoting for data_source tool
    if (!groupBy || !xField || !yField || chartType === 'table') {
      return { pivotedData: undefined, seriesKeys: undefined };
    }

    // Check if groupBy field exists in data
    if (data.length > 0 && !(groupBy in data[0])) {
      return { pivotedData: undefined, seriesKeys: undefined };
    }

    return pivotDataForMultiSeries(data, xField, groupBy, yField);
  }, [data, xField, yField, groupBy, chartType, hasMultipleYFields, initialYFields]);

  // Prepare chart data - auto-aggregate categorical data or use pivoted data
  const chartData = useMemo(() => {
    // Use pivoted data for multi-series if available
    if (pivotedData && seriesKeys && seriesKeys.length > 0) {
      return pivotedData;
    }
    // For categorical data, count occurrences by the selected X field
    if (isCategorical && chartType !== 'table') {
      return countByCategory(data, xField);
    }
    return data;
  }, [data, xField, isCategorical, chartType, pivotedData, seriesKeys]);

  // The Y field for categorical data is always 'count'
  const effectiveYField = isCategorical ? 'count' : yField;

  // Determine if stacked mode should be used based on seriesMode prop
  const useStackedMode = seriesMode === 'stacked' || (seriesMode === 'auto' && hasMultipleYFields);

  // Available chart types
  const availableTypes: ChartType[] = ['bar', 'line', 'area', 'pie', 'scatter', 'radar', 'table'];

  if (!data || data.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 mt-3">
        <p className="text-gray-500">No data available for visualization</p>
      </div>
    );
  }

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row =>
        headers.map(h => {
          const value = row[h];
          // Escape values with commas or quotes
          const strValue = String(value ?? '');
          if (strValue.includes(',') || strValue.includes('"')) {
            return `"${strValue.replace(/"/g, '""')}"`;
          }
          return strValue;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Use a clean filename based on category field
    const cleanName = formatFieldName(xField).replace(/\s+/g, '-').toLowerCase();
    link.download = `${cleanName}-data.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportImage = async () => {
    if (!chartRef.current || chartType === 'table') return;

    setIsExporting(true);
    try {
      // Dynamic import html2canvas to avoid SSR issues
      const html2canvas = (await import('html2canvas')).default;

      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher resolution
        logging: false,
      });

      // Add AI disclaimer if enabled
      if (disclaimerConfig?.enabled) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const fontSize = disclaimerConfig.fontSize * 2; // Scale for higher resolution
          ctx.font = `italic ${fontSize}px Arial, sans-serif`;
          ctx.fillStyle = disclaimerConfig.color;
          ctx.textAlign = 'center';
          ctx.fillText(
            disclaimerConfig.fullText,
            canvas.width / 2,
            canvas.height - fontSize
          );
        }
      }

      // Convert to PNG and download
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      // Use a clean filename based on category field
      const cleanName = formatFieldName(xField).replace(/\s+/g, '-').toLowerCase();
      link.download = `${cleanName}-${chartType}-chart.png`;
      link.click();
    } catch (error) {
      console.error('Error exporting chart:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 mt-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {CHART_ICONS[chartType]}
          <h4 className="font-medium text-blue-900">
            {title || generateChartTitle(xField, isCategorical, sourceName)}
          </h4>
          {cached && (
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded">
              Cached
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {chartType !== 'table' && (
            <button
              onClick={handleExportImage}
              disabled={isExporting}
              className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100 rounded disabled:opacity-50"
              title="Export as PNG"
            >
              <ImageIcon size={14} />
              <span className="hidden sm:inline">{isExporting ? 'Exporting...' : 'PNG'}</span>
            </button>
          )}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100 rounded"
            title="Export as CSV"
          >
            <Download size={14} />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>

      {/* Categorical data indicator */}
      {isCategorical && chartType !== 'table' && (
        <div className="mb-2 text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded inline-block">
          📊 Showing count of records by category
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-4 pb-3 border-b border-blue-200">
        <ChartTypeSelector
          currentType={chartType}
          onTypeChange={setChartType}
          availableTypes={availableTypes}
        />

        {chartType !== 'table' && (
          <>
            <FieldSelector
              label="Category"
              value={xField}
              options={isCategorical ? stringFields : allFields}
              onChange={setXField}
            />
            {!isCategorical && (
              <FieldSelector
                label="Value"
                value={yField}
                options={allFields}
                onChange={setYField}
              />
            )}
          </>
        )}
      </div>

      {/* Chart */}
      <div ref={chartRef} className="bg-white rounded-lg p-4 min-h-[300px]">
        {!isMounted && chartType !== 'table' ? (
          <div className="flex items-center justify-center h-[300px]">
            <div className="text-gray-500 text-sm">Loading chart...</div>
          </div>
        ) : (
          <ChartErrorBoundary fallback={<DataTable data={data} />}>
            {chartType === 'bar' && (
              <BarChartComponent
                data={chartData}
                xField={isCategorical ? 'name' : xField}
                yField={effectiveYField}
                stacked={useStackedMode}
                seriesKeys={seriesKeys}
              />
            )}
            {chartType === 'line' && (
              <LineChartComponent
                data={chartData}
                xField={isCategorical ? 'name' : xField}
                yField={effectiveYField}
                seriesKeys={seriesKeys}
              />
            )}
            {chartType === 'area' && (
              <AreaChartComponent
                data={chartData}
                xField={isCategorical ? 'name' : xField}
                yField={effectiveYField}
                stacked={useStackedMode}
                seriesKeys={seriesKeys}
              />
            )}
            {chartType === 'pie' && (
              <PieChartComponent data={chartData} nameField={isCategorical ? 'name' : xField} valueField={effectiveYField} />
            )}
            {chartType === 'scatter' && (
              <ScatterChartComponent
                data={chartData}
                xField={isCategorical ? 'name' : xField}
                yField={effectiveYField}
                groupBy={groupBy}
              />
            )}
            {chartType === 'radar' && (
              <RadarChartComponent
                data={chartData}
                nameField={isCategorical ? 'name' : xField}
                valueField={effectiveYField}
                seriesKeys={seriesKeys}
              />
            )}
            {chartType === 'table' && <DataTable data={data} />}
          </ChartErrorBoundary>
        )}
      </div>

      {/* Raw Data Toggle */}
      {chartType !== 'table' && (
        <div className="mt-3">
          <button
            onClick={() => setShowRawData(!showRawData)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            {showRawData ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showRawData ? 'Hide raw data' : `Show raw data (${data.length} records)`}
          </button>
          {showRawData && (
            <div className="mt-2 bg-white rounded-lg p-3 max-h-64 overflow-auto">
              <DataTable data={data} maxRows={50} />
            </div>
          )}
        </div>
      )}

      {/* Notes Section (collapsible accordion) */}
      {notes && (
        <div className="mt-3 border border-blue-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-sm text-blue-700 transition-colors"
          >
            <span className="font-medium">Data Notes</span>
            {showNotes ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showNotes && (
            <div className="px-3 py-2 bg-white text-sm text-gray-600">
              {notes}
            </div>
          )}
        </div>
      )}

      {/* Footer with record count */}
      <div className="mt-3 text-xs text-blue-600">
        {data.length} record{data.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ===== Utility Export for Parsing Tool Output =====

/**
 * Parse data source tool output and extract visualization props
 */
export function parseDataSourceOutput(output: string): {
  data: Record<string, unknown>[];
  visualizationHint?: VisualizationHint;
  metadata?: {
    source: string;
    cached: boolean;
    fields: string[];
  };
} | null {
  try {
    const parsed = JSON.parse(output);

    if (!parsed.success || !parsed.data) {
      return null;
    }

    return {
      data: parsed.data as Record<string, unknown>[],
      visualizationHint: parsed.visualizationHint as VisualizationHint | undefined,
      metadata: parsed.metadata
        ? {
            source: parsed.metadata.source as string,
            cached: parsed.metadata.cached as boolean,
            fields: parsed.metadata.fields as string[],
          }
        : undefined,
    };
  } catch {
    return null;
  }
}
