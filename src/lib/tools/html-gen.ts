/**
 * HTML Generator Tool Definition
 *
 * Generates interactive, self-contained HTML pages from chat content.
 * Supports dashboards, books, reports, web pages, roadmaps, Gantt charts,
 * project plans, and playbooks.
 * Embeds Chart.js and Mermaid.js for charts and diagrams.
 *
 * This tool is separate from doc_gen to keep tool intent clean:
 * - html_gen -> web/interactive artifacts
 * - doc_gen -> PDF, DOCX, Markdown
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import { getToolConfig, TOOL_DEFAULTS } from '../db/compat/tool-config';
import { getEffectiveToolConfig, type BrandingConfig } from '../db/compat/category-tool-config';
import { generateHtml, type HtmlPageType } from '../docgen/html-builder';
import {
  getThreadContext,
  addThreadOutput,
  addWorkspaceOutput,
} from '@/lib/db/compat';
import { getRequestContext } from '../request-context';
import {
  getOutputDirectory,
  generateDocumentFilename,
  mergeBrandingConfigs,
} from '../docgen/branding';
import * as fs from 'fs';
import * as path from 'path';

// ============ Types ============

export type HtmlGenPageType = 'auto' | 'dashboard' | 'book' | 'report' | 'website' | 'playbook' | 'roadmap' | 'gantt' | 'project_plan';

function mapPageType(pageType: HtmlGenPageType): HtmlPageType | undefined {
  switch (pageType) {
    case 'dashboard':
      return 'dashboard';
    case 'book':
      return 'book';
    case 'report':
      return 'report';
    case 'website':
      return 'website';
    case 'playbook':
      return 'playbook';
    case 'roadmap':
      return 'roadmap';
    case 'gantt':
      return 'gantt';
    case 'project_plan':
      return 'project_plan';
    case 'auto':
    default:
      return undefined;
  }
}

export interface HtmlGenConfig {
  enabled: boolean;
  defaultPageType: HtmlGenPageType;
  branding: BrandingConfig;
  expirationDays: number;
  maxDocumentSizeMB: number;
  promptTemplate: string;
}

// ============ Default Prompt ============

const DEFAULT_HTML_PROMPT_LINES = [
  'Generate an interactive HTML page using the following guidelines based on the requested page_type:',
  '',
  '- auto: Use only when the user does not specify a concrete format. Prefer explicit page types for repeatable skill behavior.',
  '- dashboard: Create a Power BI-style analytical dashboard. Charts are interactive — users can hover for tooltips, see data labels, and click bars/slices to cross-filter other charts. Keep prose minimal — let the visuals tell the story. Layout has 5 zones: top title bar, KPI row, chart canvas (12-col grid), optional left filters rail, optional right data rail. Use the following fenced blocks (each must contain valid JSON). KPI tiles for the top row use ```kpi blocks (1-6 tiles recommended): {"label":"Revenue","value":"$2.4M","delta":"+12.4%","trend_direction":"positive","trend":[10,12,14,15,18,20],"tags":["region:north"]} where trend_direction is "positive"|"negative"|"neutral" and trend is an optional sparkline array. Chart panels use the standard ```chart block, optionally with "size":"hero"|"half"|"third"|"quarter" (defaults to half) and "tags":["category:sales"] for filterability. Optional filters rail uses a single ```filters block: {"title":"Filters","slicers":[{"id":"region","label":"Region","type":"multiselect","options":["North","South"],"tag_prefix":"region"}]} (slicer types: select, multiselect, search, daterange). Optional right data rail uses a single ```data block: {"title":"Details","items":[{"label":"Total Records","value":"1,284","note":"as of today"}],"table":{"headers":["Metric","Value"],"rows":[["Avg","42"]]}}. CROSS-FILTER DESIGN (critical): Charts that share the same x_field name automatically cross-filter each other when a user clicks a bar, slice, or point — non-matching data dims across all charts sharing that dimension. To design cross-filterable dashboards: (1) Use a consistent x_field name across charts that share a dimension (e.g. "region" in multiple charts means clicking "North" in one highlights "North" in all others). (2) Slicer tag_prefix should match the chart x_field name — e.g. tag_prefix "region" + options ["North","South"] will data-filter charts whose x_field is "region". (3) Data row values for x_field must match filter option strings exactly (case-insensitive). Example aligned chart+filter: chart has x_field:"region" with rows {"region":"North",...}, slicer has tag_prefix:"region" and options:["North","South"]. Tag conventions: tag_prefix on a slicer matches data-tags entries on charts/KPIs (intra-group OR, inter-group AND). Side rails are optional — only emit them when the user data benefits from filtering or detail views. Prefer Chart.js for quantitative visuals; use Mermaid for process/system visuals when charts are not suitable. DATA HANDLING RULES: (1) When the user provides raw tabular data (row-per-item spreadsheets), aggregate it into meaningful groups BEFORE placing data in chart blocks — never put more than 12 rows in a single chart data array. (2) If a metric requires matching data across two tables (e.g. budget grouped by theme when theme is in a register table and budget is in a cost table), compute the join result yourself and emit only the aggregated result as chart data. (3) All tag values and slicer options MUST be lowercase — e.g. tag "region:north", NOT "Region:North".',
  '- book: Create a structured HTML ebook with a cover page and numbered chapters. You MUST emit a single ```book fenced block containing valid JSON (schema below). The cover page is auto-generated from frontMatter. Each chapter has a title and sections with headings and markdown content.',
  '- report: Create a formal HTML report with a cover page, executive summary, and typed sections. You MUST emit a single ```report fenced block containing valid JSON (schema below). Section types control visual treatment: findings (blue), recommendations (green), analysis (purple), methodology (gray), background (amber).',
  '- website: Create a comprehensive front-end webpage mockup with header, hero, sections, and footer. Keep backend/API routes as stubs only.',
  '- playbook: Create an interactive government/organizational HTML playbook page. IMPORTANT heading contract: the tool title parameter is the page title; do not repeat the page title as content. In the content argument, use markdown heading syntax only for playbook structure: ## for each category/part/card, ### for each question/step/topic/accordion row inside a card, and #### only for lower-level details inside a topic. Do not use raw <h2>, <h3>, or <h4> HTML tags for playbook structure. Never put all content under a single ## Overview unless the user explicitly asks for a one-card overview. Avoid hard-coding phases or predefined sections unless the source content or user request explicitly includes them. Derive accent colors from branding.primaryColor or country/organization identity. Search bar in hero is mandatory.',
  '- roadmap: Create a Sun Ray Diagram — a visual strategic roadmap showing progression from Current State to Future State. You MUST emit a single ```roadmap fenced block containing valid JSON (schema below). Concentric arc bands (inner=current, outer=future) are divided by diagonal ray lines into segments representing strategic pillars.',
  '- gantt: Create an interactive Gantt chart with category filtering, legend, hover tooltips, and a today marker. You MUST emit a single ```gantt fenced block containing valid JSON (schema below). Do NOT use markdown headings or prose for the Gantt data — all task data goes inside the JSON block. Use today\'s actual date (you know the current date) as the reference for start_date and task dates.',
  '- project_plan: Same as gantt but also renders a KPI summary strip (total tasks, milestones, work streams, categories, timeline span) and a roll-up table grouped by work stream showing numeric counts. Use the same ```gantt JSON block format.',
  '',
  '═══ BOOK JSON block schema (use for book page type): ═══',
  '```book',
  '{',
  '  "frontMatter": {',
  '    "author": "Jane Doe",',
  '    "subtitle": "A comprehensive guide",',
  '    "publisher": "Acme Corp",',
  '    "edition": "1st Edition",',
  '    "abstract": "This book covers..."',
  '  },',
  '  "chapters": [',
  '    {',
  '      "title": "Getting Started",',
  '      "sections": [',
  '        { "heading": "Introduction", "content": "markdown content here..." },',
  '        { "heading": "Key Concepts", "content": "markdown content here..." }',
  '      ]',
  '    },',
  '    {',
  '      "title": "Advanced Topics",',
  '      "sections": [',
  '        { "heading": "Deep Dive", "content": "markdown content here..." }',
  '      ]',
  '    }',
  '  ]',
  '}',
  '```',
  '',
  'Book JSON field reference:',
  '- frontMatter: optional cover page metadata (author, subtitle, publisher, edition, abstract).',
  '- chapters: REQUIRED array of chapters. Each chapter has a title and optional sections array.',
  '- sections[].heading: section heading shown as h3.',
  '- sections[].content: markdown string (supports bold, italic, lists, tables, code blocks).',
  '',
  '═══ REPORT JSON block schema (use for report page type): ═══',
  '```report',
  '{',
  '  "metadata": {',
  '    "preparedFor": "Board of Directors",',
  '    "preparedBy": "Strategy Team",',
  '    "date": "May 2026",',
  '    "classification": "Internal",',
  '    "version": "1.0"',
  '  },',
  '  "executiveSummary": "markdown summary of key findings and recommendations...",',
  '  "sections": [',
  '    {',
  '      "heading": "Market Analysis",',
  '      "type": "findings",',
  '      "content": "markdown content..."',
  '    },',
  '    {',
  '      "heading": "Strategic Recommendations",',
  '      "type": "recommendations",',
  '      "content": "markdown content..."',
  '    }',
  '  ],',
  '  "appendices": [',
  '    { "title": "Data Sources", "content": "markdown content..." }',
  '  ]',
  '}',
  '```',
  '',
  'Report JSON field reference:',
  '- metadata: optional cover page metadata (preparedFor, preparedBy, date, classification, version).',
  '- executiveSummary: optional markdown string shown in a highlighted card before sections.',
  '- sections: REQUIRED array. Each section has heading, optional type, and content (markdown).',
  '- sections[].type: "findings"|"analysis"|"recommendations"|"methodology"|"background"|"content". Controls left-border color.',
  '- appendices: optional array of { title, content } shown after sections with A/B/C numbering.',
  '',
  '═══ ROADMAP JSON block schema (Sun Ray Diagram — use for roadmap page type): ═══',
  '```roadmap',
  '{',
  '  "topic": "Digital Transformation",',
  '  "subtitle": "Strategic Roadmap 2026-2030",',
  '  "currentState": "Manual processes, siloed data, legacy systems",',
  '  "futureState": "Fully automated, integrated platform, AI-driven insights",',
  '  "overallProgress": 35,',
  '  "bands": [',
  '    { "label": "Foundation" },',
  '    { "label": "Integration" },',
  '    { "label": "Automation" },',
  '    { "label": "Intelligence" },',
  '    { "label": "Innovation" }',
  '  ],',
  '  "rays": [',
  '    { "caption": "People & Culture", "description": "Team alignment and capability building", "status": "completed" },',
  '    { "caption": "Technology", "description": "Platform modernization and cloud migration", "status": "in-progress" },',
  '    { "caption": "Process", "description": "Workflow automation and optimization", "status": "planned" },',
  '    { "caption": "Data & Analytics", "description": "Unified data platform and AI insights", "status": "planned" }',
  '  ]',
  '}',
  '```',
  '',
  'Roadmap JSON field reference:',
  '- topic: REQUIRED. Central label shown at the origin of the sun ray diagram.',
  '- subtitle: optional subtitle shown in the header.',
  '- currentState: description of where the organization is today (shown at arc start).',
  '- futureState: description of the target end state (shown at arc end).',
  '- overallProgress: optional integer 0-100 shown as a progress ring in the header.',
  '- bands: REQUIRED array of concentric layers (inner=current, outer=future). 3-7 bands recommended.',
  '  Each band: { "label": "string", "color"?: "#hex" }. Colors auto-generated from branding if omitted.',
  '- rays: REQUIRED array of strategic pillars/themes (the diagonal segments). 3-6 rays recommended.',
  '  Each ray: { "caption": "string", "description"?: "string", "status"?: "completed"|"in-progress"|"planned" }.',
  '  Hover over any arc segment to see the ray description. Click to expand a detail card.',
  '',
  '═══ GANTT JSON block schema (use for both gantt and project_plan page types): ═══',
  '```gantt',
  '{',
  '  "title": "Optional chart title (can omit if page title is sufficient)",',
  '  "subtitle": "Optional subtitle or date range label",',
  '  "start_date": "2026-05-01",',
  '  "end_date": "2026-12-31",',
  '  "axis": "months",',
  '  "flag_colors": ["#CE1126", "#FCD116", "#009E60"],',
  '  "categories": [',
  '    { "id": "onboarding", "label": "Onboarding", "color": "#1f4e79" },',
  '    { "id": "training",   "label": "Training",   "color": "#2C5F7A" },',
  '    { "id": "champions",  "label": "Champions",  "color": "#5B2D8E" }',
  '  ],',
  '  "tasks": [',
  '    { "group": "Phase 1", "name": "Orientation",      "sub": "Week 1: team formation", "category": "onboarding", "start": "2026-05-04", "end": "2026-05-22", "type": "bar" },',
  '    { "group": "Phase 1", "name": "Onboarding session","sub": "Week 3: full-day",      "category": "onboarding", "start": "2026-05-18", "end": "2026-05-29", "type": "bar" },',
  '    { "group": "Phase 2", "name": "BA fundamentals",  "sub": "Self-paced with check-ins","category": "training", "start": "2026-06-01", "end": "2026-06-26", "type": "bar" },',
  '    { "group": "Phase 2", "name": "Launch milestone", "sub": "Go-live",                "category": "champions", "start": "2026-07-01", "type": "diamond", "detail": "Full platform go-live" }',
  '  ]',
  '}',
  '```',
  '',
  'Gantt JSON field reference:',
  '- start_date / end_date: ISO date strings (YYYY-MM-DD). Use the actual current year — do NOT default to 2024 or 2025.',
  '- axis: REQUIRED. Choose based on total project duration:',
  '    "weeks"  → project span ≤ 3 months (≤ ~90 days). Produces weekly columns.',
  '    "months" → project span 3–18 months. Produces monthly columns. USE THIS for most multi-month plans.',
  '    "dates"  → project span ≤ 2 weeks. Produces daily columns for short sprints only.',
  '  The renderer will auto-correct "weeks" to "months" if the span exceeds 6 months, but you should choose correctly upfront.',
  '- flag_colors: optional 3-color array for a decorative flag strip at the top (e.g. national flag colors). Omit if not relevant.',
  '- categories: array of { id, label, color? }. Define one category per work stream or role type. Colors are optional — branding.primaryColor is used as fallback.',
  '- tasks[].group: REQUIRED. Section/phase heading that groups rows visually. Must never be empty or null.',
  '- tasks[].name: REQUIRED. Task label shown in the left column.',
  '- tasks[].sub: optional subtitle shown below the name.',
  '- tasks[].category: REQUIRED. Must match a category id.',
  '- tasks[].start: REQUIRED. ISO date (YYYY-MM-DD), week token "W1"–"Wn", or month token "M1"–"Mn".',
  '- tasks[].end: ISO date, week token, or month token. OMIT for milestones (type: "diamond"). Required for type: "bar".',
  '- tasks[].type: REQUIRED. "bar" for duration tasks | "diamond" for point-in-time milestones.',
  '    IMPORTANT: Every milestone MUST have type: "diamond" and NO end field.',
  '    IMPORTANT: Every regular task MUST have type: "bar" and a valid end field.',
  '    Do NOT mix — a task without an end date will be auto-converted to a diamond.',
  '- tasks[].hatched: true for a hatched/striped bar (optional, indicates uncertainty or overlap).',
  '- tasks[].detail: hover tooltip text shown on bar/diamond hover (optional but recommended for project_plan).',
  '',
  'For charts, you MUST use a fenced ```chart block containing valid JSON. Do NOT emit raw <canvas>, <script>, or JavaScript.',
  '```chart',
  '{',
  '  "title": "Chart Title",',
  '  "data": [',
  '    {"category": "A", "value": 10},',
  '    {"category": "B", "value": 20}',
  '  ],',
  '  "x_field": "category",',
  '  "y_fields": ["value"],',
  '  "recommended_chart": "bar"',
  '}',
  '```',
  '',
  'Supported Chart.js stable chart types: bar, line, scatter, bubble, pie, doughnut, polarArea, radar.',
  'Area is represented as a filled line chart (recommended_chart: "area" maps to line+fill).',
  '',
  'For Mermaid diagrams, you MUST use a fenced ```mermaid block. Do NOT emit raw Mermaid text outside fences, and do NOT emit <script>, <div class="mermaid">, or <svg> tags directly.',
  '```mermaid',
  'flowchart TD',
  '  A["Start"] --> B["End"]',
  '```',
  '',
  'Supported mermaid diagrams in this generator: flowchart/graph, sequenceDiagram, mindmap, classDiagram, stateDiagram-v2/stateDiagram, erDiagram, userJourney, gantt, gitGraph, pie, requirementDiagram, c4Context, c4Container, c4Component, c4Dynamic, c4Deployment, timeline, block-beta/block, quadrantchart/quadrant, architecture-beta/architecture, sankey, packet-beta, zenuml.',
];

export const DEFAULT_HTML_PROMPT = DEFAULT_HTML_PROMPT_LINES.join('\n');

/**
 * Returns the html_gen function.description with today's date injected.
 * Called at request time so the LLM always knows the current date.
 */
