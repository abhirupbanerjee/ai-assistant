/**
 * Pipeline Orchestrator
 *
 * Full end-to-end pipeline controller for website generation:
 * 1. Parse requirement → extract intent
 * 2. Select theme via keyword matching
 * 3. Plan which pages to generate
 * 4. For each page: load template + fill with data (or trigger LLM fallback)
 * 5. Assemble pages with shared nav, footer, Google Fonts
 * 6. Package into downloadable zip
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { ThemeId, PageTypeId, SiteGenConfig } from '../../tools/site-gen';
import { selectTheme } from '../themes/selector';
import { getAvailability, getAvailablePageTypes } from '../templates/mapper';
import { renderTemplate, loadTemplate, templateExists } from '../renderer/engine';
import { wrapPage, type PageInfo } from '../renderer/assembler';
import { generateSampleData } from '../data/generator';
import { packageWebsite, getZipFilename } from '../packager/zip';

// ============ Types ============

export interface PipelineInput {
  requirement: string;
  explicitTheme?: ThemeId;
  explicitPages?: string[];
  siteName?: string;
  config: SiteGenConfig;
}

export interface PipelineOutput {
  zipBuffer: Buffer;
  projectName: string;
  pageCount: number;
  themeId: ThemeId;
  themeName: string;
  pages: string[];
  fallbackCount: number;
}

interface PlannedPage {
  pageType: PageTypeId;
  title: string;
  slug: string;
  /** Whether template is available (full or partial) */
  hasTemplate: boolean;
}

// ============ Planner ============

/** Common page patterns derived from user intent */
function planPages(
  requirement: string,
  themeId: ThemeId,
  explicitPages?: string[],
  maxPages = 10
): PlannedPage[] {
  if (explicitPages?.length) {
    return explicitPages.slice(0, maxPages).map((pt, i) => {
      const pageType = pt as PageTypeId;
      const status = getAvailability(themeId, pageType);
      return {
        pageType,
        title: pageType.charAt(0).toUpperCase() + pageType.slice(1).replace(/-/g, ' '),
        slug: i === 0 ? 'index' : pageType,
        hasTemplate: status === 'full' || status === 'partial',
      };
    });
  }

  // Auto-plan based on requirement and available page types
  const available = getAvailablePageTypes(themeId);
  const pages: PlannedPage[] = [];

  // Always include landing
  if (available.includes('landing')) {
    pages.push({
      pageType: 'landing',
      title: 'Home',
      slug: 'index',
      hasTemplate: true,
    });
  }

  // Look for keyword hints in requirement
  const lower = requirement.toLowerCase();

  if (lower.includes('gallery') || lower.includes('portfolio') || lower.includes('showcase')) {
    if (available.includes('gallery') && pages.length < maxPages) {
      pages.push({ pageType: 'gallery', title: 'Gallery', slug: 'gallery', hasTemplate: true });
    }
  }

  if (lower.includes('contact') || lower.includes('form') || lower.includes('sign up')) {
    if (available.includes('form') && pages.length < maxPages) {
      pages.push({ pageType: 'form', title: 'Contact', slug: 'contact', hasTemplate: true });
    }
  }

  if (lower.includes('blog') || lower.includes('article') || lower.includes('news')) {
    if (available.includes('article') && pages.length < maxPages) {
      pages.push({ pageType: 'article', title: 'Blog', slug: 'blog', hasTemplate: true });
    }
  }

  if (lower.includes('about') || lower.includes('team') || lower.includes('story')) {
    if (available.includes('detail') && pages.length < maxPages) {
      pages.push({ pageType: 'detail', title: 'About', slug: 'about', hasTemplate: true });
    }
  }

  if (lower.includes('faq') || lower.includes('question')) {
    if (available.includes('faq') && pages.length < maxPages) {
      pages.push({ pageType: 'faq', title: 'FAQ', slug: 'faq', hasTemplate: true });
    }
  }

  if (lower.includes('price') || lower.includes('pricing') || lower.includes('compare')) {
    if (available.includes('comparison') && pages.length < maxPages) {
      pages.push({ pageType: 'comparison', title: 'Pricing', slug: 'pricing', hasTemplate: true });
    }
  }

  // Fill remaining slots with sensible defaults
  const defaults: PageTypeId[] = ['detail', 'list-grid', 'article', 'form', 'faq'];
  for (const pt of defaults) {
    if (pages.length >= maxPages) break;
    if (!pages.some(p => p.pageType === pt) && available.includes(pt)) {
      const status = getAvailability(themeId, pt);
      pages.push({
        pageType: pt,
        title: pt.charAt(0).toUpperCase() + pt.slice(1).replace(/-/g, ' '),
        slug: pt,
        hasTemplate: status === 'full' || status === 'partial',
      });
    }
  }

  return pages;
}

