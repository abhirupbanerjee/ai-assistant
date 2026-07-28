/**
 * KB Document Detection & Full-Document Retrieval
 *
 * When a user asks to "summarise the Q3 report" or "review the policy document",
 * the standard RAG pipeline may fail: the reranker (Fireworks Qwen3-Reranker-8B)
 * scores each chunk against the query text, and a generic request like "summarise
 * this" doesn't topically match any single paragraph — so all chunks score below
 * the 0.30 threshold and get silently dropped. The model then receives no document
 * content at all.
 *
 * This module solves that problem for KB / category documents (documents already
 * ingested into the vector store) by:
 *
 *   1. Detecting whether the user's message references a specific KB document by
 *      name — using four matching strategies (exact, extension-stripped, token
 *      overlap, substring) so it works regardless of how the user phrases it.
 *   2. Fetching ALL chunks for that document directly from Qdrant via a
 *      documentName payload filter (bypassing similarity search entirely).
 *   3. Returning them as RetrievedChunk[] with a score of 0 so the caller can
 *      inject them as full-document context and apply a zero-floor rerank with
 *      the empty-result safety net.
 *
 * This mirrors the fix already applied for user-uploaded chat attachments, but
 * operates on the `globalChunks` path (KB documents) rather than `userChunks`.
 */

import type { RetrievedChunk } from '@/types';
import type { DbDocument } from '@/lib/db/compat';
import { getVectorStore, getCollectionNames } from './vector-store';
import { ragLogger as logger } from './logger';

/**
 * Result of attempting to detect a referenced KB document.
 */
export interface DetectedDocument {
  /** The matched document from the database */
  document: DbDocument;
  /** Which matching strategy succeeded */
  matchStrategy: 'exact' | 'extension_stripped' | 'token_overlap' | 'substring';
  /**
   * Overlap ratio for the token_overlap strategy (presentTokens / meaningfulTokens).
   * Undefined for exact/extension_stripped/substring strategies.
   * Used by kb_read to grade confidence (HIGH ≥ 0.9, AMBIGUOUS 0.6–0.9).
   */
  overlapRatio?: number;
  /**
   * Runner-up documents that also matched within the token_overlap band (ratio ≥ 0.6).
   * Excludes the winning document. Populated only for the token_overlap strategy.
   * Used by kb_read AMBIGUOUS tier to surface alternatives for HITL clarification.
   * Each entry includes its own overlapRatio for ranking the candidates.
   */
  candidateDocuments?: Array<{ document: DbDocument; overlapRatio: number }>;
}

/**
 * Normalize a filename for comparison: lowercase, trim, collapse whitespace.
 */
function normalizeFilename(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Strip the file extension from a filename.
 * "Q3_Report.pdf" → "Q3_Report"
 */
function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return name; // no extension or hidden file
  return name.substring(0, lastDot);
}

/**
 * Stop tokens filtered out of filenames before matching.
 *
 * Date/version tokens are included because users almost never say them when
 * referring to a document ("review the CMS RFP", not "review the FINAL-1 CMS
 * RFP September 2024"). Removing them shrinks the token set to the meaningful
 * parts of the filename, which makes partial-overlap matching precise instead
 * of noisy: FINAL-1-CMS-RFP-September-2024.pdf → ["cms", "rfp"].
 */
const FILENAME_STOP_TOKENS: ReadonlySet<string> = new Set([
  // Generic file words
  'doc', 'document', 'file', 'report', 'pdf', 'docx',
  // Version/finality markers
  'final', 'draft', 'v1', 'v2', 'v3', 'version', 'copy', 'new', 'old', 'latest', 'updated',
  // Years
  '2020', '2021', '2022', '2023', '2024', '2025', '2026',
  // Month names + common abbreviations
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  // Day numbers 01-31 (zero-padded) and 1-31
  '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31',
]);

/**
 * Tokenize a filename into meaningful tokens (words), filtering out very short
 * tokens and common file/date/version words that wouldn't help matching.
 */
