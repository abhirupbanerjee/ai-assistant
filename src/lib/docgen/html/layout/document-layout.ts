/**
 * Shared document layout builder used by documentation, book, report, website, webpage.
 */
import type { BrandingConfig } from '../../branding';
import type { TocEntry, DocumentLayoutFlags } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';
import { buildTocHtml } from '../parsing/toc';

export function buildDocumentLayout(
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

  const tocHtml = flags.showToc ? buildTocHtml(toc, flags.tocHeading) : '';

  const langOptions = ['English', 'French', 'Spanish', 'Portuguese', 'Mandarin', 'Hindi']
    .map((lang) => `<option value="${lang.toLowerCase()}">${lang}</option>`)
    .join('');
  const langSelectorHtml = flags.showLangSelector
    ? `<select aria-label="Language selector" style="padding:6px 10px;border-radius:8px;border:none;">${langOptions}</select>`
    : '';

  const searchHtml = `<input type="search" class="search-bar" placeholder="${escapeHtml(flags.searchPlaceholder)}" oninput="searchDocs(this.value)" aria-label="Search">`;

  const badgeHtml = flags.showMetadataBadge
    ? `<section style="margin-bottom:24px;padding:16px 18px;${flags.badgeStyle === 'border-left' ? 'border-left:4px solid #2563eb;border-radius:8px;background:#eff6ff;' : 'border:1px solid #e5e7eb;border-radius:10px;background:#fff;'}">
        <h1 style="margin-bottom:8px;">${escapeHtml(title)}</h1>
        <p style="font-size:0.9rem;color:${flags.badgeStyle === 'border-left' ? '#374151' : '#6b7280'};margin:0;">${flags.badgeLabel}${orgName ? ' · ' + escapeHtml(orgName) : ''}${flags.badgeStyle === 'border-left' ? ' · ' + date : ' · Generated ' + date}</p>
      </section>`
    : '';

  const heroHtml = flags.showHero
    ? `<section style="margin:22px 0 20px;padding:26px;border-radius:14px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#fff;">
        <h1 style="margin:0 0 10px;color:#fff;">${escapeHtml(title)}</h1>
        <p style="margin:0;opacity:0.95;">${escapeHtml(branding.heroSubtitle || 'Website')}</p>
      </section>`
    : '';

  const headerTitleHtml = flags.showHeaderTitle
    ? `<span class="header-title">${escapeHtml(title)}</span>`
    : '';

  const dashboardTitleHtml = !flags.showToc && !flags.showHeaderTitle && !flags.showHero
    ? `<span style="color:rgba(255,255,255,0.85);font-size:0.9rem;font-weight:600">${escapeHtml(title)}</span>`
    : '';

  const isDashboard = !flags.showToc && !flags.showHeaderTitle && !flags.showHero && !flags.showMetadataBadge;
  const mainContentClass = isDashboard ? 'main-content full-width' : 'main-content';
  const mainContentStyle = isDashboard ? 'padding:24px' : '';

  let mainInner: string;
  if (flags.showHero) {
    mainInner = `<main role="main" style="max-width:${flags.contentMaxWidth};margin:0 auto;padding:0 20px 28px;">
        ${heroHtml}
        ${disclaimerHtml}
        <section>${contentHtml}</section>
        <p style="margin-top:24px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
      </main>`;
  } else {
    mainInner = `<div class="layout">
        ${tocHtml}
        <main class="${mainContentClass}" style="${mainContentStyle}" role="main">
          ${isDashboard ? disclaimerHtml + '<div class="dashboard-grid">' + contentHtml + '</div>' : ''}
          ${!isDashboard ? (badgeHtml || `<h1>${escapeHtml(title)}</h1>`) + disclaimerHtml + contentHtml : ''}
          ${!isDashboard ? `<p style="margin-top:32px;font-size:0.8rem;color:#9ca3af">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>` : ''}
          ${isDashboard ? `<p style="margin-top:24px;font-size:0.8rem;color:#9ca3af;text-align:right">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>` : ''}
        </main>
      </div>`;
  }

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
