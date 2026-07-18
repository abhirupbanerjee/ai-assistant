/**
 * Site Generator Tool Definition
 *
 * Generates multi-page themed websites from user requirements.
 * Features:
 * - 10 purpose-based themes (portfolio, product, company, blog, docs, dashboard, store, event, nonprofit, education)
 * - 15 page type templates (landing, article, dashboard, data-table, chart, form, list-grid, detail,
 *   diagram, playbook, timeline, faq, comparison, settings, gallery)
 * - Auto-selection of theme based on keyword matching
 * - LLM fallback for page types not available in the selected theme
 * - Context-aware sample data generation
 * - Multi-page assembly with navigation, footer, and cross-links
 * - Zip packaging for download
 * - DTCG design tokens compiled to CSS via Style Dictionary v4
 * - Dark mode CSS overrides (toggle UI deferred to v2)
 *
 * This tool is distinct from html_gen:
 * - html_gen -> single-page LLM-authored HTML artifacts (dashboards, books, reports)
 * - site_gen -> multi-page themed website generation with pre-built templates
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import { getToolConfig, TOOL_DEFAULTS } from '../db/compat/tool-config';
import { getRequestContext } from '../request-context';
import {
  getThreadContext,
  addThreadOutput,
  addWorkspaceOutput,
} from '@/lib/db/compat';

// ============ Types ============

/** All 10 supported theme IDs */
export type ThemeId =
  | 'portfolio'
  | 'product'
  | 'company'
  | 'blog'
  | 'documentation'
  | 'dashboard'
  | 'store'
  | 'event'
  | 'nonprofit'
  | 'education';

/** All 15 supported page type IDs */
export type PageTypeId =
  | 'landing'
  | 'article'
  | 'dashboard'
  | 'data-table'
  | 'chart'
  | 'form'
  | 'list-grid'
  | 'detail'
  | 'diagram'
  | 'playbook'
  | 'timeline'
  | 'faq'
  | 'comparison'
  | 'settings'
  | 'gallery';

export interface SiteGenConfig {
  enabled: boolean;
  defaultTheme: ThemeId;
  maxPagesPerSite: number;
  maxRetriesFallback: number;
  imagePlaceholderService: string;
  outputFormat: 'zip' | 'folder';
  includeReadme: boolean;
  includeSourceMaps: boolean;
  responsiveBreakpoints: number[];
  fontProvider: 'google-cdn';
  fontDisplayStrategy: 'swap';
  darkMode: {
    cssOverrides: boolean;
    toggleUi: boolean;
  };
}

export interface SiteGenArgs {
  /** The user's requirement description (used for theme selection and page planning) */
  requirement: string;
  /** Optional explicit theme override (bypasses auto-detection) */
  theme?: ThemeId;
  /** Optional explicit page types to generate (bypasses planner) */
  pages?: string[];
  /** Site name for the generated website */
  site_name?: string;
}

// ============ Config Schema ============

const siteGenConfigSchema = {
  type: 'object',
  properties: {
    defaultTheme: {
      type: 'string',
      title: 'Default Theme',
      description: 'Fallback theme when auto-detection has low confidence',
      enum: [
        'portfolio', 'product', 'company', 'blog', 'documentation',
        'dashboard', 'store', 'event', 'nonprofit', 'education',
      ],
      default: 'company',
    },
    maxPagesPerSite: {
      type: 'number',
      title: 'Max Pages Per Site',
      description: 'Maximum number of pages to generate per website',
      minimum: 1,
      maximum: 20,
      default: 10,
    },
    maxRetriesFallback: {
      type: 'number',
      title: 'Max LLM Fallback Retries',
      description: 'Maximum retries when LLM-generated fallback HTML fails validation',
      minimum: 0,
      maximum: 5,
      default: 2,
    },
    outputFormat: {
      type: 'string',
      title: 'Output Format',
      description: 'Output format for generated website',
      enum: ['zip', 'folder'],
      default: 'zip',
    },
    includeReadme: {
      type: 'boolean',
      title: 'Include README',
      description: 'Generate a README.md with project summary',
      default: true,
    },
    darkMode: {
      type: 'object',
      title: 'Dark Mode',
      description: 'Dark mode settings (CSS overrides are always generated; toggle UI is v2)',
      properties: {
        cssOverrides: {
          type: 'boolean',
          title: 'CSS Overrides',
          description: 'Generate dark mode CSS overrides',
          default: true,
        },
        toggleUi: {
          type: 'boolean',
          title: 'Toggle UI',
          description: 'Include dark mode toggle UI (v2 feature)',
          default: false,
        },
      },
    },
  },
};

// ============ Validation ============

function validateSiteGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  const validThemes = [
    'portfolio', 'product', 'company', 'blog', 'documentation',
    'dashboard', 'store', 'event', 'nonprofit', 'education',
  ];

  if (config.defaultTheme && !validThemes.includes(config.defaultTheme as string)) {
    errors.push(`defaultTheme must be one of: ${validThemes.join(', ')}`);
  }

  if (config.maxPagesPerSite !== undefined) {
    const max = config.maxPagesPerSite as number;
    if (typeof max !== 'number' || max < 1 || max > 20) {
      errors.push('maxPagesPerSite must be between 1 and 20');
    }
  }

  if (config.maxRetriesFallback !== undefined) {
    const retries = config.maxRetriesFallback as number;
    if (typeof retries !== 'number' || retries < 0 || retries > 5) {
      errors.push('maxRetriesFallback must be between 0 and 5');
    }
  }

  if (config.outputFormat && !['zip', 'folder'].includes(config.outputFormat as string)) {
    errors.push('outputFormat must be "zip" or "folder"');
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const siteGenTool: ToolDefinition = {
  name: 'site_gen',
  displayName: 'Website Generator',
  description:
    'Generate multi-page themed websites from user requirements. Auto-selects a theme (portfolio, product, company, blog, documentation, dashboard, store, event, nonprofit, education) and generates themed pages with navigation, footer, and sample content. Outputs a downloadable zip file.',

  category: 'autonomous',

  definition: {
    type: 'function' as const,
    function: {
      name: 'site_gen',
      description: [
        'Generate a complete multi-page themed website based on user requirements.',
        '',
        'Use this tool when the user asks to:',
        '- Create a website, site, or web presence',
        '- Build a portfolio, company site, blog, or landing page',
        '- Generate a documentation site, dashboard, or storefront',
        '- Make an event page, nonprofit site, or educational platform',
        '',
        'Do NOT use for single HTML pages (use html_gen instead).',
        'Do NOT use for PDF or Word documents (use doc_gen instead).',
        '',
        'HOW IT WORKS:',
        '1. Auto-detects the best theme from 10 options based on keywords in the requirement',
        '2. Plans which page types are needed (landing, gallery, form, etc.)',
        '3. Generates each page using pre-built themed templates or LLM fallback',
        '4. Assembles pages with shared navigation, footer, and cross-links',
        '5. Packages everything into a downloadable zip file',
        '',
        'AVAILABLE THEMES:',
        '- portfolio: Personal/creative showcase (photographers, designers, developers)',
        '- product: SaaS/product marketing landing pages',
        '- company: Corporate/business presence sites',
        '- blog: Content publishing and article sites',
        '- documentation: Technical docs, API references, knowledge bases',
        '- dashboard: Data analytics and admin interfaces',
        '- store: E-commerce product listings and catalogs',
        '- event: Conference, meetup, and workshop sites',
        '- nonprofit: NGO, charity, and foundation sites',
        '- education: Course, LMS, and training platforms',
        '',
        'The generated website will include shared navigation, footer, themed CSS (with dark mode support),',
        'Google Fonts, and a README.md. Each page is a self-contained HTML file with proper semantic structure.',
        '',
        'IMPORTANT: After calling site_gen, do NOT call it again unless the user explicitly requests another website.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          requirement: {
            type: 'string',
            description: 'The user\'s full requirement description. Used to auto-detect the best theme and plan which pages to generate. Include all relevant context the user provided about their desired website.',
          },
          theme: {
            type: 'string',
            enum: [
              'portfolio', 'product', 'company', 'blog', 'documentation',
              'dashboard', 'store', 'event', 'nonprofit', 'education',
            ],
            description: 'Optional: Explicitly specify a theme to override auto-detection. Only use if the user explicitly names a theme type.',
          },
          pages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Explicit list of page types to generate. Only use if the user explicitly lists specific pages they want.',
          },
          site_name: {
            type: 'string',
            description: 'Optional: The website/project name. If not provided, derived from the requirement.',
          },
        },
        required: ['requirement'],
      },
    },
  },

  validateConfig: validateSiteGenConfig,

  defaultConfig: {
    defaultTheme: 'company',
    maxPagesPerSite: 10,
    maxRetriesFallback: 2,
    imagePlaceholderService: 'https://placehold.co',
    outputFormat: 'zip',
    includeReadme: true,
    includeSourceMaps: false,
    responsiveBreakpoints: [768, 1024],
    fontProvider: 'google-cdn',
    fontDisplayStrategy: 'swap',
    darkMode: {
      cssOverrides: true,
      toggleUi: false,
    },
  },

  configSchema: siteGenConfigSchema,

  execute: async (args: SiteGenArgs): Promise<string> => {
    try {
      const context = getRequestContext();
      const { threadId } = context;

      if (!threadId) {
        return JSON.stringify({
          error: 'Website generation requires an active chat thread',
          errorCode: 'NO_CONTEXT',
        });
      }

      // Get tool configuration
      const toolConfig = await getToolConfig('site_gen');
      const config = (toolConfig?.config || {}) as Record<string, unknown>;

      if (!toolConfig?.isEnabled) {
        return JSON.stringify({
          error: 'Website generation is currently disabled',
          errorCode: 'TOOL_DISABLED',
        });
      }

      const siteGenConfig: SiteGenConfig = {
        enabled: toolConfig?.isEnabled ?? true,
        defaultTheme: (config.defaultTheme as ThemeId) || 'company',
        maxPagesPerSite: (config.maxPagesPerSite as number) || 10,
        maxRetriesFallback: (config.maxRetriesFallback as number) || 2,
        imagePlaceholderService: (config.imagePlaceholderService as string) || 'https://placehold.co',
        outputFormat: (config.outputFormat as 'zip' | 'folder') || 'zip',
        includeReadme: (config.includeReadme as boolean) ?? true,
        includeSourceMaps: (config.includeSourceMaps as boolean) ?? false,
        responsiveBreakpoints: (config.responsiveBreakpoints as number[]) || [768, 1024],
        fontProvider: (config.fontProvider as 'google-cdn') || 'google-cdn',
        fontDisplayStrategy: (config.fontDisplayStrategy as 'swap') || 'swap',
        darkMode: (config.darkMode as SiteGenConfig['darkMode']) || {
          cssOverrides: true,
          toggleUi: false,
        },
      };

      // Validate thread context
      const threadContext = await getThreadContext(threadId);
      if (!threadContext.exists) {
        return JSON.stringify({
          error: 'Thread not found - cannot save generated website',
          errorCode: 'THREAD_NOT_FOUND',
        });
      }

      // Run the full site generation pipeline
      const { runPipeline } = await import('../site-gen/pipeline/orchestrator');

      const result = await runPipeline({
        requirement: args.requirement,
        explicitTheme: args.theme,
        explicitPages: args.pages,
        siteName: args.site_name,
        config: siteGenConfig,
      });

      // Save zip to disk
      const outputDir = (await import('../docgen/branding')).getOutputDirectory();
      const zipFilename = (await import('../site-gen/packager/zip')).getZipFilename(result.projectName);
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      const filepath = join(outputDir, zipFilename);
      writeFileSync(filepath, result.zipBuffer);

      // Save to thread/workspace output
      const generationConfig = JSON.stringify({
        theme: result.themeId,
        themeName: result.themeName,
        pages: result.pages,
        fallbackCount: result.fallbackCount,
      });

      let docId: number;
      let downloadUrlPrefix: string;

      if (threadContext.isWorkspace) {
        const wsResult = await addWorkspaceOutput(
          threadContext.workspaceId!,
          threadContext.sessionId!,
          threadContext.actualThreadId ?? null,
          zipFilename,
          filepath,
          'html',
          result.zipBuffer.length,
          generationConfig,
          null
        );
        docId = wsResult.id;
        downloadUrlPrefix = '/api/workspace-documents';
      } else {
        const outputResult = await addThreadOutput(
          threadId,
          null,
          zipFilename,
          filepath,
          'html',
          result.zipBuffer.length,
          generationConfig,
          null
        );
        docId = outputResult.id;
        downloadUrlPrefix = '/api/documents';
      }

      const fileSizeMB = result.zipBuffer.length / (1024 * 1024);
      const themeDisplayName = result.themeName;

      return JSON.stringify({
        success: true,
        message: `Website generated successfully using the ${themeDisplayName} theme with ${result.pageCount} pages. Do NOT call site_gen again unless the user explicitly requests another website.`,
        website: {
          id: docId,
          filename: zipFilename,
          fileSize: result.zipBuffer.length,
          fileSizeFormatted: fileSizeMB >= 1
            ? `${fileSizeMB.toFixed(2)} MB`
            : `${(result.zipBuffer.length / 1024).toFixed(1)} KB`,
          downloadUrl: `${downloadUrlPrefix}/${docId}/download`,
          theme: result.themeId,
          themeName: themeDisplayName,
          pages: result.pages,
          pageCount: result.pageCount,
          fallbackCount: result.fallbackCount,
        },
      });
    } catch (error) {
      console.error('[SiteGen] Generation error:', error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error during website generation',
        errorCode: 'GENERATION_ERROR',
      });
    }
  },
};

