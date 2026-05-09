/**
 * Time-axis utilities for Gantt chart rendering.
 *
 * Extracted from gantt.ts so they can be unit-tested independently
 * and reused by future timeline-based templates.
 *
 * Supports five axis modes:
 *   - "weeks"    — each column is one week   (0–3 months)
 *   - "months"   — each column is one month  (3–13 months)
 *   - "quarters" — each column is one quarter (1–3 years)
 *   - "years"    — each column is one year   (3+ years)
 *   - "dates"    — each column is one day    (short sprints)
 *
 * Auto-selection tiers (applied when no explicit axis is provided):
 *   ≤ 90 days   → "weeks"
 *   91–395 days → "months"
 *   396–1095 days → "quarters"
 *   > 1095 days → "years"
 *
 * Position tokens:
 *   - "W1"…"Wn"  — 1-based week index
 *   - "M1"…"Mn"  — 1-based month index
 *   - "Q1"…"Qn"  — 1-based quarter index
 *   - "Y1"…"Yn"  — 1-based year index
 *   - ISO date    — offset from start_date in the appropriate unit
 *   - plain int   — treated as 1-based week index
 */
import type { GanttTask } from '../types';

export type GanttAxis = 'weeks' | 'months' | 'quarters' | 'years' | 'dates';

export interface MonthSpan {
  /** Display label, e.g. "May 2026" or "Q2 2026" or "2026" */
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
 * The returned index is always in the same unit as the axis:
 *   - weeks    → 0-based week index
 *   - months   → 0-based month index
 *   - quarters → 0-based quarter index
 *   - years    → 0-based year index
 *   - dates    → 0-based day index
 *
 * @param token    - Position string: "W3", "M2", "Q1", "Y2", "2026-05-04", or plain int
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
  if (wMatch) {
    const weekIdx = Math.max(0, parseInt(wMatch[1], 10) - 1);
    // Convert to the target axis unit
    if (axis === 'months') return Math.round(weekIdx / 4.333);
    if (axis === 'quarters') return Math.floor(weekIdx / 13);
    if (axis === 'years') return Math.floor(weekIdx / 52);
    return weekIdx; // weeks or dates
  }

  // Month token: M1, M2, …
  const mMatch = t.match(/^[Mm](\d+)$/);
  if (mMatch) {
    const monthIdx = Math.max(0, parseInt(mMatch[1], 10) - 1);
    if (axis === 'months') return monthIdx;
    if (axis === 'quarters') return Math.floor(monthIdx / 3);
    if (axis === 'years') return Math.floor(monthIdx / 12);
    if (axis === 'dates') return Math.round(monthIdx * 30.44);
    return Math.round(monthIdx * 4.333); // weeks
  }

  // Quarter token: Q1, Q2, …
  const qMatch = t.match(/^[Qq](\d+)$/);
  if (qMatch) {
    const quarterIdx = Math.max(0, parseInt(qMatch[1], 10) - 1);
    if (axis === 'quarters') return quarterIdx;
    if (axis === 'years') return Math.floor(quarterIdx / 4);
    if (axis === 'months') return quarterIdx * 3;
    if (axis === 'dates') return Math.round(quarterIdx * 91.25);
    return Math.round(quarterIdx * 13); // weeks
  }

  // Year token: Y1, Y2, …
  const yMatch = t.match(/^[Yy](\d+)$/);
  if (yMatch) {
    const yearIdx = Math.max(0, parseInt(yMatch[1], 10) - 1);
    if (axis === 'years') return yearIdx;
    if (axis === 'quarters') return yearIdx * 4;
    if (axis === 'months') return yearIdx * 12;
    if (axis === 'dates') return Math.round(yearIdx * 365.25);
    return Math.round(yearIdx * 52); // weeks
  }

