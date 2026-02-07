/**
 * Semantic Chunker
 *
 * Splits text into chunks based on semantic similarity rather than fixed character counts.
 * Uses embeddings to detect topic boundaries and groups related content together.
 *
 * Algorithm:
 * 1. Split text into sentences
 * 2. Group sentences (sliding window of 3 for context)
 * 3. Get embeddings for each group
 * 4. Calculate cosine similarity between consecutive groups
 * 5. Find breakpoints where similarity drops (topic change)
 * 6. Merge groups between breakpoints into coherent chunks
 */

import { createEmbeddings } from '../openai';

export interface SemanticChunkerOptions {
  /** Maximum characters per chunk (default: 1200) */
  maxChunkSize?: number;
  /** Minimum characters per chunk to avoid tiny chunks (default: 100) */
  minChunkSize?: number;
  /** Percentile threshold for breakpoint detection (default: 0.5, range 0.3-0.8) */
  breakpointThreshold?: number;
  /** Pattern to split sentences (default: split on . ! ? followed by space) */
  sentenceSplitPattern?: RegExp;
}

interface SentenceGroup {
  text: string;
  sentences: string[];
  startIndex: number;
  endIndex: number;
}

interface ScoredGroup extends SentenceGroup {
  embedding: number[];
  similarityToNext?: number;
}

/**
 * Semantic chunker that preserves topic boundaries
 */
export class SemanticChunker {
  private options: Required<SemanticChunkerOptions>;

