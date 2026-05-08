/**
 * Sanitize mammoth HTML: strip dangerous tags while preserving safe content.
 * Removes <script>, <style>, <link>, <iframe>, <object>, <embed>, <form>.
 * Adds anchor IDs to headings that don't have them.
 */
export function sanitizeMammothHtml(sourceHtml: string): string {
  let html = sourceHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  html = html.replace(/<link\b[^>]+>/gi, '');
  html = html.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  html = html.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  html = html.replace(/<embed\b[^>]+>/gi, '');
  html = html.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '');
  html = html.replace(/javascript:/gi, '');

  const idCounts: Record<string, number> = {};
  html = html.replace(/<h([1-4])([^>]*)>([\s\S]*?)<\/h[1-4]>/gi, (_, level, attrs, content) => {
    if (/id="/.test(attrs)) return _;
    const plainText = content.replace(/<[^>]+>/g, '').trim();
    let id = plainText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) return _;
    if (idCounts[id]) {
      idCounts[id]++;
      id = `${id}-${idCounts[id]}`;
    } else {
      idCounts[id] = 1;
    }
    return `<h${level}${attrs} id="${id}">${content}</h${level}>`;
  });

  return html;
}
