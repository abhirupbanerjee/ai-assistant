/**
 * HTML Builder Types
 */
import type { BrandingConfig } from '../branding';
import type { DisclaimerConfig } from '../../disclaimer';

export interface HtmlOptions {
  title: string;
  content: string;
  branding: BrandingConfig;
  disclaimerConfig?: DisclaimerConfig | null;
  metadata?: {
    author?: string;
    date?: string;
  };
  /** Optional explicit page type. If omitted, auto-detection is used. */
  pageType?: HtmlPageType;
}

/**
 * Options for generating HTML from a pre-rendered HTML source
 * (e.g., output from mammoth.convertToHtml for DOCX conversion)
 */
export type HtmlSourcePageType = 'documentation' | 'playbook' | 'roadmap';

export interface HtmlSourceOptions {
  title: string;
  /** Pre-rendered HTML fragment (headings, paragraphs, tables, images) */
  sourceHtml: string;
  branding: BrandingConfig;
  disclaimerConfig?: DisclaimerConfig | null;
  metadata?: {
    author?: string;
    date?: string;
  };
  /** Optional output layout type. Defaults to 'documentation'. */
  pageType?: HtmlSourcePageType;
}

export interface HtmlResult {
  buffer: Buffer;
  fileSize: number;
  pageType: HtmlPageType;
  chartCount: number;
  diagramCount: number;
}

export type HtmlPageType = 'dashboard' | 'documentation' | 'book' | 'report' | 'website' | 'chart' | 'webpage' | 'playbook' | 'roadmap' | 'gantt' | 'project_plan';

// ============ Content Segment Types ============

export interface MarkdownSegment {
  type: 'markdown';
  content: string;
}

export interface ChartSegment {
  type: 'chart';
  config: ChartBlockConfig;
  raw: string;
}

export interface DiagramSegment {
  type: 'mermaid';
  code: string;
  diagramType: string;
}

export type ContentSegment = MarkdownSegment | ChartSegment | DiagramSegment | KpiSegment | FiltersSegment | DataSegment | GanttSegment;

export interface ChartBlockConfig {
  title?: string;
  data: Record<string, unknown>[];
  x_field: string;
  y_fields: string[];
  recommended_chart?: string;
  series_mode?: 'grouped' | 'stacked' | 'auto';
  notes?: string;
  /** Dashboard layout size hint: hero=8col, half=6col, third=4col, quarter=3col */
  size?: 'hero' | 'half' | 'third' | 'quarter';
  /** Panel zone: 'canvas' (default) or 'kpi' (renders as KPI tile) */
  panel?: 'canvas' | 'kpi';
  /** Tags for client-side slicer filtering (e.g. ["region:north","category:sales"]) */
  tags?: string[];
}

/** KPI tile block — rendered in the KPI row at the top of the dashboard */
export interface KpiBlockConfig {
  label: string;
  value: string;
  delta?: string;
  /** positive | negative | neutral — controls delta colour */
  trend_direction?: 'positive' | 'negative' | 'neutral';
  /** Optional sparkline data (array of numbers) */
  trend?: number[];
  /** Tags for slicer filtering */
  tags?: string[];
}

/** Filters block — defines left-rail slicers */
export interface FiltersBlockConfig {
  title?: string;
  slicers: Array<{
    id: string;
    label: string;
    type: 'select' | 'multiselect' | 'search' | 'daterange';
    options?: string[];
    tag_prefix?: string;
  }>;
}

/** Data block — defines right-rail data/stats panel */
export interface DataBlockConfig {
  title?: string;
  items: Array<{
    label: string;
    value: string;
    note?: string;
  }>;
  table?: {
    headers: string[];
    rows: string[][];
  };
}

export interface KpiSegment {
  type: 'kpi';
  config: KpiBlockConfig;
}

export interface FiltersSegment {
  type: 'filters';
  config: FiltersBlockConfig;
}

export interface DataSegment {
  type: 'data';
  config: DataBlockConfig;
}

// ============ Gantt / Project Plan Types ============

/**
 * A single category definition for a Gantt chart.
 * The LLM/user defines names, ids, and colors — nothing is hardcoded.
 */
export interface GanttCategory {
  /** Unique identifier used in task.category */
  id: string;
  /** Human-readable label shown in the legend */
  label: string;
  /** Hex color for bars/diamonds in this category */
  color?: string;
}

/**
 * A single task (bar or milestone diamond) in the Gantt chart.
 * start/end accept ISO dates ("2026-05-04"), week tokens ("W1"), or month tokens ("M1").
 */
export interface GanttTask {
  /** Group/section heading this task belongs to */
  group: string;
  /** Task display name */
  name: string;
  /** Optional sub-label shown below the name */
  sub?: string;
  /** Category id — must match a GanttCategory.id */
  category: string;
  /**
   * Start position. Accepts:
   *   - ISO date string: "2026-05-04"
   *   - Week token: "W1" … "W52"
   *   - Month token: "M1" … "M24"
   */
  start: string;
  /**
   * End position (same format as start). Omit for milestone diamonds.
   */
  end?: string;
  /** "diamond" renders a milestone marker instead of a bar */
  type?: 'bar' | 'diamond';
  /** Apply a diagonal stripe pattern to the bar (e.g. for planned/future phases) */
  hatched?: boolean;
  /** Tooltip detail text */
  detail?: string;
}

/**
 * Top-level configuration block for a Gantt / Project Plan page.
 * Emitted by the LLM inside a ```gantt fenced block as JSON.
 */
export interface GanttBlockConfig {
  /** Chart title (overrides the page title if provided) */
  title?: string;
  /** Subtitle / date range description */
  subtitle?: string;
  /**
   * Reference start date for the timeline.
   * ISO date string: "2026-05-04". If omitted, W1/M1 tokens are used as-is.
   */
  start_date?: string;
  /**
   * Reference end date. Used to compute total weeks/months when axis="dates".
   */
  end_date?: string;
  /**
   * Time axis granularity.
   * - "weeks"  → W1…Wn columns (default)
   * - "months" → M1…Mn columns
   * - "dates"  → derive weeks from start_date/end_date
   */
  axis?: 'weeks' | 'months' | 'dates';
  /**
   * Optional three-color flag strip [color1, color2, color3].
   * Priority: flag_colors > branding.primary/accent/secondary > default palette.
   */
  flag_colors?: [string, string, string];
  /**
   * User/LLM-defined categories. Names, ids, and colors are fully dynamic.
   * If a task references a category id not in this list, a default color is assigned.
   */
  categories?: GanttCategory[];
  /** The tasks to render */
  tasks: GanttTask[];
}

export interface GanttSegment {
  type: 'gantt';
  config: GanttBlockConfig;
}

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

// ============ Layout Flags ============

export interface DocumentLayoutFlags {
  /** Show TOC sidebar (documentation, book, report) */
  showToc: boolean;
  /** TOC heading label (e.g. 'Contents', 'Chapters') */
  tocHeading: string;
  /** Show language selector in header */
  showLangSelector: boolean;
  /** Show hero section with gradient background (website) */
  showHero: boolean;
  /** Show metadata badge under title (report, book) */
  showMetadataBadge: boolean;
  /** Badge label text (e.g. 'Formal report', 'Ebook format') */
  badgeLabel: string;
  /** Badge accent style: 'border-left' or 'border' */
  badgeStyle: 'border-left' | 'border';
  /** Show title in header bar */
  showHeaderTitle: boolean;
  /** Footer suffix text */
  footerSuffix: string;
  /** Search placeholder text */
  searchPlaceholder: string;
  /** Max content width */
  contentMaxWidth: string;
}
