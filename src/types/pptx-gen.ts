/**
 * PPTX Generation Tool Types
 *
 * Type definitions for the PowerPoint presentation generation tool.
 */

// ============ Tool Arguments ============

export interface PptxGenToolArgs {
  /** Presentation title */
  title: string;
  /** Array of slide definitions */
  slides: SlideDefinition[];
  /** Visual theme */
  theme?: ThemeName;
  /** Accent color for highlights, chart fills, stat numbers (hex, e.g. "#3B82F6") */
  accentColor?: string;
}

// ============ Slide Layout ============

export type SlideLayout = 'full' | 'split-left' | 'split-right' | 'split-top';

// ============ Slide Types ============

export type SlideType =
  | 'title'
  | 'content'
  | 'two-column'
  | 'comparison'
  | 'stats'
  | 'image'
  | 'closing'
  | 'chart'
  | 'table'
  | 'timeline'
  | 'metric-cards'
  | 'swot'
  | 'funnel'
  | 'before-after'
  | 'process'
  | 'kanban'
  | 'pyramid'
  | 'radial-progress'
  | 'icon-grid'
  | 'comparison-matrix'
  | 'quote'
  | 'agenda'
  | 'team'
  | 'geo';

export interface SlideDefinition {
  /** Slide layout type */
  type: SlideType;
  /** Slide title */
  title: string;
  /** Optional explanatory paragraph displayed below the title (1-2 sentences) */
  description?: string;
  /** Layout mode for visual slides: full (default), split-left, split-right, split-top */
  layout?: SlideLayout;
  /** Main content (for content/closing slides) */
  content?: string;
  /** Left column content (for two-column/comparison) */
  leftContent?: string;
  /** Right column content (for two-column/comparison) */
  rightContent?: string;
  /** Stats for stats slide */
  stats?: StatItem[];
  /** Chart data (for chart slides) */
  chartData?: ChartSlideData;
  /** Table data (for table slides) */
  tableData?: TableSlideData;
  /** Timeline data (for timeline slides) */
  timelineData?: TimelineSlideData;
  /** Metric cards data (for metric-cards slides) */
  metricCardsData?: MetricCardsSlideData;
  /** SWOT data (for swot slides) */
  swotData?: SwotSlideData;
  /** Funnel data (for funnel slides) */
  funnelData?: FunnelSlideData;
  /** Before/after data (for before-after slides) */
  beforeAfterData?: BeforeAfterSlideData;
  /** Process data (for process slides) */
  processData?: ProcessSlideData;
  /** Kanban data (for kanban slides) */
  kanbanData?: KanbanSlideData;
  /** Pyramid data (for pyramid slides) */
  pyramidData?: PyramidSlideData;
  /** Radial progress data (for radial-progress slides) */
  radialProgressData?: RadialProgressSlideData;
  /** Icon grid data (for icon-grid slides) */
  iconGridData?: IconGridSlideData;
  /** Comparison matrix data (for comparison-matrix slides) */
  comparisonMatrixData?: ComparisonMatrixSlideData;
  /** Quote data (for quote slides) */
  quoteData?: QuoteSlideData;
  /** Agenda data (for agenda slides) */
  agendaData?: AgendaSlideData;
  /** Team data (for team slides) */
  teamData?: TeamSlideData;
  /** Geo data (for geo slides) */
  geoData?: GeoSlideData;
  /** Prompt for AI image generation (for image slides) */
  imagePrompt?: string;
  /** Style hint for image generation */
  imageStyle?: string;
  /** Resolution for image generation: 512 (preview), 1K (standard), 2K (high-fidelity), 4K (print). Default: 1K */
  imageResolution?: string;
  /** Speaker notes */
  speakerNotes?: string;
  /** Optional emoji/icon shown alongside the title for content/closing fallback slides (Tier 3) */
  icon?: string;
}

export interface StatItem {
  /** Large value/number display */
  value: string;
  /** Description label */
  label: string;
  /** Optional small caption below label (e.g., "+12% vs last month") */
  caption?: string;
}

