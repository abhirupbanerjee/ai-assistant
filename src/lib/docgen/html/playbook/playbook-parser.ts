/**
 * Parse markdown/segments into a hierarchical PlaybookPart[] structure.
 */
import type { ContentSegment, MarkdownSegment, ChartSegment, DiagramSegment } from '../types';
import { markdownToHtml } from '../markdown/markdown-to-html';
import { PART_ACCENT_COLORS } from '../constants';
import type { PlaybookPart } from './playbook-types';
import { createRenderContext, renderChartSegment, renderDiagramSegment } from '../renderers/segment-renderers';
import type { ServerRenderResult } from '../server-renderer';

/**
 * Normalize embedded HTML headings in markdown content to markdown heading syntax.
 */
function normalizeHtmlHeadingsInMarkdown(content: string): string {
  let normalized = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return `\n## ${text}\n`;
  });
  normalized = normalized.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return `\n### ${text}\n`;
  });
  normalized = normalized.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return `\n#### ${text}\n`;
  });
  return normalized;
}

/**
 * Derive a short subtitle from body lines.
 */
function deriveSubtitle(bodyLines: string[]): string {
  const raw = bodyLines.join('\n').trim();
  if (!raw) return '';
  const html = markdownToHtml(raw);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 120) return text;
  return text.substring(0, 120).replace(/\s\S+$/, '') + '…';
}

/**
 * Parse markdown/segments into a hierarchical PlaybookPart[] structure.
 * Counts heading occurrences to determine correct hierarchy.
 *
 * @param segments - Content segments to parse
 * @param serverResult - Optional server-rendered charts/diagrams (from serverRenderAll).
 *   When provided, chart/diagram segments are emitted as static PNG images / inline SVG
 *   instead of client-side canvas/mermaid placeholders.
 */
