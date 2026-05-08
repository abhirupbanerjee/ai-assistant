/**
 * Project Plan template.
 *
 * Wraps the Gantt template with projectPlanMode=true (adds KPI strip)
 * and appends a roll-up summary table grouped by work stream.
 *
 * The Gantt chart itself is rendered by buildGanttTemplate; this module
 * only adds the roll-up table HTML that is injected before the Gantt container.
 *
 * Summary table columns:
 *   Work Stream | Tasks (count) | Milestones (count) | Activities (numeric count)
 *
 * "Activities" is the total item count (tasks + milestones) per work stream,
 * shown as a number — not a list of names.
 */
import type { BrandingConfig } from '../../branding';
import type { GanttBlockConfig } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildGanttTemplate } from './gantt';
import { resolveCategoryColor } from '../branding/color-resolver';
import { normalizeGanttConfig } from '../parsing/gantt-normalizer';

/**
 * Build a Project Plan HTML page.
 * Identical to the Gantt page but with:
 *   - KPI strip (task count, milestones, work streams, categories, timeline)
 *   - Roll-up table: one row per work stream with numeric task/milestone/activity counts
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
  // Normalize first so the roll-up table uses the same task/milestone
  // classification as the Gantt chart (milestone inference, group fallbacks).
  const { config } = normalizeGanttConfig(cfg);

  // Delegate to the Gantt template with projectPlanMode=true.
  // The roll-up table is injected via a placeholder that we replace below.
  // Note: buildGanttTemplate will call normalizeGanttConfig again internally,
  // but that is idempotent — passing the already-normalized config is fine.
  const ganttHtml = buildGanttTemplate(
    pageTitle,
    config,
    branding,
    css,
    js,
    disclaimerHtml,
    date,
    todayIso,
    true, // projectPlanMode
  );

  // ── Build roll-up table ──────────────────────────────────────────────
  // Group tasks by work stream (group field — already normalized, never undefined)
  const groups: Record<string, typeof config.tasks> = {};
  for (const task of config.tasks) {
    const key = task.group || 'General';
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  }

  // Build category color map using the shared resolveCategoryColor utility
  const categories = config.categories || [];
  const declaredIds = new Set(categories.map(c => c.id));
  const extraIds: string[] = [];
  for (const t of config.tasks) {
    if (t.category && !declaredIds.has(t.category) && !extraIds.includes(t.category)) {
      extraIds.push(t.category);
    }
  }
  const allCategories = [
    ...categories,
    ...extraIds.map(id => ({ id, label: id })),
  ];
  const colorMap: Record<string, string> = {};
  allCategories.forEach((cat, idx) => {
    colorMap[cat.id] = resolveCategoryColor(cat.id, allCategories, branding, idx);
  });

  let tableRows = '';
  for (const [groupName, tasks] of Object.entries(groups)) {
    // Use normalized type field — normalizer already inferred diamonds
    const taskItems = tasks.filter(t => t.type !== 'diamond');
    const milestoneItems = tasks.filter(t => t.type === 'diamond');
    const taskCount = taskItems.length;
    const milestoneCount = milestoneItems.length;
    const activityCount = tasks.length; // total items in this work stream

    // Category color dots for the work stream (unique categories only)
    const seenCats = new Set<string>();
    const catDots = tasks
      .filter(t => { const seen = seenCats.has(t.category); seenCats.add(t.category); return !seen; })
      .map(t => {
        const color = colorMap[t.category] || '#888';
        return `<span class="pp-cat-dot" style="background:${escapeHtml(color)}" title="${escapeHtml(t.category)}"></span>`;
      })
      .join('');

    tableRows += `
      <tr>
        <td><strong>${escapeHtml(groupName)}</strong>${catDots ? '<br><span style="margin-top:4px;display:inline-block">' + catDots + '</span>' : ''}</td>
        <td style="text-align:center;font-weight:600">${taskCount}</td>
        <td style="text-align:center;font-weight:600">${milestoneCount}</td>
        <td style="text-align:center;font-weight:600">${activityCount}</td>
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
        <th style="text-align:center">Activities</th>
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
