/**
 * HTML Builder - Generate self-contained HTML pages
 *
 * Supports multiple page types:
 * - dashboard: Charts and diagrams in a grid layout
 * - documentation: TOC sidebar, search, navigation
 * - chart: Single or few charts
 * - webpage: General purpose HTML page
 *
 * Embeds Chart.js (charts) and Mermaid.js (diagrams) as inline scripts from local vendor files.
 * This makes generated HTML self-contained — no CDN dependencies at view time.
 * Imports sanitizeMermaidCode from diagram-gen/validator for quality parity.
 */

import * as fs from 'fs';
import * as path from 'path';
import { sanitizeMermaidCode } from '../diagram-gen/validator';
import type { BrandingConfig } from './branding';
import type { DisclaimerConfig } from '../disclaimer';

// ============ Types ============

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

interface MarkdownSegment {
  type: 'markdown';
  content: string;
}

interface ChartSegment {
  type: 'chart';
  config: ChartBlockConfig;
  raw: string;
}

interface DiagramSegment {
  type: 'mermaid';
  code: string;
  diagramType: string;
}

type ContentSegment = MarkdownSegment | ChartSegment | DiagramSegment;

interface ChartBlockConfig {
  title?: string;
  data: Record<string, unknown>[];
  x_field: string;
  y_fields: string[];
  recommended_chart?: string;
  series_mode?: 'grouped' | 'stacked' | 'auto';
  notes?: string;
}

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

// ============ Constants ============

// Same palette as DataVisualization.tsx
const CHART_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

// Supported Mermaid types for HTML output (aligned with MermaidDiagram.tsx and diagram_gen)
const SUPPORTED_MERMAID_TYPES = new Set([
  'flowchart', 'graph', 'mindmap', 'sequencediagram',
  'c4context', 'c4container', 'c4component', 'c4dynamic', 'c4deployment',
  'classdiagram', 'statediagram', 'statediagram-v2',
  'erdiagram', 'userjourney', 'gantt', 'gitgraph',
  'pie', 'requirementdiagram', 'timeline', 'block-beta', 'block',
  'quadrantchart', 'quadrant', 'architecture-beta', 'architecture',
  'sankey', 'packet-beta', 'zenuml',
]);

// ============ Inline Vendor Bundles ============

/**
 * Read a vendor bundle from the local public/vendor directory, falling back to node_modules.
 * This makes generated HTML self-contained — no CDN dependencies at view time.
 *
 * Tries multiple likely paths for robustness across package versions.
 */
function readVendorBundle(packageName: string, vendorFileName: string, relativePaths: string[]): string | null {
  const appRoot = process.env.APP_ROOT ?? process.cwd();
  const candidatePaths = [
    path.join(appRoot, 'public', 'vendor', vendorFileName),
    ...relativePaths.map((relativePath) => path.join(appRoot, 'node_modules', packageName, relativePath)),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
}

/**
 * Build inline <script> blocks for Chart.js and Mermaid from local vendor bundles.
 * Falls back to HTML comments (not CDN) so missing bundles are visible, not silent.
 */
function buildVendorScripts(): string {
  const chartJsBundle = readVendorBundle('chart.js', 'chart.umd.min.js', [
    'dist/chart.umd.min.js',
    'dist/chart.umd.js',
  ]);
  const mermaidBundle = readVendorBundle('mermaid', 'mermaid.min.js', [
    'dist/mermaid.min.js',
    'dist/mermaid.js',
  ]);

  const scripts: string[] = [];

  if (chartJsBundle) {
    scripts.push(`<script>\n${chartJsBundle}\n</script>`);
  } else {
    scripts.push('<!-- Chart.js bundle not found: charts will show a fallback message. Run: npm install -->');
  }

  if (mermaidBundle) {
    scripts.push(`<script>\n${mermaidBundle}\n</script>`);
  } else {
    scripts.push('<!-- Mermaid bundle not found: diagrams will show a text fallback. Run: npm install -->');
  }

  return scripts.join('\n');
}

// ============ Content Parser ============

/**
 * Parse markdown content into typed segments
 */
/**
 * Detect if a bare line starts a Mermaid diagram block (not inside fences).
 * Matches common diagram type declarations.
 */
function isBareMermaidStartLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  // Match flowchart/graph variants, sequenceDiagram, etc.
  const bareMermaidPatterns = [
    /^(flowchart|graph)\b/,
    /^sequencediagram\b/,
    /^mindmap\b/,
    /^statediagram(-v2)?\b/,
    /^erdiagram\b/,
    /^userjourney\b/,
    /^gantt\b/,
    /^gitgraph\b/,
    /^pie\b/,
    /^requirementdiagram\b/,
    /^c4(context|container|component|dynamic|deployment)\b/,
    /^classdiagram\b/,
    /^timeline\b/,
    /^block(-beta)?\b/,
    /^quadrant(chart)?\b/,
    /^architecture(-beta)?\b/,
    /^sankey\b/,
    /^packet-beta\b/,
    /^zenuml\b/,
  ];
  return bareMermaidPatterns.some(p => p.test(trimmed));
}

/**
 * Collect a bare Mermaid block starting at index `start`.
 * Collects until:
 * - a blank line followed by non-indented prose/heading
 * - a markdown heading line
 * - another fenced block start
 * - EOF
 */
function collectBareMermaidBlock(lines: string[], start: number): { block: string[]; endIndex: number } {
  const block: string[] = [lines[start]];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    // Stop at a markdown heading
    if (/^#{1,6}\s+/.test(line)) break;
    // Stop at a fenced block start
    if (/^```/.test(line)) break;
    // If blank line and next line is not indented, stop
    if (line.trim() === '') {
      if (i + 1 < lines.length && !/^\s/.test(lines[i + 1])) break;
      block.push(line);
      i++;
      continue;
    }
    block.push(line);
    i++;
  }
  return { block, endIndex: i };
}

function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const lines = content.split('\n');
  let i = 0;
  let currentMarkdown: string[] = [];

  function flushMarkdown() {
    if (currentMarkdown.length > 0) {
      segments.push({ type: 'markdown', content: currentMarkdown.join('\n') });
      currentMarkdown = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Detect fenced code blocks
    const fenceMatch = line.match(/^```(\w+)?\s*$/);
    if (fenceMatch) {
      flushMarkdown();
      const lang = (fenceMatch[1] || '').toLowerCase();

      // Collect block content until closing fence
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        blockLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence

      const blockContent = blockLines.join('\n');

      if (lang === 'chart') {
        try {
          const config = JSON.parse(blockContent) as ChartBlockConfig;
          // Validate chart config has required fields for Chart.js
          if (Array.isArray(config.data) && config.x_field && Array.isArray(config.y_fields) && config.y_fields.length > 0) {
            segments.push({ type: 'chart', config, raw: blockContent });
          } else {
            // Invalid config — treat as markdown code block
            currentMarkdown.push('```chart\n' + blockContent + '\n```');
          }
        } catch {
          // Invalid JSON — treat as markdown code block
          currentMarkdown.push('```chart\n' + blockContent + '\n```');
        }
      } else if (lang === 'mermaid') {
        const sanitized = sanitizeMermaidCode(blockContent);
        const firstLine = sanitized.trim().split('\n')[0].toLowerCase().replace(/\s+/g, '');
        const isSupported = Array.from(SUPPORTED_MERMAID_TYPES).some(t => firstLine.startsWith(t));
        if (isSupported) {
          const diagramType = detectMermaidType(sanitized);
          segments.push({ type: 'mermaid', code: sanitized, diagramType });
        } else {
          // Unsupported type — render as code block
          currentMarkdown.push('```mermaid\n' + blockContent + '\n```');
        }
      } else {
        // Other code blocks — pass through as markdown
        currentMarkdown.push('```' + (lang || '') + '\n' + blockContent + '\n```');
      }
      continue;
    }

    // Detect bare Mermaid blocks (not inside fences)
    if (isBareMermaidStartLine(line)) {
      flushMarkdown();
      const { block, endIndex } = collectBareMermaidBlock(lines, i);
      const rawCode = block.join('\n');
      const sanitized = sanitizeMermaidCode(rawCode);
      const firstLine = sanitized.trim().split('\n')[0].toLowerCase().replace(/\s+/g, '');
      const isSupported = Array.from(SUPPORTED_MERMAID_TYPES).some(t => firstLine.startsWith(t));
      if (isSupported) {
        const diagramType = detectMermaidType(sanitized);
        segments.push({ type: 'mermaid', code: sanitized, diagramType });
      } else {
        // Unsupported — render as code block
        currentMarkdown.push('```mermaid\n' + rawCode + '\n```');
      }
      i = endIndex;
      continue;
    }

    currentMarkdown.push(line);
    i++;
  }

  // Flush remaining markdown
  flushMarkdown();

  return segments;
}

/**
 * Detect Mermaid diagram type from code
 */
function detectMermaidType(code: string): string {
  const first = code.trim().split('\n')[0].toLowerCase();
  if (first.startsWith('flowchart') || first.startsWith('graph')) return 'flowchart';
  if (first.startsWith('sequencediagram')) return 'sequence';
  if (first.startsWith('mindmap')) return 'mindmap';
  if (first.startsWith('statediagram-v2') || first.startsWith('statediagram')) return 'stateDiagram';
  if (first.startsWith('erdiagram')) return 'erDiagram';
  if (first.startsWith('userjourney')) return 'userJourney';
  if (first.startsWith('gantt')) return 'gantt';
  if (first.startsWith('gitgraph')) return 'gitGraph';
  if (first.startsWith('pie')) return 'pie';
  if (first.startsWith('requirementdiagram')) return 'requirementDiagram';
  if (first.startsWith('c4context')) return 'c4-context';
  if (first.startsWith('c4container')) return 'c4-container';
  if (first.startsWith('c4component')) return 'c4-component';
  if (first.startsWith('classdiagram')) return 'classDiagram';
  return 'unknown';
}

/**
 * Detect page type from content segments and title
 */
