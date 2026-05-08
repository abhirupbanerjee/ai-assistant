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
 */
import type { BrandingConfig } from '../../branding';
import type { GanttBlockConfig, GanttTask, GanttCategory } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';

// ── Default professional palette (used only when LLM/branding provides nothing) ──
const DEFAULT_PALETTE = [
  '#1f4e79', '#2C5F7A', '#5B2D8E', '#8B6914',
  '#7a3535', '#3a6b3a', '#4a4a7a', '#6b4a2a',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a position token to a 0-based week index. */
function parsePosition(
  token: string,
  startDate: Date | null,
  axis: 'weeks' | 'months' | 'dates',
): number {
  const t = (token || '').trim();

  // Week token: W1, W2, …
  const wMatch = t.match(/^[Ww](\d+)$/);
  if (wMatch) return Math.max(0, parseInt(wMatch[1], 10) - 1);

  // Month token: M1, M2, …
  const mMatch = t.match(/^[Mm](\d+)$/);
  if (mMatch) {
    const monthIdx = parseInt(mMatch[1], 10) - 1;
    return Math.round(monthIdx * 4.333);
  }

  // ISO date: 2026-05-04
  const dateMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      if (startDate) {
        const diffMs = d.getTime() - startDate.getTime();
        return Math.max(0, Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)));
      }
      // No start_date — treat as absolute week 0 fallback
      return 0;
    }
  }

  // Numeric fallback
  const n = parseInt(t, 10);
  return isNaN(n) ? 0 : Math.max(0, n - 1);
}

/** Compute total columns needed from tasks. */
function computeTotalColumns(
  tasks: GanttTask[],
  startDate: Date | null,
  axis: 'weeks' | 'months' | 'dates',
): number {
  let max = 0;
  for (const t of tasks) {
    const s = parsePosition(t.start, startDate, axis);
    const e = t.end ? parsePosition(t.end, startDate, axis) : s + 1;
    if (e > max) max = e;
  }
  return Math.max(max, 4);
}

/** Build month header spans from a start date + total weeks. */
interface MonthSpan {
  label: string;
  startCol: number; // 0-based
  weeks: number;
}

function buildMonthSpans(
  startDate: Date | null,
  totalCols: number,
  axis: 'weeks' | 'months' | 'dates',
): MonthSpan[] {
  if (axis === 'months') {
    // Each column IS a month
    const spans: MonthSpan[] = [];
    for (let i = 0; i < totalCols; i++) {
      spans.push({ label: `M${i + 1}`, startCol: i, weeks: 1 });
    }
    return spans;
  }

  if (!startDate || axis === 'weeks') {
    // Group every 4 weeks into a "month" label
    const spans: MonthSpan[] = [];
    let col = 0;
    let monthNum = 1;
    while (col < totalCols) {
      const w = Math.min(4, totalCols - col);
      spans.push({ label: `M${monthNum}`, startCol: col, weeks: w });
      col += w;
      monthNum++;
    }
    return spans;
  }

  // axis === 'dates' with a real start date — group by calendar month
  const spans: MonthSpan[] = [];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let currentMonth = startDate.getMonth();
  let currentYear = startDate.getFullYear();
  let spanStart = 0;

  for (let w = 0; w <= totalCols; w++) {
    const weekDate = new Date(startDate.getTime() + w * 7 * 24 * 60 * 60 * 1000);
    const wMonth = weekDate.getMonth();
    const wYear = weekDate.getFullYear();

    if ((wMonth !== currentMonth || wYear !== currentYear) || w === totalCols) {
      const spanWeeks = w - spanStart;
      if (spanWeeks > 0) {
        const yearSuffix = currentYear !== startDate.getFullYear() ? ` ${currentYear}` : ` ${currentYear}`;
        spans.push({
          label: `${MONTH_NAMES[currentMonth]}${yearSuffix}`,
          startCol: spanStart,
          weeks: spanWeeks,
        });
      }
      currentMonth = wMonth;
      currentYear = wYear;
      spanStart = w;
    }
  }
  return spans;
}