  constructor(options: SemanticChunkerOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 1200,
      minChunkSize: options.minChunkSize ?? 100,
      breakpointThreshold: options.breakpointThreshold ?? 0.5,
      sentenceSplitPattern: options.sentenceSplitPattern ?? /(?<=[.!?])\s+/,
    };
  }

  /**
   * Split text into semantically coherent chunks
   */
  async splitText(text: string): Promise<string[]> {
    // Handle empty or very short text
    if (!text || text.trim().length === 0) {
      return [];
    }

    if (text.length <= this.options.maxChunkSize) {
      return [text.trim()];
    }

    // Step 1: Split into sentences
    const sentences = this.splitIntoSentences(text);

    if (sentences.length === 0) {
      return [];
    }

    if (sentences.length === 1) {
      // Single sentence - apply safety split if needed
      const trimmedText = text.trim();
      const MAX_SAFE_CHARS = 6000;
      if (trimmedText.length > MAX_SAFE_CHARS) {
        console.log(`[SemanticChunker] Single sentence exceeds safe size (${trimmedText.length} chars), splitting`);
        return this.splitLargeChunk(trimmedText, this.options.maxChunkSize);
      }
      return [trimmedText];
    }

    // Step 2: Create sentence groups (sliding window)
    const groups = this.createSentenceGroups(sentences);

    if (groups.length <= 1) {
      // Few groups - apply safety split if needed
      const trimmedText = text.trim();
      const MAX_SAFE_CHARS = 6000;
      if (trimmedText.length > MAX_SAFE_CHARS) {
        console.log(`[SemanticChunker] Text with few groups exceeds safe size (${trimmedText.length} chars), splitting`);
        return this.splitLargeChunk(trimmedText, this.options.maxChunkSize);
      }
      return [trimmedText];
    }

    // Step 3: Get embeddings for all groups
    const scoredGroups = await this.embedGroups(groups);

    // Step 4: Calculate similarities and find breakpoints
    this.calculateSimilarities(scoredGroups);
    const breakpoints = this.findBreakpoints(scoredGroups);

    // Step 5: Merge groups into chunks based on breakpoints
    const chunks = this.mergeIntoChunks(sentences, breakpoints);

    // Step 6: Safety fallback - split any chunks that exceed safe embedding size
    // ~6000 chars ≈ 7500 tokens, safely under the 8192 token limit
    const MAX_SAFE_CHARS = 6000;
    const safeChunks = chunks.flatMap(chunk => {
      if (chunk.length > MAX_SAFE_CHARS) {
        console.log(`[SemanticChunker] Splitting oversized chunk (${chunk.length} chars) into smaller pieces`);
        return this.splitLargeChunk(chunk, this.options.maxChunkSize);
      }
      return chunk;
    });

    console.log(`[SemanticChunker] Split ${sentences.length} sentences into ${safeChunks.length} chunks`);

    return safeChunks;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(this.options.sentenceSplitPattern)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Create overlapping sentence groups for context
   * Each group contains 3 consecutive sentences (or fewer at boundaries)
   */
  private createSentenceGroups(sentences: string[]): SentenceGroup[] {
    const groups: SentenceGroup[] = [];
    const windowSize = 3;

    for (let i = 0; i < sentences.length; i++) {
      const startIdx = Math.max(0, i - 1);
      const endIdx = Math.min(sentences.length, i + windowSize - 1);
      const groupSentences = sentences.slice(startIdx, endIdx);

      groups.push({
        text: groupSentences.join(' '),
        sentences: groupSentences,
        startIndex: startIdx,
        endIndex: endIdx - 1,
      });
    }

    return groups;
  }

  /**
   * Get embeddings for all sentence groups
   * Batches requests to avoid API token limits (max 300K tokens per request)
   */
  private async embedGroups(groups: SentenceGroup[]): Promise<ScoredGroup[]> {
    try {
      // Truncate group text to avoid token limits
      const texts = groups.map(g => g.text.slice(0, 500));

      // Batch embed in chunks of 100 to stay under API limits
      // ~500 chars * 100 groups * ~1.3 tokens/char = ~65K tokens per batch (safe margin)
      const BATCH_SIZE = 100;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const batchEmbeddings = await createEmbeddings(batch);
        allEmbeddings.push(...batchEmbeddings);
      }

      return groups.map((group, i) => ({
        ...group,
        embedding: allEmbeddings[i] || [],
      }));
    } catch (error) {
      console.error('[SemanticChunker] Embedding error:', error);
      // Fallback: return groups without embeddings (will use even distribution)
      return groups.map(group => ({
        ...group,
        embedding: [],
      }));
    }
  }

  /**
   * Calculate cosine similarity between consecutive groups
   */
  private calculateSimilarities(groups: ScoredGroup[]): void {
    for (let i = 0; i < groups.length - 1; i++) {
      if (groups[i].embedding.length > 0 && groups[i + 1].embedding.length > 0) {
        groups[i].similarityToNext = this.cosineSimilarity(
          groups[i].embedding,
          groups[i + 1].embedding
        );
      } else {
        // Default similarity if embeddings failed
        groups[i].similarityToNext = 0.8;
      }
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Find breakpoints where similarity drops below threshold
   * Uses percentile-based threshold for adaptive breakpoint detection
   */
  private findBreakpoints(groups: ScoredGroup[]): number[] {
    const similarities = groups
      .slice(0, -1)
      .map(g => g.similarityToNext ?? 0.8);

    if (similarities.length === 0) {
      return [];
    }

    // Calculate threshold based on percentile
    const threshold = this.calculatePercentileThreshold(similarities);

    const breakpoints: number[] = [];

    for (let i = 0; i < similarities.length; i++) {
      if (similarities[i] < threshold) {
        // Breakpoint at sentence index i+1 (after the low-similarity gap)
        breakpoints.push(i + 1);
      }
    }

    return breakpoints;
  }

  /**
   * Calculate threshold using percentile method
   * Lower percentile = more breakpoints = smaller chunks
   */
  private calculatePercentileThreshold(similarities: number[]): number {
    if (similarities.length === 0) {
      return this.options.breakpointThreshold;
    }

    const sorted = [...similarities].sort((a, b) => a - b);

    // Use breakpointThreshold as percentile (0.3 = 30th percentile, 0.5 = 50th, etc.)
    // Lower threshold setting = lower percentile = more sensitive to topic changes
    const percentile = 1 - this.options.breakpointThreshold; // Invert so higher setting = fewer splits
    const index = Math.floor(sorted.length * percentile);

    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * Merge sentences into chunks based on breakpoints
   */
  private mergeIntoChunks(sentences: string[], breakpoints: number[]): string[] {
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;
    let breakpointIdx = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceLength = sentence.length;

      // Check if we should break here
      const isBreakpoint = breakpointIdx < breakpoints.length && i === breakpoints[breakpointIdx];
      const wouldExceedMax = currentLength + sentenceLength > this.options.maxChunkSize;
      const hasMinContent = currentLength >= this.options.minChunkSize;

      // Break conditions:
      // 1. Semantic breakpoint AND we have minimum content AND we have existing content
      // 2. Would exceed max size AND we have existing content (don't require min for size overflow)
      if ((isBreakpoint && hasMinContent && currentChunk.length > 0) || (wouldExceedMax && currentChunk.length > 0)) {
        chunks.push(currentChunk.join(' ').trim());
        currentChunk = [];
        currentLength = 0;

        if (isBreakpoint) {
          breakpointIdx++;
        }
      }

      currentChunk.push(sentence);
      currentLength += sentenceLength + 1; // +1 for space
    }

    // Add remaining content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' ').trim());
    }

    // Post-process: merge tiny chunks with neighbors
    return this.mergeSmallChunks(chunks);
  }

  /**
   * Split a large chunk into smaller pieces using character-based splitting.
   * Used as a fallback when semantic chunking produces oversized chunks.
   */
  private splitLargeChunk(text: string, maxSize: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxSize) {
      // Find a good break point (space, newline, or punctuation)
      let breakPoint = maxSize;
      for (let i = maxSize; i > maxSize * 0.5; i--) {
        if ([' ', '\n', '.', ',', ';', ':'].includes(remaining[i])) {
          breakPoint = i + 1;
          break;
        }
      }
      chunks.push(remaining.slice(0, breakPoint).trim());
      remaining = remaining.slice(breakPoint).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Merge chunks that are too small with their neighbors
   */
  private mergeSmallChunks(chunks: string[]): string[] {
    if (chunks.length <= 1) {
      return chunks;
    }

    const result: string[] = [];
    let pendingChunk = '';

    for (const chunk of chunks) {
      if (pendingChunk) {
        // We have a pending small chunk, try to merge
        const combined = pendingChunk + ' ' + chunk;
        if (combined.length <= this.options.maxChunkSize) {
          pendingChunk = combined;
        } else {
          result.push(pendingChunk);
          pendingChunk = chunk;
        }
      } else if (chunk.length < this.options.minChunkSize) {
        // This chunk is too small, hold it for merging
        pendingChunk = chunk;
      } else {
        result.push(chunk);
      }
    }

    // Handle final pending chunk
    if (pendingChunk) {
      if (result.length > 0 && result[result.length - 1].length + pendingChunk.length + 1 <= this.options.maxChunkSize) {
        result[result.length - 1] += ' ' + pendingChunk;
      } else {
        result.push(pendingChunk);
      }
    }

    return result;
  }
}

/**
 * Create a semantic chunker with the given options
 */
export function createSemanticChunker(options?: SemanticChunkerOptions): SemanticChunker {
  return new SemanticChunker(options);
}
