/**
 * Heading Extractor
 *
 * Detects document headings (Markdown, plain-text, numbered sections)
 * and enriches chunks with heading context for better semantic understanding.
 */

export interface DetectedHeading {
  level: number; // 1-6 for Markdown, 0 for plain-text
  text: string;
  charOffset: number; // Position in original text
}

/**
 * Extract headings from text
 * Detects:
 * - Markdown headings: # ## ### etc.
 * - Numbered sections: 1. 1.1 1.1.1 etc.
 * - ALL CAPS lines (potential section titles)
 * - Lines ending with colon (potential section titles)
 */
export function extractHeadings(text: string): DetectedHeading[] {
  const headings: DetectedHeading[] = [];
  const lines = text.split('\n');
  let charOffset = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Markdown headings: # ## ### etc.
    const markdownMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (markdownMatch) {
      const level = markdownMatch[1].length;
      const headingText = markdownMatch[2].trim();
      if (headingText.length > 0 && headingText.length < 200) {
        headings.push({
          level,
          text: headingText,
          charOffset,
        });
      }
      charOffset += line.length + 1;
      continue;
    }

    // Numbered sections: 1. 1.1 1.1.1 etc.
    const numberedMatch = trimmed.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
    if (numberedMatch) {
      const sectionNum = numberedMatch[1];
      const headingText = numberedMatch[2].trim();
      // Estimate level from number of dots
      const level = (sectionNum.match(/\./g) || []).length + 1;
      if (headingText.length > 0 && headingText.length < 200 && level <= 6) {
        headings.push({
          level,
          text: `${sectionNum} ${headingText}`,
          charOffset,
        });
      }
      charOffset += line.length + 1;
      continue;
    }

    // ALL CAPS lines (potential section titles)
    if (
      trimmed.length > 5 &&
      trimmed.length < 100 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed)
    ) {
      headings.push({
        level: 1,
        text: trimmed,
        charOffset,
      });
      charOffset += line.length + 1;
      continue;
    }

    // Lines ending with colon (potential section titles)
    if (
      trimmed.endsWith(':') &&
      trimmed.length > 3 &&
      trimmed.length < 100 &&
      !trimmed.includes('http')
    ) {
      const headingText = trimmed.slice(0, -1).trim();
      if (headingText.length > 0) {
        headings.push({
          level: 1,
          text: headingText,
          charOffset,
        });
      }
      charOffset += line.length + 1;
      continue;
    }

    charOffset += line.length + 1;
  }

  return headings;
}

/**
 * Find the nearest parent heading for a chunk
 * Returns the most recent heading that appears before the chunk in the text
 */
export function findNearestHeading(
  chunkText: string,
  fullText: string,
  headings: DetectedHeading[]
): string | null {
  if (headings.length === 0) {
    return null;
  }

  // Find where this chunk appears in the full text
  const chunkIndex = fullText.indexOf(chunkText);
  if (chunkIndex === -1) {
    return null;
  }

  // Find the most recent heading before this chunk
  let nearestHeading: DetectedHeading | null = null;
  for (const heading of headings) {
    if (heading.charOffset < chunkIndex) {
      if (!nearestHeading || heading.charOffset > nearestHeading.charOffset) {
        nearestHeading = heading;
      }
    }
  }

  if (!nearestHeading) {
    return null;
  }

  // Don't prepend if the chunk already starts with this heading
  if (chunkText.trim().startsWith(nearestHeading.text)) {
    return null;
  }

  // Format heading with appropriate prefix
  const prefix = '#'.repeat(Math.min(nearestHeading.level, 6));
  return `${prefix} ${nearestHeading.text}`;
}

/**
 * Enrich a chunk with its nearest heading context
 * Returns the enriched text, or original if no heading found
 */
export function enrichChunkWithHeading(
  chunkText: string,
  fullText: string,
  headings: DetectedHeading[]
): string {
  const heading = findNearestHeading(chunkText, fullText, headings);
  if (!heading) {
    return chunkText;
  }

  return `${heading}\n\n${chunkText}`;
}
