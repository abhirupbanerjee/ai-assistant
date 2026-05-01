/**
 * HTML Builder - Generate self-contained HTML pages
 *
 * Supports multiple page types:
 * - dashboard: Charts and diagrams in a grid layout
 * - documentation: TOC sidebar, search, navigation
 * - chart: Single or few charts
 * - webpage: General purpose HTML page
 *
 * Embeds Chart.js (charts) and Mermaid.js (diagrams) via CDN.
 * Imports sanitizeMermaidCode from diagram-gen/validator for quality parity.
 */

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
}

export interface HtmlResult {
  buffer: Buffer;
  fileSize: number;
  pageType: HtmlPageType;
  chartCount: number;
  diagramCount: number;
}

export type HtmlPageType = 'dashboard' | 'documentation' | 'book' | 'report' | 'website' | 'chart' | 'webpage';

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

// Supported Mermaid types for HTML output (scoped active set)
const SUPPORTED_MERMAID_TYPES = new Set([
  'flowchart', 'graph', 'mindmap', 'sequencediagram',
  'c4context', 'c4container', 'c4component',
  'classdiagram', 'statediagram', 'statediagram-v2',
  'erdiagram', 'userjourney', 'gantt', 'gitgraph',
  'pie', 'requirementdiagram',
]);

// ============ Content Parser ============

/**
 * Parse markdown content into typed segments
 */
function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const lines = content.split('\n');
  let i = 0;
  let currentMarkdown: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Detect fenced code blocks
    const fenceMatch = line.match(/^```(\w+)?\s*$/);
    if (fenceMatch) {
      const lang = (fenceMatch[1] || '').toLowerCase();

      // Flush accumulated markdown
      if (currentMarkdown.length > 0) {
        segments.push({ type: 'markdown', content: currentMarkdown.join('\n') });
        currentMarkdown = [];
      }

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
          segments.push({ type: 'chart', config, raw: blockContent });
        } catch {
          // Invalid JSON — treat as markdown code block
          currentMarkdown.push('```\n' + blockContent + '\n```');
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
    } else {
      currentMarkdown.push(line);
      i++;
    }
  }

  // Flush remaining markdown
  if (currentMarkdown.length > 0) {
    segments.push({ type: 'markdown', content: currentMarkdown.join('\n') });
  }

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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
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
  const notesHtml = seg.config.notes
    ? `<details class="chart-notes"><summary>Notes</summary><p>${escapeHtml(seg.config.notes)}</p></details>`
    : '';
  return `
<div class="chart-card">
  ${seg.config.title ? `<h4 class="chart-title">${escapeHtml(seg.config.title)}</h4>` : ''}
  <div class="chart-container">
    <canvas id="${id}"></canvas>
  </div>
  ${notesHtml}
  <script>
    (function() {
      var ctx = document.getElementById('${id}').getContext('2d');
      new Chart(ctx, ${chartConfig});
    })();
  </script>
</div>`;
}

function renderDiagramSegment(seg: DiagramSegment): string {
  diagramCounter++;
  const escapedCode = seg.code.replace(/</g, '<').replace(/>/g, '>');
  return `
<div class="diagram-card">
  <div class="mermaid">${escapedCode}</div>
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

// ============ TOC HTML Builder ============

function buildTocHtml(toc: TocEntry[]): string {
  if (toc.length === 0) return '';
  const items = toc.map(entry => {
    const indent = (entry.level - 2) * 16;
    return `<li style="padding-left:${indent}px"><a href="#${entry.id}" class="toc-link">${escapeHtml(entry.text)}</a></li>`;
  }).join('\n');
  return `<nav class="toc" id="toc-nav"><h3>Contents</h3><ul>${items}</ul></nav>`;
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
  '// Mermaid init',
  'if (typeof mermaid !== "undefined") {',
  '  mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });',
  '}',
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

// ============ Template Assemblers ============

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
  const tocHtml = buildTocHtml(toc);
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
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
      ${disclaimerHtml}
      ${contentHtml}
      <p style="margin-top:32px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
    </main>
  </div>
  <footer class="site-footer">
    ${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)} · Generated ${date}
  </footer>
  <script>${js}</script>
</body>
</html>`;
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
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
  <style>${css}</style>
</head>
<body>
  <header class="site-header">
    <div class="header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
    </div>
    <div class="header-right">
      <span style="color:rgba(255,255,255,0.85);font-size:0.9rem;font-weight:600">${escapeHtml(title)}</span>
    </div>
  </header>
  <main class="main-content full-width" style="padding:24px" role="main">
    ${disclaimerHtml}
    <div class="dashboard-grid">
      ${contentHtml}
    </div>
    <p style="margin-top:24px;font-size:0.8rem;color:#9ca3af;text-align:right">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
  </main>
  <script>${js}</script>
</body>
</html>`;
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
  const tocHtml = buildTocHtml(toc).replace('Contents', 'Chapters');
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  const langOptions = ['English', 'French', 'Spanish', 'Portuguese', 'Mandarin', 'Hindi']
    .map(lang => `<option value="${lang.toLowerCase()}">${lang}</option>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
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
      <input type="search" class="search-bar" placeholder="Search book..." oninput="searchDocs(this.value)" aria-label="Search book">
      <select aria-label="Language selector" style="padding:6px 10px;border-radius:8px;border:none;">
        ${langOptions}
      </select>
    </div>
  </header>
  <div class="layout">
    ${tocHtml}
    <main class="main-content" role="main">
      <section style="margin-bottom:24px;padding:16px 18px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;">
        <h1 style="margin-bottom:8px;">${escapeHtml(title)}</h1>
        <p style="font-size:0.9rem;color:#6b7280;margin:0;">${orgName ? escapeHtml(orgName) + ' · ' : ''}Ebook format · Generated ${date}</p>
      </section>
      ${disclaimerHtml}
      ${contentHtml}
      <p style="margin-top:32px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
    </main>
  </div>
  <footer class="site-footer">
    ${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)} · Book View · Generated ${date}
  </footer>
  <script>${js}</script>
</body>
</html>`;
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
  const tocHtml = buildTocHtml(toc);
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
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
      <input type="search" class="search-bar" placeholder="Search report..." oninput="searchDocs(this.value)" aria-label="Search report">
    </div>
  </header>
  <div class="layout">
    ${tocHtml}
    <main class="main-content" role="main">
      <section style="margin-bottom:24px;padding:16px 18px;border-left:4px solid #2563eb;border-radius:8px;background:#eff6ff;">
        <h1 style="margin-bottom:8px;">${escapeHtml(title)}</h1>
        <p style="font-size:0.9rem;color:#374151;margin:0;">Formal report · ${orgName ? escapeHtml(orgName) + ' · ' : ''}${date}</p>
      </section>
      ${disclaimerHtml}
      ${contentHtml}
      <p style="margin-top:32px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
    </main>
  </div>
  <footer class="site-footer">
    ${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)} · Report View · Generated ${date}
  </footer>
  <script>${js}</script>
</body>
</html>`;
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
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  const langOptions = ['English', 'French', 'Spanish', 'Portuguese', 'Mandarin', 'Hindi']
    .map(lang => `<option value="${lang.toLowerCase()}">${lang}</option>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
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
      <input type="search" class="search-bar" placeholder="Search website..." oninput="searchDocs(this.value)" aria-label="Search website">
      <select aria-label="Language selector" style="padding:6px 10px;border-radius:8px;border:none;">
        ${langOptions}
      </select>
    </div>
  </header>
  <main role="main" style="max-width:1200px;margin:0 auto;padding:0 20px 28px;">
    <section style="margin:22px 0 20px;padding:26px;border-radius:14px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#fff;">
      <h1 style="margin:0 0 10px;color:#fff;">${escapeHtml(title)}</h1>
      <p style="margin:0;opacity:0.95;">Comprehensive frontend website mockup · Backend/API routes are intentionally left as stubs.</p>
    </section>
    ${disclaimerHtml}
    <section>
      ${contentHtml}
    </section>
    <p style="margin-top:24px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
  </main>
  <footer class="site-footer">
    ${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)} · Website Mockup · Generated ${date}
  </footer>
  <script>${js}</script>
