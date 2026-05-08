/**
 * Main HTML generation orchestrator.
 */
import type { HtmlOptions, HtmlResult, HtmlPageType, ContentSegment } from './types';
import { parseContent } from './parsing/content-parser';
import { detectPageType } from './parsing/page-type';
import { extractToc } from './parsing/toc';
import { buildCss } from './styles';
import { buildJs } from './client';
import { escapeHtml } from './markdown/escape';
import { renderSegments } from './renderers/render-segments';
import { serverRenderAll, type ServerRenderResult } from './server-renderer';

import { buildDocumentationTemplate } from './templates/documentation';
import { buildBookTemplate } from './templates/book';
import { buildReportTemplate } from './templates/report';
import { buildWebsiteTemplate } from './templates/website';
import { buildWebpageTemplate } from './templates/webpage';
import { buildDashboardTemplate } from './templates/dashboard';
import { buildPlaybookTemplate } from './templates/playbook';
import { buildRoadmapTemplate } from './templates/roadmap';

export async function generateHtml(options: HtmlOptions): Promise<HtmlResult> {
  const { title, content, branding, disclaimerConfig, metadata } = options;

  // Parse content into segments
  const segments = parseContent(content);

  // Determine page type
  const pageType: HtmlPageType = options.pageType || detectPageType(segments, title);

  // Extract TOC for documentation, book, and report pages
  const toc = (pageType === 'documentation' || pageType === 'book' || pageType === 'report') ? extractToc(segments) : [];

  // ---- Server-side rendering of charts and diagrams ----
  const chartConfigs: Array<{ index: number; config: import('./types').ChartBlockConfig }> = [];
  const diagramCodes: Array<{ index: number; code: string }> = [];

  segments.forEach((seg, i) => {
    if (seg.type === 'chart') {
      chartConfigs.push({ index: i, config: seg.config });
    } else if (seg.type === 'mermaid') {
      diagramCodes.push({ index: i, code: seg.code });
    }
  });

  let serverResult: ServerRenderResult | null = null;
  if (chartConfigs.length > 0 || diagramCodes.length > 0) {
    try {
      serverResult = await serverRenderAll(chartConfigs, diagramCodes);
    } catch (err) {
      console.warn('[generateHtml] Server-side rendering failed, falling back to client-side:', (err as Error).message);
      serverResult = { charts: new Map(), diagrams: new Map(), fallbackToClient: true };
    }
  }

  // Build CSS and JS
  const css = buildCss(branding, pageType);
  const js = buildJs();

  // Build disclaimer HTML
  const disclaimerHtml = disclaimerConfig?.enabled && disclaimerConfig.fullText
    ? `<div class="disclaimer">${escapeHtml(disclaimerConfig.fullText)}</div>`
    : '';

  // Render content segments to HTML (pass server-rendered results)
  const contentHtml = renderSegments(segments, serverResult ?? undefined);

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
    html = buildDashboardTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date, segments, serverResult ?? undefined);
  } else if (pageType === 'website') {
    html = buildWebsiteTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
  } else if (pageType === 'playbook') {
    html = buildPlaybookTemplate(title, segments, branding, css, js, date, serverResult ?? undefined);
  } else if (pageType === 'roadmap') {
    html = buildRoadmapTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
  } else {
    html = buildWebpageTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
  }

  const buffer = Buffer.from(html, 'utf-8');

  const chartCount = segments.filter((s) => s.type === 'chart').length;
  const diagramCount = segments.filter((s) => s.type === 'mermaid').length;

  return {
    buffer,
    fileSize: buffer.length,
    pageType,
    chartCount,
    diagramCount,
  };
}