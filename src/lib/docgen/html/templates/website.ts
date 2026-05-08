/**
 * Website template — thin wrapper around shared document layout.
 */
import type { BrandingConfig } from '../../branding';
import { buildDocumentLayout } from '../layout/document-layout';
import { DOCUMENT_LAYOUT_FLAGS } from '../layout/document-layout-flags';

export function buildWebsiteTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, [], branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.website);
}
