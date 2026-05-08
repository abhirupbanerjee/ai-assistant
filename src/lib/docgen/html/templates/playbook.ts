/**
 * Playbook template — country-aware theme, card grid, accordion topics.
 *
 * Two entry points:
 *   - buildPlaybookTemplate()     — legacy: renders from ContentSegment[] (markdown path)
 *   - buildPlaybookFromConfig()   — new: renders from a PlaybookBlockConfig JSON segment
 */
import type { BrandingConfig } from '../../branding';
import type { ContentSegment, PlaybookBlockConfig } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';
import { parsePlaybookParts } from '../playbook/playbook-parser';
import { renderPlaybookPartsHtml } from '../playbook/playbook-renderer';
import { markdownToHtml } from '../markdown/markdown-to-html';
import { PART_ACCENT_COLORS } from '../constants';
import type { ServerRenderResult } from '../server-renderer';

export function resolvePlaybookTheme(
  branding: BrandingConfig,
  title: string,
  organizationName: string
): { primary: string; secondary: string; accent: string; flagStrip: string } {
  if (branding.primaryColor) {
    return {
      primary: branding.primaryColor,
      secondary: branding.primaryColor,
      accent: branding.primaryColor,
      flagStrip: branding.primaryColor,
    };
  }

  const combined = (title + ' ' + organizationName).toLowerCase();

  if (/grenada/i.test(combined)) return { primary: '#007A5E', secondary: '#CE1126', accent: '#FCD116', flagStrip: '#007A5E,#CE1126,#FCD116' };
  if (/jamaica/i.test(combined)) return { primary: '#009B3A', secondary: '#FED100', accent: '#000000', flagStrip: '#009B3A,#FED100,#000000' };
  if (/barbados/i.test(combined)) return { primary: '#00247D', secondary: '#FCD116', accent: '#00247D', flagStrip: '#00247D,#FCD116,#00247D' };
  if (/trinidad/i.test(combined)) return { primary: '#C8102E', secondary: '#FFFFFF', accent: '#000000', flagStrip: '#C8102E,#FFFFFF,#000000' };
  if (/bahamas/i.test(combined)) return { primary: '#00778B', secondary: '#FCD116', accent: '#000000', flagStrip: '#00778B,#FCD116,#000000' };
  if (/antigua/i.test(combined)) return { primary: '#C8102E', secondary: '#FFFFFF', accent: '#002F6C', flagStrip: '#C8102E,#FFFFFF,#002F6C' };
  if (/saint[\s-]?lusia|st[\s-]?lucia/i.test(combined)) return { primary: '#4D8CC4', secondary: '#FCD116', accent: '#000000', flagStrip: '#4D8CC4,#FCD116,#000000' };
  if (/dominica/i.test(combined)) return { primary: '#007A5E', secondary: '#CE1126', accent: '#FCD116', flagStrip: '#007A5E,#CE1126,#FCD116' };
  if (/guyana/i.test(combined)) return { primary: '#009E49', secondary: '#CE1126', accent: '#FCD116', flagStrip: '#009E49,#CE1126,#FCD116' };
  if (/suriname/i.test(combined)) return { primary: '#377E3F', secondary: '#FFFFFF', accent: '#B40A2C', flagStrip: '#377E3F,#FFFFFF,#B40A2C' };
  if (/belize/i.test(combined)) return { primary: '#00358E', secondary: '#D90000', accent: '#FFFFFF', flagStrip: '#00358E,#D90000,#FFFFFF' };
  if (/caribbean/i.test(combined)) return { primary: '#7AB800', secondary: '#0033A0', accent: '#FF6900', flagStrip: '#7AB800,#0033A0,#FF6900' };

  return { primary: '#003366', secondary: '#003366', accent: '#003366', flagStrip: '#003366,#003366,#003366' };
}

