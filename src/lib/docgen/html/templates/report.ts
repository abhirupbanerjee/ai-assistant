/**
 * Report template — structured formal report renderer.
 *
 * Supports two rendering paths:
 *   1. JSON-driven (preferred): LLM emits a ```report fenced block with ReportBlockConfig
 *   2. Legacy markdown fallback: delegates to buildDocumentLayout with report flags
 *
 * Features:
 *   - Cover page with metadata (preparedFor, preparedBy, date, classification, version)
 *   - Executive Summary card with distinct visual treatment
 *   - Numbered sections with type-based visual indicators:
 *       findings      → blue left border
 *       recommendations → green left border
 *       methodology   → gray left border
 *       analysis      → purple left border
 *       background    → amber left border
 *       content       → default
 *   - Appendix section with A/B/C numbering
 *   - Sticky sidebar TOC
 *   - Print-optimized layout
 */
import type { BrandingConfig } from '../../branding';
import type { ReportBlockConfig, TocEntry } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';
import { markdownToHtml } from '../markdown/markdown-to-html';
import { buildDocumentLayout } from '../layout/document-layout';
import { DOCUMENT_LAYOUT_FLAGS } from '../layout/document-layout-flags';

// Section type → accent color
const SECTION_TYPE_COLORS: Record<string, string> = {
  findings: '#1a5c8a',
  analysis: '#5b2d8e',
  recommendations: '#1a7a3a',
  methodology: '#555',
  background: '#8b6914',
  content: '#ccc',
};

const SECTION_TYPE_LABELS: Record<string, string> = {
  findings: 'Findings',
  analysis: 'Analysis',
  recommendations: 'Recommendations',
  methodology: 'Methodology',
  background: 'Background',
  content: '',
};

// ─── JSON-driven path ────────────────────────────────────────────────────────

