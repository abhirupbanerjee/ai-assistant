/**
 * Build Chart.js configuration from chart block config.
 */
import type { ChartBlockConfig } from '../types';
import { CHART_COLORS } from '../constants';

export function buildChartJsConfig(config: ChartBlockConfig, chartId: string): string {
  const chartType = resolveChartType(config);
  const colors = CHART_COLORS;

  if (chartType === 'pie' || chartType === 'doughnut') {
    return buildPieChartConfig(config, chartType, colors);
  }

  return buildCartesianChartConfig(config, chartType, colors, chartId);
}

function resolveChartType(config: ChartBlockConfig): string {
  const rec = config.recommended_chart;
  if (!rec || rec === 'auto') return autoSelectChartType(config);
  if (rec === 'area') return 'line'; // Chart.js uses 'line' with fill for area
  return rec;
}

function autoSelectChartType(config: ChartBlockConfig): string {
  if (!config.data || config.data.length === 0) return 'bar';
  const xVal = config.data[0][config.x_field];
  const isDate = /date|time|year|month|day|week/i.test(config.x_field) ||
    (typeof xVal === 'string' && !isNaN(Date.parse(xVal as string)));
  if (isDate) return 'line';
  const unique = new Set(config.data.map(d => d[config.x_field])).size;
  if (unique >= 2 && unique <= 8 && config.data.length <= 20 && config.y_fields.length === 1) return 'pie';
  return 'bar';
}

function buildPieChartConfig(config: ChartBlockConfig, chartType: string, colors: string[]): string {
  const labels = config.data.map(d => String(d[config.x_field] ?? ''));
  const values = config.data.map(d => Number(d[config.y_fields[0]] ?? 0));
  return JSON.stringify({
    type: chartType,
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, values.length),
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        title: { display: !!config.title, text: config.title || '' },
      },
    },
  });
}

function buildCartesianChartConfig(
  config: ChartBlockConfig,
  chartType: string,
  colors: string[],
  _chartId: string
): string {
  const labels = config.data.map(d => String(d[config.x_field] ?? ''));
  const isArea = config.recommended_chart === 'area';
  const isStacked = config.series_mode === 'stacked' ||
    (config.series_mode === 'auto' && config.y_fields.length > 1);

  const datasets = config.y_fields.map((field, i) => {
    const color = colors[i % colors.length];
    const base: Record<string, unknown> = {
      label: field,
      data: config.data.map(d => Number(d[field] ?? 0)),
      backgroundColor: chartType === 'bar' ? color : color + '40',
      borderColor: color,
      borderWidth: 2,
    };
    if (isArea) base.fill = true;
    if (chartType === 'line') base.tension = 0.3;
    return base;
  });

  return JSON.stringify({
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: config.y_fields.length > 1 },
        title: { display: !!config.title, text: config.title || '' },
      },
      scales: {
        x: { stacked: isStacked },
        y: { stacked: isStacked, beginAtZero: true },
      },
    },
  });
}