</body>
</html>`;
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
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
  <style>${css}</style>
</head>
<body>
  <header class="site-header">
    <div class="header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
    </div>
  </header>
  <div class="layout">
    <main class="main-content" role="main">
      <h1>${escapeHtml(title)}</h1>
      ${disclaimerHtml}
      ${contentHtml}
      <p style="margin-top:32px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
    </main>
  </div>
  <script>${js}</script>
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

  // Extract TOC for documentation pages
  const toc = pageType === 'documentation' ? extractToc(segments) : [];

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

/**
 * Generate a self-contained HTML page from pre-rendered HTML source.
 * Used when converting DOCX → HTML via mammoth.convertToHtml().
 * Wraps the source HTML in the documentation template with TOC sidebar and search.
 */
export async function generateHtmlFromSource(options: HtmlSourceOptions): Promise<{
  buffer: Buffer;
  fileSize: number;
  tocCount: number;
}> {
  const { title, sourceHtml, branding, metadata } = options;

  // Sanitize the mammoth HTML
  const sanitizedHtml = sanitizeMammothHtml(sourceHtml);

  // Extract TOC from headings
  const toc = extractTocFromHtml(sanitizedHtml);

  // Build CSS and JS
  const css = buildCss(branding, 'documentation');
  const js = buildJs();

  // Build TOC HTML
  const tocHtml = buildTocHtml(toc);

  // Date for footer
  const date = metadata?.date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Assemble the full documentation template
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
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