// ============ Phase 1: New Slide Type Interfaces ============

/** Supported chart types */
export type ChartType = 'bar' | 'line' | 'pie' | 'doughnut' | 'area';

export interface ChartSeries {
  /** Series name (displayed in legend) */
  name: string;
  /** Data values for this series */
  values: number[];
}

export interface ChartSlideData {
  /** Chart type */
  chartType: ChartType;
  /** X-axis category labels */
  categories: string[];
  /** Data series (1 for pie/doughnut, 1+ for bar/line/area) */
  series: ChartSeries[];
  /** Show legend (default: true for multi-series) */
  showLegend?: boolean;
  /** Show data labels on chart */
  showValues?: boolean;
  /** Optional Y-axis label */
  yAxisLabel?: string;
}

export interface TableSlideData {
  /** Column headers */
  headers: string[];
  /** Data rows (each row is an array of cell values) */
  rows: string[][];
  /** Optional relative column width weights (e.g. [1,2,1]); normalized to fit the table width. Default: equal. */
  columnWidths?: number[];
  /** Header row background color hex (default: accentColor) */
  headerColor?: string;
  /** Alternate row shading (default: true) */
  striped?: boolean;
}

export type TimelineOrientation = 'horizontal' | 'vertical';

export interface TimelineEvent {
  /** Date or timeframe label (e.g., "Q1 2025", "Jan 2026") */
  date: string;
  /** Event title */
  title: string;
  /** Optional event detail */
  description?: string;
}

export interface TimelineSlideData {
  /** Timeline events in chronological order */
  events: TimelineEvent[];
  /** Layout orientation (default: horizontal) */
  orientation?: TimelineOrientation;
}

export type TrendDirection = 'up' | 'down' | 'flat';

export interface MetricCard {
  /** Metric name */
  label: string;
  /** Display value (e.g., "99.97%", "$12.4M") */
  value: string;
  /** Trend direction */
  trend?: TrendDirection;
  /** Trend delta text (e.g., "+0.02%", "-18ms") */
  trendValue?: string;
  /** Card accent color hex (default: auto from trend direction) */
  color?: string;
}

export interface MetricCardsSlideData {
  /** Metric cards */
  cards: MetricCard[];
  /** Number of cards per row (default: auto based on count, 2-4) */
  columns?: number;
}

// ============ Phase 2: Strategic Slide Type Interfaces ============

export interface SwotSlideData {
  /** Internal positive factors */
  strengths: string[];
  /** Internal negative factors */
  weaknesses: string[];
  /** External positive factors */
  opportunities: string[];
  /** External negative factors */
  threats: string[];
}

export interface FunnelStage {
  /** Stage name */
  label: string;
  /** Count or value at this stage */
  value: number;
  /** Stage color (default: gradient from top) */
  color?: string;
}

export interface FunnelSlideData {
  /** Stages from top (widest) to bottom (narrowest) */
  stages: FunnelStage[];
  /** Show conversion percentages between stages */
  showPercentages?: boolean;
  /** Prefix for value display (e.g., "$", "#") */
  valuePrefix?: string;
  /** Suffix for value display (e.g., "%", " users") */
  valueSuffix?: string;
}

export interface BeforeAfterPanel {
  /** Panel label ("Before", "After") */
  label: string;
  /** Bullet points (newline separated) */
  content: string;
  /** Panel accent color (default: red for before, green for after) */
  color?: string;
}

export interface BeforeAfterSlideData {
  /** Left ("Before") panel */
  left: BeforeAfterPanel;
  /** Right ("After") panel */
  right: BeforeAfterPanel;
}

export type ProcessOrientation = 'horizontal' | 'vertical';

export interface ProcessStep {
  /** Step number (1-based) */
  number: number;
  /** Step title */
  title: string;
  /** Step detail */
  description?: string;
}

export interface ProcessSlideData {
  /** Process steps in order */
  steps: ProcessStep[];
  /** Layout orientation (default: horizontal) */
  orientation?: ProcessOrientation;
  /** Show step numbers (default: true) */
  showNumbers?: boolean;
  /** Show connector arrows (default: true) */
  showArrows?: boolean;
}

