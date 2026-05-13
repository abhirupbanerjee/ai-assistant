/**
 * Legacy dashboard template (single-grid fallback) + Power BI-style V2 dashboard.
 */
import type { BrandingConfig } from '../../branding';
import type { ContentSegment, MarkdownSegment } from '../types';
import type { ServerRenderResult } from '../server-renderer';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';
import { buildDocumentLayout } from '../layout/document-layout';
import { DOCUMENT_LAYOUT_FLAGS } from '../layout/document-layout-flags';
import { renderKpiTile, renderFiltersSidebar, renderDataPanel, renderDashboardChartPanel, renderDashboardDiagramPanel } from '../renderers/dashboard-renderers';
import { markdownToHtml } from '../markdown/markdown-to-html';
import { createRenderContext } from '../renderers/segment-renderers';

export function buildDashboardTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
  segments?: ContentSegment[],
  serverResult?: ServerRenderResult,
): string {
  if (!segments) {
    return buildDocumentLayout(title, contentHtml, [], branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.dashboard);
  }
  return buildDashboardTemplateV2(title, segments, branding, css, js, disclaimerHtml, date, serverResult);
}

export function buildDashboardTemplateV2(
  title: string,
  segments: ContentSegment[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
  serverResult?: ServerRenderResult,
): string {
  const primary = branding.primaryColor || '#003366';
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="dash-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const vendorScripts = buildVendorScripts();

  const kpiCounter = { value: 0 };
  const ctx = createRenderContext();

  // Route segments into zones
  const kpiSegments = segments.filter((s): s is import('../types').KpiSegment => s.type === 'kpi');
  const filterSegments = segments.filter((s): s is import('../types').FiltersSegment => s.type === 'filters');
  const dataSegments = segments.filter((s): s is import('../types').DataSegment => s.type === 'data');
  const canvasSegments: ContentSegment[] = [];
  const noteSegments: import('../types').MarkdownSegment[] = [];

  for (const seg of segments) {
    if (seg.type === 'chart') {
      if (seg.config.panel === 'kpi') {
        const firstY = seg.config.y_fields[0];
        const total = seg.config.data.reduce((acc, d) => acc + Number(d[firstY] ?? 0), 0);
        kpiSegments.push({
          type: 'kpi',
          config: {
            label: seg.config.title || firstY,
            value: total.toLocaleString(),
            trend: seg.config.data.map((d) => Number(d[firstY] ?? 0)),
          },
        });
      } else {
        canvasSegments.push(seg);
      }
    } else if (seg.type === 'mermaid') {
      canvasSegments.push(seg);
    } else if (seg.type === 'markdown') {
      const txt = (seg as MarkdownSegment).content.trim();
      if (txt) noteSegments.push(seg as MarkdownSegment);
    }
  }

  const canvasHtml = canvasSegments.map((seg, i) => {
    // Find the original segment index in the full segments array for server result lookup
    const segIndex = segments.indexOf(seg);
    if (seg.type === 'chart') {
      const rendered = serverResult?.charts.get(segIndex);
      return renderDashboardChartPanel(seg as import('../types').ChartSegment, ctx, rendered);
    }
    if (seg.type === 'mermaid') {
      const rendered = serverResult?.diagrams.get(segIndex);
      return renderDashboardDiagramPanel(seg as import('../types').DiagramSegment, ctx, rendered);
    }
    return '';
  }).join('\n');

  const kpiRowHtml = kpiSegments.length > 0
    ? `<div class="dash-kpis">${kpiSegments.map((s) => renderKpiTile(s, kpiCounter)).join('\n')}</div>`
    : '';

  const filtersHtml = filterSegments.length > 0
    ? filterSegments.map(renderFiltersSidebar).join('\n')
    : '';

  const dataHtml = dataSegments.length > 0
    ? dataSegments.map(renderDataPanel).join('\n')
    : '';

  const notesHtml = noteSegments.length > 0
    ? `<div class="panel panel-notes panel-hero"><div class="panel-title">Notes</div><div class="panel-body dash-notes">${noteSegments.map((s) => markdownToHtml(s.content)).join('\n')}</div></div>`
    : '';

  const hasFilters = filtersHtml !== '';
  const hasData = dataHtml !== '';
  let gridCols: string;
  if (hasFilters && hasData) gridCols = '240px 1fr 280px';
  else if (hasFilters) gridCols = '240px 1fr';
  else if (hasData) gridCols = '1fr 280px';
  else gridCols = '1fr';

  const canvasColStart = hasFilters ? '2' : '1';
  const canvasColEnd = hasData ? (hasFilters ? '3' : '2') : '-1';
  const dataColStart = hasFilters ? '3' : '2';

  const dashboardCss = `
    body { background: #f3f4f6; }
    .dash-titlebar {
      background: ${primary};
      color: #fff;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .dash-titlebar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .dash-logo { height: 32px; width: auto; object-fit: contain; }
    .dash-titlebar-org { font-size: 0.85rem; font-weight: 600; opacity: 0.9; }
    .dash-titlebar-divider { width: 1px; height: 22px; background: rgba(255,255,255,0.25); }
    .dash-titlebar-title { font-size: 1.05rem; font-weight: 700; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dash-titlebar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .dash-titlebar-search { padding: 6px 14px; border-radius: 18px; border: none; width: 240px; font-size: 0.85rem; outline: none; background: rgba(255,255,255,0.15); color: #fff; }
    .dash-titlebar-search::placeholder { color: rgba(255,255,255,0.7); }
    .dash-titlebar-search:focus { background: rgba(255,255,255,0.25); }
    .dash-titlebar-action { background: rgba(255,255,255,0.15); border: none; color: #fff; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1rem; display: inline-flex; align-items: center; justify-content: center; transition: background 0.2s; }
    .dash-titlebar-action:hover { background: rgba(255,255,255,0.25); }
    .dash-shell { display: grid; grid-template-columns: ${gridCols}; gap: 16px; padding: 16px; max-width: 1800px; margin: 0 auto; align-items: start; }
    .dash-kpis { grid-column: ${canvasColStart} / ${canvasColEnd}; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .kpi-tile { padding: 14px 16px; display: flex; flex-direction: column; min-height: 110px; position: relative; overflow: hidden; }
    .kpi-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 6px; }
    .kpi-value { font-size: 1.6rem; font-weight: 700; color: #1f2937; line-height: 1.1; }
    .kpi-delta { font-size: 0.78rem; font-weight: 600; margin-top: 4px; }
    .kpi-delta-positive { color: #047857; }
    .kpi-delta-negative { color: #b91c1c; }
    .kpi-delta-neutral { color: #6b7280; }
    .kpi-spark { margin-top: 8px; height: 32px; position: relative; }
    .kpi-spark canvas { width: 100% !important; height: 100% !important; }
    .dash-canvas { grid-column: ${canvasColStart} / ${canvasColEnd}; display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: minmax(180px, auto); gap: 16px; }
    .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); padding: 14px 16px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .panel.panel-hidden { display: none !important; }
    .panel-title { font-size: 0.85rem; font-weight: 600; color: #374151; margin-bottom: 10px; flex-shrink: 0; }
    .panel-body { flex: 1; min-height: 0; position: relative; }
    .panel .chart-container { height: 100%; min-height: 220px; }
    .panel .mermaid { display: flex; justify-content: center; align-items: center; min-height: 220px; }
    .panel-hero    { grid-column: span 12; grid-row: span 2; min-height: 380px; }
    .panel-half    { grid-column: span 6;  grid-row: span 2; min-height: 320px; }
    .panel-third   { grid-column: span 4;  grid-row: span 2; min-height: 320px; }
    .panel-quarter { grid-column: span 3;  grid-row: span 2; min-height: 280px; }
    .panel-notes   { grid-column: span 12; }
    .dash-notes p { margin: 0 0 8px; }
    .dash-notes ul, .dash-notes ol { margin: 0 0 8px 18px; }
    .dash-filters { grid-column: 1 / 2; grid-row: 1 / span 2; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0; position: sticky; top: 72px; max-height: calc(100vh - 88px); overflow-y: auto; }
    .dash-data { grid-column: ${dataColStart} / -1; grid-row: 1 / span 2; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0; position: sticky; top: 72px; max-height: calc(100vh - 88px); overflow-y: auto; }
    .dash-rail-header { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e5e7eb; background: #f9fafb; border-radius: 10px 10px 0 0; position: sticky; top: 0; z-index: 1; }
    .dash-rail-title { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #374151; }
    .dash-rail-clear { background: none; border: none; color: ${primary}; cursor: pointer; font-size: 0.75rem; font-weight: 600; }
    .dash-rail-clear:hover { text-decoration: underline; }
    .dash-rail-body { padding: 12px 14px; }
    .filter-slicer { margin-bottom: 18px; }
    .filter-slicer-label, .filter-slicer label { display: block; font-size: 0.75rem; font-weight: 600; color: #4b5563; margin-bottom: 6px; }
    .filter-slicer input[type="search"], .filter-slicer input[type="date"] { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.85rem; outline: none; }
    .filter-slicer input:focus { border-color: ${primary}; }
    .filter-daterange { display: flex; align-items: center; gap: 6px; }
    .filter-daterange span { color: #9ca3af; font-size: 0.85rem; }
    .filter-options { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
    .filter-opt { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #1f2937; cursor: pointer; padding: 2px 0; }
    .filter-opt input[type="checkbox"] { margin: 0; cursor: pointer; }
    .filter-opt:hover { color: ${primary}; }
    .data-item { padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .data-item:last-child { border-bottom: none; }
    .data-item-label { font-size: 0.72rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
    .data-item-value { font-size: 0.95rem; font-weight: 600; color: #1f2937; }
    .data-item-note { font-size: 0.78rem; color: #9ca3af; margin-top: 2px; }
    .data-table-wrap { margin-top: 14px; overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .data-table th { background: #f9fafb; color: #4b5563; padding: 6px 8px; text-align: left; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    .data-table td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; color: #1f2937; }
    .data-table tr:hover td { background: #f9fafb; }
    .dash-footer { text-align: center; padding: 14px 16px; color: #9ca3af; font-size: 0.75rem; }
    .dash-shell .disclaimer { grid-column: 1 / -1; margin: 0; }
    /* ── KPI Tooltip ── */
    .kpi-tile { cursor: default; }
    .kpi-tile[data-kpi-tooltip] { cursor: help; }
    .kpi-tooltip-icon {
      position: absolute;
      top: 8px;
      right: 10px;
      font-size: 0.75rem;
      color: #9ca3af;
      line-height: 1;
      font-style: normal;
      pointer-events: none;
    }
    .kpi-tooltip-bubble {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: #f9fafb;
      font-size: 0.78rem;
      line-height: 1.45;
      padding: 8px 12px;
      border-radius: 8px;
      white-space: normal;
      max-width: 240px;
      min-width: 140px;
      text-align: left;
      z-index: 200;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      pointer-events: none;
    }
    .kpi-tooltip-bubble::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: #1f2937;
    }
    .kpi-tile:hover .kpi-tooltip-bubble,
    .kpi-tile:focus-within .kpi-tooltip-bubble { display: block; }
    @media (max-width: 1100px) {
      .dash-shell { grid-template-columns: 1fr; }
      .dash-kpis, .dash-canvas, .dash-filters, .dash-data { grid-column: 1 / -1; }
      .dash-filters, .dash-data { grid-row: auto; position: static; max-height: none; }
      .panel-hero, .panel-half, .panel-third, .panel-quarter { grid-column: span 12; }
    }
    @media (max-width: 700px) {
      .dash-canvas { grid-template-columns: 1fr; }
      .panel-hero, .panel-half, .panel-third, .panel-quarter { grid-column: span 1; }
      .dash-titlebar-search { width: 140px; }
      .dash-titlebar-org { display: none; }
    }
    /* ── AI badge in title bar ── */
    .dash-ai-badge { display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: #fff; font-size: 0.72rem; font-weight: 600; padding: 4px 10px; border-radius: 99px; letter-spacing: 0.03em; white-space: nowrap; flex-shrink: 0; }
    /* ── Data button on chart panels ── */
    .panel-title { display: flex; align-items: center; justify-content: space-between; }
    .panel-title > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-data-btn { flex-shrink: 0; background: none; border: 1px solid #e5e7eb; color: #9ca3af; font-size: 0.78rem; width: 20px; height: 20px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; line-height: 1; padding: 0; }
    .panel-data-btn:hover { background: #f3f4f6; color: #374151; border-color: #9ca3af; }
    /* ── Data modal ── */
    .dash-data-modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
    .dash-data-modal-backdrop.open { display: flex; }
    .dash-data-modal { background: #fff; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.25); width: min(92vw, 860px); max-height: 82vh; display: flex; flex-direction: column; overflow: hidden; }
    .dash-data-modal-header { padding: 14px 20px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 12px; }
    .dash-data-modal-title { font-size: 0.95rem; font-weight: 700; color: #111827; flex: 1; min-width: 0; }
    .dash-data-modal-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
    .dash-data-csv-btn { background: #2563eb; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; }
    .dash-data-csv-btn:hover { background: #1d4ed8; }
    .dash-data-close-btn { background: none; border: 1px solid #e5e7eb; color: #6b7280; width: 30px; height: 30px; border-radius: 6px; cursor: pointer; font-size: 1rem; display: inline-flex; align-items: center; justify-content: center; }
    .dash-data-close-btn:hover { background: #f3f4f6; }
    .dash-data-modal-body { overflow: auto; flex: 1; }
    .dash-data-table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    .dash-data-table th { background: #f9fafb; color: #374151; font-weight: 600; padding: 8px 14px; text-align: left; border-bottom: 2px solid #e5e7eb; position: sticky; top: 0; z-index: 1; white-space: nowrap; }
    .dash-data-table td { padding: 7px 14px; border-bottom: 1px solid #f3f4f6; color: #1f2937; }
    .dash-data-table tr:last-child td { border-bottom: none; }
    .dash-data-table tr:hover td { background: #f9fafb; }
    .dash-data-row-count { padding: 8px 20px; font-size: 0.75rem; color: #9ca3af; border-top: 1px solid #f3f4f6; text-align: right; flex-shrink: 0; }
    /* ── Active filter pills (inside sidebar) ── */
    .dash-active-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 14px; border-bottom: 1px solid #f3f4f6; }
    .dash-active-filters:empty { display: none; }
    .filter-pill { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; font-size: 0.78rem; font-weight: 600; padding: 4px 10px; border-radius: 99px; display: inline-flex; align-items: center; gap: 6px; }
    .filter-pill-x { cursor: pointer; color: #2563eb; line-height: 1; font-size: 0.9rem; }
    .filter-pill-x:hover { color: #dc2626; }
    /* ── Filter count badge in rail header ── */
    .dash-filter-count { display: none; background: #2563eb; color: #fff; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 99px; margin-left: 6px; vertical-align: middle; }
    .dash-filter-count.visible { display: inline-block; }
    /* ── Cross-filter & panel transitions ── */
    .panel { transition: opacity 0.2s ease; }
    .panel-filter-active { position: relative; }
    .panel-filter-active::after { content: 'Filtered'; position: absolute; top: 8px; right: 8px; background: #3b82f6; color: #fff; font-size: 0.65rem; font-weight: 700; padding: 2px 8px; border-radius: 99px; pointer-events: none; z-index: 5; }
  `;

  const dashboardJs = `
    /* ── Utilities ───────────────────────────────────────────────────────── */
    function escHtml(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function addAlpha(color, alpha) {
      if (!color) return 'rgba(0,0,0,' + alpha + ')';
      var c = String(color);
      if (c.startsWith('rgba')) return c.replace(/[\\d.]+\\)$/, alpha + ')');
      if (c.startsWith('#') && c.length >= 7) {
        var r=parseInt(c.slice(1,3),16), g=parseInt(c.slice(3,5),16), b=parseInt(c.slice(5,7),16);
        return 'rgba('+r+','+g+','+b+','+alpha+')';
      }
      return c;
    }

    /* ── Cross-chart selection state ─────────────────────────────────────── */
    var __crossFilter = null;

    function dashHighlightSourceChart(chart, selDataIndex, selDsIndex) {
      var isPie = chart.config.type==='pie' || chart.config.type==='doughnut';
      chart.data.datasets.forEach(function(ds, di) {
        if (!ds._fullBg) ds._fullBg = ds.backgroundColor;
        var colors = Array.isArray(ds._fullBg)
          ? ds._fullBg.slice()
          : chart.data.labels.map(function() { return ds._fullBg; });
        ds.backgroundColor = colors.map(function(c, i) {
          return (isPie ? i===selDataIndex : di===selDsIndex) ? c : addAlpha(c, 0.22);
        });
      });
      chart.update('active');
    }

    function dashHighlightOtherChart(chart, raw, selLabel) {
      chart.data.labels = raw.data.map(function(d) { return String(d[raw.x_field]||''); });
      var isBar = chart.config.type==='bar';
      raw.y_fields.forEach(function(field, di) {
        var ds = chart.data.datasets[di];
        if (!ds) return;
        if (!ds._fullBg) ds._fullBg = ds.backgroundColor;
        ds.data = raw.data.map(function(d) { return Number(d[field]||0); });
        if (isBar) {
          ds.backgroundColor = raw.data.map(function(d, i) {
            var matched = String(d[raw.x_field]||'').toLowerCase() === selLabel.toLowerCase();
            var base = Array.isArray(ds._fullBg) ? ds._fullBg[i % ds._fullBg.length] : ds._fullBg;
            return matched ? base : addAlpha(base, 0.18);
          });
        }
      });
      chart.update('active');
    }

    function dashRestoreChartData(chartId) {
      var raw = (window.__dashData||{})[chartId];
      var chart = (window.__dashCharts||{})[chartId];
      if (!raw || !chart) return;
      chart.data.labels = raw.data.map(function(d) { return String(d[raw.x_field]||''); });
      raw.y_fields.forEach(function(field, di) {
        var ds = chart.data.datasets[di];
        if (!ds) return;
        ds.data = raw.data.map(function(d) { return Number(d[field]||0); });
        if (ds._fullBg) { ds.backgroundColor = ds._fullBg; delete ds._fullBg; }
      });
      chart.update('active');
    }

    function dashUpdateCrossFilter() {
      __crossFilter = window.__dashSelection || null;
      Object.keys(window.__dashCharts||{}).forEach(function(chartId) {
        var chart = (window.__dashCharts||{})[chartId];
        var raw   = (window.__dashData||{})[chartId];
        var panel = document.querySelector('[data-chart-id="' + chartId + '"]');
        if (!__crossFilter) {
          dashRestoreChartData(chartId);
          if (panel) panel.classList.remove('panel-filter-active');
          return;
        }
        if (chartId === __crossFilter.sourceChartId) {
          dashHighlightSourceChart(chart, __crossFilter.dataIndex, __crossFilter.datasetIndex);
          if (panel) panel.classList.add('panel-filter-active');
        } else if (raw && raw.x_field === __crossFilter.field) {
          dashHighlightOtherChart(chart, raw, __crossFilter.label);
          if (panel) panel.classList.add('panel-filter-active');
        }
      });
      dashRenderFilterPills();
    }
    window.dashUpdateCrossFilter = dashUpdateCrossFilter;

    /* ── Filter pills strip ──────────────────────────────────────────────── */
    function dashRenderFilterPills() {
      var strip = document.getElementById('dash-active-filters');
      if (!strip) return;
      strip.innerHTML = '';
      var count = 0;
      document.querySelectorAll('.dash-filters input[type="checkbox"]:checked').forEach(function(cb) {
        var tag = cb.getAttribute('data-tag');
        if (!tag) return;
        var lbl = cb.parentElement ? cb.parentElement.textContent.trim() : tag;
        var pill = document.createElement('div');
        pill.className = 'filter-pill';
        pill.innerHTML = escHtml(lbl) + '<span class="filter-pill-x" data-tag="' + escHtml(tag) + '">&#x00D7;</span>';
        pill.querySelector('.filter-pill-x').addEventListener('click', function() {
          var t = this.getAttribute('data-tag');
          var cbox = document.querySelector('.dash-filters input[data-tag="' + t + '"]');
          if (cbox) { cbox.checked = false; dashApplyFilters(); }
        });
        strip.appendChild(pill);
        count++;
      });
      if (__crossFilter) {
        var pill = document.createElement('div');
        pill.className = 'filter-pill';
        pill.innerHTML = '&#x2736; ' + escHtml(__crossFilter.label) + '<span class="filter-pill-x">&#x00D7;</span>';
        pill.querySelector('.filter-pill-x').addEventListener('click', function() {
          window.__dashSelection = null;
          dashUpdateCrossFilter();
        });
        strip.appendChild(pill);
        count++;
      }
      var badge = document.getElementById('dash-filter-count');
      if (badge) {
        badge.textContent = String(count);
        badge.classList.toggle('visible', count > 0);
      }
    }

    /* ── Chart data filtering (slicer-driven row filter) ─────────────────── */
    function dashFilterChartData(chartId, tagValues) {
      var raw = (window.__dashData||{})[chartId];
      var chart = (window.__dashCharts||{})[chartId];
      if (!raw || !chart) return;
      var filtered = raw.data.filter(function(row) {
        var xv = String(row[raw.x_field]||'').toLowerCase();
        return tagValues.some(function(tv) { return xv === tv || xv.indexOf(tv) !== -1; });
      });
      if (filtered.length === 0) filtered = raw.data;
      chart.data.labels = filtered.map(function(d) { return String(d[raw.x_field]||''); });
      raw.y_fields.forEach(function(field, di) {
        if (chart.data.datasets[di]) {
          chart.data.datasets[di].data = filtered.map(function(d) { return Number(d[field]||0); });
        }
      });
      chart.update('active');
    }

    /* ── dashApplyFilters (panel visibility + data filtering) ────────────── */
    function dashApplyFilters() {
      var checkedTags = [];
      document.querySelectorAll('.dash-filters input[type="checkbox"]:checked').forEach(function(cb) {
        var t = cb.getAttribute('data-tag');
        if (t) checkedTags.push(t);
      });
      var groups = {};
      checkedTags.forEach(function(tag) {
        var idx = tag.indexOf(':');
        var prefix = idx > 0 ? tag.substring(0, idx) : tag;
        if (!groups[prefix]) groups[prefix] = [];
        groups[prefix].push(tag);
      });
      var groupKeys = Object.keys(groups);
      var tagValues = checkedTags.map(function(t) {
        var idx = t.indexOf(':');
        return idx > 0 ? t.substring(idx+1).toLowerCase() : t.toLowerCase();
      });
      document.querySelectorAll('.panel[data-tags]:not(.kpi-tile)').forEach(function(el) {
        var tags = (el.getAttribute('data-tags')||'').toLowerCase().split(/\\s+/).filter(Boolean);
        var visible = groupKeys.every(function(gk) {
          var chartGroupTags = tags.filter(function(t) { return t.indexOf(gk + ':') === 0; });
          if (chartGroupTags.length === 0) return true; // unrelated dimension — keep visible
          return groups[gk].some(function(gt) { return chartGroupTags.indexOf(gt) !== -1; });
        });
        if (!visible) {
          el.classList.add('panel-hidden');
          el.classList.remove('panel-filter-active');
          return;
        }
        el.classList.remove('panel-hidden');
        (function(cid) {
          if (!cid) return;
          setTimeout(function() { var c = (window.__dashCharts||{})[cid]; if (c) c.resize(); }, 0);
        }(el.getAttribute('data-chart-id')));
        var chartId = el.getAttribute('data-chart-id');
        if (chartId && el.getAttribute('data-filter-by-tags')==='true' &&
            (window.__dashCharts||{})[chartId] && checkedTags.length > 0) {
          dashFilterChartData(chartId, tagValues);
          el.classList.add('panel-filter-active');
        } else if (chartId && !__crossFilter) {
          dashRestoreChartData(chartId);
          el.classList.remove('panel-filter-active');
        }
      });
      dashRenderFilterPills();
    }

    function dashClearFilters() {
      document.querySelectorAll('.dash-filters input').forEach(function(inp) {
        if (inp.type==='checkbox') inp.checked=false; else inp.value='';
      });
      document.querySelectorAll('.panel-hidden').forEach(function(el) { el.classList.remove('panel-hidden'); });
      window.__dashSelection = null;
      __crossFilter = null;
      Object.keys(window.__dashCharts||{}).forEach(dashRestoreChartData);
      document.querySelectorAll('.panel-filter-active').forEach(function(el) { el.classList.remove('panel-filter-active'); });
      dashRenderFilterPills();
    }

    function dashSearch(query) {
      var lc = (query || '').toLowerCase().trim();
      document.querySelectorAll('.dash-canvas .panel').forEach(function(panel) {
        if (!lc) { panel.classList.remove('panel-hidden'); return; }
        var t = (panel.textContent || '').toLowerCase();
        var tags = (panel.getAttribute('data-tags') || '').toLowerCase();
        var titleEl = panel.querySelector('.panel-title');
        var titleMatch = titleEl && titleEl.textContent.toLowerCase().indexOf(lc) !== -1;
        var match = t.indexOf(lc) !== -1 || tags.indexOf(lc) !== -1 || titleMatch;
        panel.classList.toggle('panel-hidden', !match);
      });
    }

    document.addEventListener('DOMContentLoaded', dashRenderFilterPills);

    /* ── Data Table Modal ──────────────────────────────────────────────── */
    var __modalData = null;

    function dashShowData(chartId) {
      var canvas = document.getElementById(chartId);
      if (!canvas) return;
      var rawEncoded = canvas.getAttribute('data-raw-data');
      if (!rawEncoded) return;
      var raw;
      try { raw = JSON.parse(atob(rawEncoded)); } catch(e) { return; }
      var rows = raw.data || [];
      var columns = rows.length > 0 ? Object.keys(rows[0]) : (raw.y_fields || []);
      var panel = document.querySelector('[data-chart-id="' + chartId + '"]');
      var titleEl = panel ? panel.querySelector('.panel-title span') : null;
      var title = titleEl ? titleEl.textContent.trim() : 'Data';
      __modalData = { title: title, rows: rows, columns: columns };
      var thead = '<tr>' + columns.map(function(c) { return '<th>' + escHtml(String(c)) + '</th>'; }).join('') + '</tr>';
      var tbody = rows.map(function(row) {
        return '<tr>' + columns.map(function(c) {
          var v = row[c];
          return '<td>' + escHtml(v === null || v === undefined ? '—' : String(v)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      document.getElementById('dash-data-modal-title').textContent = title;
      document.getElementById('dash-data-modal-body').innerHTML =
        '<table class="dash-data-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
      document.getElementById('dash-data-row-count').textContent =
        rows.length + ' row' + (rows.length !== 1 ? 's' : '') + ' · ' + columns.length + ' column' + (columns.length !== 1 ? 's' : '');
      document.getElementById('dash-data-modal-backdrop').classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function dashHideData() {
      document.getElementById('dash-data-modal-backdrop').classList.remove('open');
      document.body.style.overflow = '';
      __modalData = null;
    }

    function dashDownloadCsv() {
      if (!__modalData) return;
      var cols = __modalData.columns;
      var lines = [cols.map(function(c) { return csvEscape(c); }).join(',')];
      __modalData.rows.forEach(function(row) {
        lines.push(cols.map(function(c) {
          var v = row[c];
          return csvEscape(v === null || v === undefined ? '' : String(v));
        }).join(','));
      });
      var csv = lines.join('\\r\\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (__modalData.title || 'data').replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 500);
    }

    function csvEscape(v) {
      var s = String(v);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') dashHideData(); });
  `;

  const titleBarHtml = `
<header class="dash-titlebar">
  <div class="dash-titlebar-left">
    ${logoHtml}
    ${orgName ? `<span class="dash-titlebar-org">${escapeHtml(orgName)}</span>` : ''}
    ${orgName ? '<span class="dash-titlebar-divider"></span>' : ''}
    <h1 class="dash-titlebar-title">${escapeHtml(title)}</h1>
  </div>
  <div class="dash-titlebar-right">
    <input type="search" class="dash-titlebar-search" placeholder="Search panels..." oninput="dashSearch(this.value)" aria-label="Search dashboard panels">
    <button class="dash-titlebar-action" onclick="window.print()" title="Print" aria-label="Print">⎙</button>
    <span class="dash-ai-badge">⚡ AI Generated</span>
  </div>
</header>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${vendorScripts}
  <style>${css}${dashboardCss}</style>
</head>
<body data-page-type="dashboard">
  ${titleBarHtml}
  <div class="dash-shell">
    ${disclaimerHtml}
    ${filtersHtml}
    ${kpiRowHtml}
    <div class="dash-canvas" id="dash-canvas">
      ${canvasHtml}
      ${notesHtml}
    </div>
    ${dataHtml}
  </div>
  <footer class="dash-footer">
    Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}
  </footer>
  <script>${js}${dashboardJs}</script>
  <div class="dash-data-modal-backdrop" id="dash-data-modal-backdrop" onclick="if(event.target===this)dashHideData()">
    <div class="dash-data-modal">
      <div class="dash-data-modal-header">
        <span class="dash-data-modal-title" id="dash-data-modal-title">Data</span>
        <div class="dash-data-modal-actions">
          <button class="dash-data-csv-btn" onclick="dashDownloadCsv()">&#x2B07; Download CSV</button>
          <button class="dash-data-close-btn" onclick="dashHideData()" title="Close">&#x00D7;</button>
        </div>
      </div>
      <div class="dash-data-modal-body" id="dash-data-modal-body"></div>
      <div class="dash-data-row-count" id="dash-data-row-count"></div>
    </div>
  </div>
</body>
</html>`;
}
