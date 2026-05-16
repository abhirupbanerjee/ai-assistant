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
    dataSource?: string;
  };
  /** Optional explicit page type. If omitted, auto-detection is used. */
  pageType?: HtmlPageType;
}

/**
 * Options for generating HTML from a pre-rendered HTML source
 * (e.g., output from mammoth.convertToHtml for DOCX conversion)
 */
export type HtmlSourcePageType = 'documentation' | 'playbook' | 'roadmap' | 'gantt' | 'project_plan' | 'dashboard';

export interface HtmlSourceOptions {
  title: string;
  /** Pre-rendered HTML fragment (headings, paragraphs, tables, images) */
  sourceHtml: string;
  branding: BrandingConfig;
  disclaimerConfig?: DisclaimerConfig | null;
  metadata?: {
    author?: string;
    date?: string;
    dataSource?: string;
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

export type HtmlPageType = 'dashboard' | 'book' | 'report' | 'website' | 'chart' | 'playbook' | 'roadmap' | 'gantt' | 'project_plan';

// ============ Book Types ============

/**
 * A single section within a book chapter.
 */
export interface BookSection {
  heading: string;
  content: string;
}

/**
 * A single chapter in a book.
 */
export interface BookChapter {
  title: string;
  sections?: BookSection[];
}

/**
 * Top-level configuration block for a Book page.
 * Emitted by the LLM inside a ```book fenced block as JSON.
 */
export interface BookBlockConfig {
  frontMatter?: {
    author?: string;
    subtitle?: string;
    publisher?: string;
    edition?: string;
    abstract?: string;
  };
  chapters: BookChapter[];
}

export interface BookSegment {
  type: 'book';
  config: BookBlockConfig;
}

// ============ Report Types ============

/**
 * A single section in a formal report.
 */
export interface ReportSection {
  heading: string;
  type?: 'findings' | 'analysis' | 'recommendations' | 'methodology' | 'background' | 'content';
  content: string;
}

/**
 * Top-level configuration block for a Report page.
 * Emitted by the LLM inside a ```report fenced block as JSON.
 */
export interface ReportBlockConfig {
  metadata?: {
    preparedFor?: string;
    preparedBy?: string;
    date?: string;
    classification?: string;
    version?: string;
  };
  executiveSummary?: string;
  sections: ReportSection[];
  appendices?: Array<{ title: string; content: string }>;
}

export interface ReportSegment {
  type: 'report';
  config: ReportBlockConfig;
}

// ============ Roadmap Types (Sun Ray Diagram) ============

/**
 * A single band (concentric ring) in the sun ray diagram.
 * Bands represent maturity/progress layers from inner (current) to outer (future).
 */
export interface RoadmapBand {
  /** Band label (e.g. "Foundation", "Integration") */
  label: string;
  /** Optional explicit hex color for this band */
  color?: string;
}

/**
 * A single ray (radial segment) in the sun ray diagram.
 * Rays represent strategic pillars or themes that cut across all bands.
 */
export interface RoadmapRay {
  /** Caption / pillar title */
  caption: string;
  /** Short description of this pillar */
  description?: string;
  /** Status of this pillar */
  status?: 'completed' | 'in-progress' | 'planned';
}

/**
 * A single phase in a roadmap (legacy linear format).
 * The LLM emits these inside a ```roadmap fenced block as JSON.
 */
export interface RoadmapPhase {
  /** Phase display title */
  title: string;
  /** Optional date range or period label, e.g. "Q1 2026" */
  period?: string;
  /** Status badge: completed | in-progress | planned */
  status?: 'completed' | 'in-progress' | 'planned';
  /** Short description paragraph */
  description?: string;
  /** List of milestone strings */
  milestones?: string[];
}

/**
 * Top-level configuration block for a Roadmap page (Sun Ray Diagram).
 * Emitted by the LLM inside a ```roadmap fenced block as JSON.
 */
export interface RoadmapBlockConfig {
  /** Page/chart title */
  title?: string;
  /** Subtitle shown below the title */
  subtitle?: string;
  /** Central topic label (shown at the origin of the sun ray) */
  topic?: string;
  /** Current state description (shown at arc start) */
  currentState?: string;
  /** Future state description (shown at arc end) */
  futureState?: string;
  /** Overall progress percentage (0-100) */
  overallProgress?: number;
  /**
   * Concentric bands (inner = current, outer = future).
   * If omitted, bands are auto-generated from phases.
   */
  bands?: RoadmapBand[];
  /**
   * Radial rays (strategic pillars/themes).
   * If omitted, rays are auto-generated from phases.
   */
  rays?: RoadmapRay[];
  /** Legacy: phases array (used when bands/rays not provided) */
  phases?: RoadmapPhase[];
}

export interface RoadmapSegment {
  type: 'roadmap';
  config: RoadmapBlockConfig;
}

// ============ Playbook Types ============

/**
 * A single topic within a playbook part.
 */
export interface PlaybookTopic {
  /** Topic title */
  title: string;
  /** Short subtitle / summary */
  subtitle?: string;
  /** Markdown body content */
  body?: string;
}

/**
 * A single part (section) in a playbook.
 */
export interface PlaybookPart {
  /** Part title */
  title: string;
  /** Optional intro paragraph */
  intro?: string;
  /** Topics within this part */
  topics?: PlaybookTopic[];
}

/**
 * Top-level configuration block for a Playbook page.
 * Emitted by the LLM inside a ```playbook fenced block as JSON.
 */
export interface PlaybookBlockConfig {
  /** Page title */
  title?: string;
  /** Hero subtitle */
  subtitle?: string;
  /** The parts/sections of the playbook */
  parts: PlaybookPart[];
}

export interface PlaybookSegment {
  type: 'playbook';
  config: PlaybookBlockConfig;
}

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

export type ContentSegment = MarkdownSegment | ChartSegment | DiagramSegment | KpiSegment | FiltersSegment | DataSegment | InsightsSegment | GanttSegment | RoadmapSegment | PlaybookSegment | BookSegment | ReportSegment;

export interface ChartBlockConfig {
  title?: string;
  data: Record<string, unknown>[];
  x_field: string;
  y_fields: string[];
  recommended_chart?: string;
  series_mode?: 'grouped' | 'stacked' | 'auto';
  notes?: string;
  /** Short (≤ 12 words) caption shown under the chart title explaining what the chart shows. */
  description?: string;
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
  /** Hover tooltip detail text (shown on mouse-over of the KPI tile) */
  tooltip?: string;
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
  /** Optional: small label/value/note rows shown above the table */
  items?: Array<{
    label: string;
    value: string;
    note?: string;
  }>;
  table?: {
    headers: string[];
    rows: string[][];
  };
}

/**
 * Insights block — defines the AI-generated summary + bullet list shown in the right rail
 * above any data table. Zone 4 of the 6-zone dashboard contract.
 */
export interface InsightsBlockConfig {
  /** Optional title (defaults to "Insights") */
  title?: string;
  /** 1-3 sentence narrative summary of what the dashboard shows. */
  summary?: string;
  /** Short bullet points highlighting key findings (3-5 recommended). */
  bullets?: string[];
}

export interface InsightsSegment {
  type: 'insights';
  config: InsightsBlockConfig;
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
   * Time axis granularity. Auto-selected from project span if omitted.
   * - "weeks"    → W1…Wn columns  (0–3 months)
   * - "months"   → M1…Mn columns  (3–13 months)
   * - "quarters" → Q1…Qn columns  (1–3 years)
   * - "years"    → year columns   (3+ years)
   * - "dates"    → day columns    (short sprints)
   */
  axis?: 'weeks' | 'months' | 'quarters' | 'years' | 'dates';
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