// ============ Phase 3: Specialized Slide Type Interfaces ============

export interface KanbanColumn {
  header: string;
  color?: string;
  cards: string[];
}

export interface KanbanSlideData {
  columns: KanbanColumn[];
}

export interface PyramidLevel {
  label: string;
  color?: string;
  description?: string;
}

export interface PyramidSlideData {
  levels: PyramidLevel[];
  orientation?: 'top-down' | 'bottom-up';
}

export interface RadialProgressItem {
  label: string;
  value: number;
  color?: string;
}

export interface RadialProgressSlideData {
  items: RadialProgressItem[];
}

export interface IconGridItem {
  icon: string;
  title: string;
  desc: string;
}

export interface IconGridSlideData {
  items: IconGridItem[];
  layout?: '2x2' | '3x2' | '4x2';
}

export interface MatrixRow {
  criteria: string;
  /** Name of the column header that is the winner for this row (enables winner highlighting when showWinner is true) */
  winner?: string;
  [option: string]: string | undefined;
}

export interface ComparisonMatrixSlideData {
  headers: string[];
  rows: MatrixRow[];
  showWinner?: boolean;
}

export interface QuoteSlideData {
  quote: string;
  attribution?: string;
  role?: string;
}

export interface AgendaItem {
  number?: number;
  title: string;
  description?: string;
}

export interface AgendaSlideData {
  items: AgendaItem[];
  numbered?: boolean;
}

export interface TeamMember {
  name: string;
  role: string;
  bio?: string;
}

export interface TeamSlideData {
  members: TeamMember[];
  columns?: number;
}

export interface GeoMarker {
  label: string;
  lat: number;
  lng: number;
  size?: 'small' | 'medium' | 'large';
}

export interface GeoSlideData {
  region?: 'world' | 'us' | 'europe' | 'asia';
  markers: GeoMarker[];
}

// ============ Themes & Colors ============

export type ThemeName = 'light' | 'dark';

export interface ThemeConfig {
  /** Slide background color (without #) */
  background: string;
  /** Primary/header text color (without #) */
  textColor: string;
  /** Body/secondary text color (without #) */
  bodyTextColor: string;
  /** Border/divider color (without #) */
  borderColor: string;
  /** Configurable accent color for highlights, chart fills, stat numbers (without #) */
  accentColor: string;
  /** Header font family */
  headerFont: string;
  /** Body font family */
  bodyFont: string;
}

// ============ Tool Configuration ============

export interface PptxGenConfig {
  /** Default theme */
  defaultTheme: ThemeName;
  /** Maximum slides per presentation */
  maxSlides: number;
  /** Maximum image slides per presentation */
  maxImageSlides: number;
  /** Enable AI image generation for image slides */
  enableImageGeneration: boolean;
  /** Maximum characters per slide content (triggers overflow warning) */
  maxCharsPerSlide: number;
  /** Maximum characters for description field */
  maxDescriptionLength: number;
  /** Branding settings */
  branding: {
    enabled: boolean;
    logoUrl?: string;
    organizationName?: string;
  };
}

// ============ Generation Result ============

export interface PptxResult {
  /** Generated file buffer */
  buffer: Buffer;
  /** Number of slides */
  slideCount: number;
  /** File size in bytes */
  fileSize: number;
  /** Number of successfully generated image slides */
  imageSlides: number;
  /** Number of failed image generations (fell back to text) */
  failedImages: number;
}

// ============ Tool Response ============

export interface PptxGenResponse {
  success: boolean;
  document?: {
    filename: string;
    fileSize: number;
    slideCount: number;
    downloadUrl: string;
  };
  imageGeneration?: {
    attempted: number;
    successful: number;
    failed: number;
  };
  imageGenDisabled?: boolean;
  imagesFallbackToText?: number;
  error?: string;
  errorCode?: string;
  suggestion?: string;
}
