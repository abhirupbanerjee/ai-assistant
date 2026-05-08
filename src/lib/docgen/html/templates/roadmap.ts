/**
 * Roadmap template with visual timeline bar and phase cards.
 */
import type { BrandingConfig } from '../../branding';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';

export function buildRoadmapTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const vendorScripts = buildVendorScripts();

  const roadmapCss = `
    .rm-container { max-width: 960px; margin: 0 auto; padding: 0 20px 40px; }
    .rm-header { text-align: center; padding: 32px 0 24px; }
    .rm-header h1 { margin: 0 0 8px; }
    .rm-header p { color: #6b7280; font-size: 0.95rem; margin: 0; }
    .rm-timeline-bar {
      display: flex; align-items: center; justify-content: space-between;
      position: relative; margin: 32px 0 40px; padding: 0 10px;
    }
    .rm-timeline-bar::before {
      content: ''; position: absolute; top: 50%; left: 0; right: 0;
      height: 4px; background: #e5e7eb; transform: translateY(-50%);
      border-radius: 2px; z-index: 0;
    }
    .rm-timeline-bar::after {
      content: ''; position: absolute; top: 50%; left: 0;
      height: 4px; background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      transform: translateY(-50%); border-radius: 2px; z-index: 1;
      width: 0; transition: width 0.6s ease;
    }
    .rm-timeline-bar.complete::after { width: 100%; }
    .rm-timeline-dot {
      position: relative; z-index: 2;
      display: flex; flex-direction: column; align-items: center;
      cursor: pointer; transition: transform 0.2s;
    }
    .rm-timeline-dot:hover { transform: scale(1.1); }
    .rm-timeline-dot .dot {
      width: 16px; height: 16px; border-radius: 50%;
      background: #e5e7eb; border: 3px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
      transition: background 0.3s;
    }
    .rm-timeline-dot.active .dot { background: #3b82f6; }
    .rm-timeline-dot.completed .dot { background: #10b981; }
    .rm-timeline-dot .label {
      margin-top: 8px; font-size: 0.7rem; color: #6b7280;
      text-align: center; max-width: 80px; line-height: 1.2;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rm-timeline-dot.active .label { color: #3b82f6; font-weight: 600; }
    .rm-timeline-dot.completed .label { color: #10b981; font-weight: 600; }
    .rm-phases { display: flex; flex-direction: column; gap: 20px; }
    .rm-phase-card {
      background: #fff; border: 1px solid #e5e7eb;
      border-radius: 12px; overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
      transition: box-shadow 0.2s;
    }
    .rm-phase-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .rm-phase-card-header {
      padding: 16px 20px; display: flex; align-items: center;
      justify-content: space-between; cursor: pointer;
      background: #f9fafb; border-bottom: 1px solid #e5e7eb;
    }
    .rm-phase-card-header h3 { margin: 0; font-size: 1.05rem; color: #1f2937; }
    .rm-phase-status {
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; padding: 3px 10px; border-radius: 12px;
    }
    .rm-phase-status.completed { background: #d1fae5; color: #065f46; }
    .rm-phase-status.in-progress { background: #dbeafe; color: #1e40af; }
    .rm-phase-status.planned { background: #f3f4f6; color: #6b7280; }
    .rm-phase-card-body { padding: 16px 20px; }
    .rm-phase-card-body p { margin: 0 0 12px; color: #374151; font-size: 0.9rem; }
    .rm-milestones { list-style: none; padding: 0; margin: 0; }
    .rm-milestone {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid #f3f4f6;
    }
    .rm-milestone:last-child { border-bottom: none; }
    .rm-milestone-icon {
      width: 20px; height: 20px; border-radius: 50%;
      flex-shrink: 0; margin-top: 2px;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.65rem; color: #fff;
    }
    .rm-milestone-icon.done { background: #10b981; }
    .rm-milestone-icon.pending { background: #d1d5db; }
    .rm-milestone-icon.active { background: #3b82f6; }
    .rm-milestone-text { font-size: 0.9rem; color: #374151; }
    .rm-milestone-text strong { color: #1f2937; }
    @media (max-width: 768px) {
      .rm-timeline-bar { overflow-x: auto; padding-bottom: 8px; }
      .rm-timeline-dot .label { font-size: 0.6rem; max-width: 60px; }
    }
  `;

  const roadmapJs = `
    function scrollToPhase(phaseId) {
      var el = document.getElementById(phaseId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${orgName ? ' — ' + escapeHtml(orgName) : ''}</title>
  ${vendorScripts}
  <style>${css}${roadmapCss}</style>
</head>
<body>
  <header class="site-header">
    <div class="header-left">
      ${logoHtml}
      ${orgName ? `<span class="header-org">${escapeHtml(orgName)}</span>` : ''}
      <span class="header-title">${escapeHtml(title)}</span>
    </div>
    <div class="header-right">
      <input type="search" class="search-bar" placeholder="Search roadmap..." oninput="searchDocs(this.value)" aria-label="Search roadmap">
    </div>
  </header>
  <div class="rm-container">
    <div class="rm-header">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(branding.heroSubtitle || 'Strategic Roadmap')} · ${date}</p>
    </div>
    ${disclaimerHtml}
    <div class="rm-timeline-bar" id="rm-timeline-bar">
      <!-- Timeline dots will be injected by JS parsing h2 headings -->
    </div>
    <div class="rm-phases" id="rm-phases">
      ${contentHtml}
    </div>
    <p style="margin-top:32px;font-size:0.8rem;color:#9ca3af;text-align:center">Generated ${date}${orgName ? ' · ' + escapeHtml(orgName) : ''}</p>
  </div>
  <footer class="site-footer">
    ${orgName ? escapeHtml(orgName) + ' · ' : ''}${escapeHtml(title)} · Roadmap · Generated ${date}
  </footer>
  <script>${js}${roadmapJs}</script>
</body>
</html>`;
}
