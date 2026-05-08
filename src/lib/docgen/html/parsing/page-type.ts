/**
 * Page type auto-detection.
 */
import type { ContentSegment, HtmlPageType, MarkdownSegment } from '../types';

/**
 * Detect page type from content segments and title.
 */
export function detectPageType(segments: ContentSegment[], title: string): HtmlPageType {
  const chartCount = segments.filter(s => s.type === 'chart').length;
  const diagramCount = segments.filter(s => s.type === 'mermaid').length;
  const markdownSegments = segments.filter(s => s.type === 'markdown');

  // Count headings in markdown
  const headingCount = markdownSegments.reduce((count, seg) => {
    const matches = (seg as MarkdownSegment).content.match(/^#{2,3}\s/gm);
    return count + (matches?.length || 0);
  }, 0);

  const titleLower = title.toLowerCase();

  // Dashboard: multiple charts, few headings
  if (chartCount >= 2 && headingCount <= 3) return 'dashboard';

  // Documentation: many headings
  if (headingCount >= 3) return 'documentation';

  // Chart: primarily charts
  if (chartCount >= 1 && diagramCount === 0 && headingCount <= 1) return 'chart';

  // Check title keywords
  if (/dashboard|analytics|metrics|kpi/i.test(titleLower)) return 'dashboard';
  if (/doc|guide|manual|reference|wiki|readme/i.test(titleLower)) return 'documentation';
  if (/report|formal report|annual report|status report|assessment/i.test(titleLower)) return 'report';
  if (/book|ebook|chapter|volume/i.test(titleLower)) return 'book';

  return 'webpage';
}
