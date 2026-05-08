/**
 * Dashboard-specific panel renderers (KPI, Filters, Data, Dashboard Chart/Diagram).
 */
import type { ChartSegment, DataSegment, DiagramSegment, FiltersSegment, KpiSegment } from '../types';
import type { RenderedChart, RenderedDiagram } from '../server-renderer';
import { escapeHtml } from '../markdown/escape';
import { buildChartJsConfig } from '../charts/chartjs-config';
import type { RenderContext } from './segment-renderers';

/**
 * Render a KPI tile with optional sparkline and hover tooltip.
 */
export function renderKpiTile(seg: KpiSegment, kpiCounter: { value: number }): string {
  kpiCounter.value++;
  const id = `kpi-spark-${kpiCounter.value}`;
  const cfg = seg.config;
  const trend = cfg.trend_direction || 'neutral';
  const tagsAttr = cfg.tags && cfg.tags.length ? ` data-tags="${escapeHtml(cfg.tags.join(' '))}"` : '';

  let sparkHtml = '';
  if (Array.isArray(cfg.trend) && cfg.trend.length >= 2) {
    const sparkConfig = JSON.stringify({
      type: 'line',
      data: {
        labels: cfg.trend.map((_, i) => String(i)),
        datasets: [{
          data: cfg.trend,
          borderColor: trend === 'positive' ? '#10b981' : trend === 'negative' ? '#ef4444' : '#6b7280',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          backgroundColor: trend === 'positive' ? 'rgba(16,185,129,0.1)' : trend === 'negative' ? 'rgba(239,68,68,0.1)' : 'rgba(107,114,128,0.1)',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
        elements: { point: { radius: 0 } },
      },
    });
    const encoded = Buffer.from(sparkConfig, 'utf-8').toString('base64');
    sparkHtml = `<div class="kpi-spark" data-chart-wrapper="true"><canvas id="${id}" data-chart-config="${encoded}"></canvas></div>`;
  }

  const deltaHtml = cfg.delta
    ? `<div class="kpi-delta kpi-delta-${trend}">${escapeHtml(cfg.delta)}</div>`
    : '';

  // Tooltip: shown on hover if tooltip text is provided
  const tooltipAttr = cfg.tooltip ? ` data-kpi-tooltip="${escapeHtml(cfg.tooltip)}"` : '';
  const tooltipIcon = cfg.tooltip ? `<span class="kpi-tooltip-icon" aria-hidden="true">ℹ</span>` : '';
  const tooltipHtml = cfg.tooltip
    ? `<div class="kpi-tooltip-bubble" role="tooltip">${escapeHtml(cfg.tooltip)}</div>`
    : '';

  return `
<div class="kpi-tile panel"${tagsAttr}${tooltipAttr}>
  ${tooltipIcon}
  <div class="kpi-label">${escapeHtml(cfg.label)}</div>
  <div class="kpi-value">${escapeHtml(cfg.value)}</div>
  ${deltaHtml}
  ${sparkHtml}
  ${tooltipHtml}
</div>`;
}

/**
 * Render filters sidebar from a FiltersSegment.
 */
export function renderFiltersSidebar(seg: FiltersSegment): string {
  const cfg = seg.config;
  const heading = cfg.title || 'Filters';
  const slicersHtml = cfg.slicers.map((slicer) => {
    const prefix = slicer.tag_prefix || slicer.id;
    if (slicer.type === 'search') {
      return `
<div class="filter-slicer">
  <label for="filter-${escapeHtml(slicer.id)}">${escapeHtml(slicer.label)}</label>
  <input type="search" id="filter-${escapeHtml(slicer.id)}" data-slicer-type="search" placeholder="Search..." oninput="dashSearch(this.value)">
</div>`;
    }
    if (slicer.type === 'daterange') {
      return `
<div class="filter-slicer">
  <label>${escapeHtml(slicer.label)}</label>
  <div class="filter-daterange">
    <input type="date" data-slicer-id="${escapeHtml(slicer.id)}" data-slicer-type="datestart" data-tag-prefix="${escapeHtml(prefix)}" onchange="dashApplyFilters()">
    <span>—</span>
    <input type="date" data-slicer-id="${escapeHtml(slicer.id)}" data-slicer-type="dateend" data-tag-prefix="${escapeHtml(prefix)}" onchange="dashApplyFilters()">
  </div>
</div>`;
    }
    const opts = (slicer.options || []).map((opt) => `
<label class="filter-opt">
  <input type="checkbox" data-tag="${escapeHtml(prefix + ':' + opt)}" onchange="dashApplyFilters()">
  <span>${escapeHtml(opt)}</span>
</label>`).join('');
    return `
<div class="filter-slicer">
  <label class="filter-slicer-label">${escapeHtml(slicer.label)}</label>
  <div class="filter-options">${opts}</div>
</div>`;
  }).join('');

  return `
<aside class="dash-filters" aria-label="Filters">
  <div class="dash-rail-header">
    <span class="dash-rail-title">${escapeHtml(heading)}</span>
    <button class="dash-rail-clear" onclick="dashClearFilters()" aria-label="Clear filters">Clear</button>
  </div>
  <div class="dash-rail-body">${slicersHtml}</div>
</aside>`;
}

/**
 * Render right-rail data panel from a DataSegment.
 */
export function renderDataPanel(seg: DataSegment): string {
  const cfg = seg.config;
  const heading = cfg.title || 'Details';
  const itemsHtml = (cfg.items || []).map((item) => `
<div class="data-item">
  <div class="data-item-label">${escapeHtml(item.label)}</div>
  <div class="data-item-value">${escapeHtml(item.value)}</div>
  ${item.note ? `<div class="data-item-note">${escapeHtml(item.note)}</div>` : ''}
</div>`).join('');

  let tableHtml = '';
  if (cfg.table && cfg.table.headers && cfg.table.rows) {
    const head = cfg.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const body = cfg.table.rows.map((row) =>
      `<tr>${row.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`
    ).join('');
    tableHtml = `
<div class="data-table-wrap">
  <table class="data-table">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>`;
  }

  return `
<aside class="dash-data" aria-label="${escapeHtml(heading)}">
  <div class="dash-rail-header">
    <span class="dash-rail-title">${escapeHtml(heading)}</span>
  </div>
  <div class="dash-rail-body">
    ${itemsHtml}
    ${tableHtml}
  </div>
</aside>`;
}

/**
 * Render a chart segment as a dashboard panel with size class, tag attributes,
 * and an optional hover insight overlay (from config.notes).
 */
export function renderDashboardChartPanel(
  seg: ChartSegment,
  ctx: RenderContext,
  rendered?: RenderedChart,
): string {
  const id = ctx.nextChartId();
  const size = seg.config.size || 'half';
  const tagsAttr = seg.config.tags && seg.config.tags.length
    ? ` data-tags="${escapeHtml(seg.config.tags.join(' '))}"`
    : '';

  // Insight overlay: shown on panel hover when notes are present
  const insightHtml = seg.config.notes
    ? `<div class="panel-insight-overlay" aria-label="Chart insight">
        <div class="panel-insight-content">
          <span class="panel-insight-icon">💡</span>
          <span class="panel-insight-text">${escapeHtml(seg.config.notes)}</span>
        </div>
      </div>`
    : '';

  const hasInsight = !!seg.config.notes;
  const insightClass = hasInsight ? ' panel-has-insight' : '';

  // Server-rendered: emit static <img> with data-URL
  if (rendered) {
    return `
<div class="panel panel-${size}${insightClass}"${tagsAttr}>
  ${seg.config.title ? `<div class="panel-title">${escapeHtml(seg.config.title)}</div>` : ''}
  <div class="panel-body chart-container" data-chart-wrapper="true">
    <img src="${rendered.pngDataUrl}" alt="${escapeHtml(rendered.title)}" style="width:100%;height:auto;display:block;" data-chart-image="true">
  </div>
  ${insightHtml}
</div>`;
  }

  // Fallback: client-side Chart.js rendering
  const chartConfig = buildChartJsConfig(seg.config, id);
  const encodedConfig = Buffer.from(chartConfig, 'utf-8').toString('base64');
  return `
<div class="panel panel-${size}${insightClass}"${tagsAttr}>
  ${seg.config.title ? `<div class="panel-title">${escapeHtml(seg.config.title)}</div>` : ''}
  <div class="panel-body chart-container" data-chart-wrapper="true">
    <canvas id="${id}" data-chart-config="${encodedConfig}"></canvas>
  </div>
  ${insightHtml}
</div>`;
}

/**
 * Render a diagram segment as a dashboard panel.
 */
export function renderDashboardDiagramPanel(
  seg: DiagramSegment,
  ctx: RenderContext,
  rendered?: RenderedDiagram,
  size: 'hero' | 'half' | 'third' | 'quarter' = 'half',
): string {
  ctx.nextDiagramId();

  // Server-rendered: emit inline SVG with source disclosure
  if (rendered) {
    return `
<div class="panel panel-${size}">
  <div class="panel-body">
    <div class="diagram-svg-container" style="overflow-x:auto;">
      ${rendered.svg}
    </div>
    <details class="diagram-source" style="margin-top:8px;">
      <summary style="cursor:pointer;font-size:0.8rem;color:#6b7280;">Diagram source</summary>
      <pre style="background:#f9fafb;padding:8px;border-radius:6px;font-size:11px;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(rendered.source)}</pre>
    </details>
  </div>
</div>`;
  }

  // Fallback: client-side mermaid rendering
  const encodedSource = Buffer.from(seg.code, 'utf-8').toString('base64');
  return `
<div class="panel panel-${size}">
  <div class="panel-body">
    <div class="mermaid" data-mermaid-source="${encodedSource}">
      <pre style="color:#6b7280;font-size:12px;">Loading diagram...</pre>
    </div>
  </div>
</div>`;
}
