/**
 * Render all content segments to HTML.
 */
import type { ContentSegment } from '../types';
import type { ServerRenderResult } from '../server-renderer';
import { markdownToHtml } from '../markdown/markdown-to-html';
import { renderChartSegment, renderDiagramSegment, createRenderContext } from './segment-renderers';

export function renderSegments(segments: ContentSegment[], serverResult?: ServerRenderResult): string {
  const ctx = createRenderContext();
  return segments.map((seg, i) => {
    if (seg.type === 'markdown') return markdownToHtml(seg.content);
    if (seg.type === 'chart') {
      const rendered = serverResult?.charts.get(i);
      return renderChartSegment(seg, ctx, rendered);
    }
    if (seg.type === 'mermaid') {
      const rendered = serverResult?.diagrams.get(i);
      return renderDiagramSegment(seg, ctx, rendered, serverResult?.fallbackToClient);
    }
    return '';
  }).join('\n');
}