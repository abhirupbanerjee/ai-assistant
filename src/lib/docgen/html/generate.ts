/**
 * Main HTML generation orchestrator.
 */
import type { HtmlOptions, HtmlResult, HtmlPageType } from './types';
import { parseContent } from './parsing/content-parser';
import { detectPageType } from './parsing/page-type';
import { extractToc } from './parsing/toc';
import { buildCss } from './styles';
import { buildJs } from './client';
import { escapeHtml } from './markdown/escape';
import { renderSegments } from './renderers/render-segments';
import { serverRenderAll, type ServerRenderResult } from './server-renderer';

import { buildSimpleDocTemplate } from './templates/simple-doc';
import { buildDashboardTemplate } from './templates/dashboard';
import { buildPlaybookTemplate, buildPlaybookFromConfig } from './templates/playbook';
import { buildRoadmapTemplate, buildRoadmapFromConfig } from './templates/roadmap';
import { buildGanttTemplate } from './templates/gantt';
import { buildProjectPlanTemplate } from './templates/project-plan';
import { buildBookFromConfig, buildBookTemplate } from './templates/book';
import { buildReportFromConfig, buildReportTemplate } from './templates/report';
import type { GanttSegment, RoadmapSegment, PlaybookSegment, BookSegment, ReportSegment } from './types';

export async function generateHtml(options: HtmlOptions): Promise<HtmlResult> {
  const { title, content, branding, disclaimerConfig, metadata } = options;

  // Parse content into segments
  const segments = parseContent(content);

  // Determine page type
  const pageType: HtmlPageType = options.pageType || detectPageType(segments, title);

  // Extract TOC for book and report pages (documentation removed)
  const toc = (pageType === 'book' || pageType === 'report') ? extractToc(segments) : [];

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

  if (pageType === 'website') {
    // website uses the simple doc layout (hero enabled)
    html = buildSimpleDocTemplate('website', title, contentHtml, toc, branding, css, js, disclaimerHtml, date);
  } else if (pageType === 'dashboard') {
    html = buildDashboardTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date, segments, serverResult ?? undefined);
  } else if (pageType === 'book') {
    // Prefer JSON-driven path if a ```book block was parsed
    const bookSeg = segments.find((s): s is BookSegment => s.type === 'book');
    if (bookSeg) {
      html = buildBookFromConfig(title, bookSeg.config, branding, css, js, date);
    } else {
      html = buildBookTemplate(title, contentHtml, toc, branding, css, js, disclaimerHtml, date);
    }
  } else if (pageType === 'report') {
    // Prefer JSON-driven path if a ```report block was parsed
    const reportSeg = segments.find((s): s is ReportSegment => s.type === 'report');
    if (reportSeg) {
      html = buildReportFromConfig(title, reportSeg.config, branding, css, js, disclaimerHtml, date);
    } else {
      html = buildReportTemplate(title, contentHtml, toc, branding, css, js, disclaimerHtml, date);
    }
  } else if (pageType === 'playbook') {
    // Prefer JSON-driven path if a ```playbook block was parsed
    const playbookSeg = segments.find((s): s is PlaybookSegment => s.type === 'playbook');
    if (playbookSeg) {
      html = buildPlaybookFromConfig(title, playbookSeg.config, branding, css, js, date);
    } else {
      html = buildPlaybookTemplate(title, segments, branding, css, js, date, serverResult ?? undefined);
    }
  } else if (pageType === 'roadmap') {
    // Prefer JSON-driven path if a ```roadmap block was parsed
    const roadmapSeg = segments.find((s): s is RoadmapSegment => s.type === 'roadmap');
    if (roadmapSeg) {
      html = buildRoadmapFromConfig(title, roadmapSeg.config, branding, css, js, disclaimerHtml, date);
    } else {
      html = buildRoadmapTemplate(title, contentHtml, branding, css, js, disclaimerHtml, date);
    }
  } else if (pageType === 'gantt' || pageType === 'project_plan') {
    // Find the first gantt segment; fall back to empty config if none found
    const ganttSeg = segments.find((s): s is GanttSegment => s.type === 'gantt');
    const ganttCfg = ganttSeg?.config ?? { tasks: [] };
    const todayIso = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    if (pageType === 'project_plan') {
      html = buildProjectPlanTemplate(title, ganttCfg, branding, css, js, disclaimerHtml, date, todayIso);
    } else {
      html = buildGanttTemplate(title, ganttCfg, branding, css, js, disclaimerHtml, date, todayIso);
    }
  } else {
    // Fallback: treat unknown/chart types as website layout
    html = buildSimpleDocTemplate('website', title, contentHtml, [], branding, css, js, disclaimerHtml, date);
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