export function getHtmlGenDescriptionWithDate(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const todayHuman = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const dateNote = `\n\nToday's date is ${todayHuman} (${today}). Use this as the reference when generating gantt/project_plan date ranges or any date-sensitive content.`;
  return htmlGenTool.definition!.function.description + dateNote;
}

// ============ Config Schema ============

const htmlGenConfigSchema = {
  type: 'object',
  properties: {
    defaultPageType: {
      type: 'string',
      title: 'Default Page Type',
      description: 'Default page layout when not specified',
      enum: ['auto', 'dashboard', 'book', 'report', 'website', 'playbook', 'roadmap', 'gantt', 'project_plan'],
      default: 'auto',
    },

    promptTemplate: {
      type: 'string',
      title: 'HTML Generation Prompt Template',
      description: 'Internal guidance used for HTML generation. Custom values replace the default guidance.',
      default: DEFAULT_HTML_PROMPT,
    },
    branding: {
      type: 'object',
      title: 'Branding Settings',
      description: 'Page branding configuration',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enable Branding',
          description: 'Add organization branding to HTML pages',
          default: false,
        },
        logoUrl: {
          type: 'string',
          title: 'Logo URL',
          description: 'URL or data URL of organization logo',
          default: '',
        },
        organizationName: {
          type: 'string',
          title: 'Organization Name',
          description: 'Name displayed in page header',
          default: '',
        },
        primaryColor: {
          type: 'string',
          title: 'Primary Color',
          description: 'Primary color for headings and accents (hex)',
          pattern: '^#[0-9A-Fa-f]{6}$',
          default: '#003366',
        },
        fontFamily: {
          type: 'string',
          title: 'Font Family',
          description: 'Primary font for page text',
          default: 'Segoe UI, Arial, sans-serif',
        },
      },
    },
    expirationDays: {
      type: 'number',
      title: 'Page Expiration (days)',
      description: 'Days until generated HTML pages expire (0 = never)',
      minimum: 0,
      maximum: 365,
      default: 30,
    },
    maxDocumentSizeMB: {
      type: 'number',
      title: 'Max Page Size (MB)',
      description: 'Maximum generated HTML page size',
      minimum: 1,
      maximum: 100,
      default: 50,
    },
  },
};

