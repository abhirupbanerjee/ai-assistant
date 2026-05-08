/**
 * Backwards-compatible public entrypoint for HTML generation.
 *
 * The implementation is split across src/lib/docgen/html/* modules. Keep this
 * file as the stable import path for existing callers.
 */
export { generateHtml } from './html/generate';
export { generateHtmlFromSource } from './html/source-html/generate-from-source';
export type {
  HtmlOptions,
  HtmlSourceOptions,
  HtmlResult,
  HtmlPageType,
  HtmlSourcePageType,
} from './html/types';
