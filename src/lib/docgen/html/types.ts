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

export type HtmlPageType = 'dashboard' | 'documentation' | 'book' | 'report' | 'website' | 'chart' | 'webpage' | 'playbook' | 'roadmap';

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

export type ContentSegment = MarkdownSegment | ChartSegment | DiagramSegment | KpiSegment | FiltersSegment | DataSegment;

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