export function buildPlaybookTemplate(
  title: string,
  segments: ContentSegment[],
  branding: BrandingConfig,
  css: string,
  js: string,
  date: string,
  serverResult?: ServerRenderResult,
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const tagline = (branding as any).playbook?.tagline || '';
  const heroSubtitle = (branding as any).playbook?.heroSubtitle || '';
  const heroDate = (branding as any).playbook?.heroDate || date;
  const footerEntity = (branding as any).playbook?.footerEntity || orgName;
  const footerAgency = (branding as any).playbook?.footerAgency || '';
  const footerDate = (branding as any).playbook?.footerDate || date;

  const theme = resolvePlaybookTheme(branding, title, orgName);

  const playbookCss = `
    .pb-flag-strip { height: 6px; background: linear-gradient(90deg, ${theme.flagStrip}); }
    .pb-header {
      background: #fff; color: #1f2937; padding: 10px 24px;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 6px; z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-bottom: 1px solid #e5e7eb;
    }
    .pb-header-left { display: flex; align-items: center; gap: 12px; }
    .pb-header-right { display: flex; align-items: center; gap: 12px; }
    .pb-tagline { font-size: 0.8rem; color: #6b7280; }
    .pb-view-all-btn { background: ${theme.primary}; color: #fff; border: none; padding: 7px 18px; border-radius: 20px; font-size: 0.85rem; cursor: pointer; transition: opacity 0.2s; }
    .pb-view-all-btn:hover { opacity: 0.85; }
    .pb-hero { background: #fff; padding: 40px 24px 48px; text-align: center; }
    .pb-hero h1 { font-size: 2rem; color: #1f2937; margin: 0 0 10px; font-weight: 700; }
    .pb-hero-subtitle { font-size: 1rem; color: #6b7280; margin: 0 0 6px; }
    .pb-hero-date { font-size: 0.8rem; color: #9ca3af; margin: 0; }
    .pb-hero-search { max-width: 560px; margin: 20px auto 0; }
    .pb-hero-search input { width: 100%; padding: 10px 20px; border-radius: 28px; border: 1px solid #d1d5db; font-size: 0.95rem; outline: none; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .pb-hero-search input:focus { border-color: ${theme.primary}; }
    .pb-main { padding: 0 24px 48px; max-width: 960px; margin: 0 auto; }
    .pb-cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 0; }
    .pb-card { background: #fff; border-radius: 10px; box-shadow: 0 1px 6px rgba(0,0,0,0.08); overflow: hidden; transition: box-shadow 0.2s, transform 0.2s; }
    .pb-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.12); transform: translateY(-2px); }
    .pb-card.selected { box-shadow: 0 0 0 2px ${theme.primary}; }
    .pb-card-header { padding: 0; border: none; display: block; cursor: pointer; background: #fff; text-align: left; width: 100%; }
    .pb-card-top-border { height: 4px; width: 100%; }
    .pb-card-header-inner { padding: 14px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .pb-card-part-label { display: block; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }
    .pb-card-header h3 { margin: 0; font-size: 0.9rem; color: #1f2937; font-weight: 600; line-height: 1.3; }
    .pb-card-arrow { font-size: 1.2rem; color: #d1d5db; flex-shrink: 0; margin-top: 2px; }
    .pb-card.selected .pb-card-arrow { color: ${theme.primary}; }
    .pb-part-detail-area { margin-top: 28px; display: none; }
    .pb-part-detail-area.active { display: block; }
    .pb-part-detail { background: #fff; border-radius: 10px; box-shadow: 0 1px 6px rgba(0,0,0,0.08); overflow: hidden; }
    .pb-part-detail-heading { padding: 14px 20px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${theme.primary}; background: ${theme.primary}08; border-bottom: 1px solid #e5e7eb; }
    .pb-part-intro { padding: 16px 20px; font-size: 0.9rem; color: #374151; line-height: 1.7; border-bottom: 1px solid #f3f4f6; }
    .pb-part-intro p { margin: 0 0 8px; }
    .pb-part-intro p:last-child { margin-bottom: 0; }
    .pb-topic-row { border-bottom: 1px solid #f3f4f6; }
    .pb-topic-row:last-child { border-bottom: none; }
    .pb-topic-header { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #fff; border: none; cursor: pointer; text-align: left; gap: 12px; }
    .pb-topic-header:hover { background: #f9fafb; }
    .pb-topic-header-left { flex: 1; }
    .pb-topic-title { display: block; font-size: 0.95rem; font-weight: 600; color: #1f2937; }
    .pb-topic-subtitle { display: block; font-size: 0.8rem; color: #9ca3af; margin-top: 2px; }
    .pb-topic-chevron { font-size: 1.4rem; color: #d1d5db; transition: transform 0.2s; flex-shrink: 0; }
    .pb-topic-body { display: none; padding: 0 20px 16px; font-size: 0.9rem; color: #374151; line-height: 1.7; border-top: 1px solid #f3f4f6; }
    .pb-topic-body.open { display: block; }
    .pb-topic-body h4 { font-size: 0.95rem; font-weight: 600; color: #1f2937; margin: 12px 0 6px; }
    .pb-topic-body p { margin: 0 0 8px; }
    .pb-footer { background: #f9fafb; color: #6b7280; padding: 20px 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .pb-footer-entity { font-size: 0.9rem; font-weight: 600; color: #374151; margin: 0 0 4px; }
    .pb-footer-agency { font-size: 0.8rem; margin: 0 0 4px; }
    .pb-footer-date { font-size: 0.75rem; opacity: 0.7; margin: 0; }
    .pb-hidden { display: none !important; }
    .pb-no-results { text-align: center; padding: 40px 24px; color: #9ca3af; font-size: 0.95rem; }
    @media (max-width: 768px) {
      .pb-hero-search { flex-direction: column; }
      .pb-cards-grid { grid-template-columns: 1fr; }
      .pb-header { flex-direction: column; gap: 8px; text-align: center; }
    }
  `;

  const playbookJs = `
    function openPlaybookPart(partId) {
      var detail = document.getElementById('pb-part-detail');
      if (!detail) return;
      var tmpl = document.getElementById('pb-part-tmpl-' + partId);
      if (!tmpl) return;
      detail.innerHTML = '';
      var clone = tmpl.content.cloneNode(true);
      detail.appendChild(clone);
      detail.classList.add('active');
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
      var card = document.getElementById(partId);
      if (card) card.classList.add('selected');
      detail.querySelectorAll('.pb-topic-body').forEach(function(b) { b.classList.add('open'); });
      detail.querySelectorAll('.pb-topic-header').forEach(function(h) { h.setAttribute('aria-expanded', 'true'); });
      if (typeof window.renderMermaidDiagrams === 'function') window.renderMermaidDiagrams();
      if (typeof window.renderCharts === 'function') window.renderCharts();
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function togglePlaybookTopic(topicId) {
      var row = document.getElementById(topicId);
      if (!row) return;
      var btn = row.querySelector('.pb-topic-header');
      var body = row.querySelector('.pb-topic-body');
      var isOpen = body && body.classList.contains('open');
      document.querySelectorAll('.pb-topic-body.open').forEach(function(b) { b.classList.remove('open'); });
      document.querySelectorAll('.pb-topic-header[aria-expanded="true"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
      if (!isOpen) {
        if (body) body.classList.add('open');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    function filterPlaybookCards(query) {
      var detail = document.getElementById('pb-part-detail');
      if (detail) { detail.classList.remove('active'); detail.innerHTML = ''; }
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
      var lc = query.toLowerCase();
      var matchCount = 0;
      document.querySelectorAll('.pb-card').forEach(function(card) {
        var title = (card.querySelector('h3') || {}).textContent || '';
        var keywords = card.getAttribute('data-keywords') || '';
        var visible = !lc || title.toLowerCase().includes(lc) || keywords.includes(lc);
        card.classList.toggle('pb-hidden', !visible);
        if (visible) matchCount++;
      });
      var noResults = document.querySelector('.pb-no-results');
      if (noResults) noResults.style.display = matchCount > 0 ? 'none' : 'block';
    }
    function viewAllSections() {
      var detail = document.getElementById('pb-part-detail');
      var btn = document.getElementById('pb-view-all-btn');
      if (!detail) return;
      if (detail.getAttribute('data-expanded') === 'all') {
        detail.classList.remove('active');
        detail.innerHTML = '';
        detail.removeAttribute('data-expanded');
        document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
        if (btn) btn.textContent = 'View all sections';
        return;
      }
      var search = document.querySelector('.pb-hero-search input');
      if (search) search.value = '';
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('pb-hidden'); });
      var noResults = document.querySelector('.pb-no-results');
      if (noResults) noResults.style.display = 'none';
      detail.innerHTML = '';
      document.querySelectorAll('.pb-card').forEach(function(card) {
        var tmpl = document.getElementById('pb-part-tmpl-' + card.id);
        if (tmpl) {
          var clone = tmpl.content.cloneNode(true);
          detail.appendChild(clone);
        }
      });
      detail.querySelectorAll('.pb-topic-body').forEach(function(b) { b.classList.add('open'); });
      detail.querySelectorAll('.pb-topic-header').forEach(function(h) { h.setAttribute('aria-expanded', 'true'); });
      detail.classList.add('active');
      detail.setAttribute('data-expanded', 'all');
      if (btn) btn.textContent = 'Collapse sections';
      if (typeof window.renderMermaidDiagrams === 'function') window.renderMermaidDiagrams();
      if (typeof window.renderCharts === 'function') window.renderCharts();
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  `;

  const parts = parsePlaybookParts(segments, serverResult);
  const { cardsHtml: partsCardsHtml, partDetailHtml } = renderPlaybookPartsHtml(parts);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${buildVendorScripts()}
  <style>${css}${playbookCss}</style>
</head>
<body>
  <div class="pb-flag-strip"></div>
  <header class="pb-header">
    <div class="pb-header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
      ${tagline ? `<span class="pb-tagline">${escapeHtml(tagline)}</span>` : ''}
    </div>
    <div class="pb-header-right">
      <button id="pb-view-all-btn" class="pb-view-all-btn" onclick="viewAllSections()">View all sections</button>
    </div>
  </header>
  <section class="pb-hero">
    <h1>${escapeHtml(title)}</h1>
    ${heroSubtitle ? `<p class="pb-hero-subtitle">${escapeHtml(heroSubtitle)}</p>` : ''}
    ${heroDate ? `<p class="pb-hero-date">${escapeHtml(heroDate)}</p>` : ''}
    <div class="pb-hero-search">
      <input type="search" placeholder="Search sections, steps, and keywords..." aria-label="Search playbook" oninput="filterPlaybookCards(this.value)">
    </div>
  </section>
  <main class="pb-main" role="main">
    <div class="pb-cards-grid" id="pb-cards">
      ${partsCardsHtml}
    </div>
    <div class="pb-no-results" style="display:none;">No sections match your search. Try different keywords.</div>
    <section id="pb-part-detail" class="pb-part-detail-area" aria-live="polite"></section>
  </main>
  <footer class="pb-footer">
    ${footerEntity ? `<p class="pb-footer-entity">${escapeHtml(footerEntity)}</p>` : ''}
    ${footerAgency ? `<p class="pb-footer-agency">${escapeHtml(footerAgency)}</p>` : ''}
    ${footerDate ? `<p class="pb-footer-date">${escapeHtml(footerDate)}</p>` : ''}
  </footer>
  <script>${js}${playbookJs}</script>
  ${partDetailHtml}
</body>
</html>`;
}

// ── JSON-driven playbook renderer ─────────────────────────────────────────────

/**
 * Build a Playbook HTML page from a structured PlaybookBlockConfig.
 *
 * This is the preferred path when the LLM emits a ```playbook JSON block.
 * Parts and topics are rendered directly from the config — no markdown parsing needed.
 */
export function buildPlaybookFromConfig(
  pageTitle: string,
  cfg: PlaybookBlockConfig,
  branding: BrandingConfig,
  css: string,
  js: string,
  date: string,
): string {
  const orgName = branding.organizationName || '';
  const theme = resolvePlaybookTheme(branding, pageTitle, orgName);

  // Convert PlaybookBlockConfig parts → the internal PlaybookPart[] format
  // used by renderPlaybookPartsHtml
  const slug = (text: string): string =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const getPartLabel = (index: number): string => {
    const labels = ['PART I', 'PART II', 'PART III', 'PART IV', 'PART V'];
    return index < labels.length ? labels[index] : `PART ${index + 1}`;
  };

  // Build internal parts structure compatible with renderPlaybookPartsHtml
  const internalParts = cfg.parts.map((part, idx) => ({
    partLabel: getPartLabel(idx),
    title: part.title,
    id: slug(part.title),
    accentColor: PART_ACCENT_COLORS[idx % PART_ACCENT_COLORS.length],
    introHtml: part.intro ? markdownToHtml(part.intro) : '',
    topics: (part.topics || []).map((topic, tIdx) => {
      const bodyHtml = topic.body
        ? markdownToHtml(topic.body)
        : '<p>No details available.</p>';
      const subtitleText = topic.subtitle || (topic.body
        ? topic.body.replace(/[#*`]/g, '').substring(0, 120).trim()
        : '');
      return {
        id: `${slug(part.title)}-${tIdx + 1}`,
        title: topic.title,
        subtitle: subtitleText,
        bodyHtml,
        keywords: (topic.title + ' ' + (topic.body || '')).toLowerCase().substring(0, 200),
      };
    }),
  }));

  const { cardsHtml: partsCardsHtml, partDetailHtml } = renderPlaybookPartsHtml(internalParts);

  const chartTitle = cfg.title || pageTitle;
  const heroSubtitle = cfg.subtitle || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';

  const playbookCss = `
    .pb-flag-strip { height: 6px; background: linear-gradient(90deg, ${theme.flagStrip}); }
    .pb-header {
      background: #fff; color: #1f2937; padding: 10px 24px;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 6px; z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-bottom: 1px solid #e5e7eb;
    }
    .pb-header-left { display: flex; align-items: center; gap: 12px; }
    .pb-header-right { display: flex; align-items: center; gap: 12px; }
    .pb-view-all-btn { background: ${theme.primary}; color: #fff; border: none; padding: 7px 18px; border-radius: 20px; font-size: 0.85rem; cursor: pointer; transition: opacity 0.2s; }
    .pb-view-all-btn:hover { opacity: 0.85; }
    .pb-hero { background: #fff; padding: 40px 24px 48px; text-align: center; }
    .pb-hero h1 { font-size: 2rem; color: #1f2937; margin: 0 0 10px; font-weight: 700; }
    .pb-hero-subtitle { font-size: 1rem; color: #6b7280; margin: 0 0 6px; }
    .pb-hero-date { font-size: 0.8rem; color: #9ca3af; margin: 0; }
    .pb-hero-search { max-width: 560px; margin: 20px auto 0; }
    .pb-hero-search input { width: 100%; padding: 10px 20px; border-radius: 28px; border: 1px solid #d1d5db; font-size: 0.95rem; outline: none; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .pb-hero-search input:focus { border-color: ${theme.primary}; }
    .pb-main { padding: 0 24px 48px; max-width: 960px; margin: 0 auto; }
    .pb-cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 0; }
    .pb-card { background: #fff; border-radius: 10px; box-shadow: 0 1px 6px rgba(0,0,0,0.08); overflow: hidden; transition: box-shadow 0.2s, transform 0.2s; }
    .pb-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.12); transform: translateY(-2px); }
    .pb-card.selected { box-shadow: 0 0 0 2px ${theme.primary}; }
    .pb-card-header { padding: 0; border: none; display: block; cursor: pointer; background: #fff; text-align: left; width: 100%; }
    .pb-card-top-border { height: 4px; width: 100%; }
    .pb-card-header-inner { padding: 14px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .pb-card-part-label { display: block; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }
    .pb-card-header h3 { margin: 0; font-size: 0.9rem; color: #1f2937; font-weight: 600; line-height: 1.3; }
    .pb-card-arrow { font-size: 1.2rem; color: #d1d5db; flex-shrink: 0; margin-top: 2px; }
    .pb-card.selected .pb-card-arrow { color: ${theme.primary}; }
    .pb-part-detail-area { margin-top: 28px; display: none; }
    .pb-part-detail-area.active { display: block; }
    .pb-part-detail { background: #fff; border-radius: 10px; box-shadow: 0 1px 6px rgba(0,0,0,0.08); overflow: hidden; }
    .pb-part-detail-heading { padding: 14px 20px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${theme.primary}; background: ${theme.primary}08; border-bottom: 1px solid #e5e7eb; }
    .pb-part-intro { padding: 16px 20px; font-size: 0.9rem; color: #374151; line-height: 1.7; border-bottom: 1px solid #f3f4f6; }
    .pb-part-intro p { margin: 0 0 8px; }
    .pb-part-intro p:last-child { margin-bottom: 0; }
    .pb-topic-row { border-bottom: 1px solid #f3f4f6; }
    .pb-topic-row:last-child { border-bottom: none; }
    .pb-topic-header { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #fff; border: none; cursor: pointer; text-align: left; gap: 12px; }
    .pb-topic-header:hover { background: #f9fafb; }
    .pb-topic-header-left { flex: 1; }
    .pb-topic-title { display: block; font-size: 0.95rem; font-weight: 600; color: #1f2937; }
    .pb-topic-subtitle { display: block; font-size: 0.8rem; color: #9ca3af; margin-top: 2px; }
    .pb-topic-chevron { font-size: 1.4rem; color: #d1d5db; transition: transform 0.2s; flex-shrink: 0; }
    .pb-topic-body { display: none; padding: 0 20px 16px; font-size: 0.9rem; color: #374151; line-height: 1.7; border-top: 1px solid #f3f4f6; }
    .pb-topic-body.open { display: block; }
    .pb-topic-body h4 { font-size: 0.95rem; font-weight: 600; color: #1f2937; margin: 12px 0 6px; }
    .pb-topic-body p { margin: 0 0 8px; }
    .pb-footer { background: #f9fafb; color: #6b7280; padding: 20px 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .pb-footer-entity { font-size: 0.9rem; font-weight: 600; color: #374151; margin: 0 0 4px; }
    .pb-footer-date { font-size: 0.75rem; opacity: 0.7; margin: 0; }
    .pb-hidden { display: none !important; }
    .pb-no-results { text-align: center; padding: 40px 24px; color: #9ca3af; font-size: 0.95rem; }
    @media (max-width: 768px) {
      .pb-cards-grid { grid-template-columns: 1fr; }
      .pb-header { flex-direction: column; gap: 8px; text-align: center; }
    }
  `;

  const playbookJs = `
    function openPlaybookPart(partId) {
      var detail = document.getElementById('pb-part-detail');
      if (!detail) return;
      var tmpl = document.getElementById('pb-part-tmpl-' + partId);
      if (!tmpl) return;
      detail.innerHTML = '';
      var clone = tmpl.content.cloneNode(true);
      detail.appendChild(clone);
      detail.classList.add('active');
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
      var card = document.getElementById(partId);
      if (card) card.classList.add('selected');
      detail.querySelectorAll('.pb-topic-body').forEach(function(b) { b.classList.add('open'); });
      detail.querySelectorAll('.pb-topic-header').forEach(function(h) { h.setAttribute('aria-expanded', 'true'); });
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function togglePlaybookTopic(topicId) {
      var row = document.getElementById(topicId);
      if (!row) return;
      var btn = row.querySelector('.pb-topic-header');
      var body = row.querySelector('.pb-topic-body');
      var isOpen = body && body.classList.contains('open');
      document.querySelectorAll('.pb-topic-body.open').forEach(function(b) { b.classList.remove('open'); });
      document.querySelectorAll('.pb-topic-header[aria-expanded="true"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
      if (!isOpen) {
        if (body) body.classList.add('open');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    function filterPlaybookCards(query) {
      var detail = document.getElementById('pb-part-detail');
      if (detail) { detail.classList.remove('active'); detail.innerHTML = ''; }
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
      var lc = query.toLowerCase();
      var matchCount = 0;
      document.querySelectorAll('.pb-card').forEach(function(card) {
        var title = (card.querySelector('h3') || {}).textContent || '';
        var keywords = card.getAttribute('data-keywords') || '';
        var visible = !lc || title.toLowerCase().includes(lc) || keywords.includes(lc);
        card.classList.toggle('pb-hidden', !visible);
        if (visible) matchCount++;
      });
      var noResults = document.querySelector('.pb-no-results');
      if (noResults) noResults.style.display = matchCount > 0 ? 'none' : 'block';
    }
    function viewAllSections() {
      var detail = document.getElementById('pb-part-detail');
      var btn = document.getElementById('pb-view-all-btn');
      if (!detail) return;
      if (detail.getAttribute('data-expanded') === 'all') {
        detail.classList.remove('active');
        detail.innerHTML = '';
        detail.removeAttribute('data-expanded');
        document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('selected'); });
        if (btn) btn.textContent = 'View all sections';
        return;
      }
      var search = document.querySelector('.pb-hero-search input');
      if (search) search.value = '';
      document.querySelectorAll('.pb-card').forEach(function(c) { c.classList.remove('pb-hidden'); });
      var noResults = document.querySelector('.pb-no-results');
      if (noResults) noResults.style.display = 'none';
      detail.innerHTML = '';
      document.querySelectorAll('.pb-card').forEach(function(card) {
        var tmpl = document.getElementById('pb-part-tmpl-' + card.id);
        if (tmpl) {
          var clone = tmpl.content.cloneNode(true);
          detail.appendChild(clone);
        }
      });
      detail.querySelectorAll('.pb-topic-body').forEach(function(b) { b.classList.add('open'); });
      detail.querySelectorAll('.pb-topic-header').forEach(function(h) { h.setAttribute('aria-expanded', 'true'); });
      detail.classList.add('active');
      detail.setAttribute('data-expanded', 'all');
      if (btn) btn.textContent = 'Collapse sections';
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(chartTitle)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${buildVendorScripts()}
  <style>${css}${playbookCss}</style>
</head>
<body>
  <div class="pb-flag-strip"></div>
  <header class="pb-header">
    <div class="pb-header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
    </div>
    <div class="pb-header-right">
      <button id="pb-view-all-btn" class="pb-view-all-btn" onclick="viewAllSections()">View all sections</button>
    </div>
  </header>
  <section class="pb-hero">
    <h1>${escapeHtml(chartTitle)}</h1>
    ${heroSubtitle ? `<p class="pb-hero-subtitle">${escapeHtml(heroSubtitle)}</p>` : ''}
    <p class="pb-hero-date">${escapeHtml(date)}</p>
    <div class="pb-hero-search">
      <input type="search" placeholder="Search sections, steps, and keywords..." aria-label="Search playbook" oninput="filterPlaybookCards(this.value)">
    </div>
  </section>
  <main class="pb-main" role="main">
    <div class="pb-cards-grid" id="pb-cards">
      ${partsCardsHtml}
    </div>
    <div class="pb-no-results" style="display:none;">No sections match your search. Try different keywords.</div>
    <section id="pb-part-detail" class="pb-part-detail-area" aria-live="polite"></section>
  </main>
  <footer class="pb-footer">
    ${orgName ? `<p class="pb-footer-entity">${escapeHtml(orgName)}</p>` : ''}
    <p class="pb-footer-date">Generated ${escapeHtml(date)}</p>
  </footer>
  <script>${js}${playbookJs}</script>
  ${partDetailHtml}
</body>
</html>`;
}
