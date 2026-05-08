/**
 * Convert sanitized HTML (from mammoth) into ContentSegment[] suitable for playbook rendering.
 */
import type { ContentSegment } from '../types';

export function sourceHtmlToPlaybookSegments(sanitizedHtml: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let currentBody: string[] = [];

  const flush = () => {
    if (currentBody.length > 0) {
      segments.push({ type: 'markdown', content: currentBody.join('\n') });
      currentBody = [];
    }
  };

  const h2Count = (sanitizedHtml.match(/<h2[^>]*>/gi) || []).length;
  const h3Count = (sanitizedHtml.match(/<h3[^>]*>/gi) || []).length;
  const h4Count = (sanitizedHtml.match(/<h4[^>]*>/gi) || []).length;

  let partTag: string | null = null;
  let topicTag: string | null = null;
  let stripFirstH2 = false;

  if (h2Count > 1) {
    partTag = 'h2';
    topicTag = 'h3';
  } else if (h2Count === 1 && h3Count > 1) {
    partTag = 'h3';
    topicTag = 'h4';
    stripFirstH2 = true;
  } else if (h2Count === 0 && h3Count > 1) {
    partTag = 'h3';
    topicTag = 'h4';
  } else if (h3Count === 1 && h4Count > 1) {
    partTag = 'h4';
    topicTag = null;
  }

  if (!partTag) {
    segments.push({ type: 'markdown', content: sanitizedHtml });
    return segments;
  }

  let workingHtml = sanitizedHtml;
  if (stripFirstH2) {
    workingHtml = workingHtml.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '');
    workingHtml = workingHtml.replace(/^\s*<p[^>]*>(?!<strong>|<em>|<a\s|<img\s)([\s\S]*?)<\/p>/i, (match, content) => {
      const plainText = content.replace(/<[^>]+>/g, '').trim();
      if (plainText.length < 200 && !plainText.includes('\n')) {
        return '';
      }
      return match;
    });
  }

  const partRegex = new RegExp(`<${partTag}([^>]*)>([\\s\\S]*?)<\\/${partTag}>`, 'gi');
  let lastIndex = 0;
  let match;

  while ((match = partRegex.exec(workingHtml)) !== null) {
    if (lastIndex === 0) {
      const before = workingHtml.substring(0, match.index).trim();
      if (before) {
        currentBody.push(before);
        flush();
      }
    } else {
      flush();
    }
    const rawText = match[2].replace(/<[^>]+>/g, '').trim();
    currentBody.push('## ' + rawText);
    flush();
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < workingHtml.length) {
    const after = workingHtml.substring(lastIndex).trim();
    if (after) {
      currentBody.push(after);
      flush();
    }
  }

  if (segments.length === 0) {
    segments.push({ type: 'markdown', content: workingHtml });
  }

  if (topicTag) {
    const topicRegex = new RegExp(`<${topicTag}([^>]*)>([\\s\\S]*?)<\\/${topicTag}>`, 'gi');
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].type === 'markdown') {
        segments[i] = {
          type: 'markdown',
          content: (segments[i] as any).content.replace(topicRegex, (_: string, _attrs: string, content: string) => {
            const text = content.replace(/<[^>]+>/g, '').trim();
            return '### ' + text;
          }),
        };
      }
    }
  }

  return segments;
}
