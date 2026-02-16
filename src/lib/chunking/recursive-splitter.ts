/**
 * Recursive Text Splitter
 *
 * A simple text splitter that recursively splits text using a list of separators.
 * Replaces @langchain/textsplitters RecursiveCharacterTextSplitter to eliminate
 * vulnerabilities in @langchain/core and langsmith dependencies.
 *
 * Algorithm:
 * 1. Try to split using the first separator
 * 2. Merge splits into chunks respecting maxChunkSize
 * 3. If any chunk is still too large, recursively split with next separator
 * 4. Apply overlap between chunks
 */

export interface RecursiveTextSplitterOptions {
  /** Maximum characters per chunk */
  chunkSize: number;
  /** Number of characters to overlap between chunks */
  chunkOverlap: number;
  /** Separators to try in order (default: ['\n\n', '\n', '. ', ' ', '']) */
  separators?: string[];
}

/**
 * Recursive text splitter that preserves semantic boundaries
 */
export class RecursiveTextSplitter {
  private options: Required<RecursiveTextSplitterOptions>;

  constructor(options: RecursiveTextSplitterOptions) {
    this.options = {
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
      separators: options.separators ?? ['\n\n', '\n', '. ', ' ', ''],
    };
  }

  /**
   * Split text into chunks
   */
  splitText(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    if (text.length <= this.options.chunkSize) {
      return [text.trim()];
    }

    return this.splitRecursive(text, this.options.separators);
  }

  /**
   * Recursively split text using separators
   */
  private splitRecursive(text: string, separators: string[]): string[] {
    const { chunkSize, chunkOverlap } = this.options;

    // Base case: text fits in chunk
    if (text.length <= chunkSize) {
      return text.trim() ? [text.trim()] : [];
    }

    // Find the best separator to use
    const separator = this.findBestSeparator(text, separators);
    const remainingSeparators = separators.slice(separators.indexOf(separator) + 1);

    // Split text
    const splits = separator ? text.split(separator) : [text];

    // Merge splits into chunks
    const chunks = this.mergeSplits(splits, separator);

    // Recursively split any chunks that are still too large
    const result: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length > chunkSize && remainingSeparators.length > 0) {
        result.push(...this.splitRecursive(chunk, remainingSeparators));
      } else if (chunk.length > chunkSize) {
        // No more separators, force split by character
        result.push(...this.forceSplit(chunk));
      } else if (chunk.trim()) {
        result.push(chunk.trim());
      }
    }

    // Apply overlap
    return this.applyOverlap(result, chunkOverlap);
  }

  /**
   * Find the best separator that produces reasonable splits
   */
  private findBestSeparator(text: string, separators: string[]): string {
    for (const sep of separators) {
      if (sep && text.includes(sep)) {
        return sep;
      }
    }
    return '';
  }

  /**
   * Merge splits into chunks respecting maxChunkSize
   */
  private mergeSplits(splits: string[], separator: string): string[] {
    const { chunkSize } = this.options;
    const chunks: string[] = [];
    let currentChunk = '';

    for (const split of splits) {
      const piece = split + (separator || '');

      if (!currentChunk) {
        currentChunk = piece;
      } else if ((currentChunk + piece).length <= chunkSize) {
        currentChunk += piece;
      } else {
        // Current chunk is full, start a new one
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = piece;
      }
    }

    // Add remaining chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Force split text that can't be split by separators
   */
  private forceSplit(text: string): string[] {
    const { chunkSize } = this.options;
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > chunkSize) {
      // Find a good break point (space, newline, or punctuation)
      let breakPoint = chunkSize;
      for (let i = chunkSize; i > chunkSize * 0.5; i--) {
        if ([' ', '\n', '.', ',', ';', ':', '!', '?'].includes(remaining[i])) {
          breakPoint = i + 1;
          break;
        }
      }

      const chunk = remaining.slice(0, breakPoint).trim();
      if (chunk) {
        chunks.push(chunk);
      }
      remaining = remaining.slice(breakPoint).trim();
    }

    if (remaining.trim()) {
      chunks.push(remaining.trim());
    }

    return chunks;
  }

  /**
   * Apply overlap between chunks
   */
  private applyOverlap(chunks: string[], overlap: number): string[] {
    if (overlap <= 0 || chunks.length <= 1) {
      return chunks;
    }

    const result: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        result.push(chunks[i]);
      } else {
        // Get overlap from previous chunk
        const prevChunk = chunks[i - 1];
        const overlapText = this.getOverlapText(prevChunk, overlap);

        // Prepend overlap to current chunk if it doesn't already start with it
        const currentChunk = chunks[i];
        if (overlapText && !currentChunk.startsWith(overlapText.trim())) {
          result.push(overlapText + currentChunk);
        } else {
          result.push(currentChunk);
        }
      }
    }

    return result;
  }

  /**
   * Get overlap text from end of a chunk
   */
  private getOverlapText(text: string, maxOverlap: number): string {
    if (text.length <= maxOverlap) {
      return '';
    }

    // Try to break at a word boundary
    const start = text.length - maxOverlap;
    const overlapPortion = text.slice(start);

    // Find first space to start at a word boundary
    const firstSpace = overlapPortion.indexOf(' ');
    if (firstSpace > 0 && firstSpace < maxOverlap / 2) {
      return overlapPortion.slice(firstSpace + 1);
    }

    return overlapPortion;
  }
}

/**
 * Create a recursive text splitter with the given options
 */
export function createRecursiveTextSplitter(
  options: RecursiveTextSplitterOptions
): RecursiveTextSplitter {
  return new RecursiveTextSplitter(options);
}
