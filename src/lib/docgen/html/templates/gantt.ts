/**
 * Gantt chart template.
 *
 * Renders a fully interactive, self-contained HTML Gantt chart page.
 * All content (categories, tasks, colors, labels) is driven by the
 * GanttBlockConfig supplied by the LLM — nothing is hardcoded.
 *
 * Time axis normalization:
 *   - "W1"…"Wn"  → week index (1-based)
 *   - "M1"…"Mn"  → month index, converted to weeks (×4.33)
 *   - ISO date    → weeks from start_date (or from first task date)
 *
 * Bar/diamond rendering:
 *   Each task row uses a two-layer approach:
 *     1. Grid cells — provide the column lines and background (no position:relative)
 *     2. Overlay div — sits on top of the data area (position:absolute) and
 *        holds bars/diamonds positioned by percentage, avoiding z-index stacking
 *        issues that would hide bars behind later sibling cells.
 */
import type { BrandingConfig } from '../../branding';
import type { GanttBlockConfig, GanttTask, GanttCategory } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';
import { resolveCategoryColor } from '../branding/color-resolver';
import { parsePosition, computeTotalColumns, buildMonthSpans, buildColumnLabels, colToLabel } from '../time/time-axis';
import { normalizeGanttConfig } from '../parsing/gantt-normalizer';

// ── Main template builder ─────────────────────────────────────────────────────

