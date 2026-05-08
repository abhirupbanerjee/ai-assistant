/**
 * Gantt config normalizer.
 *
 * Validates and normalizes a raw GanttBlockConfig before rendering:
 *   - Fills in missing group/name/start with safe fallbacks
 *   - Infers milestone type (diamond) when end is absent or equals start
 *   - Drops tasks that cannot be positioned (no parseable start)
 *   - Auto-selects axis granularity when not explicitly provided
 *   - Logs a diagnostic summary in development
 */
import type { GanttBlockConfig, GanttTask } from '../types';
import { autoSelectAxis } from '../time/time-axis';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if the string looks like an ISO date (YYYY-MM-DD). */
function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/** Returns true if the string looks like a W/M token or a plain integer. */
function isPositionToken(s: string): boolean {
  return /^[WwMm]\d+$/.test(s.trim()) || /^\d+$/.test(s.trim());
}

/** Returns true if the position string is parseable by the renderer. */
function isValidPosition(s: string | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  return isIsoDate(t) || isPositionToken(t);
}

// ── Main normalizer ───────────────────────────────────────────────────────────

export interface NormalizationReport {
  totalInput: number;
  taskCount: number;
  milestoneCount: number;
  droppedCount: number;
  selectedAxis: string;
  warnings: string[];
}

/**
 * Normalize a raw GanttBlockConfig.
 *
 * Returns a new config object with:
 *   - All tasks validated and sanitized
 *   - Milestone type inferred where missing
 *   - Axis auto-selected if not explicitly provided
 *   - Group/name/category fallbacks applied
 */
export function normalizeGanttConfig(
  cfg: GanttBlockConfig,
): { config: GanttBlockConfig; report: NormalizationReport } {
  const warnings: string[] = [];
  const rawTasks: GanttTask[] = Array.isArray(cfg.tasks) ? cfg.tasks : [];
  const totalInput = rawTasks.length;

  const startDate = cfg.start_date ? new Date(cfg.start_date) : null;
  if (cfg.start_date && (!startDate || isNaN(startDate.getTime()))) {
    warnings.push(`start_date "${cfg.start_date}" is not a valid ISO date — ignored`);
  }

  const normalizedTasks: GanttTask[] = [];
  let droppedCount = 0;

  rawTasks.forEach((t, idx) => {
    // ── Field fallbacks ──
    const name = (typeof t.name === 'string' && t.name.trim()) ? t.name.trim() : `Task ${idx + 1}`;
    const tAny = t as unknown as Record<string, unknown>;
    const group = (typeof t.group === 'string' && t.group.trim())
      ? t.group.trim()
      : (typeof tAny['phase'] === 'string'
          ? String(tAny['phase'])
          : (typeof tAny['workstream'] === 'string'
              ? String(tAny['workstream'])
              : 'General'));
    const category = (typeof t.category === 'string' && t.category.trim())
      ? t.category.trim()
      : 'default';

    // ── Start validation ──
    const startRaw = typeof t.start === 'string' ? t.start.trim() : '';
    if (!isValidPosition(startRaw)) {
      warnings.push(`Task "${name}" (index ${idx}) has invalid/missing start "${startRaw}" — dropped`);
      droppedCount++;
      return;
    }

    // ── End / milestone inference ──
    const endRaw = typeof t.end === 'string' ? t.end.trim() : '';
    const hasValidEnd = isValidPosition(endRaw) && endRaw !== startRaw;

    // Infer milestone: explicit type=diamond, OR no end, OR end === start
    const isMilestone =
      t.type === 'diamond' ||
      !hasValidEnd;

    const normalizedTask: GanttTask = {
      group,
      name,
      category,
      start: startRaw,
      type: isMilestone ? 'diamond' : (t.type || 'bar'),
    };

    if (!isMilestone && hasValidEnd) {
      normalizedTask.end = endRaw;
    }
    if (t.sub) normalizedTask.sub = t.sub;
    if (t.hatched) normalizedTask.hatched = t.hatched;
    if (t.detail) normalizedTask.detail = t.detail;

    normalizedTasks.push(normalizedTask);
  });

  // ── Auto-select axis ──
  const selectedAxis = autoSelectAxis(normalizedTasks, startDate, cfg.axis);

  // ── Build report ──
  const taskCount = normalizedTasks.filter(t => t.type !== 'diamond').length;
  const milestoneCount = normalizedTasks.filter(t => t.type === 'diamond').length;

  const report: NormalizationReport = {
    totalInput,
    taskCount,
    milestoneCount,
    droppedCount,
    selectedAxis,
    warnings,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      `[GanttNormalizer] in=${totalInput} tasks=${taskCount} milestones=${milestoneCount} dropped=${droppedCount} axis=${selectedAxis}`,
      warnings.length ? warnings : '',
    );
  }

  const normalizedConfig: GanttBlockConfig = {
    ...cfg,
    axis: selectedAxis,
    tasks: normalizedTasks,
  };

  return { config: normalizedConfig, report };
}