// ============ Convenience Functions ============

export async function getSiteGenConfig(): Promise<SiteGenConfig> {
  const toolConfig = await getToolConfig('site_gen');
  const config = (toolConfig?.config || {}) as Record<string, unknown>;

  return {
    enabled: toolConfig?.isEnabled ?? true,
    defaultTheme: (config.defaultTheme as ThemeId) || 'company',
    maxPagesPerSite: (config.maxPagesPerSite as number) || 10,
    maxRetriesFallback: (config.maxRetriesFallback as number) || 2,
    imagePlaceholderService: (config.imagePlaceholderService as string) || 'https://placehold.co',
    outputFormat: (config.outputFormat as 'zip' | 'folder') || 'zip',
    includeReadme: (config.includeReadme as boolean) ?? true,
    includeSourceMaps: (config.includeSourceMaps as boolean) ?? false,
    responsiveBreakpoints: (config.responsiveBreakpoints as number[]) || [768, 1024],
    fontProvider: (config.fontProvider as 'google-cdn') || 'google-cdn',
    fontDisplayStrategy: (config.fontDisplayStrategy as 'swap') || 'swap',
    darkMode: (config.darkMode as SiteGenConfig['darkMode']) || {
      cssOverrides: true,
      toggleUi: false,
    },
  };
}

export async function isSiteGenEnabled(): Promise<boolean> {
  const toolConfig = await getToolConfig('site_gen');
  return toolConfig?.isEnabled ?? true;
}
