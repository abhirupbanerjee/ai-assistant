/**
 * Page Assembler
 *
 * Assembles individual pages into a complete website with:
 * - Wrapped HTML document structure (<!DOCTYPE html>, <head>, <body>)
 * - Google Fonts <link> tags from theme font tokens
 * - Theme CSS (<link> to global.css)
 * - Shared navigation injected into every page
 * - Shared footer injected into every page
 * - Cross-links between pages
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { ThemeId } from '../../tools/site-gen';
import { renderTemplate, loadComponent } from './engine';

const DIST_DIR = join(process.cwd(), 'src/lib/site-gen/themes/dist');

/** Font family → Google Fonts API parameter mapping */
const GOOGLE_FONT_MAP: Record<string, string> = {
  'Inter, sans-serif': 'Inter:wght@400;500;700',
  'Playfair Display, serif': 'Playfair+Display:wght@400;700',
  'Lora, serif': 'Lora:wght@400;700',
  'Poppins, sans-serif': 'Poppins:wght@400;500;700',
  'Merriweather, serif': 'Merriweather:wght@400;700',
  'Fira Code, monospace': 'Fira+Code:wght@400;500',
  'JetBrains Mono, monospace': 'JetBrains+Mono:wght@400;500',
};

/**
 * Read the compiled global.css for a theme.
 */
function loadThemeCss(themeId: ThemeId): string {
  try {
    return readFileSync(join(DIST_DIR, themeId, 'global.css'), 'utf8');
  } catch {
    console.warn(`[Assembler] No global.css found for theme ${themeId}, using empty styles.`);
    return '';
  }
}

/**
 * Extract Google Font families from the theme CSS.
 */
function extractFontsFromCss(themeCss: string): string[] {
  const fonts = new Set<string>();
  // Match --font-heading, --font-body, --font-mono values
  const fontRegex = /--font-(?:heading|body|mono):\s*([^;]+);/g;
  let match;
  while ((match = fontRegex.exec(themeCss)) !== null) {
    const fontStack = match[1].trim();
    // Check if it's a Google Fonts family
    for (const [key, googleParam] of Object.entries(GOOGLE_FONT_MAP)) {
      if (fontStack.includes(key.split(',')[0].trim())) {
        fonts.add(googleParam);
        break;
      }
    }
  }
  return Array.from(fonts);
}

/**
 * Generate Google Fonts <link> tags.
 */
function generateFontLinks(fonts: string[]): string {
  if (fonts.length === 0) return '';

  const familyParam = fonts.join('&family=');
  return [
    '  <!-- Google Fonts -->',
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `  <link href="https://fonts.googleapis.com/css2?family=${familyParam}&display=swap" rel="stylesheet">`,
  ].join('\n');
}

export interface PageInfo {
  slug: string;
  title: string;
  isActive: boolean;
}

export interface AssemblyInput {
  themeId: ThemeId;
  themeName: string;
  siteName: string;
  pages: PageInfo[];
}

/**
 * Generate the nav HTML for a specific page.
 */
function renderNav(pages: PageInfo[]): string {
  const navTemplate = loadComponent('navigation');
  return renderTemplate(navTemplate, {
    site_name: '{{site_name}}', // Will be replaced later in wrapPage
    pages: pages.map(p => ({
      page_url: p.slug === 'index' ? 'index.html' : `${p.slug}.html`,
      page_label: p.title,
      is_active: p.isActive,
    })),
  });
}

/**
 * Generate the footer HTML.
 */
function renderFooter(siteName: string, themeName: string): string {
  const footerTemplate = loadComponent('footer');
  return renderTemplate(footerTemplate, {
    site_name: siteName,
    current_year: String(new Date().getFullYear()),
    theme_name: themeName,
  });
}

/**
 * Wrap page content in a full HTML document.
 */
export function wrapPage(
  content: string,
  pageTitle: string,
  assembly: AssemblyInput,
  isActiveIndex: number
): string {
  const themeCss = loadThemeCss(assembly.themeId);
  const fonts = extractFontsFromCss(themeCss);
  const fontLinks = generateFontLinks(fonts);

  const pagesWithActive = assembly.pages.map((p, i) => ({
    ...p,
    is_active: i === isActiveIndex,
  }));

  const navHtml = renderNav(pagesWithActive)
    .replace('{{site_name}}', assembly.siteName);
  const footerHtml = renderFooter(assembly.siteName, assembly.themeName);

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle} — ${assembly.siteName}</title>
${fontLinks}
  <style>
${themeCss}
  </style>
  <style>
    /* Base reset */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-body, system-ui, sans-serif);
      font-size: var(--font-size-base, 1rem);
      line-height: var(--line-height, 1.6);
      color: var(--color-text, #1e293b);
      background: var(--color-background, #ffffff);
    }
    .container {
      max-width: var(--content-width, 1200px);
      margin: 0 auto;
      padding: 0 var(--spacing-md, 1rem);
    }
    @media (max-width: 768px) {
      .container { padding: 0 var(--spacing-sm, 0.5rem); }
    }
  </style>
</head>
<body>
${navHtml}
  <main>
${content}
  </main>
${footerHtml}
</body>
</html>`;
}