/** Resolve category color — LLM color → branding primary → default palette. */
function resolveCategoryColor(
  catId: string,
  categories: GanttCategory[],
  branding: BrandingConfig,
  paletteIndex: number,
): string {
  const cat = categories.find(c => c.id === catId);
  if (cat?.color) return cat.color;
  // Use branding primary only for index 0; rest fall through to default palette
  if (paletteIndex === 0 && branding.primaryColor) return branding.primaryColor;
  return DEFAULT_PALETTE[paletteIndex % DEFAULT_PALETTE.length];
}

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
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="gantt-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const vendorScripts = buildVendorScripts();

  // ── Resolve time axis ──
  const axis = cfg.axis || 'weeks';
  const startDate = cfg.start_date ? new Date(cfg.start_date) : null;
  const totalCols = computeTotalColumns(cfg.tasks, startDate, axis);
  const monthSpans = buildMonthSpans(startDate, totalCols, axis);

  // ── Resolve flag strip colors ──
  // BrandingConfig doesn't have accentColor/secondaryColor; access via unknown cast
  const brandingAny = branding as unknown as Record<string, string>;
  const flagColors: string[] = cfg.flag_colors && cfg.flag_colors.length === 3
    ? cfg.flag_colors
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
  const categories: GanttCategory[] = cfg.categories || [];
  // Collect any category ids referenced in tasks but not declared
  const declaredIds = new Set(categories.map(c => c.id));
  const extraIds: string[] = [];
  for (const t of cfg.tasks) {
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
      const diffMs = today.getTime() - startDate.getTime();
      todayCol = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    }
  }

  // ── Serialize data for inline JS ──
  const jsCategories = JSON.stringify(allCategories.map(c => ({
    id: c.id,
    label: c.label,
    color: colorMap[c.id],
  })));

  const jsTasks = JSON.stringify(cfg.tasks.map(t => ({
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

  // ── Project plan KPI strip ──
  let projectPlanHeaderHtml = '';
  if (projectPlanMode) {
    const totalTasks = cfg.tasks.filter(t => (t.type || 'bar') === 'bar').length;
    const milestones = cfg.tasks.filter(t => t.type === 'diamond').length;
    const groups = [...new Set(cfg.tasks.map(t => t.group))].length;
    const dateRange = cfg.subtitle || (cfg.start_date && cfg.end_date
      ? `${cfg.start_date} → ${cfg.end_date}`
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

  const chartTitle = cfg.title || pageTitle;
  const chartSubtitle = cfg.subtitle || '';

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
  align-items: center;
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
}

.gantt-week-row {
  border-bottom: 1px solid var(--gantt-line);
}
.gantt-week-label-area { font-size: 9px; color: var(--gantt-faint); padding: 3px 0; }
.gantt-week-cell {
  border-left: 1px solid #f0f0ed;
  padding: 2px 0;
  font-size: 8px;
  color: var(--gantt-faint);
  text-align: center;
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

/* Task row */
.gantt-task-row {
  min-height: 36px;
  border-bottom: 1px solid #f5f5f2;
  transition: background 0.1s, opacity 0.3s;
}
.gantt-task-row:hover { background: var(--gantt-row-hover); }
.gantt-task-row.dimmed { opacity: 0.12; }

.gantt-task-name {
  font-size: 12px;
  color: var(--gantt-ink);
  padding-right: 10px;
  line-height: 1.3;
}
.gantt-task-name .gantt-sub {
  font-size: 10px;
  color: var(--gantt-faint);
  display: block;
  margin-top: 1px;
}

.gantt-grid-cell {
  position: relative;
  height: 100%;
  border-left: 1px solid #f5f5f2;
}

/* Bars */
.gantt-bar {
  position: absolute;
  top: 7px;
  bottom: 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: filter 0.15s, transform 0.15s;
  z-index: 2;
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
  width: 11px;
  height: 11px;
  transform: translateY(-50%) rotate(45deg);
  border-radius: 2px;
  cursor: pointer;
  z-index: 3;
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
  z-index: 5;
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
  vertical-align: top;
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
  var CATEGORIES = ${jsCategories};
  var TASKS      = ${jsTasks};
  var MONTHS     = ${jsMonths};
  var TOTAL_COLS = ${jsTotalCols};
  var TODAY_COL  = ${jsTodayCol};
  var AXIS       = ${jsAxis};

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
  var gridCols = '200px repeat(' + TOTAL_COLS + ', 1fr)';

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

  // Week sub-header
  var weekRow = document.createElement('div');
  weekRow.className = 'gantt-week-row';
  weekRow.style.gridTemplateColumns = gridCols;

  var weekLabelArea = document.createElement('div');
  weekLabelArea.className = 'gantt-week-label-area';
  weekRow.appendChild(weekLabelArea);

  for (var w = 0; w < TOTAL_COLS; w++) {
    var wCell = document.createElement('div');
    wCell.className = 'gantt-week-cell';
    wCell.textContent = (AXIS === 'months') ? ('M' + (w + 1)) : ('W' + (w + 1));
    weekRow.appendChild(wCell);
  }
  wrapEl.appendChild(weekRow);

  // Task rows
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

    // Task name cell
    var nameCell = document.createElement('div');
    nameCell.className = 'gantt-task-name';
    nameCell.innerHTML = escHtml(task.name) +
      (task.sub ? '<span class="gantt-sub">' + escHtml(task.sub) + '</span>' : '');
    row.appendChild(nameCell);

    // Grid cells
    for (var col = 0; col < TOTAL_COLS; col++) {
      var cell = document.createElement('div');
      cell.className = 'gantt-grid-cell';

      var catColor = getCatColor(task.category);

      if (task.type === 'diamond' && col === task.startCol) {
        var diamond = document.createElement('div');
        diamond.className = 'gantt-diamond';
        diamond.style.background = catColor;
        diamond.style.left = '50%';
        diamond.style.marginLeft = '-5px';
        diamond.dataset.task = task.name;
        diamond.dataset.detail = task.detail;
        diamond.dataset.dates = colLabel(task.startCol);
        cell.appendChild(diamond);
      } else if (task.type !== 'diamond' && col === task.startCol) {
        var span = task.endCol - task.startCol;
        var bar = document.createElement('div');
        bar.className = 'gantt-bar' + (task.hatched ? ' hatched' : '');
        bar.style.background = catColor;
        bar.style.left = '0';
        bar.style.width = 'calc(' + (span * 100) + '% + ' + (span - 1) + 'px)';
        bar.dataset.task = task.name;
        bar.dataset.detail = task.detail;
        bar.dataset.dates = colLabel(task.startCol) + '\u2013' + colLabel(task.endCol);
        cell.appendChild(bar);
      }

      // Today line
      if (col === TODAY_COL && TODAY_COL >= 0) {
        var todayLine = document.createElement('div');
        todayLine.className = 'gantt-today-line';
        var todayLbl = document.createElement('div');
        todayLbl.className = 'gantt-today-label';
        todayLbl.textContent = 'Today';
        todayLine.appendChild(todayLbl);
        cell.appendChild(todayLine);
      }

      row.appendChild(cell);
    }

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
    if (AXIS === 'months') return 'M' + (col + 1);
    return 'W' + (col + 1);
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
