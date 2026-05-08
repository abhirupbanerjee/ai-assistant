/**
 * Website template — delegates to buildSimpleDocTemplate.
 * @see simple-doc.ts
 */
import type { BrandingConfig } from '../../branding';
import { buildSimpleDocTemplate } from './simple-doc';

export function buildWebsiteTemplate(
  title: string,
  contentHtml: string,
  branding: BrandingConfig,
  css: string,
  js: string,
  disclaimerHtml: string,
  date: string
): string {
  return buildSimpleDocTemplate('website', title, contentHtml, [], branding, css, js, disclaimerHtml, date);
}