export function buildGanttTemplate(
  pageTitle: string,
  cfg: GanttBlockConfig,
  branding: BrandingConfig,
  css: string,
  _js: string,
  disclaimerHtml: string,
  date: string,
  /** ISO date string for the "today" marker, e.g. "2026-05-08" */
  todayIso: string,
  /** If true, render the extended project-plan header (KPI strip + roll-up table) */
  projectPlanMode = false,
): string {
  // ── Normalize config (validate tasks, infer milestones, auto-select axis) ──
  const { config } = normalizeGanttConfig(cfg);

  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="gantt-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const vendorScripts = buildVendorScripts();

  // ── Resolve time axis ──
  const axis = config.axis || 'weeks';
  const startDate = config.start_date ? new Date(config.start_date) : null;
  const totalCols = computeTotalColumns(config.tasks, startDate, axis);
  const monthSpans = buildMonthSpans(startDate, totalCols, axis);

  // ── Resolve flag strip colors ──
  const brandingAny = branding as unknown as Record<string, string>;
  const flagColors: string[] = config.flag_colors && config.flag_colors.length === 3
    ? config.flag_colors
    : [
        branding.primaryColor || '',
        brandingAny['accentColor'] || '',
        brandingAny['secondaryColor'] || '',
      ].filter(Boolean);

  const flagStripHtml = flagColors.length >= 3
    ? `<div class="gantt-flag-strip">
        <span style="background:${flagColors[0]}"></span>
        <span style="background:${flagColors[1]}"></span>
        <span style="background:${flagColors[2]}"></span>
       </div>`
    : '';

  // ── Resolve categories (fully dynamic) ──
  const categories: GanttCategory[] = config.categories || [];
  const declaredIds = new Set(categories.map(c => c.id));
  const extraIds: string[] = [];
  for (const t of config.tasks) {
    if (t.category && !declaredIds.has(t.category) && !extraIds.includes(t.category)) {
      extraIds.push(t.category);
    }
  }
  const allCategories: GanttCategory[] = [
    ...categories,
    ...extraIds.map(id => ({ id, label: id })),
  ];

  // Build color map: catId → hex
  const colorMap: Record<string, string> = {};
  allCategories.forEach((cat, idx) => {
    colorMap[cat.id] = resolveCategoryColor(cat.id, allCategories, branding, idx);
  });

  // ── Today marker column ──
  let todayCol = -1;
  if (startDate) {
    const today = new Date(todayIso);
    if (!isNaN(today.getTime())) {
      todayCol = parsePosition(todayIso, startDate, axis);
    }
  }

  // ── Serialize data for inline JS ──
  const jsCategories = JSON.stringify(allCategories.map(c => ({
    id: c.id,
    label: c.label,
    color: colorMap[c.id],
  })));

  const jsTasks = JSON.stringify(config.tasks.map(t => ({
    group: t.group,
    name: t.name,
    sub: t.sub || '',
    category: t.category,
    startCol: parsePosition(t.start, startDate, axis),
    endCol: t.end ? parsePosition(t.end, startDate, axis) : parsePosition(t.start, startDate, axis) + 1,
    type: t.type || 'bar',
    hatched: t.hatched || false,
    detail: t.detail || '',
  })));

  const jsMonths = JSON.stringify(monthSpans);
  const jsTotalCols = totalCols;
  const jsTodayCol = todayCol;
  const jsAxis = JSON.stringify(axis);
  const jsColumnLabels = JSON.stringify(buildColumnLabels(startDate, totalCols, axis));

  // ── Project plan KPI strip ──
  let projectPlanHeaderHtml = '';
  if (projectPlanMode) {
    const totalTasks = config.tasks.filter(t => t.type !== 'diamond').length;
    const milestones = config.tasks.filter(t => t.type === 'diamond').length;
    const groups = [...new Set(config.tasks.map(t => t.group))].length;
    const dateRange = config.subtitle || (config.start_date && config.end_date
      ? `${config.start_date} → ${config.end_date}`
      : '');

    projectPlanHeaderHtml = `
    <div class="pp-kpi-strip">
      <div class="pp-kpi"><span class="pp-kpi-value">${totalTasks}</span><span class="pp-kpi-label">Tasks</span></div>
      <div class="pp-kpi"><span class="pp-kpi-value">${milestones}</span><span class="pp-kpi-label">Milestones</span></div>
      <div class="pp-kpi"><span class="pp-kpi-value">${groups}</span><span class="pp-kpi-label">Work Streams</span></div>
      <div class="pp-kpi"><span class="pp-kpi-value">${allCategories.length}</span><span class="pp-kpi-label">Categories</span></div>
      ${dateRange ? `<div class="pp-kpi pp-kpi-wide"><span class="pp-kpi-value pp-kpi-date">${escapeHtml(dateRange)}</span><span class="pp-kpi-label">Timeline</span></div>` : ''}
    </div>`;
  }

  const chartTitle = config.title || pageTitle;
  const chartSubtitle = config.subtitle || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(chartTitle)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${vendorScripts}
  <style>
${css}
/* ── Gantt / Project Plan Styles ─────────────────────────────────────── */
:root {
  --gantt-bg: #fafaf7;
  --gantt-card: #ffffff;
  --gantt-ink: #1a1a1a;
  --gantt-muted: #5a5a5a;
  --gantt-faint: #8a8a8a;
  --gantt-line: #e0e0e0;
  --gantt-row-hover: #f7f7f4;
  --gantt-group-label: ${branding.primaryColor || '#007A5E'};
  --gantt-today: #dc2626;
  --gantt-font: ${branding.fontFamily || '"Segoe UI", system-ui, sans-serif'};
  --gantt-label-w: 200px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: var(--gantt-bg);
  color: var(--gantt-ink);
  font-family: var(--gantt-font);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

.gantt-flag-strip { display: flex; height: 4px; width: 100%; }
.gantt-flag-strip span { flex: 1; }

.gantt-page-header {
  padding: 20px 28px 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-bottom: 1px solid var(--gantt-line);
  flex-wrap: wrap;
  gap: 12px;
}

.gantt-header-left { display: flex; align-items: center; gap: 12px; }
.gantt-logo { height: 36px; width: auto; }
.gantt-header-titles h1 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--gantt-ink);
}
.gantt-header-titles p {
  font-size: 12px;
  color: var(--gantt-muted);
  margin-top: 3px;
}