function detectPageType(segments: ContentSegment[], title: string): HtmlPageType {
  const chartCount = segments.filter(s => s.type === 'chart').length;
  const diagramCount = segments.filter(s => s.type === 'mermaid').length;
  const markdownSegments = segments.filter(s => s.type === 'markdown');

  // Count headings in markdown
  const headingCount = markdownSegments.reduce((count, seg) => {
    const matches = (seg as MarkdownSegment).content.match(/^#{2,3}\s/gm);
    return count + (matches?.length || 0);
  }, 0);

  const titleLower = title.toLowerCase();

  // Dashboard: multiple charts, few headings
  if (chartCount >= 2 && headingCount <= 3) return 'dashboard';

  // Documentation: many headings
  if (headingCount >= 3) return 'documentation';

  // Chart: primarily charts
  if (chartCount >= 1 && diagramCount === 0 && headingCount <= 1) return 'chart';

  // Check title keywords
  if (/dashboard|analytics|metrics|kpi/i.test(titleLower)) return 'dashboard';
  if (/doc|guide|manual|reference|wiki|readme/i.test(titleLower)) return 'documentation';
  if (/report|formal report|annual report|status report|assessment/i.test(titleLower)) return 'report';
  if (/book|ebook|chapter|volume/i.test(titleLower)) return 'book';

  return 'webpage';
}

// ============ Table of Contents ============

/**
 * Extract TOC entries from markdown segments
 */
function extractToc(segments: ContentSegment[]): TocEntry[] {
  const toc: TocEntry[] = [];
  const idCounts: Record<string, number> = {};

  for (const seg of segments) {
    if (seg.type !== 'markdown') continue;
    const lines = (seg as MarkdownSegment).content.split('\n');
    for (const line of lines) {
      const match = line.match(/^(#{2,4})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        let id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (idCounts[id]) {
          idCounts[id]++;
          id = `${id}-${idCounts[id]}`;
        } else {
          idCounts[id] = 1;
        }
        toc.push({ level, text, id });
      }
    }
  }

  return toc;
}

// ============ Markdown to HTML ============

/**
 * Convert markdown to HTML (server-side, no external deps)
 */
function markdownToHtml(md: string): string {
  let html = md;

  // Headings with anchor IDs
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, text) => {
    const level = hashes.length;
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h${level} id="${id}">${escapeHtml(text)}</h${level}>`;
  });

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Code blocks (non-chart/mermaid — already handled)
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/((?:^[-*+]\s+.+\n?)+)/gm, (match) => {
    const items = match.trim().split('\n').map(line =>
      `<li>${line.replace(/^[-*+]\s+/, '')}</li>`
    ).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\.\s+.+\n?)+)/gm, (match) => {
    const items = match.trim().split('\n').map(line =>
      `<li>${line.replace(/^\d+\.\s+/, '')}</li>`
    ).join('');
    return `<ol>${items}</ol>`;
  });

  // Tables
  html = html.replace(/(\|.+\|\n\|[-:| ]+\|\n(?:\|.+\|\n?)+)/g, (match) => {
    const rows = match.trim().split('\n');
    const header = rows[0].split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const body = rows.slice(2).map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
  });

  // Paragraphs (double newline)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<h[1-6])/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul|<ol|<table|<blockquote|<pre|<hr)/g, '$1');
  html = html.replace(/(<\/ul>|<\/ol>|<\/table>|<\/blockquote>|<\/pre>)<\/p>/g, '$1');

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '\x26amp;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;')
    .replace(/"/g, '\x26quot;')
    .replace(/'/g, '\x26#39;');
}

// ============ Chart.js Config Builder ============

/**
 * Build Chart.js configuration from chart block config
 */
function buildChartJsConfig(config: ChartBlockConfig, chartId: string): string {
  const chartType = resolveChartType(config);
  const colors = CHART_COLORS;

  if (chartType === 'pie' || chartType === 'doughnut') {
    return buildPieChartConfig(config, chartType, colors);
  }

  return buildCartesianChartConfig(config, chartType, colors, chartId);
}

function resolveChartType(config: ChartBlockConfig): string {
  const rec = config.recommended_chart;
  if (!rec || rec === 'auto') return autoSelectChartType(config);
  if (rec === 'area') return 'line'; // Chart.js uses 'line' with fill for area
  return rec;
}

function autoSelectChartType(config: ChartBlockConfig): string {
  if (!config.data || config.data.length === 0) return 'bar';
  const xVal = config.data[0][config.x_field];
  const isDate = /date|time|year|month|day|week/i.test(config.x_field) ||
    (typeof xVal === 'string' && !isNaN(Date.parse(xVal as string)));
  if (isDate) return 'line';
  const unique = new Set(config.data.map(d => d[config.x_field])).size;
  if (unique >= 2 && unique <= 8 && config.data.length <= 20 && config.y_fields.length === 1) return 'pie';
  return 'bar';
}

function buildPieChartConfig(config: ChartBlockConfig, chartType: string, colors: string[]): string {
  const labels = config.data.map(d => String(d[config.x_field] ?? ''));
  const values = config.data.map(d => Number(d[config.y_fields[0]] ?? 0));
  return JSON.stringify({
    type: chartType,
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, values.length),
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        title: { display: !!config.title, text: config.title || '' },
      },
    },
  });
}

function buildCartesianChartConfig(
  config: ChartBlockConfig,
  chartType: string,
  colors: string[],
  _chartId: string
): string {
  const labels = config.data.map(d => String(d[config.x_field] ?? ''));
  const isArea = config.recommended_chart === 'area';
  const isStacked = config.series_mode === 'stacked' ||
    (config.series_mode === 'auto' && config.y_fields.length > 1);

  const datasets = config.y_fields.map((field, i) => {
    const color = colors[i % colors.length];
    const base: Record<string, unknown> = {
      label: field,
      data: config.data.map(d => Number(d[field] ?? 0)),
      backgroundColor: chartType === 'bar' ? color : color + '40',
      borderColor: color,
      borderWidth: 2,
    };
    if (isArea) base.fill = true;
    if (chartType === 'line') base.tension = 0.3;
    return base;
  });

  return JSON.stringify({
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: config.y_fields.length > 1 },
        title: { display: !!config.title, text: config.title || '' },
      },
      scales: {
        x: { stacked: isStacked },
        y: { stacked: isStacked, beginAtZero: true },
      },
    },
  });
}

// ============ HTML Segment Renderers ============

let chartCounter = 0;
let diagramCounter = 0;

function renderChartSegment(seg: ChartSegment): string {
  chartCounter++;
  const id = `chart-${chartCounter}`;
  const chartConfig = buildChartJsConfig(seg.config, id);
  const encodedConfig = Buffer.from(chartConfig, 'utf-8').toString('base64');
  const notesHtml = seg.config.notes
    ? `<details class="chart-notes"><summary>Notes</summary><p>${escapeHtml(seg.config.notes)}</p></details>`
    : '';
  return `
<div class="chart-card">
  ${seg.config.title ? `<h4 class="chart-title">${escapeHtml(seg.config.title)}</h4>` : ''}
  <div class="chart-container" data-chart-wrapper="true">
    <canvas id="${id}" data-chart-config="${encodedConfig}"></canvas>
  </div>
  ${notesHtml}
</div>`;
}

function renderDiagramSegment(seg: DiagramSegment): string {
  diagramCounter++;
  // Encode Mermaid source safely using base64 to avoid HTML parsing corruption
  const encodedSource = Buffer.from(seg.code, 'utf-8').toString('base64');
  return `
<div class="diagram-card">
  <div class="mermaid" data-mermaid-source="${encodedSource}">
    <pre style="color:#6b7280;font-size:12px;">Loading diagram...</pre>
  </div>
</div>`;
}

function renderSegments(segments: ContentSegment[]): string {
  return segments.map(seg => {
    if (seg.type === 'markdown') return markdownToHtml((seg as MarkdownSegment).content);
    if (seg.type === 'chart') return renderChartSegment(seg as ChartSegment);
    if (seg.type === 'mermaid') return renderDiagramSegment(seg as DiagramSegment);
    return '';
  }).join('\n');
}

// ============ Playbook Structure ============
// Hierarchy: ## heading → Part card   |   ### heading → Accordion topic row

interface PlaybookTopic {
  id: string;
  title: string;
  subtitle: string;
  bodyHtml: string;
  keywords: string;
}

interface PlaybookPart {
  partLabel: string;
  title: string;
  id: string;
  accentColor: string;
  introHtml: string;  // Content that appears directly under the part heading (before any topics)
  topics: PlaybookTopic[];
}

/** Map of part-label prefixes to accent colours (can be extended per-country). */
const PART_ACCENT_COLORS = [
  '#007A5E', // green
  '#00247D', // blue
  '#FCD116', // yellow
  '#C8102E', // red
  '#009B3A', // green
  '#4D8CC4', // blue
];

/**
 * Convert "About Digital Government for Resilience" → "ABOUT DIGITAL GOVERNMENT FOR RESILIENCE"
 */
function toUpperHeading(text: string): string {
  return text.toUpperCase().replace(/\bFOR\b/g, 'FOR').replace(/\bAND\b/g, 'AND');
}

/**
 * Derive a short subtitle from body lines (first non-empty line or 120-char truncation).
 */
function deriveSubtitle(bodyLines: string[]): string {
  const raw = bodyLines.join('\n').trim();
  if (!raw) return '';
  const html = markdownToHtml(raw);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 120) return text;
  return text.substring(0, 120).replace(/\s\S+$/, '') + '…';
}

/**
 * Normalize embedded HTML headings in markdown content to markdown heading syntax.
 * Converts <h2>, <h3>, <h4> tags to ##, ###, #### markdown headings.
 * This ensures the heading-count parser works for both markdown and raw HTML headings.
 */
function normalizeHtmlHeadingsInMarkdown(content: string): string {
  // Convert <h2>...</h2> to ## ...
  let normalized = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return `\n## ${text}\n`;
  });
  // Convert <h3>...</h3> to ### ...
  normalized = normalized.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return `\n### ${text}\n`;
  });
  // Convert <h4>...</h4> to #### ...
  normalized = normalized.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return `\n#### ${text}\n`;
  });
  return normalized;
}

/**
 * Parse markdown/segments into a hierarchical PlaybookPart[] structure.
 * Counts heading occurrences to determine correct hierarchy:
 * - If multiple ##: ## → parts, ### → topics
 * - If single ## + multiple ###: ## is title-only, ### → parts, #### → topics
 * - If no ## + multiple ###: ### → parts, #### → topics
 * - Otherwise: all content as one overview part
 */