export function parsePlaybookParts(
  segments: ContentSegment[],
  serverResult?: ServerRenderResult,
): PlaybookPart[] {
  const renderContext = createRenderContext();

  // Build index maps: original segment index → rendered result
  // We need to know each segment's position in the original array so we can
  // look it up in the serverResult maps (which are keyed by segment index).
  const normalizedSegments = segments.map((seg) => {
    if (seg.type === 'markdown') {
      const normalized = normalizeHtmlHeadingsInMarkdown((seg as MarkdownSegment).content);
      return { type: 'markdown', content: normalized } as MarkdownSegment;
    }
    return seg;
  });

  // Pre-scan to count heading occurrences
  let h2Count = 0;
  let h3Count = 0;
  let h4Count = 0;
  for (const seg of normalizedSegments) {
    if (seg.type === 'markdown') {
      const lines = (seg as MarkdownSegment).content.split('\n');
      for (const line of lines) {
        if (/^##(?!#)\s+/.test(line)) h2Count++;
        if (/^###(?!#)\s+/.test(line)) h3Count++;
        if (/^####(?!#)\s+/.test(line)) h4Count++;
      }
    }
  }

  let partHeadingRegex: RegExp | null = null;
  let topicHeadingRegex: RegExp | null = null;
  let skipFirstH2 = false;

  if (h2Count > 1) {
    partHeadingRegex = /^##(?!#)\s+(.+)$/;
    topicHeadingRegex = /^###(?!#)\s+(.+)$/;
  } else if (h2Count === 1 && h3Count > 1) {
    partHeadingRegex = /^###(?!#)\s+(.+)$/;
    topicHeadingRegex = /^####(?!#)\s+(.+)$/;
    skipFirstH2 = true;
  } else if (h2Count === 0 && h3Count > 1) {
    partHeadingRegex = /^###(?!#)\s+(.+)$/;
    topicHeadingRegex = /^####(?!#)\s+(.+)$/;
  } else if (h3Count === 1 && h4Count > 1) {
    partHeadingRegex = /^####(?!#)\s+(.+)$/;
    topicHeadingRegex = null;
  }

  const getPartLabel = (index: number): string => {
    const labels = ['PART I', 'PART II', 'PART III', 'PART IV', 'PART V'];
    if (index < labels.length) return labels[index];
    return `PART ${index + 1}`;
  };

  const slug = (text: string): string =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const parts: PlaybookPart[] = [];
  let partCounter = 0;
  let topicCounter = 0;
  let currentPart: PlaybookPart | null = null;
  let currentTopicTitle = '';
  let currentTopicId = '';
  let currentTopicBody: string[] = [];
  let introBody: string[] = [];
  let skippedTitleH2 = false;

  const flushTopic = () => {
    if (!currentPart || !currentTopicTitle) return;
    topicCounter++;
    currentPart.topics.push({
      id: `${currentTopicId}-${topicCounter}`,
      title: currentTopicTitle,
      subtitle: deriveSubtitle(currentTopicBody),
      bodyHtml: currentTopicBody.length > 0
        ? markdownToHtml(currentTopicBody.join('\n'))
        : '<p>No details available.</p>',
      keywords: (currentTopicTitle + ' ' + currentTopicBody.join(' '))
        .toLowerCase().replace(/<[^>]+>/g, ' ').substring(0, 200),
    });
    currentTopicTitle = '';
    currentTopicId = '';
    currentTopicBody = [];
  };

  const pushCurrentPart = () => {
    if (!currentPart) return;
    flushTopic();
    if (introBody.length > 0) {
      currentPart.introHtml = markdownToHtml(introBody.join('\n'));
    }
    parts.push(currentPart);
    currentPart = null;
    introBody = [];
  };

  const createPart = (title: string) => {
    pushCurrentPart();
    currentPart = {
      partLabel: getPartLabel(partCounter),
      title,
      id: slug(title),
      accentColor: PART_ACCENT_COLORS[partCounter % PART_ACCENT_COLORS.length],
      introHtml: '',
      topics: [],
    };
    partCounter++;
    topicCounter = 0;
  };

  /**
   * Render a chart or diagram segment, using server-rendered results when available.
   * The segment's position in the original `segments` array is used as the lookup key.
   */
  const renderSegment = (seg: ContentSegment): string => {
    // Find the original index in the pre-normalization segments array
    // (normalizedSegments preserves order, so indexOf on normalizedSegments is equivalent)
    const segIndex = normalizedSegments.indexOf(seg);

    if (seg.type === 'chart') {
      const rendered = serverResult?.charts.get(segIndex);
      return renderChartSegment(seg as ChartSegment, renderContext, rendered);
    }
    if (seg.type === 'mermaid') {
      const rendered = serverResult?.diagrams.get(segIndex);
      return renderDiagramSegment(
        seg as DiagramSegment,
        renderContext,
        rendered,
        serverResult?.fallbackToClient,
      );
    }
    return '';
  };

  for (const seg of normalizedSegments) {
    if (seg.type === 'markdown') {
      const lines = (seg as MarkdownSegment).content.split('\n');
      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        const h2Match = line.match(/^##(?!#)\s+(.+)$/);
        if (h2Match && skipFirstH2 && !skippedTitleH2) {
          skippedTitleH2 = true;
          continue;
        }

        const partMatch = partHeadingRegex ? line.match(partHeadingRegex) : null;
        const topicMatch = topicHeadingRegex ? line.match(topicHeadingRegex) : null;

        if (partMatch) {
          createPart(partMatch[1].trim());
        } else if (topicMatch) {
          if (!currentPart) {
            createPart('Overview');
          }
          flushTopic();
          currentTopicTitle = topicMatch[1].trim();
          currentTopicId = slug(currentTopicTitle);
          currentTopicBody = [];
        } else if (currentTopicTitle) {
          currentTopicBody.push(line);
        } else if (currentPart) {
          introBody.push(line);
        } else {
          introBody.push(line);
        }
      }
    } else if (seg.type === 'chart' || seg.type === 'mermaid') {
      // Render inline html string for charts/diagrams inside topic body or intro
      const html = renderSegment(seg);
      if (currentTopicTitle) currentTopicBody.push(html);
      else introBody.push(html);
    }
  }

  pushCurrentPart();

  if (parts.length === 0 && normalizedSegments.length > 0) {
    const allHtml = normalizedSegments.map((seg) => {
      if (seg.type === 'markdown') return markdownToHtml((seg as MarkdownSegment).content);
      if (seg.type === 'chart' || seg.type === 'mermaid') return renderSegment(seg);
      return '';
    }).join('\n');
    parts.push({
      partLabel: 'OVERVIEW',
      title: 'Overview',
      id: 'overview',
      accentColor: PART_ACCENT_COLORS[0],
      introHtml: '',
      topics: [{
        id: 'overview-1',
        title: 'Overview',
        subtitle: deriveSubtitle([]),
        bodyHtml: allHtml || '<p>No details available.</p>',
        keywords: 'overview',
      }],
    });
  }

  return parts;
}