/* Legend */
.gantt-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.gantt-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--gantt-muted);
  cursor: pointer;
  padding: 3px 7px;
  border-radius: 4px;
  transition: background 0.15s;
  user-select: none;
}
.gantt-legend-item:hover { background: #f0f0ed; }
.gantt-legend-item.dimmed { opacity: 0.3; }
.gantt-legend-dot {
  width: 10px; height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

/* Controls */
.gantt-controls {
  display: flex;
  gap: 8px;
  padding: 14px 28px 0;
  flex-wrap: wrap;
}
.gantt-view-btn {
  font-family: var(--gantt-font);
  font-size: 12px;
  font-weight: 500;
  padding: 5px 13px;
  border: 1px solid var(--gantt-line);
  border-radius: 6px;
  background: var(--gantt-card);
  color: var(--gantt-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.gantt-view-btn:hover { border-color: var(--gantt-group-label); color: var(--gantt-group-label); }
.gantt-view-btn.active { background: var(--gantt-group-label); color: white; border-color: var(--gantt-group-label); }

/* Container */
.gantt-container {
  padding: 16px 28px 60px;
  overflow-x: auto;
}

.gantt-wrap {
  min-width: 700px;
  position: relative;
}

/* Grid layout: label col + N data cols */
.gantt-month-row,
.gantt-week-row,
.gantt-task-row {
  display: grid;
  align-items: stretch;
}

.gantt-month-row {
  border-bottom: 2px solid var(--gantt-line);
  position: sticky;
  top: 0;
  background: var(--gantt-bg);
  z-index: 10;
}

.gantt-label-area {
  padding: 7px 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--gantt-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
}

.gantt-month-cell {
  padding: 7px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--gantt-ink);
  letter-spacing: 0.02em;
  border-left: 1px solid var(--gantt-line);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gantt-week-row {
  border-bottom: 1px solid var(--gantt-line);
}
.gantt-week-label-area {
  font-size: 9px;
  color: var(--gantt-faint);
  padding: 3px 0;
  display: flex;
  align-items: center;
}
.gantt-week-cell {
  border-left: 1px solid #f0f0ed;
  padding: 2px 0;
  font-size: 8px;
  color: var(--gantt-faint);
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Group label */
.gantt-group-label {
  padding: 14px 0 5px;
  font-size: 10px;
  font-weight: 700;
  color: var(--gantt-group-label);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Task row — two-layer: grid cells (background) + overlay (bars/diamonds) */
.gantt-task-row {
  min-height: 36px;
  border-bottom: 1px solid #f5f5f2;
  transition: background 0.1s, opacity 0.3s;
  position: relative;   /* overlay anchor */
}
.gantt-task-row:hover { background: var(--gantt-row-hover); }
.gantt-task-row.dimmed { opacity: 0.12; }

.gantt-task-name {
  font-size: 12px;
  color: var(--gantt-ink);
  padding-right: 10px;
  line-height: 1.3;
  /* vertically center the text within the stretched cell */
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 36px;
}
.gantt-task-name .gantt-sub {
  font-size: 10px;
  color: var(--gantt-faint);
  display: block;
  margin-top: 1px;
}

/* Grid cells — background/border layer only; no position:relative so they
   don't create stacking contexts that would hide the overlay bars. */
.gantt-grid-cell {
  height: 100%;
  border-left: 1px solid #f5f5f2;
  min-height: 36px;
}

/* ── Overlay layer ──────────────────────────────────────────────────────
   Sits on top of all grid cells. Bars and diamonds are placed here using
   percentage-based left/width so they span correctly across columns
   without being clipped by sibling cell stacking contexts.
*/
.gantt-bar-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  /* starts after the label column */
  left: var(--gantt-label-w);
  right: 0;
  pointer-events: none;   /* let grid-cell hover/click pass through */
  z-index: 4;
}

/* Bars */
.gantt-bar {
  position: absolute;
  top: 7px;
  bottom: 7px;
  border-radius: 4px;
  cursor: pointer;
  pointer-events: auto;
  transition: filter 0.15s, transform 0.15s;
}
.gantt-bar:hover {
  filter: brightness(1.12);
  transform: scaleY(1.18);
}
.gantt-bar.hatched {
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 4px,
    rgba(255,255,255,0.22) 4px,
    rgba(255,255,255,0.22) 8px
  );
}

/* Milestone diamond */
.gantt-diamond {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  transform: translateY(-50%) rotate(45deg);
  border-radius: 2px;
  cursor: pointer;
  pointer-events: auto;
  z-index: 5;
  transition: transform 0.15s;
}
.gantt-diamond:hover {
  transform: translateY(-50%) rotate(45deg) scale(1.35);
}

/* Today line */
.gantt-today-line {
  position: absolute;
  top: 0; bottom: 0;
  width: 2px;
  background: var(--gantt-today);
  opacity: 0.55;
  z-index: 6;
  pointer-events: none;
}
.gantt-today-label {
  position: absolute;
  top: -16px;
  font-size: 8px;
  font-weight: 700;
  color: var(--gantt-today);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transform: translateX(-50%);
  white-space: nowrap;
}

/* Tooltip */
.gantt-tooltip {
  display: none;
  position: fixed;
  background: #0F1F2E;
  color: #fff;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  max-width: 280px;
  z-index: 1000;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.28);
}
.gantt-tooltip.visible { display: block; }
.gantt-tooltip .tt-title { font-weight: 600; font-size: 12px; margin-bottom: 3px; }
.gantt-tooltip .tt-dates { color: #9aafbf; font-size: 10px; margin-bottom: 5px; }
.gantt-tooltip .tt-body { color: #c8d6e0; }

/* Project Plan KPI strip */
.pp-kpi-strip {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--gantt-line);
  background: var(--gantt-card);
  flex-wrap: wrap;
}
.pp-kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 24px;
  border-right: 1px solid var(--gantt-line);
  min-width: 90px;
}
.pp-kpi-wide { min-width: 180px; }
.pp-kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--gantt-group-label);
  line-height: 1;
}
.pp-kpi-date { font-size: 13px; }
.pp-kpi-label {
  font-size: 10px;
  color: var(--gantt-faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
}

/* Project plan roll-up table */
.pp-rollup {
  margin: 28px 28px 0;
  border: 1px solid var(--gantt-line);
  border-radius: 8px;
  overflow: hidden;
}
.pp-rollup-title {
  padding: 10px 16px;
  font-size: 11px;
  font-weight: 700;
  color: var(--gantt-group-label);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: #f9f9f6;
  border-bottom: 1px solid var(--gantt-line);
}
.pp-rollup table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.pp-rollup th {
  padding: 8px 12px;
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  color: var(--gantt-faint);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: #f9f9f6;
  border-bottom: 1px solid var(--gantt-line);
}
.pp-rollup td {
  padding: 8px 12px;
  border-bottom: 1px solid #f5f5f2;
  color: var(--gantt-ink);
  vertical-align: middle;
}
.pp-rollup tr:last-child td { border-bottom: none; }
.pp-rollup tr:hover td { background: var(--gantt-row-hover); }
.pp-cat-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 2px;
  margin-right: 5px;
  vertical-align: middle;
}

/* Disclaimer */
.gantt-disclaimer {
  margin: 12px 28px 0;
  padding: 10px 14px;
  background: #fef9e7;
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
  font-size: 11px;
  color: #78350f;
}

/* Footer */
.gantt-footer {
  text-align: center;
  padding: 20px 28px;
  font-size: 10px;
  color: var(--gantt-faint);
  border-top: 1px solid var(--gantt-line);
  margin-top: 40px;
}

@media (max-width: 768px) {
  .gantt-page-header { flex-direction: column; align-items: flex-start; }
  .gantt-container { padding: 12px; }
  .gantt-controls { padding: 10px 12px 0; }
  :root { --gantt-label-w: 140px; }
}
  </style>
</head>
<body>

${flagStripHtml}

<div class="gantt-page-header">
  <div class="gantt-header-left">
    ${logoHtml}
    <div class="gantt-header-titles">
      <h1>${escapeHtml(chartTitle)}</h1>
      ${chartSubtitle ? `<p>${escapeHtml(chartSubtitle)}</p>` : ''}
    </div>
  </div>
  <div class="gantt-legend" id="gantt-legend"></div>
</div>

${projectPlanHeaderHtml}

${disclaimerHtml ? `<div class="gantt-disclaimer">${disclaimerHtml}</div>` : ''}

<div class="gantt-controls" id="gantt-controls">
  <button class="gantt-view-btn active" data-view="all">All</button>
</div>

<div class="gantt-container">
  <div class="gantt-wrap" id="gantt-wrap"></div>
</div>

<div class="gantt-tooltip" id="gantt-tooltip"></div>

<div class="gantt-footer">
  Generated ${escapeHtml(date)}${orgName ? ' · ' + escapeHtml(orgName) : ''}
</div>

<script>
(function() {
  'use strict';

  // ── Data injected by server ──────────────────────────────────────────
  var CATEGORIES  = ${jsCategories};
  var TASKS       = ${jsTasks};
  var MONTHS      = ${jsMonths};
  var TOTAL_COLS  = ${jsTotalCols};
  var TODAY_COL   = ${jsTodayCol};
  var AXIS        = ${jsAxis};
  var COL_LABELS  = ${jsColumnLabels};

  // Label column width in pixels — must match CSS --gantt-label-w
  var LABEL_W = 200;

  // ── State ────────────────────────────────────────────────────────────
  var activeFilter = 'all';

  // ── DOM refs ─────────────────────────────────────────────────────────
  var legendEl   = document.getElementById('gantt-legend');
  var controlsEl = document.getElementById('gantt-controls');
  var wrapEl     = document.getElementById('gantt-wrap');
  var tooltipEl  = document.getElementById('gantt-tooltip');

  // ── Build legend ─────────────────────────────────────────────────────
  CATEGORIES.forEach(function(cat) {
    var item = document.createElement('div');
    item.className = 'gantt-legend-item';
    item.dataset.cat = cat.id;
    item.innerHTML =
      '<span class="gantt-legend-dot" style="background:' + cat.color + '"></span>' +
      escHtml(cat.label);
    item.addEventListener('click', function() { toggleFilter(cat.id); });
    legendEl.appendChild(item);
  });

  // ── Build view buttons (one per category + All) ──────────────────────
  CATEGORIES.forEach(function(cat) {
    var btn = document.createElement('button');
    btn.className = 'gantt-view-btn';
    btn.dataset.view = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener('click', function() {
      activeFilter = cat.id;
      applyFilter();
      document.querySelectorAll('.gantt-view-btn').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
    });
    controlsEl.appendChild(btn);
  });

  // ── Build Gantt grid ─────────────────────────────────────────────────
  var gridCols = 'var(--gantt-label-w) repeat(' + TOTAL_COLS + ', 1fr)';

  // Month header
  var monthRow = document.createElement('div');
  monthRow.className = 'gantt-month-row';
  monthRow.style.gridTemplateColumns = gridCols;

  var labelArea = document.createElement('div');
  labelArea.className = 'gantt-label-area';
  labelArea.textContent = 'Activity';
  monthRow.appendChild(labelArea);

  MONTHS.forEach(function(m) {
    var cell = document.createElement('div');
    cell.className = 'gantt-month-cell';
    cell.style.gridColumn = 'span ' + m.weeks;
    cell.textContent = m.label;
    monthRow.appendChild(cell);
  });
  wrapEl.appendChild(monthRow);

  // Week/month sub-header
  var weekRow = document.createElement('div');
  weekRow.className = 'gantt-week-row';
  weekRow.style.gridTemplateColumns = gridCols;

  var weekLabelArea = document.createElement('div');
  weekLabelArea.className = 'gantt-week-label-area';
  weekRow.appendChild(weekLabelArea);

  for (var w = 0; w < TOTAL_COLS; w++) {
    var wCell = document.createElement('div');
    wCell.className = 'gantt-week-cell';
    wCell.textContent = COL_LABELS[w] || ('W' + (w + 1));
    weekRow.appendChild(wCell);
  }
  wrapEl.appendChild(weekRow);

  // ── Task rows ────────────────────────────────────────────────────────
  // Each row uses a two-layer approach:
  //   Layer 1: grid cells (background lines) — no position:relative
  //   Layer 2: .gantt-bar-overlay (position:absolute) — bars + diamonds
  //
  // Bar/diamond left and width are expressed as percentages of the DATA
  // area width (total row width minus the label column).
  //
  //   left%  = startCol / TOTAL_COLS * 100
  //   width% = (endCol - startCol) / TOTAL_COLS * 100
  //
  // The overlay's left edge is offset by LABEL_W (CSS var --gantt-label-w)
  // so percentages are relative to the data area only.

  var lastGroup = '';
  TASKS.forEach(function(task) {
    if (task.group !== lastGroup) {
      var groupLabel = document.createElement('div');
      groupLabel.className = 'gantt-group-label';
      groupLabel.textContent = task.group;
      wrapEl.appendChild(groupLabel);
      lastGroup = task.group;
    }

    var row = document.createElement('div');
    row.className = 'gantt-task-row';
    row.dataset.cat = task.category;
    row.style.gridTemplateColumns = gridCols;

    // ── Task name cell (label column) ──
    var nameCell = document.createElement('div');
    nameCell.className = 'gantt-task-name';
    nameCell.innerHTML = escHtml(task.name) +
      (task.sub ? '<span class="gantt-sub">' + escHtml(task.sub) + '</span>' : '');
    row.appendChild(nameCell);

    // ── Background grid cells (column lines only) ──
    for (var col = 0; col < TOTAL_COLS; col++) {
      var cell = document.createElement('div');
      cell.className = 'gantt-grid-cell';
      row.appendChild(cell);
    }

    // ── Overlay layer (bars + diamonds + today line) ──
    var overlay = document.createElement('div');
    overlay.className = 'gantt-bar-overlay';

    var catColor = getCatColor(task.category);
    var startPct = (task.startCol / TOTAL_COLS * 100).toFixed(4);

    if (task.type === 'diamond') {
      // Diamond: centered on startCol
      var diamond = document.createElement('div');
      diamond.className = 'gantt-diamond';
      diamond.style.background = catColor;
      // Center the 12px diamond on the column midpoint
      diamond.style.left = 'calc(' + startPct + '% + ' + (100 / TOTAL_COLS / 2).toFixed(4) + '% - 6px)';
      diamond.dataset.task = task.name;
      diamond.dataset.detail = task.detail;
      diamond.dataset.dates = colLabel(task.startCol);
      overlay.appendChild(diamond);
    } else {
      // Bar: spans from startCol to endCol
      var span = Math.max(1, task.endCol - task.startCol);
      var widthPct = (span / TOTAL_COLS * 100).toFixed(4);
      var bar = document.createElement('div');
      bar.className = 'gantt-bar' + (task.hatched ? ' hatched' : '');
      bar.style.background = catColor;
      bar.style.left = startPct + '%';
      bar.style.width = widthPct + '%';
      bar.dataset.task = task.name;
      bar.dataset.detail = task.detail;
      bar.dataset.dates = colLabel(task.startCol) + '\u2013' + colLabel(task.endCol);
      overlay.appendChild(bar);
    }

    // Today line (inside overlay, same percentage system)
    if (TODAY_COL >= 0 && TODAY_COL < TOTAL_COLS) {
      var todayPct = (TODAY_COL / TOTAL_COLS * 100).toFixed(4);
      var todayLine = document.createElement('div');
      todayLine.className = 'gantt-today-line';
      todayLine.style.left = todayPct + '%';
      var todayLbl = document.createElement('div');
      todayLbl.className = 'gantt-today-label';
      todayLbl.textContent = 'Today';
      todayLine.appendChild(todayLbl);
      overlay.appendChild(todayLine);
    }

    row.appendChild(overlay);
    wrapEl.appendChild(row);
  });

  // ── Filter logic ─────────────────────────────────────────────────────
  function toggleFilter(cat) {
    activeFilter = (activeFilter === cat) ? 'all' : cat;
    applyFilter();
    document.querySelectorAll('.gantt-view-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.view === activeFilter);
    });
  }

  function applyFilter() {
    document.querySelectorAll('.gantt-task-row').forEach(function(row) {
      var cat = row.dataset.cat;
      row.classList.toggle('dimmed', activeFilter !== 'all' && cat !== activeFilter);
    });
    document.querySelectorAll('.gantt-legend-item').forEach(function(item) {
      item.classList.toggle('dimmed', activeFilter !== 'all' && item.dataset.cat !== activeFilter);
    });
  }

  // All button
  document.querySelector('.gantt-view-btn[data-view="all"]').addEventListener('click', function() {
    activeFilter = 'all';
    applyFilter();
    document.querySelectorAll('.gantt-view-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.view === 'all');
    });
  });

  // ── Tooltip ──────────────────────────────────────────────────────────
  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('.gantt-bar, .gantt-diamond');
    if (el) {
      tooltipEl.innerHTML =
        '<div class="tt-title">' + escHtml(el.dataset.task || '') + '</div>' +
        '<div class="tt-dates">' + escHtml(el.dataset.dates || '') + '</div>' +
        (el.dataset.detail ? '<div class="tt-body">' + escHtml(el.dataset.detail) + '</div>' : '');
      tooltipEl.classList.add('visible');
    }
  });
  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('.gantt-bar, .gantt-diamond')) {
      tooltipEl.classList.remove('visible');
    }
  });
  document.addEventListener('mousemove', function(e) {
    if (tooltipEl.classList.contains('visible')) {
      var x = e.clientX + 16;
      var y = e.clientY - 10;
      if (x + 290 > window.innerWidth) x = e.clientX - 290;
      if (y + 130 > window.innerHeight) y = e.clientY - 130;
      tooltipEl.style.left = x + 'px';
      tooltipEl.style.top  = y + 'px';
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────
  function getCatColor(catId) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === catId) return CATEGORIES[i].color;
    }
    return '#888';
  }

  function colLabel(col) {
    return COL_LABELS[col] || ('W' + (col + 1));
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
</script>
</body>
</html>`;
}
