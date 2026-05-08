/**
 * CSS builder — composes base styles with optional per-page-type extensions.
 */
import type { BrandingConfig } from '../../branding';
import type { HtmlPageType } from '../types';

export function buildCss(branding: BrandingConfig, pageType: HtmlPageType): string {
  const primary = branding.primaryColor || '#003366';
  const font = branding.fontFamily || 'Segoe UI, Arial, sans-serif';

  const baseCss = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${font}, sans-serif; font-size: 15px; color: #1f2937; background: #f9fafb; line-height: 1.6; }
    a { color: ${primary}; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Header */
    .site-header {
      background: ${primary}; color: #fff; padding: 10px 24px;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-logo { height: 36px; width: auto; object-fit: contain; }
    .header-org { font-size: 1rem; font-weight: 600; color: #fff; }
    .header-title { font-size: 0.85rem; opacity: 0.85; margin-left: 8px; }
    .header-right { display: flex; align-items: center; gap: 12px; }
    .search-bar {
      padding: 6px 14px; border-radius: 20px; border: none;
      width: 220px; font-size: 0.85rem; outline: none;
      background: rgba(255,255,255,0.15); color: #fff;
    }
    .search-bar::placeholder { color: rgba(255,255,255,0.7); }
    .search-bar:focus { background: rgba(255,255,255,0.25); }

    /* Layout */
    .layout { display: flex; min-height: calc(100vh - 56px); }

    /* TOC Sidebar */
    .toc {
      width: 260px; min-width: 220px; padding: 20px 16px;
      border-right: 1px solid #e5e7eb; background: #fff;
      position: sticky; top: 56px; height: calc(100vh - 56px);
      overflow-y: auto; flex-shrink: 0;
    }
    .toc h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 12px; }
    .toc ul { list-style: none; }
    .toc li { margin: 2px 0; }
    .toc-link { font-size: 0.85rem; color: #374151; display: block; padding: 4px 8px; border-radius: 4px; }
    .toc-link:hover, .toc-link.active { background: #eff6ff; color: ${primary}; text-decoration: none; }

    /* Main content */
    .main-content { flex: 1; padding: 32px 40px; max-width: 960px; }
    .main-content.full-width { max-width: 100%; }

    /* Typography */
    h1 { font-size: 2rem; font-weight: 700; color: ${primary}; margin: 0 0 24px; }
    h2 { font-size: 1.4rem; font-weight: 600; color: ${primary}; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
    h3 { font-size: 1.15rem; font-weight: 600; color: #1f2937; margin: 24px 0 8px; }
    h4 { font-size: 1rem; font-weight: 600; color: #374151; margin: 16px 0 6px; }
    p { margin: 0 0 12px; }
    ul, ol { margin: 0 0 12px 24px; }
    li { margin: 4px 0; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.875em; font-family: 'Courier New', monospace; }
    pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
    pre code { background: none; padding: 0; color: inherit; }
    blockquote { border-left: 4px solid ${primary}; padding: 8px 16px; background: #eff6ff; margin: 12px 0; border-radius: 0 4px 4px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9rem; }
    th { background: ${primary}; color: #fff; padding: 8px 12px; text-align: left; }
    td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
    tr:hover td { background: #f9fafb; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    strong { font-weight: 600; }
    em { font-style: italic; }

    /* Chart cards */
    .chart-card {
      background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
      padding: 20px; margin: 16px 0; box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .chart-title { font-size: 1rem; font-weight: 600; color: #1f2937; margin-bottom: 12px; }
    .chart-container { position: relative; height: 300px; }
    .chart-notes { margin-top: 12px; font-size: 0.8rem; color: #6b7280; }
    .chart-notes summary { cursor: pointer; color: ${primary}; }
    .chart-notes p { margin-top: 6px; }

    /* Dashboard grid */
    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 20px; }

    /* Diagram cards */
    .diagram-card {
      background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px;
      padding: 20px; margin: 16px 0; overflow-x: auto;
    }
    .diagram-card .mermaid { display: flex; justify-content: center; }

    /* Search highlight */
    .search-highlight { background: #fef08a; border-radius: 2px; }

    /* Footer */
    .site-footer {
      background: #f3f4f6; border-top: 1px solid #e5e7eb;
      padding: 16px 24px; text-align: center;
      font-size: 0.8rem; color: #6b7280;
    }

    /* Disclaimer */
    .disclaimer { background: #fef9c3; border: 1px solid #fde047; border-radius: 6px; padding: 10px 16px; margin: 16px 0; font-size: 0.8rem; color: #713f12; }

    /* Print */
    @media print {
      .site-header, .toc, .search-bar { display: none !important; }
      .main-content { padding: 0; max-width: 100%; }
      .chart-card, .diagram-card { break-inside: avoid; }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .toc { display: none; }
      .main-content { padding: 16px; }
      .dashboard-grid { grid-template-columns: 1fr; }
      .search-bar { width: 140px; }
    }
  `;

  // Dashboard adds nothing to base CSS (it ships its own inline styles)
  // Playbook, Roadmap also ship inline styles inside their templates.
  return baseCss;
}