function parsePlaybookParts(segments: ContentSegment[]): PlaybookPart[] {
  // Normalize embedded HTML headings in markdown content first
  // This ensures <h2>, <h3>, <h4> tags are converted to ##, ###, #### markdown headings
  const normalizedSegments = segments.map(seg => {
    if (seg.type === 'markdown') {
      const normalized = normalizeHtmlHeadingsInMarkdown((seg as MarkdownSegment).content);
      return { type: 'markdown', content: normalized } as MarkdownSegment;
    }
    return seg;
  });

  // Pre-scan to count heading occurrences (exact level matching with negative lookahead)
  let h2Count = 0;
  let h3Count = 0;
  let h4Count = 0;
  for (const seg of normalizedSegments) {
    if (seg.type === 'markdown') {
      const lines = (seg as MarkdownSegment).content.split('\n');
      for (const line of lines) {
        if (/^##(?!#)\s+/.test(line)) h2Count++;
        if (/^###(?!#)\s+/.test(line)) h3Count++;
        if (/^####(?!#)\s+/.test(line)) h4Count++;
      }
    }
  }

  // Determine heading patterns based on counts
  // If multiple h2: h2 → parts, h3 → topics
  // If single h2 + multiple h3: h2 is title-only, h3 → parts, h4 → topics
  // If no h2 + multiple h3: h3 → parts, h4 → topics
  let partHeadingRegex: RegExp | null = null;
  let topicHeadingRegex: RegExp | null = null;
  let skipFirstH2 = false;

  if (h2Count > 1) {
    partHeadingRegex = /^##(?!#)\s+(.+)$/;
    topicHeadingRegex = /^###(?!#)\s+(.+)$/;
  } else if (h2Count === 1 && h3Count > 1) {
    partHeadingRegex = /^###(?!#)\s+(.+)$/;
    topicHeadingRegex = /^####(?!#)\s+(.+)$/;
    skipFirstH2 = true;
  } else if (h2Count === 0 && h3Count > 1) {
    partHeadingRegex = /^###(?!#)\s+(.+)$/;
    topicHeadingRegex = /^####(?!#)\s+(.+)$/;
  } else if (h3Count === 1 && h4Count > 1) {
    partHeadingRegex = /^####(?!#)\s+(.+)$/;
    topicHeadingRegex = null;
  }

  // Helper to generate part labels
  const getPartLabel = (index: number): string => {
    const labels = ['PART I', 'PART II', 'PART III', 'PART IV', 'PART V'];
    if (index < labels.length) return labels[index];
    return `PART ${index + 1}`;
  };

  // Helper to create slug from title
  const slug = (text: string): string => 
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // State machine for parsing
  const parts: PlaybookPart[] = [];
  let partCounter = 0;
  let topicCounter = 0;
  let currentPart: PlaybookPart | null = null;
  let currentTopicTitle = '';
  let currentTopicId = '';
  let currentTopicBody: string[] = [];
  let introBody: string[] = [];
  let skippedTitleH2 = false;

  // Flush current topic into current part
  const flushTopic = () => {
    if (!currentPart || !currentTopicTitle) return;
    topicCounter++;
    currentPart.topics.push({
      id: `${currentTopicId}-${topicCounter}`,
      title: currentTopicTitle,
      subtitle: deriveSubtitle(currentTopicBody),
      bodyHtml: currentTopicBody.length > 0
        ? markdownToHtml(currentTopicBody.join('\n'))
        : '<p>No details available.</p>',
      keywords: (currentTopicTitle + ' ' + currentTopicBody.join(' '))
        .toLowerCase().replace(/<[^>]+>/g, ' ').substring(0, 200),
    });
    currentTopicTitle = '';
    currentTopicId = '';
    currentTopicBody = [];
  };

  // Push current part into parts array
  const pushCurrentPart = () => {
    if (!currentPart) return;
    flushTopic();
    // Store intro content as introHtml (rendered directly, not in accordion)
    if (introBody.length > 0) {
      currentPart.introHtml = markdownToHtml(introBody.join('\n'));
    }
    // If part has no topics, don't add an Overview topic - just use introHtml
    parts.push(currentPart);
    currentPart = null;
    introBody = [];
  };

  // Create a new part
  const createPart = (title: string) => {
    pushCurrentPart();
    currentPart = {
      partLabel: getPartLabel(partCounter),
      title,
      id: slug(title),
      accentColor: PART_ACCENT_COLORS[partCounter % PART_ACCENT_COLORS.length],
      introHtml: '',  // Will be populated from introBody when part is pushed
      topics: [],
    };
    partCounter++;
    topicCounter = 0;
  };

  // Parse normalized segments
  for (const seg of normalizedSegments) {
    if (seg.type === 'markdown') {
      const lines = (seg as MarkdownSegment).content.split('\n');
      for (const rawLine of lines) {
        // Strip carriage return from Windows-style line endings
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        
        // Check for h2 heading (might need to skip if it's just the title)
        const h2Match = line.match(/^##(?!#)\s+(.+)$/);
        if (h2Match && skipFirstH2 && !skippedTitleH2) {
          // Skip the first h2 - it's just the document title
          skippedTitleH2 = true;
          continue;
        }

        const partMatch = partHeadingRegex ? line.match(partHeadingRegex) : null;
        const topicMatch = topicHeadingRegex ? line.match(topicHeadingRegex) : null;

        if (partMatch) {
          // New part heading - create a new part
          createPart(partMatch[1].trim());
        } else if (topicMatch) {
          // New topic heading
          if (!currentPart) {
            // Create an implicit overview part if we haven't started one
            createPart('Overview');
          }
          flushTopic();
          currentTopicTitle = topicMatch[1].trim();
          currentTopicId = slug(currentTopicTitle);
          currentTopicBody = [];
        } else if (currentTopicTitle) {
          // Content for current topic
          currentTopicBody.push(line);
        } else if (currentPart) {
          // Intro content for current part (before any topic)
          introBody.push(line);
        } else {
          // Content before any part heading - save for later
          introBody.push(line);
        }
      }
    } else if (seg.type === 'chart') {
      const html = renderChartSegment(seg as ChartSegment);
      if (currentTopicTitle) currentTopicBody.push(html);
      else introBody.push(html);
    } else if (seg.type === 'mermaid') {
      const html = renderDiagramSegment(seg as DiagramSegment);
      if (currentTopicTitle) currentTopicBody.push(html);
      else introBody.push(html);
    }
  }

  // Push the final part
  pushCurrentPart();

  // If no parts were created, treat all content as one overview part
  if (parts.length === 0 && normalizedSegments.length > 0) {
    const allHtml = normalizedSegments.map(seg => {
      if (seg.type === 'markdown') return markdownToHtml((seg as MarkdownSegment).content);
      if (seg.type === 'chart') return renderChartSegment(seg as ChartSegment);
      if (seg.type === 'mermaid') return renderDiagramSegment(seg as DiagramSegment);
      return '';
    }).join('\n');
    parts.push({
      partLabel: 'OVERVIEW',
      title: 'Overview',
      id: 'overview',
      accentColor: PART_ACCENT_COLORS[0],
      introHtml: '',
      topics: [{
        id: 'overview-1',
        title: 'Overview',
        subtitle: deriveSubtitle([]),
        bodyHtml: allHtml || '<p>No details available.</p>',
        keywords: 'overview',
      }],
    });
  }

  return parts;
}

function renderPlaybookPartsHtml(parts: PlaybookPart[]): {
  cardsHtml: string;
  partDetailHtml: string;
} {
  const cardsHtml = parts.map(part => `
<article class="pb-card" id="${part.id}" data-keywords="${escapeHtml((part.title + ' ' + part.topics.map(t => t.title).join(' ')).toLowerCase())}">
  <button class="pb-card-header" onclick="openPlaybookPart('${part.id}')" aria-label="Open ${escapeHtml(part.partLabel)}">
    <div class="pb-card-top-border" style="background:${part.accentColor};"></div>
    <div class="pb-card-header-inner">
      <div>
        <span class="pb-card-part-label">${escapeHtml(part.partLabel)}</span>
        <h3>${escapeHtml(toUpperHeading(part.title))}</h3>
      </div>
      <span class="pb-card-arrow" aria-hidden="true">&#8594;</span>
    </div>
  </button>
</article>`).join('\n');

  // Pre-render hidden part detail panels using <template> tags for safe content storage
  const partDetailHtml = parts.map(part => {
    // Render intro content directly under the heading (not in accordion)
    const introHtml = part.introHtml 
      ? `<div class="pb-part-intro">${part.introHtml}</div>` 
      : '';
    
    const topicRows = part.topics.map(topic => `
<div class="pb-topic-row" id="${topic.id}" data-keywords="${escapeHtml(topic.keywords)}">
  <button class="pb-topic-header" onclick="togglePlaybookTopic('${topic.id}')" aria-expanded="false">
    <div class="pb-topic-header-left">
      <span class="pb-topic-title">${escapeHtml(topic.title)}</span>
      ${topic.subtitle ? `<span class="pb-topic-subtitle">${escapeHtml(topic.subtitle)}</span>` : ''}
    </div>
    <span class="pb-topic-chevron" aria-hidden="true">&#8250;</span>
  </button>
  <div class="pb-topic-body">${topic.bodyHtml}</div>
</div>`).join('\n');

    // Only render topic-list if there are topics
    const topicListHtml = part.topics.length > 0 
      ? `<div class="pb-topic-list">${topicRows}</div>` 
      : '';

    return `<template id="pb-part-tmpl-${part.id}">
<div class="pb-part-detail">
  <div class="pb-part-detail-heading">${escapeHtml(part.partLabel)}: ${escapeHtml(toUpperHeading(part.title))}</div>
  ${introHtml}
  ${topicListHtml}
</div>
</template>`;
  }).join('\n');

  return { cardsHtml, partDetailHtml };
}

// ============ TOC HTML Builder ============

function buildTocHtml(toc: TocEntry[], heading: string = 'Contents'): string {
  if (toc.length === 0) return '';
  const items = toc.map(entry => {
    const indent = (entry.level - 2) * 16;
    return `<li style="padding-left:${indent}px"><a href="#${entry.id}" class="toc-link">${escapeHtml(entry.text)}</a></li>`;
  }).join('\n');
  return `<nav class="toc" id="toc-nav"><h3>${escapeHtml(heading)}</h3><ul>${items}</ul></nav>`;
}

// ============ CSS ============

function buildCss(branding: BrandingConfig, pageType: HtmlPageType): string {
  const primary = branding.primaryColor || '#003366';
  const font = branding.fontFamily || 'Segoe UI, Arial, sans-serif';

  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${font}, sans-serif; font-size: 15px; color: #1f2937; background: #f9fafb; line-height: 1.6; }
    a { color: ${primary}; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Header */
    .site-header {
      background: ${primary}; color: #fff; padding: 10px 24px;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-logo { height: 36px; width: auto; object-fit: contain; }
    .header-org { font-size: 1rem; font-weight: 600; color: #fff; }
    .header-title { font-size: 0.85rem; opacity: 0.85; margin-left: 8px; }
    .header-right { display: flex; align-items: center; gap: 12px; }
    .search-bar {
      padding: 6px 14px; border-radius: 20px; border: none;
      width: 220px; font-size: 0.85rem; outline: none;
      background: rgba(255,255,255,0.15); color: #fff;
    }
    .search-bar::placeholder { color: rgba(255,255,255,0.7); }
    .search-bar:focus { background: rgba(255,255,255,0.25); }

    /* Layout */
    .layout { display: flex; min-height: calc(100vh - 56px); }

    /* TOC Sidebar */
    .toc {
      width: 260px; min-width: 220px; padding: 20px 16px;
      border-right: 1px solid #e5e7eb; background: #fff;
      position: sticky; top: 56px; height: calc(100vh - 56px);
      overflow-y: auto; flex-shrink: 0;
    }
    .toc h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 12px; }
    .toc ul { list-style: none; }
    .toc li { margin: 2px 0; }
    .toc-link { font-size: 0.85rem; color: #374151; display: block; padding: 4px 8px; border-radius: 4px; }
    .toc-link:hover, .toc-link.active { background: #eff6ff; color: ${primary}; text-decoration: none; }

    /* Main content */
    .main-content { flex: 1; padding: 32px 40px; max-width: 960px; }
    .main-content.full-width { max-width: 100%; }

    /* Typography */
    h1 { font-size: 2rem; font-weight: 700; color: ${primary}; margin: 0 0 24px; }
    h2 { font-size: 1.4rem; font-weight: 600; color: ${primary}; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
    h3 { font-size: 1.15rem; font-weight: 600; color: #1f2937; margin: 24px 0 8px; }
    h4 { font-size: 1rem; font-weight: 600; color: #374151; margin: 16px 0 6px; }
    p { margin: 0 0 12px; }
    ul, ol { margin: 0 0 12px 24px; }
    li { margin: 4px 0; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.875em; font-family: 'Courier New', monospace; }
    pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
    pre code { background: none; padding: 0; color: inherit; }
    blockquote { border-left: 4px solid ${primary}; padding: 8px 16px; background: #eff6ff; margin: 12px 0; border-radius: 0 4px 4px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9rem; }
    th { background: ${primary}; color: #fff; padding: 8px 12px; text-align: left; }
    td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
    tr:hover td { background: #f9fafb; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    strong { font-weight: 600; }
    em { font-style: italic; }

    /* Chart cards */
    .chart-card {
      background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
      padding: 20px; margin: 16px 0; box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .chart-title { font-size: 1rem; font-weight: 600; color: #1f2937; margin-bottom: 12px; }
    .chart-container { position: relative; height: 300px; }
    .chart-notes { margin-top: 12px; font-size: 0.8rem; color: #6b7280; }
    .chart-notes summary { cursor: pointer; color: ${primary}; }
    .chart-notes p { margin-top: 6px; }

    /* Dashboard grid */
    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 20px; }

    /* Diagram cards */
    .diagram-card {
      background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px;
      padding: 20px; margin: 16px 0; overflow-x: auto;
    }
    .diagram-card .mermaid { display: flex; justify-content: center; }

    /* Search highlight */
    .search-highlight { background: #fef08a; border-radius: 2px; }

    /* Footer */
    .site-footer {
      background: #f3f4f6; border-top: 1px solid #e5e7eb;
      padding: 16px 24px; text-align: center;
      font-size: 0.8rem; color: #6b7280;
    }

    /* Disclaimer */
    .disclaimer { background: #fef9c3; border: 1px solid #fde047; border-radius: 6px; padding: 10px 16px; margin: 16px 0; font-size: 0.8rem; color: #713f12; }

    /* Print */
    @media print {
      .site-header, .toc, .search-bar { display: none !important; }
      .main-content { padding: 0; max-width: 100%; }
      .chart-card, .diagram-card { break-inside: avoid; }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .toc { display: none; }
      .main-content { padding: 16px; }
      .dashboard-grid { grid-template-columns: 1fr; }
      .search-bar { width: 140px; }
    }
  `;
}

// ============ JavaScript ============

// JS source for the generated HTML page.
// Stored as an array of lines to avoid template-literal parsing of $& and $1.
const JS_LINES = [
  '// Mermaid init - explicit rendering with missing-library fallback',
  '(function() {',
  '  // Helper to escape HTML for fallback display',
  '  function escapeHtmlForFallback(str) {',
  '    return str',
  '      .replace(/\\x26/g, "\\x26amp;")',
  '      .replace(/\\x3C/g, "\\x26lt;")',
  '      .replace(/\\x3E/g, "\\x26gt;")',
  '      .replace(/"/g, "\\x26quot;")',
  '      .replace(/\'/g, "\\x26#39;");',
  '  }',
  '  function showDiagramTextFallback(block, code) {',
  '    block.innerHTML = "<pre style=\\"background:#fef3c7;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;\\">" +',
  '      "<strong>Diagram could not be rendered.</strong><br>Mermaid library is unavailable. Diagram source is shown below:\\\\n" +',
  '      escapeHtmlForFallback(code) + "</pre>";',
  '  }',
  '  if (typeof mermaid === "undefined") {',
  '    // Mermaid unavailable: replace all .mermaid blocks with text fallbacks',
  '    document.querySelectorAll(".mermaid[data-mermaid-source]").forEach(function(block) {',
  '      var encoded = block.getAttribute("data-mermaid-source");',
  '      if (!encoded) return;',
  '      var code = atob(encoded);',
  '      showDiagramTextFallback(block, code);',
  '    });',
  '    return;',
  '  }',
  '  mermaid.initialize({',
  '    startOnLoad: false,',
  '    theme: "default",',
  '    securityLevel: "loose",',
  '    suppressErrorRendering: true,',
  '    fontFamily: "system-ui, -apple-system, sans-serif",',
  '    flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },',
  '    mindmap: { useMaxWidth: true, padding: 16 }',
  '  });',
  '  // Render all .mermaid blocks explicitly',
  '  var mermaidBlocks = document.querySelectorAll(".mermaid");',
  '  if (mermaidBlocks.length === 0) return;',
  '  mermaidBlocks.forEach(function(block, index) {',
  '    var encoded = block.getAttribute("data-mermaid-source");',
  '    var code = encoded ? atob(encoded) : block.textContent.trim();',
  '    if (!code) return;',
  '    var id = "mermaid-svg-" + index + "-" + Date.now();',
  '    try {',
  '      mermaid.render(id, code).then(function(result) {',
  '        block.innerHTML = result.svg;',
  '      }).catch(function(err) {',
  '        console.error("Mermaid render error:", err);',
  '        showDiagramTextFallback(block, code);',
  '      });',
  '    } catch (e) {',
  '      console.error("Mermaid render error:", e);',
  '      showDiagramTextFallback(block, code);',
  '    }',
  '  });',
  '  // Expose for playbook template rendering',
  '  window.renderMermaidDiagrams = function() {',
  '    var blocks = document.querySelectorAll(".mermaid[data-mermaid-source]");',
  '    blocks.forEach(function(block, index) {',
  '      if (block.querySelector("svg")) return;',
  '      var encoded = block.getAttribute("data-mermaid-source");',
  '      if (!encoded) return;',
  '      var code = atob(encoded);',
  '      var id = "mermaid-svg-dynamic-" + index + "-" + Date.now();',
  '      try {',
  '        mermaid.render(id, code).then(function(result) {',
  '          block.innerHTML = result.svg;',
  '        }).catch(function(err) {',
  '          console.error("Mermaid render error:", err);',
  '          showDiagramTextFallback(block, code);',
  '        });',
  '      } catch (e) {',
  '        console.error("Mermaid render error:", e);',
  '        showDiagramTextFallback(block, code);',
  '      }',
  '    });',
  '  };',
  '})();',
  '',
  '// Chart.js init - explicit rendering with fallback',
  '(function() {',
  '  if (typeof Chart === "undefined") {',
  '    document.querySelectorAll("canvas[data-chart-config]").forEach(function(canvas) {',
  '      var wrapper = canvas.closest("[data-chart-wrapper]") || canvas.parentNode;',
  '      wrapper.innerHTML = "<div style=\\"padding:16px;text-align:center;color:#dc2626;background:#fef2f2;border-radius:6px;font-size:13px;\\">" +',
  '        "<strong>Chart could not be rendered.</strong><br>Chart.js library is unavailable." +',
  '        "</div>";',
  '    });',
  '    return;',
  '  }',
  '  function chartTitleFromConfig(config) {',
  '    var title = config && config.options && config.options.plugins && config.options.plugins.title;',
  '    if (!title || !title.display || !title.text) return "Chart";',
  '    return Array.isArray(title.text) ? title.text.join(" ") : String(title.text);',
  '  }',
  '  function replaceChartCanvasWithImage(canvas, chart, config) {',
  '    try {',
  '      if (!canvas || !canvas.parentNode) return;',
  '      var imageData = canvas.toDataURL("image/png");',
  '      var img = document.createElement("img");',
  '      img.src = imageData;',
  '      img.alt = chartTitleFromConfig(config);',
  '      img.setAttribute("data-chart-image", "true");',
  '      img.width = canvas.width;',
  '      img.height = canvas.height;',
  '      img.style.width = "100%";',
  '      img.style.height = "100%";',
  '      img.style.objectFit = "contain";',
  '      img.style.display = "block";',
  '      canvas.parentNode.replaceChild(img, canvas);',
  '      if (chart && typeof chart.destroy === "function") chart.destroy();',
  '    } catch (e) {',
  '      console.warn("Chart image archival failed; leaving canvas in place:", e);',
  '    }',
  '  }',
  '  function renderCharts() {',
  '    document.querySelectorAll("canvas[data-chart-config]").forEach(function(canvas) {',
  '      if (canvas.getAttribute("data-chart-rendered") === "true") return;',
  '      var encoded = canvas.getAttribute("data-chart-config");',
  '      if (!encoded) return;',
  '      try {',
  '        var config = JSON.parse(atob(encoded));',
  '        config.options = config.options || {};',
  '        config.options.animation = { duration: 0 };',
  '        config.options.responsive = true;',
  '        config.options.maintainAspectRatio = false;',
  '        var chart = new Chart(canvas.getContext("2d"), config);',
  '        canvas.setAttribute("data-chart-rendered", "true");',
  '        requestAnimationFrame(function() {',
  '          replaceChartCanvasWithImage(canvas, chart, config);',
  '        });',
  '      } catch (e) {',
  '        console.error("Chart render error:", e);',
  '        var wrapper = canvas.closest("[data-chart-wrapper]") || canvas.parentNode;',
  '        wrapper.innerHTML = "<div style=\\"padding:16px;text-align:center;color:#dc2626;background:#fef2f2;border-radius:6px;font-size:13px;\\">" +',
  '          "<strong>Chart could not be rendered.</strong><br>Invalid chart configuration." +',
  '          "</div>";',
  '      }',
  '    });',
  '  }',
  '  if (document.readyState === "loading") {',
  '    document.addEventListener("DOMContentLoaded", renderCharts);',
  '  } else {',
  '    renderCharts();',
  '  }',
  '  window.renderCharts = renderCharts;',
  '})();',
  '',
  '// TOC active link tracking',
  '(function() {',
  '  var headings = document.querySelectorAll("h2[id], h3[id], h4[id]");',
  '  var tocLinks = document.querySelectorAll(".toc-link");',
  '  if (!headings.length || !tocLinks.length) return;',
  '  var observer = new IntersectionObserver(function(entries) {',
  '    entries.forEach(function(entry) {',
  '      if (entry.isIntersecting) {',
  '        tocLinks.forEach(function(link) { link.classList.remove("active"); });',
  '        var active = document.querySelector(".toc-link[href=\\"#" + entry.target.id + "\\"]");',
  '        if (active) active.classList.add("active");',
  '      }',
  '    });',
  '  }, { rootMargin: "-20% 0px -70% 0px" });',
  '  headings.forEach(function(h) { observer.observe(h); });',
  '})();',
  '',
  '// Search functionality',
  'function searchDocs(query) {',
  '  var highlights = document.querySelectorAll(".search-highlight");',
  '  highlights.forEach(function(el) {',
  '    var parent = el.parentNode;',
  '    parent.replaceChild(document.createTextNode(el.textContent), el);',
  '    parent.normalize();',
  '  });',
  '  if (!query || query.length < 2) return;',
  '  var walker = document.createTreeWalker(',
  '    document.querySelector(".main-content") || document.body,',
  '    NodeFilter.SHOW_TEXT, null',
  '  );',
  '  var textNodes = [];',
  '  var node;',
  '  while ((node = walker.nextNode())) {',
  '    if (node.nodeValue && node.nodeValue.toLowerCase().includes(query.toLowerCase())) {',
  '      textNodes.push(node);',
  '    }',
  '  }',
  '  textNodes.forEach(function(textNode) {',
  // Use new RegExp with escaped special chars; avoid $& / $1 in template literal
  '    var escaped = query.replace(new RegExp("[.*+?^${}()|[\\\\]\\\\\\\\]", "g"), "\\\\$&");',
  '    var regex = new RegExp("(" + escaped + ")", "gi");',
  '    var span = document.createElement("span");',
  '    span.innerHTML = textNode.nodeValue.replace(regex, "<mark class=\\"search-highlight\\">$1</mark>");',
  '    textNode.parentNode.replaceChild(span, textNode);',
  '  });',
  '  var first = document.querySelector(".search-highlight");',
  '  if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });',
  '}',
];

function buildJs(): string {
  return JS_LINES.join('\n');
}

// ============ Document Layout Flags ============

interface DocumentLayoutFlags {
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

const DOCUMENT_LAYOUT_FLAGS: Record<string, DocumentLayoutFlags> = {
  documentation: {
    showToc: true,
    tocHeading: 'Contents',
    showLangSelector: false,
    showHero: false,
    showMetadataBadge: false,
    badgeLabel: '',
    badgeStyle: 'border',
    showHeaderTitle: true,
    footerSuffix: 'Generated',
    searchPlaceholder: 'Search...',
    contentMaxWidth: '960px',
  },
  book: {
    showToc: true,
    tocHeading: 'Chapters',
    showLangSelector: true,
    showHero: false,
    showMetadataBadge: true,
    badgeLabel: 'Ebook format',
    badgeStyle: 'border',
    showHeaderTitle: true,
    footerSuffix: 'Book View',
    searchPlaceholder: 'Search book...',
    contentMaxWidth: '960px',
  },
  report: {
    showToc: true,
    tocHeading: 'Contents',
    showLangSelector: false,
    showHero: false,
    showMetadataBadge: true,
    badgeLabel: 'Formal report',
    badgeStyle: 'border-left',
    showHeaderTitle: true,
    footerSuffix: 'Report View',
    searchPlaceholder: 'Search report...',
    contentMaxWidth: '960px',
  },
  website: {
    showToc: false,
    tocHeading: 'Contents',
    showLangSelector: true,
    showHero: true,
    showMetadataBadge: false,
    badgeLabel: '',
    badgeStyle: 'border',
    showHeaderTitle: true,
    footerSuffix: 'Website Mockup',
    searchPlaceholder: 'Search website...',
    contentMaxWidth: '1200px',
  },
  webpage: {
    showToc: false,
    tocHeading: 'Contents',
    showLangSelector: false,
    showHero: false,
    showMetadataBadge: false,
    badgeLabel: '',
    badgeStyle: 'border',
    showHeaderTitle: false,
    footerSuffix: '',
    searchPlaceholder: 'Search...',
    contentMaxWidth: '960px',
  },
  dashboard: {
    showToc: false,
    tocHeading: 'Contents',
    showLangSelector: false,
    showHero: false,
    showMetadataBadge: false,
    badgeLabel: '',
    badgeStyle: 'border',
    showHeaderTitle: false,
    footerSuffix: '',
    searchPlaceholder: 'Search...',
    contentMaxWidth: '100%',
  },
  roadmap: {
    showToc: false,
    tocHeading: 'Contents',
    showLangSelector: false,
    showHero: false,
    showMetadataBadge: false,
    badgeLabel: '',
    badgeStyle: 'border',
    showHeaderTitle: true,
    footerSuffix: 'Roadmap',
    searchPlaceholder: 'Search roadmap...',
    contentMaxWidth: '960px',
  },
};

// ============ Template Assemblers ============

/**
 * Single parameterized document layout builder.
 * Consolidates documentation, book, report, website, webpage, and dashboard templates.
 * Uses DocumentLayoutFlags to control all structural variations.
 */
function buildDocumentLayout(
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
  flags: DocumentLayoutFlags
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const vendorScripts = buildVendorScripts();

  // TOC sidebar
  const tocHtml = flags.showToc ? buildTocHtml(toc, flags.tocHeading) : '';

  // Language selector dropdown
  const langOptions = ['English', 'French', 'Spanish', 'Portuguese', 'Mandarin', 'Hindi']
    .map(lang => `<option value="${lang.toLowerCase()}">${lang}</option>`)
    .join('');
  const langSelectorHtml = flags.showLangSelector
    ? `<select aria-label="Language selector" style="padding:6px 10px;border-radius:8px;border:none;">${langOptions}</select>`
    : '';

  // Search bar
  const searchHtml = `<input type="search" class="search-bar" placeholder="${escapeHtml(flags.searchPlaceholder)}" oninput="searchDocs(this.value)" aria-label="Search">`;

  // Metadata badge (for report, book)
  const badgeHtml = flags.showMetadataBadge
    ? `<section style="margin-bottom:24px;padding:16px 18px;${flags.badgeStyle === 'border-left' ? 'border-left:4px solid #2563eb;border-radius:8px;background:#eff6ff;' : 'border:1px solid #e5e7eb;border-radius:10px;background:#fff;'}">
        <h1 style="margin-bottom:8px;">${escapeHtml(title)}</h1>
        <p style="font-size:0.9rem;color:${flags.badgeStyle === 'border-left' ? '#374151' : '#6b7280'};margin:0;">${flags.badgeLabel}${orgName ? ' · ' + escapeHtml(orgName) : ''}${flags.badgeStyle === 'border-left' ? ' · ' + date : ' · Generated ' + date}</p>
      </section>`
    : '';

  // Hero section (for website)
  const heroHtml = flags.showHero
    ? `<section style="margin:22px 0 20px;padding:26px;border-radius:14px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#fff;">
        <h1 style="margin:0 0 10px;color:#fff;">${escapeHtml(title)}</h1>
        <p style="margin:0;opacity:0.95;">${escapeHtml(branding.heroSubtitle || 'Website')}</p>
      </section>`
    : '';

  // Header title
  const headerTitleHtml = flags.showHeaderTitle
    ? `<span class="header-title">${escapeHtml(title)}</span>`
    : '';

  // Dashboard title in header-right
  const dashboardTitleHtml = !flags.showToc && !flags.showHeaderTitle && !flags.showHero
    ? `<span style="color:rgba(255,255,255,0.85);font-size:0.9rem;font-weight:600">${escapeHtml(title)}</span>`
    : '';

  // Main content wrapper
  const isDashboard = !flags.showToc && !flags.showHeaderTitle && !flags.showHero && !flags.showMetadataBadge;
  const mainContentClass = isDashboard ? 'main-content full-width' : 'main-content';
  const mainContentStyle = isDashboard ? 'padding:24px' : '';
  const mainWrapper = flags.showHero ? 'main' : 'div class="layout"';
  const mainInner = flags.showHero
    ? `<main role="main" style="max-width:${flags.contentMaxWidth};margin:0 auto;padding:0 20px 28px;">
        ${heroHtml}
        ${disclaimerHtml}
        <section>${contentHtml}</section>
        <p style="margin-top:24px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
      </main>`
    : `<div class="layout">
        ${tocHtml}
        <main class="${mainContentClass}" style="${mainContentStyle}" role="main">
          ${isDashboard ? disclaimerHtml + '<div class="dashboard-grid">' + contentHtml + '</div>' : ''}
          ${!isDashboard ? (badgeHtml || `<h1>${escapeHtml(title)}</h1>`) + disclaimerHtml + contentHtml : ''}
          ${!isDashboard ? `<p style="margin-top:32px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>` : ''}
          ${isDashboard ? `<p style="margin-top:24px;font-size:0.8rem;color:#9ca3af;text-align:right">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>` : ''}
        </main>
      </div>`;

  // Footer
  const footerSuffix = flags.footerSuffix ? ` · ${flags.footerSuffix}` : '';
  const footerHtml = flags.footerSuffix
    ? `<footer class="site-footer">${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)}${footerSuffix} · Generated ${date}</footer>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${vendorScripts}
  <style>${css}</style>
</head>
<body>
  <header class="site-header">
    <div class="header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
      ${headerTitleHtml}
    </div>
    <div class="header-right">
      ${searchHtml}
      ${langSelectorHtml}
      ${dashboardTitleHtml}
    </div>
  </header>
  ${mainInner}
  ${footerHtml}
  <script>${js}</script>
</body>
</html>`;
}

function buildDocumentationTemplate(
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, toc, branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.documentation);
}

function buildDashboardTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, [], branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.dashboard);
}

function buildBookTemplate(
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, toc, branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.book);
}

function buildReportTemplate(
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, toc, branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.report);
}

function buildWebsiteTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, [], branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.website);
}

function buildWebpageTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, [], branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.webpage);
}

/**
 * Build a roadmap page with a visual timeline bar and phase cards.
 * Parses ## headings as phases and ### headings as milestones within each phase.
 */
function buildRoadmapTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const vendorScripts = buildVendorScripts();

  const roadmapCss = `
    .rm-container { max-width: 960px; margin: 0 auto; padding: 0 20px 40px; }
    .rm-header { text-align: center; padding: 32px 0 24px; }
    .rm-header h1 { margin: 0 0 8px; }
    .rm-header p { color: #6b7280; font-size: 0.95rem; margin: 0; }
    /* Timeline bar */
    .rm-timeline-bar {
      display: flex; align-items: center; justify-content: space-between;
      position: relative; margin: 32px 0 40px; padding: 0 10px;
    }
    .rm-timeline-bar::before {
      content: ''; position: absolute; top: 50%; left: 0; right: 0;
      height: 4px; background: #e5e7eb; transform: translateY(-50%);
      border-radius: 2px; z-index: 0;
    }
    .rm-timeline-bar::after {
      content: ''; position: absolute; top: 50%; left: 0;
      height: 4px; background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      transform: translateY(-50%); border-radius: 2px; z-index: 1;
      width: 0; transition: width 0.6s ease;
    }
    .rm-timeline-bar.complete::after { width: 100%; }
    .rm-timeline-dot {
      position: relative; z-index: 2;
      display: flex; flex-direction: column; align-items: center;
      cursor: pointer; transition: transform 0.2s;
    }
    .rm-timeline-dot:hover { transform: scale(1.1); }
    .rm-timeline-dot .dot {
      width: 16px; height: 16px; border-radius: 50%;
      background: #e5e7eb; border: 3px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
      transition: background 0.3s;
    }
    .rm-timeline-dot.active .dot { background: #3b82f6; }
    .rm-timeline-dot.completed .dot { background: #10b981; }
    .rm-timeline-dot .label {
      margin-top: 8px; font-size: 0.7rem; color: #6b7280;
      text-align: center; max-width: 80px; line-height: 1.2;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rm-timeline-dot.active .label { color: #3b82f6; font-weight: 600; }
    .rm-timeline-dot.completed .label { color: #10b981; font-weight: 600; }
    /* Phase cards */
    .rm-phases { display: flex; flex-direction: column; gap: 20px; }
    .rm-phase-card {
      background: #fff; border: 1px solid #e5e7eb;
      border-radius: 12px; overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
      transition: box-shadow 0.2s;
    }
    .rm-phase-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .rm-phase-card-header {
      padding: 16px 20px; display: flex; align-items: center;
      justify-content: space-between; cursor: pointer;
      background: #f9fafb; border-bottom: 1px solid #e5e7eb;
    }
    .rm-phase-card-header h3 { margin: 0; font-size: 1.05rem; color: #1f2937; }
    .rm-phase-status {
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; padding: 3px 10px; border-radius: 12px;
    }
    .rm-phase-status.completed { background: #d1fae5; color: #065f46; }
    .rm-phase-status.in-progress { background: #dbeafe; color: #1e40af; }
    .rm-phase-status.planned { background: #f3f4f6; color: #6b7280; }
    .rm-phase-card-body { padding: 16px 20px; }
    .rm-phase-card-body p { margin: 0 0 12px; color: #374151; font-size: 0.9rem; }
    .rm-milestones { list-style: none; padding: 0; margin: 0; }
    .rm-milestone {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid #f3f4f6;
    }
    .rm-milestone:last-child { border-bottom: none; }
    .rm-milestone-icon {
      width: 20px; height: 20px; border-radius: 50%;
      flex-shrink: 0; margin-top: 2px;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.65rem; color: #fff;
    }
    .rm-milestone-icon.done { background: #10b981; }
    .rm-milestone-icon.pending { background: #d1d5db; }
    .rm-milestone-icon.active { background: #3b82f6; }
    .rm-milestone-text { font-size: 0.9rem; color: #374151; }
    .rm-milestone-text strong { color: #1f2937; }
    @media (max-width: 768px) {
      .rm-timeline-bar { overflow-x: auto; padding-bottom: 8px; }
      .rm-timeline-dot .label { font-size: 0.6rem; max-width: 60px; }
    }
  `;

  const roadmapJs = `
    function scrollToPhase(phaseId) {
      var el = document.getElementById(phaseId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${vendorScripts}
  <style>${css}${roadmapCss}</style>
</head>
<body>
  <header class="site-header">
    <div class="header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
      <span class="header-title">${escapeHtml(title)}</span>
    </div>
    <div class="header-right">
      <input type="search" class="search-bar" placeholder="Search roadmap..." oninput="searchDocs(this.value)" aria-label="Search roadmap">
    </div>
  </header>
  <div class="rm-container">
    <div class="rm-header">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(branding.heroSubtitle || 'Strategic Roadmap')} · ${date}</p>
    </div>
    ${disclaimerHtml}
    <div class="rm-timeline-bar" id="rm-timeline-bar">
      <!-- Timeline dots will be injected by JS parsing h2 headings -->
    </div>
    <div class="rm-phases" id="rm-phases">
      ${contentHtml}
    </div>
    <p style="margin-top:32px;font-size:0.8rem;color:#9ca3af;text-align:center">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
  </div>
  <footer class="site-footer">
    ${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)} · Roadmap · Generated ${date}
  </footer>
  <script>${js}${roadmapJs}</script>
</body>
</html>`;
}

// ============ Playbook Template ============

/**
 * Country-aware playbook theme resolver.
 * Detects the country/organization from title and branding fields,
 * then returns a { primary, secondary, accent, flagStrip } palette.
 * The primary colour from branding.primaryColor overrides any inferred value.
 */
function resolvePlaybookTheme(
  branding: BrandingConfig,
  title: string,
  organizationName: string
): { primary: string; secondary: string; accent: string; flagStrip: string } {
  // If an explicit primary colour is set, use it and derive the rest
  if (branding.primaryColor) {
    return {
      primary: branding.primaryColor,
      secondary: branding.primaryColor,
      accent: branding.primaryColor,
      flagStrip: branding.primaryColor,
    };
  }

  // Detect country from title / org name (case-insensitive)
  const combined = (title + ' ' + organizationName).toLowerCase();

  if (/grenada/i.test(combined)) {
    // Green, red, yellow
    return { primary: '#007A5E', secondary: '#CE1126', accent: '#FCD116', flagStrip: '#007A5E,#CE1126,#FCD116' };
  }
  if (/jamaica/i.test(combined)) {
    // Green, yellow, black
    return { primary: '#009B3A', secondary: '#FED100', accent: '#000000', flagStrip: '#009B3A,#FED100,#000000' };
  }
  if (/barbados/i.test(combined)) {
    // Blue, yellow, blue
    return { primary: '#00247D', secondary: '#FCD116', accent: '#00247D', flagStrip: '#00247D,#FCD116,#00247D' };
  }
  if (/trinidad/i.test(combined)) {
    // Red, white, black
    return { primary: '#C8102E', secondary: '#FFFFFF', accent: '#000000', flagStrip: '#C8102E,#FFFFFF,#000000' };
  }
  if (/bahamas/i.test(combined)) {
    // Aquamarine, yellow, black
    return { primary: '#00778B', secondary: '#FCD116', accent: '#000000', flagStrip: '#00778B,#FCD116,#000000' };
  }
  if (/antigua/i.test(combined)) {
    // Red, white, blue
    return { primary: '#C8102E', secondary: '#FFFFFF', accent: '#002F6C', flagStrip: '#C8102E,#FFFFFF,#002F6C' };
  }
  if (/saint[\s-]?lusia|st[\s-]?lucia/i.test(combined)) {
    // Cerulean blue, yellow, black
    return { primary: '#4D8CC4', secondary: '#FCD116', accent: '#000000', flagStrip: '#4D8CC4,#FCD116,#000000' };
  }
  if (/dominica/i.test(combined)) {
    // Green, red, yellow
    return { primary: '#007A5E', secondary: '#CE1126', accent: '#FCD116', flagStrip: '#007A5E,#CE1126,#FCD116' };
  }
  if (/guyana/i.test(combined)) {
    // White, red, black, gold
    return { primary: '#009E49', secondary: '#CE1126', accent: '#FCD116', flagStrip: '#009E49,#CE1126,#FCD116' };
  }
  if (/suriname/i.test(combined)) {
    // Green, white, red, gold
    return { primary: '#377E3F', secondary: '#FFFFFF', accent: '#B40A2C', flagStrip: '#377E3F,#FFFFFF,#B40A2C' };
  }
  if (/belize/i.test(combined)) {
    // Blue, red, white
    return { primary: '#00358E', secondary: '#D90000', accent: '#FFFFFF', flagStrip: '#00358E,#D90000,#FFFFFF' };
  }
  if (/caribbean/i.test(combined)) {
    return { primary: '#7AB800', secondary: '#0033A0', accent: '#FF6900', flagStrip: '#7AB800,#0033A0,#FF6900' };
  }

  // Default: deep navy
  return { primary: '#003366', secondary: '#003366', accent: '#003366', flagStrip: '#003366,#003366,#003366' };
}

function buildPlaybookTemplate(
  title: string,
  segments: ContentSegment[],
  branding: BrandingConfig,
  css: string,
  js: string,
  date: string
): string {
  const primary = branding.primaryColor || '#003366';
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const tagline = branding.playbook?.tagline || '';
  const heroSubtitle = branding.playbook?.heroSubtitle || '';
  const heroDate = branding.playbook?.heroDate || date;
  const footerEntity = branding.playbook?.footerEntity || orgName;
  const footerAgency = branding.playbook?.footerAgency || '';
  const footerDate = branding.playbook?.footerDate || date;

  // Resolve country-aware theme
  const theme = resolvePlaybookTheme(branding, title, orgName);

  const playbookCss = `
    /* Playbook-specific styles */
    .pb-flag-strip {
      height: 6px;
      background: linear-gradient(90deg, ${theme.flagStrip});
    }
    .pb-header {
      background: #fff;
      color: #1f2937;
      padding: 10px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 6px;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-bottom: 1px solid #e5e7eb;
    }
    .pb-header-left { display: flex; align-items: center; gap: 12px; }
    .pb-header-right { display: flex; align-items: center; gap: 12px; }
    .pb-tagline { font-size: 0.8rem; color: #6b7280; }
    .pb-view-all-btn {
      background: ${theme.primary};
      color: #fff;
      border: none;
      padding: 7px 18px;
      border-radius: 20px;
      font-size: 0.85rem;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .pb-view-all-btn:hover { opacity: 0.85; }
    .pb-hero {
      background: #fff;
      padding: 40px 24px 48px;
      text-align: center;
    }
    .pb-hero h1 { font-size: 2rem; color: #1f2937; margin: 0 0 10px; font-weight: 700; }
    .pb-hero-subtitle { font-size: 1rem; color: #6b7280; margin: 0 0 6px; }
    .pb-hero-date { font-size: 0.8rem; color: #9ca3af; margin: 0; }
    .pb-hero-search {
      max-width: 560px;
      margin: 20px auto 0;
    }
    .pb-hero-search input {
      width: 100%;
      padding: 10px 20px;
      border-radius: 28px;
      border: 1px solid #d1d5db;
      font-size: 0.95rem;
      outline: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .pb-hero-search input:focus { border-color: ${theme.primary}; }
    .pb-main { padding: 0 24px 48px; max-width: 960px; margin: 0 auto; }
    /* Part cards grid */
    .pb-cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 0; }
    .pb-card {
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 1px 6px rgba(0,0,0,0.08);
      overflow: hidden;
      transition: box-shadow 0.2s, transform 0.2s;
    }
    .pb-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.12); transform: translateY(-2px); }
    .pb-card.selected { box-shadow: 0 0 0 2px ${theme.primary}; }
    .pb-card-header {
      padding: 0;
      border: none;
      display: block;
      cursor: pointer;
      background: #fff;
      text-align: left;
      width: 100%;
    }
    .pb-card-top-border { height: 4px; width: 100%; }
    .pb-card-header-inner {
      padding: 14px 16px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .pb-card-part-label {
      display: block;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 4px;
    }
    .pb-card-header h3 { margin: 0; font-size: 0.9rem; color: #1f2937; font-weight: 600; line-height: 1.3; }
    .pb-card-arrow { font-size: 1.2rem; color: #d1d5db; flex-shrink: 0; margin-top: 2px; }
    .pb-card.selected .pb-card-arrow { color: ${theme.primary}; }
    /* Part detail area */
    .pb-part-detail-area {
      margin-top: 28px;
      display: none;
    }
    .pb-part-detail-area.active { display: block; }
    .pb-part-detail {
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 1px 6px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .pb-part-detail-heading {
      padding: 14px 20px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: ${theme.primary};
      background: ${theme.primary}08;
      border-bottom: 1px solid #e5e7eb;
    }
    /* Intro content directly under part heading */
    .pb-part-intro {
      padding: 16px 20px;
      font-size: 0.9rem;
      color: #374151;
      line-height: 1.7;
      border-bottom: 1px solid #f3f4f6;
    }
    .pb-part-intro p { margin: 0 0 8px; }
    .pb-part-intro p:last-child { margin-bottom: 0; }
    /* Topic list inside detail area */
    .pb-topic-list { }
    .pb-topic-row { border-bottom: 1px solid #f3f4f6; }
    .pb-topic-row:last-child { border-bottom: none; }
    .pb-topic-header {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      background: #fff;
      border: none;
      cursor: pointer;
      text-align: left;
      gap: 12px;
    }
    .pb-topic-header:hover { background: #f9fafb; }
    .pb-topic-header-left { flex: 1; }
    .pb-topic-title { display: block; font-size: 0.95rem; font-weight: 600; color: #1f2937; }
    .pb-topic-subtitle { display: block; font-size: 0.8rem; color: #9ca3af; margin-top: 2px; }
    .pb-topic-chevron { font-size: 1.4rem; color: #d1d5db; transition: transform 0.2s; flex-shrink: 0; }
    .pb-topic-body {
      display: none;
      padding: 0 20px 16px;
      font-size: 0.9rem;
      color: #374151;
      line-height: 1.7;
      border-top: 1px solid #f3f4f6;
    }
    .pb-topic-body.open { display: block; }
    .pb-topic-body h4 { font-size: 0.95rem; font-weight: 600; color: #1f2937; margin: 12px 0 6px; }
    .pb-topic-body p { margin: 0 0 8px; }
    /* Footer */
    .pb-footer {
      background: #f9fafb;
      color: #6b7280;
      padding: 20px 24px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
    }
    .pb-footer-entity { font-size: 0.9rem; font-weight: 600; color: #374151; margin: 0 0 4px; }
    .pb-footer-agency { font-size: 0.8rem; margin: 0 0 4px; }
    .pb-footer-date { font-size: 0.75rem; opacity: 0.7; margin: 0; }
    .pb-hidden { display: none !important; }
    .pb-no-results { text-align: center; padding: 40px 24px; color: #9ca3af; font-size: 0.95rem; }
    @media (max-width: 768px) {
      .pb-hero-search { flex-direction: column; }
      .pb-cards-grid { grid-template-columns: 1fr; }
      .pb-header { flex-direction: column; gap: 8px; text-align: center; }
    }
  `;

  const playbookJs = `
    // Open a part card → render its template into the detail area
    function openPlaybookPart(partId) {
      var detail = document.getElementById('pb-part-detail');
      if (!detail) return;
      var tmpl = document.getElementById('pb-part-tmpl-' + partId);
      if (!tmpl) return;
      // Clone template content into detail area
      detail.innerHTML = '';
      var clone = tmpl.content.cloneNode(true);
      detail.appendChild(clone);
      detail.classList.add('active');
      // Highlight selected card
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
      var card = document.getElementById(partId);
      if (card) card.classList.add('selected');
      // Auto-expand all topic bodies so content is immediately visible
      detail.querySelectorAll('.pb-topic-body').forEach(function(b) { b.classList.add('open'); });
      detail.querySelectorAll('.pb-topic-header').forEach(function(h) { h.setAttribute('aria-expanded', 'true'); });
      // Render any Mermaid diagrams in the cloned content
      if (typeof window.renderMermaidDiagrams === 'function') {
        window.renderMermaidDiagrams();
      }
      // Render any Chart.js charts in the cloned content
      if (typeof window.renderCharts === 'function') {
        window.renderCharts();
      }
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Toggle a topic row accordion
    function togglePlaybookTopic(topicId) {
      var row = document.getElementById(topicId);
      if (!row) return;
      var btn = row.querySelector('.pb-topic-header');
      var body = row.querySelector('.pb-topic-body');
      var isOpen = body && body.classList.contains('open');
      // Close all other rows
      document.querySelectorAll('.pb-topic-body.open').forEach(function(b) { b.classList.remove('open'); });
      document.querySelectorAll('.pb-topic-header[aria-expanded="true"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
      if (!isOpen) {
        if (body) body.classList.add('open');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    // Filter playbook cards + topic rows by search query
    function filterPlaybookCards(query) {
      var detail = document.getElementById('pb-part-detail');
      if (detail) { detail.classList.remove('active'); detail.innerHTML = ''; }
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
      var lc = query.toLowerCase();
      var matchCount = 0;
      document.querySelectorAll('.pb-card').forEach(function(card) {
        var title = (card.querySelector('h3') || {}).textContent || '';
        var keywords = card.getAttribute('data-keywords') || '';
        var visible = !lc || title.toLowerCase().includes(lc) || keywords.includes(lc);
        card.classList.toggle('pb-hidden', !visible);
        if (visible) matchCount++;
      });
      var noResults = document.querySelector('.pb-no-results');
      if (noResults) noResults.style.display = matchCount > 0 ? 'none' : 'block';
    }
    // View all sections — reset search, show all cards
    // View all sections — toggle between card view and fully expanded view
    function viewAllSections() {
      var detail = document.getElementById('pb-part-detail');
      var btn = document.getElementById('pb-view-all-btn');
      if (!detail) return;
      // If already in "all expanded" mode → collapse back to card grid
      if (detail.getAttribute('data-expanded') === 'all') {
        detail.classList.remove('active');
        detail.innerHTML = '';
        detail.removeAttribute('data-expanded');
        document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
        if (btn) btn.textContent = 'View all sections';
        return;
      }
      // Reset search & show all cards
      var search = document.querySelector('.pb-hero-search input');
      if (search) search.value = '';
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('pb-hidden'); });
      var noResults = document.querySelector('.pb-no-results');
      if (noResults) noResults.style.display = 'none';
      // Clone ALL part templates into the detail area
      detail.innerHTML = '';
      document.querySelectorAll('.pb-card').forEach(function(card) {
        var tmpl = document.getElementById('pb-part-tmpl-' + card.id);
        if (tmpl) {
          var clone = tmpl.content.cloneNode(true);
          detail.appendChild(clone);
        }
      });
      // Expand all topic bodies so every row of text is visible
      detail.querySelectorAll('.pb-topic-body').forEach(function(b) { b.classList.add('open'); });
      detail.querySelectorAll('.pb-topic-header').forEach(function(h) { h.setAttribute('aria-expanded', 'true'); });
      detail.classList.add('active');
      detail.setAttribute('data-expanded', 'all');
      if (btn) btn.textContent = 'Collapse sections';
      // Render any Mermaid diagrams in the cloned content
      if (typeof window.renderMermaidDiagrams === 'function') {
        window.renderMermaidDiagrams();
      }
      // Render any Chart.js charts in the cloned content
      if (typeof window.renderCharts === 'function') {
        window.renderCharts();
      }
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

  `;
  // Parse and render playbook parts
  const parts = parsePlaybookParts(segments);
  const { cardsHtml: partsCardsHtml, partDetailHtml } = renderPlaybookPartsHtml(parts);
  const vendorScripts = buildVendorScripts();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${vendorScripts}
  <style>${css}${playbookCss}</style>
</head>
<body>
  <div class="pb-flag-strip"></div>
  <header class="pb-header">
    <div class="pb-header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
      ${tagline ? `<span class="pb-tagline">${escapeHtml(tagline)}</span>` : ''}
    </div>
    <div class="pb-header-right">
      <button id="pb-view-all-btn" class="pb-view-all-btn" onclick="viewAllSections()">View all sections</button>
    </div>
  </header>
  <section class="pb-hero">
    <h1>${escapeHtml(title)}</h1>
    ${heroSubtitle ? `<p class="pb-hero-subtitle">${escapeHtml(heroSubtitle)}</p>` : ''}
    ${heroDate ? `<p class="pb-hero-date">${escapeHtml(heroDate)}</p>` : ''}
    <div class="pb-hero-search">
      <input type="search" placeholder="Search sections, steps, and keywords..." aria-label="Search playbook" oninput="filterPlaybookCards(this.value)">
    </div>
  </section>
  <main class="pb-main" role="main">
    <div class="pb-cards-grid" id="pb-cards">
      ${partsCardsHtml}
    </div>
    <div class="pb-no-results" style="display:none;">No sections match your search. Try different keywords.</div>
    <section id="pb-part-detail" class="pb-part-detail-area" aria-live="polite"></section>
  </main>
  <footer class="pb-footer">
    ${footerEntity ? `<p class="pb-footer-entity">${escapeHtml(footerEntity)}</p>` : ''}
    ${footerAgency ? `<p class="pb-footer-agency">${escapeHtml(footerAgency)}</p>` : ''}
    ${footerDate ? `<p class="pb-footer-date">${escapeHtml(footerDate)}</p>` : ''}
  </footer>
  <script>${js}${playbookJs}</script>
  ${partDetailHtml}
</body>
</html>`;
}

// ============ Main Export ============

/**
 * Generate a self-contained HTML page
 */
export async function generateHtml(options: HtmlOptions): Promise<HtmlResult> {
  const { title, content, branding, disclaimerConfig, metadata } = options;

  // Reset counters for each generation
  chartCounter = 0;
  diagramCounter = 0;

  // Parse content into segments
  const segments = parseContent(content);

  // Determine page type: explicit override wins, else auto-detect
  const pageType: HtmlPageType = options.pageType || detectPageType(segments, title);

  // Extract TOC for documentation, book, and report pages
  const toc = (pageType === 'documentation' || pageType === 'book' || pageType === 'report') ? extractToc(segments) : [];

  // Build CSS and JS
  const css = buildCss(branding, pageType);
  const js = buildJs();

  // Build disclaimer HTML
  const disclaimerHtml = disclaimerConfig?.enabled && disclaimerConfig.fullText
    ? `<div class="disclaimer">${escapeHtml(disclaimerConfig.fullText)}</div>`
    : '';

  // Render content segments to HTML
  const contentHtml = renderSegments(segments);

  // Date for footer
  const date = metadata?.date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Assemble final HTML based on page type
  let html: string;
  if (pageType === 'documentation') {
    html = buildDocumentationTemplate(title, contentHtml, toc, branding, css, js, disclaimerHtml, date);
  } else if (pageType === 'book') {
    html = buildBookTemplate(title, contentHtml, toc, branding, css, js, disclaimerHtml, date);
  } else if (pageType === 'report') {
    html = buildReportTemplate(title, contentHtml, toc, branding, css, js, disclaimerHtml, date);
  } else if (pageType === 'dashboard') {
    html = buildDashboardTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
  } else if (pageType === 'website') {
    html = buildWebsiteTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
  } else if (pageType === 'playbook') {
    html = buildPlaybookTemplate(title, segments, branding, css, js, date);
  } else if (pageType === 'roadmap') {
    html = buildRoadmapTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
  } else {
    html = buildWebpageTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
  }

  const buffer = Buffer.from(html, 'utf-8');

  return {
    buffer,
    fileSize: buffer.length,
    pageType,
    chartCount: chartCounter,
    diagramCount: diagramCounter,
  };
}

// ============ HTML Source Generator (for DOCX conversion) ============

/**
 * Extract TOC entries from pre-rendered HTML (mammoth output).
 * Works with <h1>, <h2>, <h3>, <h4> tags.
 */
function extractTocFromHtml(sourceHtml: string): TocEntry[] {
  const toc: TocEntry[] = [];
  const idCounts: Record<string, number> = {};

  // Match h1-h4 tags with their text content
  const headingRegex = /<h([1-4])[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  let match;

  while ((match = headingRegex.exec(sourceHtml)) !== null) {
    const level = parseInt(match[1], 10);
    // Strip any inner HTML tags to get plain text
    const rawText = match[2].replace(/<[^>]+>/g, '').trim();
    if (!rawText) continue;

    let id = rawText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (idCounts[id]) {
      idCounts[id]++;
      id = id + '-' + idCounts[id];
    } else {
      idCounts[id] = 1;
    }
    toc.push({ level, text: rawText, id });
  }

  return toc;
}

/**
 * Sanitize mammoth HTML: strip dangerous tags while preserving safe content.
 * Removes <script>, <style>, <link>, <iframe>, <object>, <embed>, <form>.
 * Adds anchor IDs to headings that don't have them.
 */
function sanitizeMammothHtml(sourceHtml: string): string {
  // Remove dangerous tags
  let html = sourceHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  html = html.replace(/<link\b[^>]+>/gi, '');
  html = html.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  html = html.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  html = html.replace(/<embed\b[^>]+>/gi, '');
  html = html.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '');
  html = html.replace(/javascript:/gi, '');

  // Add IDs to headings that don't have them
  const idCounts: Record<string, number> = {};
  html = html.replace(/<h([1-4])([^>]*)>([\s\S]*?)<\/h[1-4]>/gi, (_, level, attrs, content) => {
    // Skip if already has an id
    if (/id="/.test(attrs)) return _;
    const plainText = content.replace(/<[^>]+>/g, '').trim();
    let id = plainText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) return _;
    if (idCounts[id]) {
      idCounts[id]++;
      id = id + '-' + idCounts[id];
    } else {
      idCounts[id] = 1;
    }
    return `<h${level}${attrs} id="${id}">${content}</h${level}>`;
  });

  return html;
}

function sourceHtmlToPlaybookSegments(sanitizedHtml: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let currentBody: string[] = [];

  const flush = () => {
    if (currentBody.length > 0) {
      segments.push({ type: 'markdown', content: currentBody.join('\n') });
      currentBody = [];
    }
  };

  // Count heading occurrences to determine correct hierarchy
  const h2Count = (sanitizedHtml.match(/<h2[^>]*>/gi) || []).length;
  const h3Count = (sanitizedHtml.match(/<h3[^>]*>/gi) || []).length;
  const h4Count = (sanitizedHtml.match(/<h4[^>]*>/gi) || []).length;

  // Determine which heading to use for parts (cards)
  // If multiple h2: h2 → parts, h3 → topics
  // If single h2 + multiple h3: h2 is title-only, h3 → parts, h4 → topics
  // If no h2 + multiple h3: h3 → parts, h4 → topics
  // Otherwise: single overview section
  let partTag: string | null = null;
  let topicTag: string | null = null;
  let stripFirstH2 = false;

  if (h2Count > 1) {
    // Multiple h2 headings: use h2 for parts
    partTag = 'h2';
    topicTag = 'h3';
  } else if (h2Count === 1 && h3Count > 1) {
    // Single h2 (title) + multiple h3: use h3 for parts, strip the h2
    partTag = 'h3';
    topicTag = 'h4';
    stripFirstH2 = true;
  } else if (h2Count === 0 && h3Count > 1) {
    // No h2, multiple h3: use h3 for parts
    partTag = 'h3';
    topicTag = 'h4';
  } else if (h3Count === 1 && h4Count > 1) {
    // Single h3 (title) + multiple h4: use h4 for parts
    partTag = 'h4';
    topicTag = null;
  }

  if (!partTag) {
    // No part headings found, treat entire source as one section
    segments.push({ type: 'markdown', content: sanitizedHtml });
    return segments;
  }

  // Strip the first h2 if it's just a title (not a part heading)
  let workingHtml = sanitizedHtml;
  if (stripFirstH2) {
    // Remove the first h2 tag and its content (the title)
    workingHtml = workingHtml.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '');
    // Also remove any paragraph immediately after the h2 that looks like a subtitle
    // (first <p> tag right after the h2, before any h3)
    workingHtml = workingHtml.replace(/^\s*<p[^>]*>(?!<strong>|<em>|<a\s|<img\s)([\s\S]*?)<\/p>/i, (match, content) => {
      // Only strip if it's a short paragraph (likely subtitle)
      const plainText = content.replace(/<[^>]+>/g, '').trim();
      if (plainText.length < 200 && !plainText.includes('\n')) {
        return '';
      }
      return match;
    });
  }

  // Build regex for part headings
  const partRegex = new RegExp(`<${partTag}([^>]*)>([\\s\\S]*?)<\\/${partTag}>`, 'gi');
  let lastIndex = 0;
  let match;

  while ((match = partRegex.exec(workingHtml)) !== null) {
    // Accumulate content before this part heading
    if (lastIndex === 0) {
      const before = workingHtml.substring(0, match.index).trim();
      if (before) {
        currentBody.push(before);
        flush();
      }
    } else {
      flush();
    }
    // Start new section with ## heading (for parts/cards)
    const rawText = match[2].replace(/<[^>]+>/g, '').trim();
    currentBody.push('## ' + rawText);
    flush();
    lastIndex = match.index + match[0].length;
  }

  // Remaining content after last part heading
  if (lastIndex < workingHtml.length) {
    const after = workingHtml.substring(lastIndex).trim();
    if (after) {
      currentBody.push(after);
      flush();
    }
  }

  // If no segments were created, treat entire source as one section
  if (segments.length === 0) {
    segments.push({ type: 'markdown', content: workingHtml });
  }

  // Post-process: convert topic headings to ### in the markdown content
  if (topicTag) {
    const topicRegex = new RegExp(`<${topicTag}([^>]*)>([\\s\\S]*?)<\\/${topicTag}>`, 'gi');
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].type === 'markdown') {
        segments[i] = {
          type: 'markdown',
          content: (segments[i] as any).content.replace(topicRegex, (_: string, attrs: string, content: string) => {
            const text = content.replace(/<[^>]+>/g, '').trim();
            return '### ' + text;
          })
        };
      }
    }
  }

  return segments;
}

/**
 * Generate a self-contained HTML page from pre-rendered HTML source.
 * Used when converting DOCX → HTML via mammoth.convertToHtml().
 * Supports both documentation and playbook output layouts.
 */
export async function generateHtmlFromSource(options: HtmlSourceOptions): Promise<{
  buffer: Buffer;
  fileSize: number;
  tocCount: number;
}> {
  const { title, sourceHtml, branding, metadata, pageType } = options;

  // Sanitize the mammoth HTML
  const sanitizedHtml = sanitizeMammothHtml(sourceHtml);

  // Date for footer
  const date = metadata?.date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Build CSS and JS
  const css = buildCss(branding, pageType === 'playbook' ? 'playbook' : 'documentation');
  const js = buildJs();

  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  // Playbook path: convert source HTML into segments and render as cards
  if (pageType === 'playbook') {
    const segments = sourceHtmlToPlaybookSegments(sanitizedHtml);
    const html = buildPlaybookTemplate(title, segments, branding, css, js, date);

    const buffer = Buffer.from(html, 'utf-8');
    return {
      buffer,
      fileSize: buffer.length,
      tocCount: segments.filter(s => s.type === 'markdown').length,
    };
  }

  // Roadmap path: render source HTML content in the roadmap template
  if (pageType === 'roadmap') {
    const html = buildRoadmapTemplate(title, sanitizedHtml, branding, css, js, '', date);

    const buffer = Buffer.from(html, 'utf-8');
    return {
      buffer,
      fileSize: buffer.length,
      tocCount: 0,
    };
  }

  // Documentation path (default)
  const toc = extractTocFromHtml(sanitizedHtml);
  const tocHtml = buildTocHtml(toc);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${buildVendorScripts()}
  <style>${css}</style>
</head>
<body>
  <header class="site-header">
    <div class="header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
      <span class="header-title">${escapeHtml(title)}</span>
    </div>
    <div class="header-right">
      <input type="search" class="search-bar" placeholder="Search..." oninput="searchDocs(this.value)" aria-label="Search documentation">
    </div>
  </header>
  <div class="layout">
    ${tocHtml}
    <main class="main-content" role="main">
      <h1>${escapeHtml(title)}</h1>
      ${sanitizedHtml}
      <p style="margin-top:32px;font-size:0.8rem;color:#9ca3af">Converted ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
    </main>
  </div>
  <footer class="site-footer">
    ${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)} · Converted ${date}
  </footer>
  <script>${js}</script>
</body>
</html>`;

  const buffer = Buffer.from(html, 'utf-8');

  return {
    buffer,
    fileSize: buffer.length,
    tocCount: toc.length,
  };
}
