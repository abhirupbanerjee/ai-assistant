/**
 * Generate a self-contained HTML page from pre-rendered HTML source.
 * Used when converting DOCX → HTML via mammoth.convertToHtml().
 *
 * For gantt, project_plan, and dashboard page types, the source HTML is
 * converted to plain text and routed through generateHtml() so that
 * JSON fenced blocks (```gantt, ```chart, etc.) are parsed correctly.
 */
import type { HtmlSourceOptions } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildCss } from '../styles';
import { buildJs } from '../client';
import { buildVendorScripts } from '../vendor-bundles';
import { buildTocHtml, extractTocFromHtml } from '../parsing/toc';
import { sanitizeMammothHtml } from './sanitize';
import { sourceHtmlToPlaybookSegments } from './source-segments';
import { buildPlaybookTemplate } from '../templates/playbook';
import { buildRoadmapTemplate } from '../templates/roadmap';
import { generateHtml } from '../generate';

export async function generateHtmlFromSource(options: HtmlSourceOptions): Promise<{
  buffer: Buffer;
  fileSize: number;
  tocCount: number;
}> {
  const { title, sourceHtml, branding, metadata, pageType } = options;

  const sanitizedHtml = sanitizeMammothHtml(sourceHtml);

  const date = metadata?.date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const css = buildCss(branding, pageType === 'playbook' ? 'playbook' : 'website');
  const js = buildJs();

  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  if (pageType === 'playbook') {
    const segments = sourceHtmlToPlaybookSegments(sanitizedHtml);
    const html = buildPlaybookTemplate(title, segments, branding, css, js, date);
    const buffer = Buffer.from(html, 'utf-8');
    return {
      buffer,
      fileSize: buffer.length,
      tocCount: segments.filter((s) => s.type === 'markdown').length,
    };
  }

  if (pageType === 'roadmap') {
    const html = buildRoadmapTemplate(title, sanitizedHtml, branding, css, js, '', date);
    const buffer = Buffer.from(html, 'utf-8');
    return {
      buffer,
      fileSize: buffer.length,
      tocCount: 0,
    };
  }

  // For gantt, project_plan, and dashboard: extract plain text from the HTML
  // and route through generateHtml() so JSON fenced blocks are parsed correctly.
  if (pageType === 'gantt' || pageType === 'project_plan' || pageType === 'dashboard') {
    // Strip HTML tags to get plain text / markdown content
    const plainText = sanitizedHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const result = await generateHtml({
      title,
      content: plainText,
      branding,
      metadata: { date },
      pageType,
    });

    return {
      buffer: result.buffer,
      fileSize: result.fileSize,
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
