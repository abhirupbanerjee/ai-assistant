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
    /* ── Chart Panel Insight Overlay ── */
    .panel-has-insight { position: relative; overflow: hidden; }
    .panel-insight-overlay {
      position: absolute;
      inset: 0;
      background: rgba(17, 24, 39, 0.82);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s ease;
      z-index: 10;
      border-radius: 10px;
      pointer-events: none;
    }
    .panel-has-insight:hover .panel-insight-overlay { opacity: 1; pointer-events: auto; }
    .panel-insight-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 20px 24px;
      max-width: 340px;
      text-align: center;
    }
    .panel-insight-icon { font-size: 1.6rem; line-height: 1; }
    .panel-insight-text {
      color: #f9fafb;
      font-size: 0.88rem;
      line-height: 1.55;
      font-weight: 500;
    }
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
  `;

  const dashboardJs = `
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
      document.querySelectorAll('.panel[data-tags], .kpi-tile[data-tags]').forEach(function(el) {
        var tagsAttr = el.getAttribute('data-tags') || '';
        var tags = tagsAttr.split(/\\s+/).filter(Boolean);
        var visible = true;
        for (var i = 0; i < groupKeys.length; i++) {
          var groupTags = groups[groupKeys[i]];
          var matches = groupTags.some(function(gt) { return tags.indexOf(gt) !== -1; });
          if (!matches) { visible = false; break; }
        }
        el.classList.toggle('panel-hidden', !visible);
      });
    }
    function dashClearFilters() {
      document.querySelectorAll('.dash-filters input[type="checkbox"]').forEach(function(cb) { cb.checked = false; });
      document.querySelectorAll('.dash-filters input[type="search"], .dash-filters input[type="date"]').forEach(function(inp) { inp.value = ''; });
      document.querySelectorAll('.panel-hidden, .kpi-tile.panel-hidden').forEach(function(el) { el.classList.remove('panel-hidden'); });
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
<body>
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
</body>
</html>`;
}