export function buildReportFromConfig(
  pageTitle: string,
  cfg: ReportBlockConfig,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const primary = branding.primaryColor || '#1a3a5c';
  const vendorScripts = buildVendorScripts();

  const meta = cfg.metadata || {};
  const reportDate = meta.date || date;

  // Build TOC entries
  const tocItems: Array<{ id: string; label: string; type?: string }> = [];
  if (cfg.executiveSummary) {
    tocItems.push({ id: 'exec-summary', label: 'Executive Summary' });
  }
  cfg.sections.forEach((sec, i) => {
    tocItems.push({ id: `section-${i + 1}`, label: sec.heading, type: sec.type });
  });
  if (cfg.appendices && cfg.appendices.length > 0) {
    cfg.appendices.forEach((app, i) => {
      tocItems.push({ id: `appendix-${i + 1}`, label: `Appendix ${String.fromCharCode(65 + i)}: ${app.title}` });
    });
  }

  // Sidebar TOC
  const tocHtml = `
    <nav class="report-toc" id="reportToc">
      <div class="toc-header">
        <span class="toc-title">Contents</span>
        <button class="toc-toggle" onclick="toggleToc()" title="Toggle">☰</button>
      </div>
      <ul class="toc-list">
        <li class="toc-item"><a href="#report-cover" class="toc-link toc-cover-link">Cover</a></li>
        ${tocItems.map(item => `
          <li class="toc-item">
            <a href="#${item.id}" class="toc-link${item.type ? ` toc-type-${item.type}` : ''}">
              ${item.type && SECTION_TYPE_LABELS[item.type] ? `<span class="toc-type-badge" style="background:${SECTION_TYPE_COLORS[item.type] || '#ccc'}">${SECTION_TYPE_LABELS[item.type]}</span>` : ''}
              <span class="toc-text">${escapeHtml(item.label)}</span>
            </a>
          </li>
        `).join('')}
      </ul>
    </nav>`;

  // Cover page
  const classificationBadge = meta.classification
    ? `<div class="cover-classification">${escapeHtml(meta.classification)}</div>`
    : '';

  const coverHtml = `
    <section class="report-cover" id="report-cover">
      ${logoHtml ? `<div class="cover-logo">${logoHtml}</div>` : ''}
      <div class="cover-content">
        ${classificationBadge}
        <h1 class="cover-title">${escapeHtml(pageTitle)}</h1>
        <div class="cover-meta-grid">
          ${meta.preparedFor ? `<div class="meta-row"><span class="meta-label">Prepared For</span><span class="meta-value">${escapeHtml(meta.preparedFor)}</span></div>` : ''}
          ${meta.preparedBy ? `<div class="meta-row"><span class="meta-label">Prepared By</span><span class="meta-value">${escapeHtml(meta.preparedBy)}</span></div>` : ''}
          ${reportDate ? `<div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">${escapeHtml(reportDate)}</span></div>` : ''}
          ${meta.version ? `<div class="meta-row"><span class="meta-label">Version</span><span class="meta-value">${escapeHtml(meta.version)}</span></div>` : ''}
        </div>
      </div>
    </section>`;

  // Executive Summary
  const execSummaryHtml = cfg.executiveSummary ? `
    <section class="report-exec-summary" id="exec-summary">
      <div class="exec-summary-header">
        <div class="exec-summary-icon">★</div>
        <h2 class="exec-summary-title">Executive Summary</h2>
      </div>
      <div class="exec-summary-body">
        ${markdownToHtml(cfg.executiveSummary)}
      </div>
    </section>` : '';

  // Sections
  const sectionsHtml = cfg.sections.map((sec, i) => {
    const secId = `section-${i + 1}`;
    const typeColor = SECTION_TYPE_COLORS[sec.type || 'content'] || '#ccc';
    const typeLabel = sec.type ? (SECTION_TYPE_LABELS[sec.type] || '') : '';
    const bodyHtml = markdownToHtml(sec.content || '');

    return `
      <section class="report-section" id="${secId}" data-type="${sec.type || 'content'}">
        <div class="section-header" style="border-left-color: ${typeColor}">
          <div class="section-meta">
            <span class="section-num">${i + 1}</span>
            ${typeLabel ? `<span class="section-type-badge" style="background:${typeColor}">${typeLabel}</span>` : ''}
          </div>
          <h2 class="section-title">${escapeHtml(sec.heading)}</h2>
        </div>
        <div class="section-body">
          ${bodyHtml}
        </div>
      </section>`;
  }).join('');

  // Appendices
  const appendicesHtml = cfg.appendices && cfg.appendices.length > 0 ? `
    <div class="report-appendices">
      <h2 class="appendices-heading">Appendices</h2>
      ${cfg.appendices.map((app, i) => {
        const appId = `appendix-${i + 1}`;
        const letter = String.fromCharCode(65 + i);
        return `
          <section class="report-appendix" id="${appId}">
            <h3 class="appendix-title">
              <span class="appendix-letter">Appendix ${letter}</span>
              ${escapeHtml(app.title)}
            </h3>
            <div class="appendix-body">
              ${markdownToHtml(app.content || '')}
            </div>
          </section>`;
      }).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    :root {
      --primary: ${primary};
      --primary-dark: color-mix(in srgb, ${primary} 80%, #000);
      --primary-light: color-mix(in srgb, ${primary} 15%, #fff);
      --font: ${branding.fontFamily || 'Segoe UI, Arial, sans-serif'};
      --toc-width: 280px;
      --header-h: 56px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font);
      background: #f5f5f5;
      color: #1a1a1a;
      display: flex; flex-direction: column; min-height: 100vh;
    }

    /* ── Header ── */
    .report-header {
      position: sticky; top: 0; z-index: 100;
      height: var(--header-h);
      background: var(--primary); color: #fff;
      display: flex; align-items: center; gap: 12px;
      padding: 0 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .header-logo { height: 32px; width: auto; }
    .header-title {
      flex: 1; font-size: 1rem; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .header-badge {
      font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      background: rgba(255,255,255,0.2);
      padding: 3px 10px; border-radius: 12px;
    }

    /* ── Layout ── */
    .report-body { display: flex; flex: 1; }

    /* ── TOC Sidebar ── */
    .report-toc {
      width: var(--toc-width); min-width: var(--toc-width);
      background: #fff; border-right: 1px solid #ddd;
      position: sticky; top: var(--header-h);
      height: calc(100vh - var(--header-h));
      overflow-y: auto; flex-shrink: 0;
      transition: width 0.25s, min-width 0.25s;
    }
    .report-toc.collapsed { width: 0; min-width: 0; overflow: hidden; }
    .toc-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 2px solid var(--primary);
      position: sticky; top: 0; background: #fff; z-index: 1;
    }
    .toc-title {
      font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--primary);
    }
    .toc-toggle {
      background: none; border: none; cursor: pointer;
      font-size: 1rem; color: var(--primary);
    }
    .toc-list { list-style: none; padding: 6px 0; }
    .toc-link {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 14px;
      font-size: 0.8rem; color: #444;
      text-decoration: none;
      border-left: 3px solid transparent;
      transition: background 0.15s, color 0.15s;
    }
    .toc-link:hover, .toc-link.active {
      background: var(--primary-light); color: var(--primary);
      border-left-color: var(--primary);
    }
    .toc-cover-link { font-style: italic; color: #888; }
    .toc-type-badge {
      font-size: 0.62rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: #fff; padding: 1px 6px; border-radius: 8px;
      white-space: nowrap; flex-shrink: 0;
    }
    .toc-text { flex: 1; }

    /* ── Main ── */
    .report-main {
      flex: 1; max-width: 860px; margin: 0 auto;
      padding: 0 48px 80px;
    }

    /* ── Cover ── */
    .report-cover {
      min-height: 70vh;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center;
      padding: 60px 40px;
      background: linear-gradient(160deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: #fff;
      margin: 0 -48px 60px;
    }
    .cover-logo { margin-bottom: 28px; }
    .cover-logo img { height: 52px; filter: brightness(0) invert(1); }
    .cover-classification {
      display: inline-block;
      font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.12em;
      border: 1px solid rgba(255,255,255,0.5);
      padding: 4px 14px; border-radius: 4px;
      margin-bottom: 20px; opacity: 0.85;
    }
    .cover-title {
      font-size: clamp(1.8rem, 4vw, 3rem);
      font-weight: 700; line-height: 1.2;
      margin-bottom: 32px;
    }
    .cover-meta-grid {
      display: grid; grid-template-columns: auto 1fr;
      gap: 10px 20px; text-align: left;
      background: rgba(255,255,255,0.1);
      padding: 20px 28px; border-radius: 8px;
      max-width: 480px; margin: 0 auto;
    }
    .meta-label {
      font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      opacity: 0.7; white-space: nowrap;
    }
    .meta-value { font-size: 0.9rem; }

    /* ── Executive Summary ── */
    .report-exec-summary {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 32px 36px;
      margin-bottom: 40px;
      box-shadow: 0 2px 12px rgba(0,0,0,.06);
      position: relative;
      overflow: hidden;
    }
    .report-exec-summary::before {
      content: '';
      position: absolute; left: 0; top: 0; bottom: 0;
      width: 5px;
      background: var(--primary);
    }
    .exec-summary-header {
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 20px;
    }
    .exec-summary-icon {
      width: 36px; height: 36px;
      background: var(--primary); color: #fff;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 1rem; flex-shrink: 0;
    }
    .exec-summary-title {
      font-size: 1.3rem; font-weight: 700; color: var(--primary);
    }
    .exec-summary-body {
      font-size: 0.95rem; line-height: 1.75; color: #333;
    }
    .exec-summary-body p { margin-bottom: 0.9em; }

    /* ── Sections ── */
    .report-section {
      background: #fff;
      border: 1px solid #e8e8e8;
      border-radius: 8px;
      margin-bottom: 28px;
      overflow: hidden;
      box-shadow: 0 1px 6px rgba(0,0,0,.04);
    }
    .section-header {
      padding: 20px 28px 16px;
      border-left: 5px solid #ccc;
      background: #fafafa;
      border-bottom: 1px solid #eee;
    }
    .section-meta {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px;
    }
    .section-num {
      font-size: 0.72rem; font-weight: 700;
      color: #999; min-width: 20px;
    }
    .section-type-badge {
      font-size: 0.65rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: #fff; padding: 2px 8px; border-radius: 10px;
    }
    .section-title {
      font-size: 1.15rem; font-weight: 700; color: #1a1a1a;
    }
    .section-body {
      padding: 24px 28px;
      font-size: 0.93rem; line-height: 1.75; color: #333;
    }
    .section-body p { margin-bottom: 0.9em; }
    .section-body h4 { font-size: 0.95rem; font-weight: 700; margin: 1.4em 0 0.5em; color: var(--primary); }
    .section-body ul, .section-body ol { padding-left: 1.5em; margin-bottom: 0.9em; }
    .section-body li { margin-bottom: 0.35em; }
    .section-body blockquote {
      border-left: 4px solid var(--primary);
      padding: 10px 18px; margin: 1.2em 0;
      background: var(--primary-light);
      border-radius: 0 6px 6px 0;
    }
    .section-body table {
      width: 100%; border-collapse: collapse;
      margin: 1.2em 0; font-size: 0.88rem;
    }
    .section-body th {
      background: var(--primary); color: #fff;
      padding: 9px 14px; text-align: left; font-weight: 600;
    }
    .section-body td {
      padding: 8px 14px; border-bottom: 1px solid #eee;
    }
    .section-body tr:nth-child(even) td { background: #f8f8f8; }
    .section-body code {
      background: #f0f0f0; padding: 2px 5px;
      border-radius: 3px; font-size: 0.85em;
      font-family: 'Consolas', monospace;
    }
    .section-body pre {
      background: #1e1e2e; color: #cdd6f4;
      padding: 18px; border-radius: 6px;
      overflow-x: auto; margin: 1.2em 0;
      font-size: 0.85em; line-height: 1.6;
    }
    .section-body pre code { background: none; padding: 0; color: inherit; }

    /* ── Appendices ── */
    .report-appendices { margin-top: 48px; }
    .appendices-heading {
      font-size: 1.1rem; font-weight: 700;
      color: #666; text-transform: uppercase;
      letter-spacing: 0.08em;
      padding-bottom: 12px;
      border-bottom: 2px solid #ddd;
      margin-bottom: 24px;
    }
    .report-appendix {
      background: #fff; border: 1px solid #e8e8e8;
      border-radius: 8px; margin-bottom: 20px;
      overflow: hidden;
    }
    .appendix-title {
      display: flex; align-items: center; gap: 12px;
      padding: 16px 24px;
      background: #f5f5f5;
      border-bottom: 1px solid #eee;
      font-size: 1rem; font-weight: 600; color: #333;
    }
    .appendix-letter {
      font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: #888;
    }
    .appendix-body {
      padding: 20px 24px;
      font-size: 0.9rem; line-height: 1.7; color: #444;
    }
    .appendix-body p { margin-bottom: 0.8em; }

    /* ── Disclaimer ── */
    .disclaimer {
      margin: 32px 0 0;
      padding: 16px 20px;
      background: #fff8e1;
      border: 1px solid #ffe082;
      border-radius: 6px;
      font-size: 0.8rem; color: #5a4a00; line-height: 1.5;
    }

    /* ── Footer ── */
    .report-footer {
      background: var(--primary); color: rgba(255,255,255,0.7);
      text-align: center; padding: 14px;
      font-size: 0.75rem;
    }

    /* ── Print ── */
    @media print {
      .report-header, .report-toc { display: none !important; }
      .report-main { max-width: 100%; padding: 0; }
      .report-cover { min-height: auto; padding: 40px; }
      .report-section { page-break-inside: avoid; }
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .report-toc { position: fixed; left: 0; top: var(--header-h); z-index: 50; height: calc(100vh - var(--header-h)); box-shadow: 4px 0 16px rgba(0,0,0,.15); }
      .report-toc:not(.collapsed) { width: 260px; min-width: 260px; }
      .report-main { padding: 0 16px 60px; }
      .report-cover { margin: 0 -16px 40px; }
    }

    ${css}
  </style>
</head>
<body>
  <header class="report-header">
    ${logoHtml}
    <span class="header-title">${escapeHtml(pageTitle)}</span>
    <span class="header-badge">Formal Report</span>
  </header>

  <div class="report-body">
    ${tocHtml}
    <main class="report-main">
      ${coverHtml}
      ${execSummaryHtml}
      ${sectionsHtml}
      ${appendicesHtml}
      ${disclaimerHtml ? `<div class="disclaimer">${disclaimerHtml}</div>` : ''}
    </main>
  </div>

  <footer class="report-footer">
    ${escapeHtml(pageTitle)}${meta.preparedBy ? ` · ${escapeHtml(meta.preparedBy)}` : ''} · ${escapeHtml(reportDate)}
  </footer>

  ${vendorScripts}
  <script>
    function toggleToc() {
      document.getElementById('reportToc').classList.toggle('collapsed');
    }

    // Active TOC link on scroll
    const sections = document.querySelectorAll('[id]');
    const tocLinks = document.querySelectorAll('.toc-link');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          tocLinks.forEach(l => l.classList.remove('active'));
          const link = document.querySelector('.toc-link[href="#' + entry.target.id + '"]');
          if (link) link.classList.add('active');
        }
      });
    }, { threshold: 0.2, rootMargin: '-10% 0px -70% 0px' });
    sections.forEach(s => observer.observe(s));
  </script>
  ${js ? `<script>${js}</script>` : ''}
</body>
</html>`;
}

// ─── Legacy markdown fallback ─────────────────────────────────────────────────

export function buildReportTemplate(
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
): string {
  return buildDocumentLayout(title, contentHtml, toc, branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.report);
}
