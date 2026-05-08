/**
 * Table of Contents extraction and HTML builder.
 */
import type { ContentSegment, MarkdownSegment, TocEntry } from '../types';
import { escapeHtml } from '../markdown/escape';

/**
 * Extract TOC entries from markdown segments.
 */
export function extractToc(segments: ContentSegment[]): TocEntry[] {
  const toc: TocEntry[] = [];
  const idCounts: Record<string, number> = {};

  for (const seg of segments) {
    if (seg.type !== 'markdown') continue;
    const lines = (seg as MarkdownSegment).content.split('\n');
    for (const line of lines) {
      const match = line.match(/^(#{2,4})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        let id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (idCounts[id]) {
          idCounts[id]++;
          id = `${id}-${idCounts[id]}`;
        } else {
          idCounts[id] = 1;
        }
        toc.push({ level, text, id });
      }
    }
  }

  return toc;
}

/**
 * Extract TOC entries from pre-rendered HTML (mammoth output).
 * Works with <h1>, <h2>, <h3>, <h4> tags.
 */
export function extractTocFromHtml(sourceHtml: string): TocEntry[] {
  const toc: TocEntry[] = [];
  const idCounts: Record<string, number> = {};

  const headingRegex = /<h([1-4])[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  let match;

  while ((match = headingRegex.exec(sourceHtml)) !== null) {
    const level = parseInt(match[1], 10);
    const rawText = match[2].replace(/<[^>]+>/g, '').trim();
    if (!rawText) continue;

    let id = rawText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (idCounts[id]) {
      idCounts[id]++;
      id = `${id}-${idCounts[id]}`;
    } else {
      idCounts[id] = 1;
    }
    toc.push({ level, text: rawText, id });
  }

  return toc;
}

/**
 * Build the TOC sidebar HTML.
 */
export function buildTocHtml(toc: TocEntry[], heading: string = 'Contents'): string {
  if (toc.length === 0) return '';
  const items = toc
    .map((entry) => {
      const indent = (entry.level - 2) * 16;
      return `<li style="padding-left:${indent}px"><a href="#${entry.id}" class="toc-link">${escapeHtml(entry.text)}</a></li>`;
    })
    .join('\n');
  return `<nav class="toc" id="toc-nav"><h3>${escapeHtml(heading)}</h3><ul>${items}</ul></nav>`;
}