// ============ Validation ============

function validateHtmlGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  const validPageTypes = ['auto', 'dashboard', 'book', 'report', 'website', 'playbook', 'roadmap', 'gantt', 'project_plan'];


  if (config.promptTemplate !== undefined && typeof config.promptTemplate !== 'string') {
    errors.push('promptTemplate must be a string');
  }
  if (config.defaultPageType && !validPageTypes.includes(config.defaultPageType as string)) {
    errors.push(`defaultPageType must be one of: ${validPageTypes.join(', ')}`);
  }

  if (config.branding) {
    const branding = config.branding as Record<string, unknown>;
    if (branding.primaryColor && !/^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor as string)) {
      errors.push('branding.primaryColor must be a valid hex color (e.g., #003366)');
    }
    if (branding.logoUrl && typeof branding.logoUrl !== 'string') {
      errors.push('branding.logoUrl must be a string');
    }
    if (branding.organizationName && typeof branding.organizationName !== 'string') {
      errors.push('branding.organizationName must be a string');
    }
  }

  if (config.expirationDays !== undefined) {
    const days = config.expirationDays as number;
    if (typeof days !== 'number' || days < 0 || days > 365) {
      errors.push('expirationDays must be a number between 0 and 365');
    }
  }

  if (config.maxDocumentSizeMB !== undefined) {
    const size = config.maxDocumentSizeMB as number;
    if (typeof size !== 'number' || size < 1 || size > 100) {
      errors.push('maxDocumentSizeMB must be a number between 1 and 100');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const htmlGenTool: ToolDefinition = {
  name: 'html_gen',
  displayName: 'HTML Generator',
  description:
    'Generate interactive, self-contained HTML pages (dashboards, books, reports, roadmaps, Gantt charts, project plans, websites, playbooks) with Chart.js charts, Mermaid diagrams, TOC sidebar, and search.',

  category: 'autonomous',

  definition: {
    type: 'function' as const,
    function: {
      name: 'html_gen',
      description: [
        'Generate an interactive HTML page from content. Use this tool when the user explicitly asks to create, export, download, or save an HTML web page, HTML dashboard, HTML book, HTML report, HTML roadmap, or any interactive HTML artifact with charts and/or diagrams.',
        '',
        'Do NOT use for PDF, Word, or Markdown documents (use doc_gen instead).',
        'Do NOT use for regular responses - only when explicitly requested.',
        '',
        'The generated HTML page will be displayed automatically in the chat with a download button.',
        '',
        'Guidelines for content by page_type:',
        '- auto: use only when user does not explicitly choose a format; otherwise use an explicit page_type.',
        '- dashboard: Power BI-style 5-zone layout (title bar, KPI row, chart canvas, optional left filters rail, optional right data rail). Use ```kpi blocks for top KPI tiles, ```chart blocks for canvas panels, one ```filters block for the left rail, and one ```data block for the right rail. Keep prose minimal.',
        '- book: Structured HTML ebook with cover page and numbered chapters. MUST use a ```book JSON block with frontMatter and chapters array. Each chapter has sections with heading and markdown content.',
        '- report: Formal HTML report with cover page, executive summary, and typed sections. MUST use a ```report JSON block with metadata, executiveSummary, sections (with type: findings|recommendations|analysis|methodology|background), and optional appendices.',
        '- website: comprehensive frontend webpage mockup (header, hero, sections, footer), backend APIs as stubs only.',
        '- playbook: interactive government/organizational HTML playbook with sticky top bar, hero search bar, accordion section cards from ## headings, topic rows from ### headings. The title argument is the page title; do not duplicate it in content.',
        '- roadmap: Sun Ray Diagram — visual strategic roadmap showing Current State → Future State. MUST use a ```roadmap JSON block with topic, bands (concentric layers), and rays (strategic pillars). Hover over segments for details, click to expand cards.',
        '- gantt: interactive Gantt chart with category filtering, legend, hover tooltips, and today marker. MUST use a ```gantt JSON block.',
        '- project_plan: same as gantt but adds a KPI summary strip and roll-up table grouped by work stream.',
        '',
        'IMPORTANT: All charts and diagrams MUST be inside fenced code blocks.',
        '',
        'For charts, you MUST use a fenced ```chart block containing valid JSON. Do NOT emit raw <canvas>, <script>, or JavaScript.',
        '```chart',
        '{',
        '  "title": "Chart Title",',
        '  "data": [{"category": "A", "value": 10}],',
        '  "x_field": "category",',
        '  "y_fields": ["value"],',
        '  "recommended_chart": "bar"',
        '}',
        '```',
        '',
        'Supported Chart.js stable chart types: bar, line, scatter, bubble, pie, doughnut, polarArea, radar. Use area as a filled line chart.',
        '',
        'For Mermaid diagrams, you MUST use a fenced ```mermaid block. Do NOT emit raw Mermaid text outside fences.',
        '```mermaid',
        'flowchart TD',
        '  A["Start"] --> B["End"]',
        '```',
        '',
        'Supported Mermaid types in this generator: flowchart/graph, sequenceDiagram, mindmap, classDiagram, stateDiagram-v2/stateDiagram, erDiagram, userJourney, gantt, gitGraph, pie, requirementDiagram, c4Context, c4Container, c4Component, c4Dynamic, c4Deployment, timeline, block-beta/block, quadrantchart/quadrant, architecture-beta/architecture, sankey, packet-beta, zenuml.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Page title (appears as the main heading and browser tab title)',
          },
          content: {
            type: 'string',
            description: 'Page content in markdown format. May include chart, mermaid, book, report, roadmap, gantt, kpi, filters, data, and playbook fenced blocks. Include all relevant information the user wants in the page.',
          },
          page_type: {
            type: 'string',
            enum: ['auto', 'dashboard', 'book', 'report', 'website', 'playbook', 'roadmap', 'gantt', 'project_plan'],
            description: 'Page layout type. auto = infer from content/title. dashboard = Power BI-style analytical dashboard with chart grid. book = structured HTML ebook with cover page, numbered chapters, and TOC — use a ```book JSON block. report = formal HTML report with cover page, executive summary, and typed sections — use a ```report JSON block. website = comprehensive frontend webpage mockup with header/hero/sections/footer. playbook = interactive organizational HTML playbook with sticky top bar, hero search bar, and accordion section cards. roadmap = Sun Ray Diagram showing strategic transformation from Current State to Future State — use a ```roadmap JSON block with bands and rays. gantt = interactive Gantt chart with category filtering, legend, hover tooltips, and today marker — use a ```gantt JSON block. project_plan = same as gantt but adds a KPI summary strip and roll-up table grouped by work stream.',
          },

        },
        required: ['title', 'content'],
      },
    },
  },

  validateConfig: validateHtmlGenConfig,

  defaultConfig: TOOL_DEFAULTS.html_gen?.config || {
    defaultPageType: 'auto',
    branding: {
      enabled: false,
      logoUrl: '',
      organizationName: '',
      primaryColor: '#003366',
      fontFamily: 'Segoe UI, Arial, sans-serif',
    },
    expirationDays: 30,
    maxDocumentSizeMB: 50,
    promptTemplate: DEFAULT_HTML_PROMPT,
  },

  configSchema: htmlGenConfigSchema,

  execute: async (args: {
    title: string;
    content: string;
    page_type?: HtmlGenPageType;
  }): Promise<string> => {
    try {
      const context = getRequestContext();
      const { threadId, categoryIds } = context;
      const categoryId = categoryIds?.[0];

      if (!threadId) {
        return JSON.stringify({
          error: 'HTML generation requires an active chat thread',
          errorCode: 'NO_CONTEXT',
        });
      }

      // Guard against oversized content
      const MAX_CONTENT_CHARS = 200_000;
      if (args.content && args.content.length > MAX_CONTENT_CHARS) {
        return JSON.stringify({
          error: `Content too large (${args.content.length} chars). Maximum is ${MAX_CONTENT_CHARS}.`,
          errorCode: 'CONTENT_TOO_LARGE',
        });
      }

      // Fix unclosed code fences
      if (args.content) {
        const codeFences = (args.content.match(/^```/gm) || []).length;
        if (codeFences % 2 !== 0) {
          console.warn('[HtmlGen] Odd number of code fences detected — auto-closing.');
          args.content = args.content + '\n```';
        }
      }

      // Get tool configuration
      const toolConfig = await getToolConfig('html_gen');
      const config = (toolConfig?.config || TOOL_DEFAULTS.html_gen?.config || {}) as Record<string, unknown>;

      if (!toolConfig?.isEnabled && !(TOOL_DEFAULTS.html_gen?.enabled ?? true)) {
        return JSON.stringify({
          error: 'HTML generation is currently disabled',
          errorCode: 'TOOL_DISABLED',
        });
      }

      const htmlGenConfig: HtmlGenConfig = {
        enabled: toolConfig?.isEnabled ?? TOOL_DEFAULTS.html_gen?.enabled ?? true,
        defaultPageType: (config.defaultPageType as HtmlGenPageType) || 'auto',
        branding: (config.branding as BrandingConfig) || {
          enabled: false,
          logoUrl: '',
          organizationName: '',
          primaryColor: '#003366',
          fontFamily: 'Segoe UI, Arial, sans-serif',
        },
        expirationDays: (config.expirationDays as number) || 30,
        maxDocumentSizeMB: (config.maxDocumentSizeMB as number) || 50,
        promptTemplate: (config.promptTemplate as string) || DEFAULT_HTML_PROMPT,
      };

      // Resolve branding with category overrides
      let categoryBranding: Partial<BrandingConfig> | null = null;
      if (categoryId) {
        const effective = await getEffectiveToolConfig('html_gen', categoryId);
        categoryBranding = effective.branding;
      }
      const branding = mergeBrandingConfigs(htmlGenConfig.branding, categoryBranding);

      // Determine page type
      const requestedPageType = args.page_type || htmlGenConfig.defaultPageType;
      const explicitPageType = mapPageType(requestedPageType);

      // Generate HTML
      const htmlResult = await generateHtml({
        title: args.title,
        content: args.content,
        branding,
        metadata: {
          author: branding.organizationName || undefined,
          date: new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
        },
        pageType: explicitPageType,
      });

      // Check file size limit
      const fileSizeMB = htmlResult.buffer.length / (1024 * 1024);
      if (fileSizeMB > htmlGenConfig.maxDocumentSizeMB) {
        return JSON.stringify({
          error: `Generated HTML page (${fileSizeMB.toFixed(2)} MB) exceeds maximum size limit (${htmlGenConfig.maxDocumentSizeMB} MB)`,
          errorCode: 'SIZE_EXCEEDED',
        });
      }

      // Save to disk
      const filename = generateDocumentFilename(args.title, 'html', threadId);
      const outputDir = getOutputDirectory();
      const filepath = path.join(outputDir, filename);
      fs.writeFileSync(filepath, htmlResult.buffer);

      const expiresAt =
        htmlGenConfig.expirationDays > 0
          ? new Date(Date.now() + htmlGenConfig.expirationDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

      // Validate thread context
      const threadContext = await getThreadContext(threadId);
      if (!threadContext.exists) {
        console.error('[HtmlGen] Thread not found:', threadId);
        return JSON.stringify({
          error: 'Thread not found - cannot save generated HTML',
          errorCode: 'THREAD_NOT_FOUND',
        });
      }

      const generationConfig = JSON.stringify({
        title: args.title,
        pageType: htmlResult.pageType,
        branding: branding.enabled
          ? {
              organizationName: branding.organizationName,
              primaryColor: branding.primaryColor,
            }
          : null,
        chartCount: htmlResult.chartCount,
        diagramCount: htmlResult.diagramCount,
      });

      let docId: number;
      let downloadUrlPrefix: string;

      if (threadContext.isWorkspace) {
        const wsResult = await addWorkspaceOutput(
          threadContext.workspaceId!,
          threadContext.sessionId!,
          threadContext.actualThreadId ?? null,
          filename,
          filepath,
          'html',
          htmlResult.buffer.length,
          generationConfig,
          expiresAt
        );
        docId = wsResult.id;
        downloadUrlPrefix = '/api/workspace-documents';
      } else {
        const outputResult = await addThreadOutput(
          threadId,
          null,
          filename,
          filepath,
          'html',
          htmlResult.buffer.length,
          generationConfig,
          expiresAt
        );
        docId = outputResult.id;
        downloadUrlPrefix = '/api/documents';
      }

      return JSON.stringify({
        success: true,
        message: 'HTML page generated successfully. Do NOT call html_gen again unless the user explicitly requests another page.',
        document: {
          id: docId,
          filename,
          fileType: 'html',
          fileSize: htmlResult.buffer.length,
          fileSizeFormatted: formatFileSize(htmlResult.buffer.length),
          downloadUrl: `${downloadUrlPrefix}/${docId}/download`,
          pageType: htmlResult.pageType,
          chartCount: htmlResult.chartCount,
          diagramCount: htmlResult.diagramCount,
          expiresAt,
        },
      });
    } catch (error) {
      console.error('[HtmlGen] Generation error:', error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error during HTML generation',
        errorCode: 'GENERATION_ERROR',
      });
    }
  },
};

// ============ Convenience Functions ============

export async function getHtmlGenConfig(): Promise<HtmlGenConfig> {
  const toolConfig = await getToolConfig('html_gen');
  const config = (toolConfig?.config || TOOL_DEFAULTS.html_gen?.config || {}) as Record<string, unknown>;

  return {
    enabled: toolConfig?.isEnabled ?? TOOL_DEFAULTS.html_gen?.enabled ?? true,
    defaultPageType: (config.defaultPageType as HtmlGenPageType) || 'auto',
    branding: (config.branding as BrandingConfig) || {
      enabled: false,
      logoUrl: '',
      organizationName: '',
      primaryColor: '#003366',
      fontFamily: 'Segoe UI, Arial, sans-serif',
    },
    expirationDays: (config.expirationDays as number) || 30,
    maxDocumentSizeMB: (config.maxDocumentSizeMB as number) || 50,
    promptTemplate: (config.promptTemplate as string) || DEFAULT_HTML_PROMPT,
  };
}

export async function isHtmlGenEnabled(): Promise<boolean> {
  const toolConfig = await getToolConfig('html_gen');
  return toolConfig?.isEnabled ?? TOOL_DEFAULTS.html_gen?.enabled ?? true;
}

// ============ Helpers ============

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
