/**
 * Time-axis utilities for Gantt chart rendering.
 *
 * Extracted from gantt.ts so they can be unit-tested independently
 * and reused by future timeline-based templates.
 *
 * Supports three axis modes:
 *   - "weeks"  — each column is one week (default for multi-month plans)
 *   - "months" — each column is one month (for year+ plans)
 *   - "dates"  — each column is one day (for short sprints)
 *
 * Position tokens:
 *   - "W1"…"Wn"  — 1-based week index
 *   - "M1"…"Mn"  — 1-based month index, converted to weeks (×4.333)
 *   - ISO date    — weeks (or days for "dates" axis) from start_date
 *   - plain int   — treated as 1-based week index
 */
import type { GanttTask } from '../types';

export type GanttAxis = 'weeks' | 'months' | 'dates';

export interface MonthSpan {
  /** Display label, e.g. "May 2026" */
  label: string;
  /** 0-based start column */
  startCol: number;
  /** Number of columns this span covers */
  weeks: number;
}

// ── Position parsing ──────────────────────────────────────────────────────────

/**
 * Parse a position token to a 0-based column index.
 *
 * @param token    - Position string: "W3", "M2", "2026-05-04", or plain int
 * @param startDate - Chart start date (used for ISO date → column conversion)
 * @param axis     - Axis mode
 */
export function parsePosition(
  token: string,
  startDate: Date | null,
  axis: GanttAxis,
): number {
  const t = (token || '').trim();

  // Week token: W1, W2, …
  const wMatch = t.match(/^[Ww](\d+)$/);
  if (wMatch) return Math.max(0, parseInt(wMatch[1], 10) - 1);

  // Month token: M1, M2, …
  const mMatch = t.match(/^[Mm](\d+)$/);
  if (mMatch) {
    const monthIdx = parseInt(mMatch[1], 10) - 1;
    if (axis === 'months') return monthIdx;
    return Math.round(monthIdx * 4.333);
  }

  // ISO date: 2026-05-04
  const dateMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      if (startDate) {
        const diffMs = d.getTime() - startDate.getTime();
        if (axis === 'dates') {
          return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
        }
        return Math.max(0, Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)));
      }
      return 0;
    }
  }

  // Numeric fallback (1-based)
  const n = parseInt(t, 10);
  return isNaN(n) ? 0 : Math.max(0, n - 1);
}

// ── Column count ──────────────────────────────────────────────────────────────

/**
 * Compute the total number of columns needed to fit all tasks.
 * Returns at least 4 columns.
 */
export function computeTotalColumns(
  tasks: GanttTask[],
  startDate: Date | null,
  axis: GanttAxis,
): number {
  let max = 0;
  for (const t of tasks) {
    const s = parsePosition(t.start, startDate, axis);
    const e = t.end ? parsePosition(t.end, startDate, axis) : s + 1;
    if (e > max) max = e;
  }
  return Math.max(max, 4);
}

// ── Auto axis selection ───────────────────────────────────────────────────────

/**
 * Automatically select the best time-axis granularity based on project span.
 *
 * Rules (applied when no explicit axis is provided, or when the explicit
 * choice would produce an unusable number of columns):
 *   ≤ 90 days  → "weeks"   (up to ~13 columns — fine-grained)
 *   91–365 days → "months"  (up to ~12 columns — readable)
 *   > 365 days  → "months"  (month headers group into readable spans)
 *
 * If the caller passes an explicit axis that is valid for the span, it is
 * returned unchanged (user/LLM override is respected).
 *
 * @param tasks       - Normalized task list (used to derive date range)
 * @param startDate   - Chart start date (may be null)
 * @param explicitAxis - Axis value from the LLM/config (may be undefined)
 */
export function autoSelectAxis(
  tasks: GanttTask[],
  startDate: Date | null,
  explicitAxis?: string,
): GanttAxis {
  // Collect all ISO date strings from tasks
  const isoDates: Date[] = [];
  for (const t of tasks) {
    for (const pos of [t.start, t.end]) {
      if (!pos) continue;
      const m = pos.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const d = new Date(pos.trim());
        if (!isNaN(d.getTime())) isoDates.push(d);
      }
    }
  }
  if (startDate && !isNaN(startDate.getTime())) isoDates.push(startDate);

  let spanDays = 0;
  if (isoDates.length >= 2) {
    const minMs = Math.min(...isoDates.map(d => d.getTime()));
    const maxMs = Math.max(...isoDates.map(d => d.getTime()));
    spanDays = (maxMs - minMs) / (24 * 60 * 60 * 1000);
  }

  // Determine ideal axis from span
  const idealAxis: GanttAxis = spanDays <= 90 ? 'weeks' : 'months';

  // If the LLM provided a valid axis, respect it — unless it would produce
  // an absurd column count (e.g. "weeks" for a 300-day plan → 43 columns).
  if (explicitAxis === 'dates' || explicitAxis === 'months' || explicitAxis === 'weeks') {
    const explicit = explicitAxis as GanttAxis;
    // Reject "weeks" when span > 180 days (would produce 26+ columns)
    if (explicit === 'weeks' && spanDays > 180) {
      return 'months';
    }
    return explicit;
  }

  return idealAxis;
}

// ── Month spans ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Build the array of month-header spans for the Gantt header row.
 *
 * - "months" axis: each column is already a month → one span per column
 * - "weeks" axis without startDate: group every 4 columns as "M1", "M2", …
 * - "weeks"/"dates" axis with startDate: group by calendar month
 */
export function buildMonthSpans(
  startDate: Date | null,
  totalCols: number,
  axis: GanttAxis,
): MonthSpan[] {
  if (axis === 'months') {
    return Array.from({ length: totalCols }, (_, i) => ({
      label: `M${i + 1}`,
      startCol: i,
      weeks: 1,
    }));
  }

  if (!startDate) {
    // No start date — group every 4 columns
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

  // Group by calendar month using the real start date
  const msPerCol = axis === 'dates'
    ? 24 * 60 * 60 * 1000          // 1 day per column
    : 7 * 24 * 60 * 60 * 1000;     // 1 week per column

  const spans: MonthSpan[] = [];
  let currentMonth = startDate.getMonth();
  let currentYear = startDate.getFullYear();
  let spanStart = 0;

  for (let col = 0; col <= totalCols; col++) {
    const colDate = new Date(startDate.getTime() + col * msPerCol);
    const colMonth = colDate.getMonth();
    const colYear = colDate.getFullYear();

    if ((colMonth !== currentMonth || colYear !== currentYear) || col === totalCols) {
      const spanCols = col - spanStart;
      if (spanCols > 0) {
        spans.push({
          label: `${MONTH_NAMES[currentMonth]} ${currentYear}`,
          startCol: spanStart,
          weeks: spanCols,
        });
      }
      currentMonth = colMonth;
      currentYear = colYear;
      spanStart = col;
    }
  }
  return spans;
}