// ============ Main Pipeline ============

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { requirement, explicitTheme, explicitPages, siteName, config } = input;

  // 1. Select theme
  const selection = selectTheme(requirement, explicitTheme);
  const themeId = selection.themeId;

  // 2. Plan pages
  const plannedPages = planPages(requirement, themeId, explicitPages as PageTypeId[] | undefined, config.maxPagesPerSite);

  // 3. Determine site name
  const resolvedSiteName = siteName || deriveSiteName(requirement);

  // 4. Generate each page
  const outputDir = join(tmpdir(), `site-gen-${randomUUID()}`);
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'assets', 'css'), { recursive: true });

  const pages: PageInfo[] = plannedPages.map(p => ({
    slug: p.slug,
    title: p.title,
    isActive: false,
  }));

  let fallbackCount = 0;

  for (let i = 0; i < plannedPages.length; i++) {
    const planned = plannedPages[i];
    const data = generateSampleData(themeId, planned.pageType, resolvedSiteName);

    let pageContent: string;

    if (planned.hasTemplate && templateExists(planned.pageType)) {
      // Use pre-built template
      const template = loadTemplate(planned.pageType);
      pageContent = renderTemplate(template, data);
    } else {
      // LLM fallback — generate minimal placeholder
      fallbackCount++;
      pageContent = generateFallbackHtml(planned.pageType, themeId, data);
    }

    // Wrap in full HTML document
    const fullHtml = wrapPage(pageContent, planned.title, {
      themeId,
      themeName: themeId.charAt(0).toUpperCase() + themeId.slice(1),
      siteName: resolvedSiteName,
      pages,
    }, i);

    // Write file
    const filename = planned.slug === 'index' ? 'index.html' : `${planned.slug}.html`;
    writeFileSync(join(outputDir, filename), fullHtml);
  }

  // 5. Copy theme CSS
  copyThemeCss(themeId, join(outputDir, 'assets', 'css'));

  // 6. Package
  const zipBuffer = await packageWebsite(outputDir, resolvedSiteName);

  return {
    zipBuffer,
    projectName: resolvedSiteName,
    pageCount: plannedPages.length,
    themeId,
    themeName: themeId.charAt(0).toUpperCase() + themeId.slice(1),
    pages: plannedPages.map(p => p.title),
    fallbackCount,
  };
}

// ============ Helpers ============

function deriveSiteName(requirement: string): string {
  // Simple heuristic: first 3-4 meaningful words
  const words = requirement
    .replace(/[^a-zA-Z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this'].includes(w.toLowerCase()));
  return words.slice(0, 4).join(' ') || 'My Website';
}

function copyThemeCss(themeId: ThemeId, cssDir: string): void {
  try {
    const { readFileSync } = require('fs');
    const srcPath = join(process.cwd(), 'src/lib/site-gen/themes/dist', themeId, 'global.css');
    const css = readFileSync(srcPath, 'utf8');
    writeFileSync(join(cssDir, 'global.css'), css);
  } catch {
    console.warn(`[Orchestrator] Could not copy theme CSS for ${themeId}`);
  }
}

/**
 * Generate minimal fallback HTML when no template is available.
 * Full LLM-based fallback will be implemented in Phase 6.
 */
function generateFallbackHtml(
  pageType: PageTypeId,
  _themeId: ThemeId,
  data: Record<string, unknown>
): string {
  const title = (data.page_title as string) || pageType;

  return `
<section class="page-section" style="padding: var(--spacing-section) var(--spacing-md);">
  <div class="container" style="max-width: var(--content-width); margin: 0 auto;">
    <h1 style="font-family: var(--font-heading); font-size: var(--font-size-h1); color: var(--color-text); margin-bottom: var(--spacing-md);">
      ${title}
    </h1>
    <div style="
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--border-radius);
      padding: var(--spacing-lg);
      text-align: center;
    ">
      <p style="font-family: var(--font-body); color: var(--color-text-muted);">
        This ${pageType.replace(/-/g, ' ')} page is generated as a placeholder.
        Full template support is coming in a future update.
      </p>
    </div>
  </div>
</section>`;
}