  // ISO date: 2026-05-04
  const dateMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      if (startDate && !isNaN(startDate.getTime())) {
        const diffMs = d.getTime() - startDate.getTime();
        const diffDays = diffMs / (24 * 60 * 60 * 1000);

        if (axis === 'dates') {
          return Math.max(0, Math.round(diffDays));
        }
        if (axis === 'weeks') {
          return Math.max(0, Math.round(diffDays / 7));
        }
        if (axis === 'months') {
          // Use calendar month difference for accuracy
          const monthDiff =
            (d.getFullYear() - startDate.getFullYear()) * 12 +
            (d.getMonth() - startDate.getMonth()) +
            (d.getDate() - startDate.getDate()) / 30.44;
          return Math.max(0, Math.round(monthDiff));
        }
        if (axis === 'quarters') {
          const monthDiff =
            (d.getFullYear() - startDate.getFullYear()) * 12 +
            (d.getMonth() - startDate.getMonth());
          return Math.max(0, Math.floor(monthDiff / 3));
        }
        if (axis === 'years') {
          const yearDiff =
            d.getFullYear() - startDate.getFullYear() +
            (d.getMonth() - startDate.getMonth()) / 12;
          return Math.max(0, Math.round(yearDiff));
        }
      }
      return 0;
    }
  }

  // Numeric fallback (1-based week index)
  const n = parseInt(t, 10);
  if (!isNaN(n)) {
    const weekIdx = Math.max(0, n - 1);
    if (axis === 'months') return Math.round(weekIdx / 4.333);
    if (axis === 'quarters') return Math.floor(weekIdx / 13);
    if (axis === 'years') return Math.floor(weekIdx / 52);
    return weekIdx;
  }

  return 0;
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
 * Tiers:
 *   ≤ 90 days    → "weeks"    (up to ~13 columns)
 *   91–395 days  → "months"   (up to ~13 columns)
 *   396–1095 days → "quarters" (up to ~12 columns)
 *   > 1095 days  → "years"    (readable year columns)
 *
 * If the caller passes an explicit axis, it is respected unless it would
 * produce an unreadable column count (e.g. "weeks" for a 3-year plan).
 *
 * @param tasks        - Normalized task list (used to derive date range)
 * @param startDate    - Chart start date (may be null)
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
  let idealAxis: GanttAxis;
  if (spanDays <= 90) {
    idealAxis = 'weeks';
  } else if (spanDays <= 395) {
    idealAxis = 'months';
  } else if (spanDays <= 1095) {
    idealAxis = 'quarters';
  } else {
    idealAxis = 'years';
  }

  // If the LLM provided a valid axis, respect it — unless it would produce
  // an unreadable column count.
  const validAxes: GanttAxis[] = ['dates', 'weeks', 'months', 'quarters', 'years'];
  if (explicitAxis && validAxes.includes(explicitAxis as GanttAxis)) {
    const explicit = explicitAxis as GanttAxis;
    // Reject "weeks" when span > 180 days (would produce 26+ columns)
    if (explicit === 'weeks' && spanDays > 180) return idealAxis;
    // Reject "months" when span > 1095 days (would produce 36+ columns)
    if (explicit === 'months' && spanDays > 1095) return idealAxis;
    // Reject "quarters" when span > 3650 days (would produce 40+ columns)
    if (explicit === 'quarters' && spanDays > 3650) return 'years';
    return explicit;
  }

  return idealAxis;
}

// ── Month/period spans ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const QUARTER_NAMES = ['Q1', 'Q2', 'Q3', 'Q4'];

/**
 * Build the array of header spans for the Gantt top header row.
 *
 * - "years"    axis: group by decade (or just list years)
 * - "quarters" axis: group by year, each column = 1 quarter
 * - "months"   axis: group by year, each column = 1 month
 * - "weeks"/"dates" axis without startDate: group every 4 columns as "M1", "M2", …
 * - "weeks"/"dates" axis with startDate: group by calendar month
 */