function tokenizeFilename(name: string): string[] {
  const stripped = stripExtension(name);
  // Split on non-alphanumeric characters (spaces, underscores, hyphens, dots)
  const tokens = stripped
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2);
  // Filter out generic tokens that add noise (dates, versions, file words)
  return tokens.filter(t => !FILENAME_STOP_TOKENS.has(t));
}

/**
 * Check whether the user's message contains a specific filename or document name
 * from the list of KB documents. Uses four progressively-looser matching strategies:
 *
 *   1. **Exact match** — the full filename (with extension) appears in the message.
 *   2. **Extension-stripped match** — the filename without extension appears
 *      (e.g. "Q3_Report" matches "Q3_Report.pdf").
 *   3. **Token overlap** — ≥60% of significant filename tokens appear in the
 *      message (e.g. "review the cms rfp" contains both "cms" and "rfp" from
 *      "FINAL-1-CMS-RFP-September-2024.pdf"). Requires at least 2 meaningful
 *      tokens to avoid false positives on single-token filenames like
 *      "data.docx". When several documents qualify, the highest overlap ratio
 *      wins.
 *   4. **Substring match** — the extension-stripped filename appears as a substring
 *      in the message (handles cases where the user writes it without spaces, e.g.
 *      "q3report" matching "Q3_Report").
 *
 * @param userMessage - The user's chat message (case-insensitive matching)
 * @param documents - List of KB documents available in the thread's categories
 * @returns The first matching document with its match strategy, or null if no match
 */
export function detectReferencedDocument(
  userMessage: string,
  documents: DbDocument[]
): DetectedDocument | null {
  if (documents.length === 0) return null;

  const messageLower = userMessage.toLowerCase();
  const messageNormalized = normalizeFilename(userMessage);

  // Strategy 1: Exact filename match (with extension)
  for (const doc of documents) {
    const docName = normalizeFilename(doc.filename);
    if (docName.length >= 4 && messageLower.includes(docName)) {
      logger.debug('Document detected via exact match', { filename: doc.filename });
      return { document: doc, matchStrategy: 'exact' };
    }
  }

  // Strategy 2: Extension-stripped match
  for (const doc of documents) {
    const stripped = normalizeFilename(stripExtension(doc.filename));
    if (stripped.length >= 4 && messageLower.includes(stripped)) {
      logger.debug('Document detected via extension-stripped match', { filename: doc.filename });
      return { document: doc, matchStrategy: 'extension_stripped' };
    }
  }

  // Strategy 3: Token overlap (≥60% of meaningful tokens present, min 2 tokens).
  // Users typically say only the meaningful parts of a filename ("CMS RFP" for
  // FINAL-1-CMS-RFP-September-2024.pdf), so requiring ALL tokens misses real
  // references. The expanded stop-token list strips date/version noise, so the
  // remaining tokens are the meaningful parts — partial overlap on them is a
  // strong signal. When multiple documents match, the highest overlap ratio
  // wins (ties broken by more present tokens, then earlier in the list).
  //
  // All documents within the ≥0.6 band are collected so the caller (kb_read)
  // can grade confidence and surface runner-ups for HITL clarification when
  // the match is ambiguous (0.6–0.9 with competing documents).
  const overlapMatches: Array<{ doc: DbDocument; tokens: string[]; ratio: number; present: number }> = [];
  for (const doc of documents) {
    const tokens = tokenizeFilename(doc.filename);
    // Need at least 2 meaningful tokens to avoid false positives
    if (tokens.length < 2) continue;

    const presentTokens = tokens.filter(token => {
      // Match as a word boundary or substring (handles "q3" inside "q3 report")
      return messageLower.includes(token);
    });

    const overlapRatio = presentTokens.length / tokens.length;
    if (overlapRatio < 0.6) continue;

    overlapMatches.push({ doc, tokens, ratio: overlapRatio, present: presentTokens.length });
  }

  if (overlapMatches.length > 0) {
    // Sort by ratio desc, then present-token count desc, then original order (stable)
    overlapMatches.sort((a, b) =>
      b.ratio - a.ratio || b.present - a.present || 0
    );
    const bestMatch = overlapMatches[0];
    // Runner-ups (everything except the winner) become candidates for HITL
    const candidateDocuments = overlapMatches.slice(1).map(m => ({
      document: m.doc,
      overlapRatio: m.ratio,
    }));

    logger.debug('Document detected via token overlap', {
      filename: bestMatch.doc.filename,
      tokens: bestMatch.tokens,
      overlapRatio: bestMatch.ratio,
      candidateCount: candidateDocuments.length,
    });
    return {
      document: bestMatch.doc,
      matchStrategy: 'token_overlap',
      overlapRatio: bestMatch.ratio,
      candidateDocuments,
    };
  }

  // Strategy 4: Substring match (extension-stripped filename as substring,
  // ignoring separators — handles "q3report" matching "Q3_Report").
  // Stores the stripped length as overlapRatio so kb_read can grade: a long,
  // specific substring (≥8 chars) is HIGH confidence; a short one (4–7) is
  // AMBIGUOUS because it may match multiple documents incidentally.
  for (const doc of documents) {
    const stripped = stripExtension(doc.filename).toLowerCase().replace(/[^a-z0-9]/g, '');
    const messageNoSep = messageNormalized.replace(/[^a-z0-9]/g, '');
    if (stripped.length >= 4 && messageNoSep.includes(stripped)) {
      logger.debug('Document detected via substring match', { filename: doc.filename, strippedLength: stripped.length });
      return { document: doc, matchStrategy: 'substring', overlapRatio: stripped.length };
    }
  }

  return null;
}

