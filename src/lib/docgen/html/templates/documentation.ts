/**
 * Documentation template — delegates to buildSimpleDocTemplate.
 * @see simple-doc.ts
 */
import type { BrandingConfig } from '../../branding';
import type { TocEntry } from '../types';
import { buildSimpleDocTemplate } from './simple-doc';

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
  return buildSimpleDocTemplate('website', title, contentHtml, toc, branding, css, js, disclaimerHtml, date);
}
