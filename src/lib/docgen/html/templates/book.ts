/**
 * Book template — structured chapter-based HTML ebook renderer.
 *
 * Supports two rendering paths:
 *   1. JSON-driven (preferred): LLM emits a ```book fenced block with BookBlockConfig
 *   2. Legacy markdown fallback: delegates to buildDocumentLayout with book flags
 *
 * Features:
 *   - Cover page with front matter (author, subtitle, publisher, edition, abstract)
 *   - Auto-generated Table of Contents from chapters/sections
 *   - Numbered chapter title pages with visual chapter breaks
 *   - Running header with book title + current chapter
 *   - Language selector
 *   - Print-friendly styling
 *   - Sticky sidebar TOC navigation
 */
import type { BrandingConfig } from '../../branding';
import type { BookBlockConfig, TocEntry } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';
import { markdownToHtml } from '../markdown/markdown-to-html';
import { buildDocumentLayout } from '../layout/document-layout';
import { DOCUMENT_LAYOUT_FLAGS } from '../layout/document-layout-flags';

// ─── JSON-driven path ────────────────────────────────────────────────────────

export function buildBookFromConfig(
  pageTitle: string,
  cfg: BookBlockConfig,
  branding: BrandingConfig,
  css: string,
  js: string,
  date: string,
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const primary = branding.primaryColor || '#1a3a5c';
  const vendorScripts = buildVendorScripts();

  const fm = cfg.frontMatter || {};
  const bookTitle = pageTitle;
  const subtitle = fm.subtitle || '';
  const author = fm.author || '';
  const publisher = fm.publisher || '';
  const edition = fm.edition || '';
  const abstract = fm.abstract || '';

  // Build TOC entries
  const tocEntries: Array<{ chapterNum: number; title: string; id: string; sections: Array<{ heading: string; id: string }> }> = [];
  cfg.chapters.forEach((ch, ci) => {
    const chId = `chapter-${ci + 1}`;
    const sectionEntries: Array<{ heading: string; id: string }> = [];
    (ch.sections || []).forEach((sec, si) => {
      sectionEntries.push({ heading: sec.heading, id: `${chId}-sec-${si + 1}` });
    });
    tocEntries.push({ chapterNum: ci + 1, title: ch.title, id: chId, sections: sectionEntries });
  });

  // Build sidebar TOC HTML
  const tocHtml = `
    <nav class="book-toc" id="bookToc">
      <div class="toc-header">
        <span class="toc-title">Contents</span>
        <button class="toc-toggle" onclick="toggleToc()" title="Toggle contents">☰</button>
      </div>
      <ul class="toc-list">
        <li class="toc-item toc-cover"><a href="#book-cover" class="toc-link">Cover</a></li>
        ${tocEntries.map(e => `
          <li class="toc-item toc-chapter">
            <a href="#${e.id}" class="toc-link">
              <span class="toc-num">Ch. ${e.chapterNum}</span>
              <span class="toc-text">${escapeHtml(e.title)}</span>
            </a>
            ${e.sections.length > 0 ? `
              <ul class="toc-sections">
                ${e.sections.map(s => `
                  <li><a href="#${s.id}" class="toc-section-link">${escapeHtml(s.heading)}</a></li>
                `).join('')}
              </ul>
            ` : ''}
          </li>
        `).join('')}
      </ul>
    </nav>`;

  // Build cover page
  const coverHtml = `
    <section class="book-cover" id="book-cover">
      ${logoHtml ? `<div class="cover-logo">${logoHtml}</div>` : ''}
      <div class="cover-content">
        <h1 class="cover-title">${escapeHtml(bookTitle)}</h1>
        ${subtitle ? `<p class="cover-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        ${author ? `<p class="cover-author">by ${escapeHtml(author)}</p>` : ''}
        <div class="cover-meta">
          ${publisher ? `<span class="cover-publisher">${escapeHtml(publisher)}</span>` : ''}
          ${edition ? `<span class="cover-edition">${escapeHtml(edition)}</span>` : ''}
          ${date ? `<span class="cover-date">${escapeHtml(date)}</span>` : ''}
        </div>
        ${abstract ? `<div class="cover-abstract"><p>${escapeHtml(abstract)}</p></div>` : ''}
      </div>
    </section>`;

  // Build chapters HTML
  const chaptersHtml = cfg.chapters.map((ch, ci) => {
    const chId = `chapter-${ci + 1}`;
    const sectionsHtml = (ch.sections || []).map((sec, si) => {
      const secId = `${chId}-sec-${si + 1}`;
      const bodyHtml = markdownToHtml(sec.content || '');
      return `
        <div class="book-section" id="${secId}">
          <h3 class="section-heading">${escapeHtml(sec.heading)}</h3>
          <div class="section-body">${bodyHtml}</div>
        </div>`;
    }).join('');

    return `
      <article class="book-chapter" id="${chId}" data-chapter="${ci + 1}">
        <div class="chapter-title-page">
          <div class="chapter-number">Chapter ${ci + 1}</div>
          <h2 class="chapter-title">${escapeHtml(ch.title)}</h2>
          <div class="chapter-divider"></div>
        </div>
        <div class="chapter-content">
          ${sectionsHtml}
        </div>
      </article>`;
  }).join('');

  // Language selector
  const langOptions = ['English', 'French', 'Spanish', 'Portuguese', 'Mandarin', 'Hindi'];
  const langSelectorHtml = `
    <div class="lang-selector">
      <select onchange="document.documentElement.lang=this.value.toLowerCase().slice(0,2)" title="Language">
        ${langOptions.map(l => `<option value="${l}">${l}</option>`).join('')}
      </select>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bookTitle)}</title>
  <style>
    :root {
      --primary: ${primary};
      --primary-dark: color-mix(in srgb, ${primary} 80%, #000);
      --primary-light: color-mix(in srgb, ${primary} 20%, #fff);
      --font: ${branding.fontFamily || 'Georgia, "Times New Roman", serif'};
      --font-ui: ${branding.fontFamily || 'Segoe UI, Arial, sans-serif'};
      --toc-width: 280px;
      --header-h: 56px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font);
      background: #f8f7f4;
      color: #2c2c2c;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    /* ── Header ── */
    .book-header {
      position: sticky; top: 0; z-index: 100;
      height: var(--header-h);
      background: var(--primary);
      color: #fff;
      display: flex; align-items: center; gap: 12px;
      padding: 0 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .header-logo { height: 32px; width: auto; }
    .header-title {
      flex: 1;
      font-family: var(--font-ui);
      font-size: 1rem; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .header-chapter {
      font-family: var(--font-ui);
      font-size: 0.8rem; opacity: 0.75;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 300px;
    }

    /* ── Layout ── */
    .book-body {
      display: flex;
      flex: 1;
    }

    /* ── TOC Sidebar ── */
    .book-toc {
      width: var(--toc-width);
      min-width: var(--toc-width);
      background: #fff;
      border-right: 1px solid #e0ddd8;
      position: sticky;
      top: var(--header-h);
      height: calc(100vh - var(--header-h));
      overflow-y: auto;
      transition: width 0.25s ease, min-width 0.25s ease;
      flex-shrink: 0;
    }
    .book-toc.collapsed { width: 0; min-width: 0; overflow: hidden; }
    .toc-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 16px 8px;
      border-bottom: 2px solid var(--primary);
      position: sticky; top: 0; background: #fff; z-index: 1;
    }
    .toc-title {
      font-family: var(--font-ui);
      font-size: 0.75rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--primary);
    }
    .toc-toggle {
      background: none; border: none; cursor: pointer;
      font-size: 1rem; color: var(--primary); padding: 2px 4px;
    }
    .toc-list { list-style: none; padding: 8px 0; }
    .toc-item { }
    .toc-link {
      display: flex; align-items: baseline; gap: 8px;
      padding: 7px 16px;
      font-family: var(--font-ui);
      font-size: 0.82rem; color: #444;
      text-decoration: none;
      transition: background 0.15s, color 0.15s;
      border-left: 3px solid transparent;
    }
    .toc-link:hover, .toc-link.active {
      background: var(--primary-light);
      color: var(--primary);
      border-left-color: var(--primary);
    }
    .toc-num {
      font-size: 0.7rem; color: #999; min-width: 40px;
      font-family: var(--font-ui);
    }
    .toc-text { flex: 1; }
    .toc-cover .toc-link { font-style: italic; color: #888; }
    .toc-sections { list-style: none; padding: 0 0 4px 0; }
    .toc-section-link {
      display: block;
      padding: 4px 16px 4px 56px;
      font-family: var(--font-ui);
      font-size: 0.75rem; color: #777;
      text-decoration: none;
      transition: color 0.15s;
    }
    .toc-section-link:hover { color: var(--primary); }

    /* ── Main Content ── */
    .book-main {
      flex: 1;
      max-width: 780px;
      margin: 0 auto;
      padding: 0 40px 80px;
    }

    /* ── Cover Page ── */
    .book-cover {
      min-height: 80vh;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center;
      padding: 60px 40px;
      background: linear-gradient(160deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: #fff;
      margin: 0 -40px 60px;
    }
    .cover-logo { margin-bottom: 32px; }
    .cover-logo img { height: 60px; filter: brightness(0) invert(1); }
    .cover-content { max-width: 600px; }
    .cover-title {
      font-size: clamp(2rem, 5vw, 3.5rem);
      font-weight: 700; line-height: 1.15;
      margin-bottom: 16px;
      letter-spacing: -0.02em;
    }
    .cover-subtitle {
      font-size: 1.25rem; opacity: 0.85;
      margin-bottom: 24px; font-style: italic;
    }
    .cover-author {
      font-size: 1rem; opacity: 0.9;
      margin-bottom: 20px;
      font-family: var(--font-ui);
    }
    .cover-meta {
      display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;
      font-family: var(--font-ui);
      font-size: 0.8rem; opacity: 0.7;
      margin-bottom: 24px;
    }
    .cover-meta span::before { content: '·'; margin-right: 8px; }
    .cover-meta span:first-child::before { content: ''; margin: 0; }
    .cover-abstract {
      margin-top: 24px;
      padding: 20px 24px;
      background: rgba(255,255,255,0.12);
      border-radius: 8px;
      font-size: 0.9rem; line-height: 1.6;
      text-align: left;
    }

    /* ── Chapter ── */
    .book-chapter {
      margin-bottom: 80px;
      page-break-before: always;
    }
    .chapter-title-page {
      padding: 48px 0 40px;
      border-bottom: 3px solid var(--primary);
      margin-bottom: 40px;
    }
    .chapter-number {
      font-family: var(--font-ui);
      font-size: 0.75rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.12em;
      color: var(--primary); opacity: 0.7;
      margin-bottom: 8px;
    }
    .chapter-title {
      font-size: clamp(1.6rem, 3vw, 2.4rem);
      font-weight: 700; color: var(--primary);
      line-height: 1.2;
    }
    .chapter-divider {
      width: 60px; height: 4px;
      background: var(--primary);
      margin-top: 20px;
      border-radius: 2px;
    }

    /* ── Section ── */
    .book-section { margin-bottom: 40px; }
    .section-heading {
      font-size: 1.25rem; font-weight: 600;
      color: #2c2c2c;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e0ddd8;
    }
    .section-body {
      font-size: 1rem; line-height: 1.8;
      color: #3a3a3a;
    }
    .section-body p { margin-bottom: 1em; }
    .section-body h4 { font-size: 1rem; font-weight: 600; margin: 1.5em 0 0.5em; color: var(--primary); }
    .section-body ul, .section-body ol { padding-left: 1.5em; margin-bottom: 1em; }
    .section-body li { margin-bottom: 0.4em; }
    .section-body blockquote {
      border-left: 4px solid var(--primary);
      padding: 12px 20px;
      margin: 1.5em 0;
      background: var(--primary-light);
      border-radius: 0 6px 6px 0;
      font-style: italic;
    }
    .section-body code {
      background: #f0ede8; padding: 2px 6px;
      border-radius: 3px; font-size: 0.88em;
      font-family: 'Consolas', 'Monaco', monospace;
    }
    .section-body pre {
      background: #1e1e2e; color: #cdd6f4;
      padding: 20px; border-radius: 8px;
      overflow-x: auto; margin: 1.5em 0;
      font-size: 0.88em; line-height: 1.6;
    }
    .section-body pre code { background: none; padding: 0; color: inherit; }
    .section-body table {
      width: 100%; border-collapse: collapse;
      margin: 1.5em 0; font-size: 0.9rem;
    }
    .section-body th {
      background: var(--primary); color: #fff;
      padding: 10px 14px; text-align: left;
      font-family: var(--font-ui); font-weight: 600;
    }
    .section-body td {
      padding: 9px 14px;
      border-bottom: 1px solid #e8e5e0;
    }
    .section-body tr:nth-child(even) td { background: #f8f7f4; }

    /* ── Footer ── */
    .book-footer {
      background: var(--primary);
      color: rgba(255,255,255,0.7);
      text-align: center;
      padding: 16px;
      font-family: var(--font-ui);
      font-size: 0.78rem;
    }

    /* ── Lang Selector ── */
    .lang-selector select {
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.3);
      color: #fff; border-radius: 4px;
      padding: 4px 8px; font-size: 0.78rem;
      cursor: pointer;
    }
    .lang-selector select option { background: var(--primary); }

    /* ── Print ── */
    @media print {
      .book-header, .book-toc, .lang-selector { display: none !important; }
      .book-main { max-width: 100%; padding: 0; }
      .book-cover { min-height: auto; padding: 40px; }
      .book-chapter { page-break-before: always; }
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .book-toc { position: fixed; left: 0; top: var(--header-h); z-index: 50; height: calc(100vh - var(--header-h)); box-shadow: 4px 0 16px rgba(0,0,0,.15); }
      .book-toc:not(.collapsed) { width: 260px; min-width: 260px; }
      .book-main { padding: 0 20px 60px; }
      .book-cover { margin: 0 -20px 40px; }
    }

    ${css}
  </style>
</head>
<body>
  <header class="book-header">
    ${logoHtml}
    <span class="header-title" id="headerTitle">${escapeHtml(bookTitle)}</span>
    <span class="header-chapter" id="headerChapter"></span>
    ${langSelectorHtml}
  </header>

  <div class="book-body">
    ${tocHtml}
    <main class="book-main">
      ${coverHtml}
      ${chaptersHtml}
    </main>
  </div>

  <footer class="book-footer">
    ${escapeHtml(bookTitle)}${author ? ` · ${escapeHtml(author)}` : ''}${publisher ? ` · ${escapeHtml(publisher)}` : ''} · ${escapeHtml(date)}
  </footer>

  ${vendorScripts}
  <script>
    // TOC toggle
    function toggleToc() {
      document.getElementById('bookToc').classList.toggle('collapsed');
    }

    // Running chapter header + active TOC link
    const chapters = document.querySelectorAll('.book-chapter');
    const headerChapter = document.getElementById('headerChapter');
    const tocLinks = document.querySelectorAll('.toc-link');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const ch = entry.target;
          const num = ch.dataset.chapter;
          const titleEl = ch.querySelector('.chapter-title');
          if (titleEl && headerChapter) {
            headerChapter.textContent = 'Chapter ' + num + ': ' + titleEl.textContent;
          }
          // Update active TOC link
          tocLinks.forEach(l => l.classList.remove('active'));
          const activeLink = document.querySelector('.toc-link[href="#' + ch.id + '"]');
          if (activeLink) activeLink.classList.add('active');
        }
      });
    }, { threshold: 0.1, rootMargin: '-10% 0px -80% 0px' });

    chapters.forEach(ch => observer.observe(ch));

    // Cover clears running header
    const cover = document.querySelector('.book-cover');
    if (cover) {
      const coverObs = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && headerChapter) {
          headerChapter.textContent = '';
        }
      }, { threshold: 0.3 });
      coverObs.observe(cover);
    }
  </script>
  ${js ? `<script>${js}</script>` : ''}
</body>
</html>`;
}

// ─── Legacy markdown fallback ─────────────────────────────────────────────────

export function buildBookTemplate(
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
): string {
  return buildDocumentLayout(title, contentHtml, toc, branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.book);
}
