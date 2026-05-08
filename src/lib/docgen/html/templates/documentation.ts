/**
 * Documentation template — thin wrapper around shared document layout.
 */
import type { BrandingConfig } from '../../branding';
import type { TocEntry } from '../types';
import { buildDocumentLayout } from '../layout/document-layout';
import { DOCUMENT_LAYOUT_FLAGS } from '../layout/document-layout-flags';

export function buildDocumentationTemplate(
  title: string,
  contentHtml: string,
  toc: TocEntry[],
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildDocumentLayout(title, contentHtml, toc, branding, css, js, disclaimerHtml, date, DOCUMENT_LAYOUT_FLAGS.documentation);
}