export function buildMonthSpans(
  startDate: Date | null,
  totalCols: number,
  axis: GanttAxis,
): MonthSpan[] {
  // ── Years axis ──
  if (axis === 'years') {
    if (!startDate) {
      return Array.from({ length: totalCols }, (_, i) => ({
        label: `Y${i + 1}`,
        startCol: i,
        weeks: 1,
      }));
    }
    return Array.from({ length: totalCols }, (_, i) => ({
      label: String(startDate.getFullYear() + i),
      startCol: i,
      weeks: 1,
    }));
  }

  // ── Quarters axis ──
  if (axis === 'quarters') {
    if (!startDate) {
      return Array.from({ length: totalCols }, (_, i) => ({
        label: `Q${(i % 4) + 1}`,
        startCol: i,
        weeks: 1,
      }));
    }
    // Group by year
    const spans: MonthSpan[] = [];
    let currentYear = startDate.getFullYear();
    // Which quarter does startDate fall in?
    const startQuarter = Math.floor(startDate.getMonth() / 3);
    let spanStart = 0;
    let prevYear = currentYear;

    for (let col = 0; col <= totalCols; col++) {
      const totalQuarters = startQuarter + col;
      const colYear = startDate.getFullYear() + Math.floor(totalQuarters / 4);

      if (colYear !== prevYear || col === totalCols) {
        const spanCols = col - spanStart;
        if (spanCols > 0) {
          spans.push({
            label: String(prevYear),
            startCol: spanStart,
            weeks: spanCols,
          });
        }
        prevYear = colYear;
        spanStart = col;
      }
    }
    return spans;
  }

  // ── Months axis ──
  if (axis === 'months') {
    if (!startDate) {
      // No start date — group every 12 columns as a year
      const spans: MonthSpan[] = [];
      let col = 0;
      let yearNum = 1;
      while (col < totalCols) {
        const w = Math.min(12, totalCols - col);
        spans.push({ label: `Y${yearNum}`, startCol: col, weeks: w });
        col += w;
        yearNum++;
      }
      return spans;
    }
    // Group by calendar year
    const spans: MonthSpan[] = [];
    let spanStart = 0;
    let prevYear = startDate.getFullYear();

    for (let col = 0; col <= totalCols; col++) {
      const colDate = new Date(startDate.getFullYear(), startDate.getMonth() + col, 1);
      const colYear = colDate.getFullYear();

      if (colYear !== prevYear || col === totalCols) {
        const spanCols = col - spanStart;
        if (spanCols > 0) {
          spans.push({
            label: String(prevYear),
            startCol: spanStart,
            weeks: spanCols,
          });
        }
        prevYear = colYear;
        spanStart = col;
      }
    }
    return spans;
  }

  // ── Weeks / dates axis ──
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

/**
 * Build the sub-header cell labels for the Gantt week/column row.
 * Returns an array of label strings, one per column.
 */
export function buildColumnLabels(
  startDate: Date | null,
  totalCols: number,
  axis: GanttAxis,
): string[] {
  if (axis === 'years') {
    if (!startDate) {
      return Array.from({ length: totalCols }, (_, i) => `Y${i + 1}`);
    }
    return Array.from({ length: totalCols }, (_, i) =>
      String(startDate.getFullYear() + i)
    );
  }

  if (axis === 'quarters') {
    if (!startDate) {
      return Array.from({ length: totalCols }, (_, i) => `Q${(i % 4) + 1}`);
    }
    const startQuarter = Math.floor(startDate.getMonth() / 3);
    return Array.from({ length: totalCols }, (_, i) => {
      const totalQ = startQuarter + i;
      const q = totalQ % 4;
      return QUARTER_NAMES[q];
    });
  }

  if (axis === 'months') {
    if (!startDate) {
      return Array.from({ length: totalCols }, (_, i) => `M${i + 1}`);
    }
    return Array.from({ length: totalCols }, (_, i) => {
      const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      return MONTH_NAMES[d.getMonth()];
    });
  }

  // weeks / dates
  return Array.from({ length: totalCols }, (_, i) =>
    axis === 'dates' ? `D${i + 1}` : `W${i + 1}`
  );
}

/**
 * Build a human-readable column label for tooltip display.
 * e.g. "May 2026" for months, "Q2 2026" for quarters, "2027" for years.
 */
export function colToLabel(
  col: number,
  startDate: Date | null,
  axis: GanttAxis,
): string {
  if (!startDate) {
    if (axis === 'years') return `Y${col + 1}`;
    if (axis === 'quarters') return `Q${(col % 4) + 1}`;
    if (axis === 'months') return `M${col + 1}`;
    return `W${col + 1}`;
  }

  if (axis === 'years') {
    return String(startDate.getFullYear() + col);
  }
  if (axis === 'quarters') {
    const startQ = Math.floor(startDate.getMonth() / 3);
    const totalQ = startQ + col;
    const year = startDate.getFullYear() + Math.floor(totalQ / 4);
    const q = totalQ % 4;
    return `${QUARTER_NAMES[q]} ${year}`;
  }
  if (axis === 'months') {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + col, 1);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (axis === 'dates') {
    const d = new Date(startDate.getTime() + col * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  // weeks
  const d = new Date(startDate.getTime() + col * 7 * 24 * 60 * 60 * 1000);
  return `W${col + 1} (${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()})`;
}
