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
  const ganttCount = segments.filter(s => s.type === 'gantt').length;
  const roadmapCount = segments.filter(s => s.type === 'roadmap').length;
  const bookCount = segments.filter(s => s.type === 'book').length;
  const reportCount = segments.filter(s => s.type === 'report').length;
  const markdownSegments = segments.filter(s => s.type === 'markdown');

  // Count headings in markdown
  const headingCount = markdownSegments.reduce((count, seg) => {
    const matches = (seg as MarkdownSegment).content.match(/^#{2,3}\s/gm);
    return count + (matches?.length || 0);
  }, 0);

  const titleLower = title.toLowerCase();

  // Structured block types take priority
  if (bookCount > 0) return 'book';
  if (reportCount > 0) return 'report';
  if (roadmapCount > 0) return 'roadmap';

  // Gantt / Project Plan: presence of a gantt segment is definitive
  if (ganttCount > 0) {
    if (/project.?plan|work.?plan|schedule|wbs|work.?breakdown/i.test(titleLower)) return 'project_plan';
    return 'gantt';
  }

  // Title-based gantt/project-plan detection (no block yet, but explicit intent)
  if (/gantt|deployment.?roadmap|delivery.?timeline|implementation.?timeline/i.test(titleLower)) return 'gantt';
  if (/project.?plan|work.?plan|wbs|work.?breakdown/i.test(titleLower)) return 'project_plan';

  // Dashboard: multiple charts, few headings
  if (chartCount >= 2 && headingCount <= 3) return 'dashboard';

  // Chart: primarily charts
  if (chartCount >= 1 && diagramCount === 0 && headingCount <= 1) return 'chart';

  // Check title keywords
  if (/dashboard|analytics|metrics|kpi/i.test(titleLower)) return 'dashboard';
  if (/report|formal report|annual report|status report|assessment/i.test(titleLower)) return 'report';
  if (/book|ebook|chapter|volume/i.test(titleLower)) return 'book';
  if (/roadmap|transformation|journey|maturity/i.test(titleLower)) return 'roadmap';
  if (/playbook/i.test(titleLower)) return 'playbook';
  if (/website|landing.?page|homepage/i.test(titleLower)) return 'website';

  // Default: website layout (replaces old webpage/documentation fallback)
  return 'website';
}