/**
 * Retrieve ALL chunks for a specific KB document from Qdrant across the relevant
 * category collections. This bypasses similarity search entirely — we want every
 * chunk of the document, ordered by chunkIndex, so the model sees the full content.
 *
 * The chunks are returned as RetrievedChunk[] with a score of 0 (they didn't come
 * from similarity search). The caller is responsible for applying a zero-floor
 * rerank and the empty-result safety net.
 *
 * @param document - The KB document to retrieve chunks for
 * @param categorySlugs - Category slugs for the thread (to know which collections
 *   to search; also searches the global/legacy collections)
 * @returns Array of RetrievedChunk ordered by chunkIndex, or empty if not found
 */
export async function retrieveFullKbDocumentChunks(
  document: DbDocument,
  categorySlugs: string[]
): Promise<RetrievedChunk[]> {
  const store = await getVectorStore();
  const collNames = getCollectionNames();

  // Build list of collections to search — same logic as buildContext():
  // category collections + global + legacy. Filter to existing collections.
  const candidateCollections = (categorySlugs.length > 0
    ? [...categorySlugs.map(collNames.forCategory), collNames.global, collNames.legacy]
    : [collNames.global, collNames.legacy]);

  const existingCollections = await store.listCollections();
  const collectionsToSearch = candidateCollections.filter(name => existingCollections.includes(name));

  // Search all relevant collections in parallel — the document may be in any of them
  const searchPromises = collectionsToSearch.map(async (collectionName) => {
    try {
      return await store.getDocumentChunksByDocName(collectionName, document.filename);
    } catch (err) {
      logger.warn('Failed to fetch document chunks from collection', {
        collectionName,
        documentName: document.filename,
        error: String(err),
      });
      return [];
    }
  });

  const collectionResults = await Promise.all(searchPromises);

  // Flatten and convert to RetrievedChunk[]
  // Deduplicate by chunk id (a document could theoretically appear in multiple
  // collections if it was moved between categories)
  const seenIds = new Set<string>();
  const chunks: RetrievedChunk[] = [];

  for (const collectionChunks of collectionResults) {
    for (const chunk of collectionChunks) {
      if (seenIds.has(chunk.id)) continue;
      seenIds.add(chunk.id);
      chunks.push({
        id: chunk.id,
        text: chunk.text,
        documentName: chunk.metadata.documentName || document.filename,
        pageNumber: chunk.metadata.pageNumber || 1,
        score: 0, // Not from similarity search — caller applies zero-floor rerank
        source: 'global',
      });
    }
  }

  logger.debug('Full KB document chunks retrieved', {
    documentName: document.filename,
    chunkCount: chunks.length,
    collectionsSearched: collectionsToSearch.length,
  });

  return chunks;
}
