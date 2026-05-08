/**
 * Project Plan template.
 *
 * Wraps the Gantt template with projectPlanMode=true (adds KPI strip)
 * and appends a roll-up summary table grouped by work stream.
 *
 * The Gantt chart itself is rendered by buildGanttTemplate; this module
 * only adds the roll-up table HTML that is injected before the Gantt container.
 */
import type { BrandingConfig } from '../../branding';
import type { GanttBlockConfig } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildGanttTemplate } from './gantt';

/**
 * Build a Project Plan HTML page.
 * Identical to the Gantt page but with:
 *   - KPI strip (task count, milestones, work streams, categories, timeline)
 *   - Roll-up table: one row per work stream with task list + category dots
 */
export function buildProjectPlanTemplate(
  pageTitle: string,
  cfg: GanttBlockConfig,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
  todayIso: string,
): string {
  // Delegate to the Gantt template with projectPlanMode=true.
  // The roll-up table is injected via a placeholder that we replace below.
  const ganttHtml = buildGanttTemplate(
    pageTitle,
    cfg,
    branding,
    css,
    js,
    disclaimerHtml,
    date,
    todayIso,
    true, // projectPlanMode
  );

  // ── Build roll-up table ──────────────────────────────────────────────
  // Group tasks by work stream (group field)
  const groups: Record<string, typeof cfg.tasks> = {};
  for (const task of cfg.tasks) {
    if (!groups[task.group]) groups[task.group] = [];
    groups[task.group].push(task);
  }

  // Build category color map (same logic as gantt.ts — keep in sync)
  const DEFAULT_PALETTE = [
    '#1f4e79', '#2C5F7A', '#5B2D8E', '#8B6914',
    '#7a3535', '#3a6b3a', '#4a4a7a', '#6b4a2a',
  ];
  const categories = cfg.categories || [];
  const declaredIds = new Set(categories.map(c => c.id));
  const extraIds: string[] = [];
  for (const t of cfg.tasks) {
    if (t.category && !declaredIds.has(t.category) && !extraIds.includes(t.category)) {
      extraIds.push(t.category);
    }
  }
  const allCategories = [
    ...categories,
    ...extraIds.map(id => ({ id, label: id, color: undefined as string | undefined })),
  ];
  const colorMap: Record<string, string> = {};
  allCategories.forEach((cat, idx) => {
    if (cat.color) {
      colorMap[cat.id] = cat.color;
    } else if (idx === 0 && branding.primaryColor) {
      colorMap[cat.id] = branding.primaryColor;
    } else {
      colorMap[cat.id] = DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
    }
  });

  let tableRows = '';
  for (const [groupName, tasks] of Object.entries(groups)) {
    const taskCount = tasks.filter(t => (t.type || 'bar') === 'bar').length;
    const milestoneCount = tasks.filter(t => t.type === 'diamond').length;
    const taskList = tasks.map(t => {
      const color = colorMap[t.category] || '#888';
      const icon = t.type === 'diamond' ? '◆' : '▬';
      return `<span class="pp-cat-dot" style="background:${escapeHtml(color)}" title="${escapeHtml(t.category)}"></span>${escapeHtml(t.name)}`;
    }).join('<br>');

    tableRows += `
      <tr>
        <td><strong>${escapeHtml(groupName)}</strong></td>
        <td style="text-align:center">${taskCount}</td>
        <td style="text-align:center">${milestoneCount}</td>
        <td>${taskList}</td>
      </tr>`;
  }

  const rollupTable = `
<div class="pp-rollup">
  <div class="pp-rollup-title">Work Stream Summary</div>
  <table>
    <thead>
      <tr>
        <th>Work Stream</th>
        <th style="text-align:center">Tasks</th>
        <th style="text-align:center">Milestones</th>
        <th>Activities</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</div>`;

  // Inject the roll-up table just before the gantt-controls div
  return ganttHtml.replace(
    '<div class="gantt-controls" id="gantt-controls">',
    rollupTable + '\n<div class="gantt-controls" id="gantt-controls">',
  );
}
