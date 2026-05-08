/**
 * Simple document template — entry point for website page type.
 *
 * Uses buildDocumentLayout() infrastructure with DocumentLayoutFlags.
 * Previously also handled documentation, book, report, webpage — those
 * now have dedicated structured templates (book.ts, report.ts).
 */
import type { BrandingConfig } from '../../branding';
import type { TocEntry } from '../types';
import { buildDocumentLayout } from '../layout/document-layout';
import { DOCUMENT_LAYOUT_FLAGS } from '../layout/document-layout-flags';

export type SimpleDocPageType = 'website';

/**
 * Build an HTML page for the website page type.
 */
export function buildSimpleDocTemplate(
  pageType: SimpleDocPageType,
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string,
): string {
  const flags = DOCUMENT_LAYOUT_FLAGS[pageType] || DOCUMENT_LAYOUT_FLAGS.website;
  return buildDocumentLayout(title, contentHtml, toc, branding, css, js, disclaimerHtml, date, flags);
}
