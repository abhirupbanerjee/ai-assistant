/**
 * HTML Generator Tool Definition
 *
 * Generates interactive, self-contained HTML pages from chat content.
 * Supports dashboards, documentation, books, web pages, and report layouts.
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

export type HtmlGenPageType = 'auto' | 'dashboard' | 'documentation' | 'book' | 'report' | 'website' | 'playbook' | 'roadmap';

function mapPageType(pageType: HtmlGenPageType): HtmlPageType | undefined {
  switch (pageType) {
    case 'dashboard':
      return 'dashboard';
    case 'documentation':
      return 'documentation';
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
  '- dashboard: Create a Power BI-style analytical dashboard. Keep prose minimal — let the visuals tell the story. Layout has 5 zones: top title bar, KPI row, chart canvas (12-col grid), optional left filters rail, optional right data rail. Use the following fenced blocks (each must contain valid JSON). KPI tiles for the top row use ```kpi blocks (1-6 tiles recommended): {"label":"Revenue","value":"$2.4M","delta":"+12.4%","trend_direction":"positive","trend":[10,12,14,15,18,20],"tags":["region:north"]} where trend_direction is "positive"|"negative"|"neutral" and trend is an optional sparkline array. Chart panels use the standard ```chart block, optionally with "size":"hero"|"half"|"third"|"quarter" (defaults to half) and "tags":["category:sales"] for filterability. Optional filters rail uses a single ```filters block: {"title":"Filters","slicers":[{"id":"region","label":"Region","type":"multiselect","options":["North","South"],"tag_prefix":"region"}]} (slicer types: select, multiselect, search, daterange). Optional right data rail uses a single ```data block: {"title":"Details","items":[{"label":"Total Records","value":"1,284","note":"as of today"}],"table":{"headers":["Metric","Value"],"rows":[["Avg","42"]]}}. Tag conventions: tag_prefix on a slicer matches data-tags entries on charts/KPIs (intra-group OR, inter-group AND). Side rails are optional — only emit them when the user data benefits from filtering or detail views. Prefer Chart.js for quantitative visuals; use Mermaid for process/system visuals when charts are not suitable.',
  '- documentation: Create a polished HTML documentation page with clear sections using # ## ### headings. TOC sidebar + search are generated automatically.',
  '- book: Create an HTML ebook-style page with title and metadata (country/entity/company where available), and chapter-style headings so sidebar navigation is useful. Include language options in content: English, French, Spanish, Portuguese, Mandarin, Hindi.',
  '- report: Create a formal HTML report structure (executive summary, findings, recommendations). Include charts/diagrams/tables where they improve clarity.',
  '- website: Create a comprehensive front-end webpage mockup with header, hero, sections, and footer. Keep backend/API routes as stubs only.',
  '- playbook: Create an interactive government/organizational HTML playbook page. IMPORTANT heading contract: the tool title parameter is the page title; do not repeat the page title as content. In the content argument, use markdown heading syntax only for playbook structure: ## for each category/part/card, ### for each question/step/topic/accordion row inside a card, and #### only for lower-level details inside a topic. Do not use raw <h2>, <h3>, or <h4> HTML tags for playbook structure. Never put all content under a single ## Overview unless the user explicitly asks for a one-card overview. Avoid hard-coding phases or predefined sections unless the source content or user request explicitly includes them. Derive accent colors from branding.primaryColor or country/organization identity. Search bar in hero is mandatory.',
  '- roadmap: Create a visual HTML roadmap page with a horizontal timeline bar showing progression across phases. Use ## for each phase heading, ### for milestones within a phase. Include milestone markers, phase cards with descriptions, and a visual timeline bar at the top. Use accent colors from branding.primaryColor or derive from context.',
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

// ============ Config Schema ============

const htmlGenConfigSchema = {
  type: 'object',
  properties: {
    defaultPageType: {
      type: 'string',
      title: 'Default Page Type',
      description: 'Default page layout when not specified',
      enum: ['auto', 'dashboard', 'documentation', 'book', 'report', 'website', 'playbook', 'roadmap'],
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

  const validPageTypes = ['auto', 'dashboard', 'documentation', 'book', 'report', 'website', 'playbook', 'roadmap'];


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
    'Generate interactive, self-contained HTML pages (dashboards, documentation, books, reports, roadmaps, web pages, playbooks) with Chart.js charts, Mermaid diagrams, TOC sidebar, and search.',

  category: 'autonomous',

  definition: {
    type: 'function' as const,
    function: {
      name: 'html_gen',
      description: [
        'Generate an interactive HTML page from content. Use this tool when the user explicitly asks to create, export, download, or save an HTML web page, HTML dashboard, HTML documentation site, HTML book, HTML report, HTML roadmap, or any interactive HTML artifact with charts and/or diagrams.',
        '',
        'Do NOT use for PDF, Word, or Markdown documents (use doc_gen instead).',
        'Do NOT use for regular responses - only when explicitly requested.',
        '',
        'The generated HTML page will be displayed automatically in the chat with a download button.',
        '',
        'Guidelines for content by page_type:',
        '- auto: use only when user does not explicitly choose a format; otherwise use an explicit page_type.',
        '- dashboard: Power BI-style 5-zone layout (title bar, KPI row, chart canvas, optional left filters rail, optional right data rail). Use ```kpi blocks for top KPI tiles ({label,value,delta?,trend_direction?,trend?,tags?}), ```chart blocks for canvas panels (with optional "size":"hero|half|third|quarter" and "tags":[...] for filtering), one ```filters block for the left rail (slicers: select|multiselect|search|daterange), and one ```data block for the right rail (items + optional table). Side rails are optional — emit them only when filtering or supporting detail adds value. Keep prose minimal.',
        '- documentation: structured HTML documentation sections via markdown headings (# ## ###); TOC and search are generated automatically.',
        '- book: HTML ebook-style chapter hierarchy with metadata and language options (English, French, Spanish, Portuguese, Mandarin, Hindi).',
        '- report: formal HTML report structure (executive summary, findings, recommendations), with charts/diagrams where useful.',
        '- website: comprehensive frontend webpage mockup (header, hero, sections, footer), backend APIs as stubs only.',
        '- playbook: interactive government/organizational HTML playbook with sticky top bar, hero search bar, accordion section cards from ## headings, topic rows from ### headings, and optional detail headings from #### headings. The title argument is the page title; do not duplicate it in content.',
        '- roadmap: visual HTML roadmap page with a horizontal timeline bar showing progression across phases, phase cards with descriptions, and milestone markers.',
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
            description: 'Page content in markdown format. May include chart and mermaid fenced blocks. Include all relevant information the user wants in the page.',
          },
          page_type: {
            type: 'string',
            enum: ['auto', 'dashboard', 'documentation', 'book', 'report', 'website', 'playbook', 'roadmap'],
            description: 'Page layout type. auto = infer from content/title. dashboard = Power BI-style analytical dashboard with chart grid. documentation = structured HTML documentation with TOC+search. book = HTML ebook-style chapter layout with metadata and language options. report = formal HTML report layout with visuals where useful. website = comprehensive frontend webpage mockup with header/hero/sections/footer. playbook = interactive government/organizational HTML playbook with sticky top bar, hero search bar, accordion section cards, and playbook footer. roadmap = visual HTML roadmap page with timeline bar, phase cards, and milestone markers.',
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
