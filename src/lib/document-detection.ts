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
 * Tokenize a filename into meaningful tokens (words), filtering out very short
 * tokens and common file-related words that wouldn't help matching.
 */
function tokenizeFilename(name: string): string[] {
  const stripped = stripExtension(name);
  // Split on non-alphanumeric characters (spaces, underscores, hyphens, dots)
  const tokens = stripped
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2);
  // Filter out very generic tokens that add noise
  const stopTokens = new Set(['doc', 'document', 'file', 'report', 'pdf', 'docx']);
  return tokens.filter(t => !stopTokens.has(t));
}

/**
 * Check whether the user's message contains a specific filename or document name
 * from the list of KB documents. Uses four progressively-looser matching strategies:
 *
 *   1. **Exact match** — the full filename (with extension) appears in the message.
 *   2. **Extension-stripped match** — the filename without extension appears
 *      (e.g. "Q3_Report" matches "Q3_Report.pdf").
 *   3. **Token overlap** — all significant tokens from the filename appear in the
 *      message (e.g. "summarise the q3 report" contains both "q3" and "report"
 *      from "Q3_Report.pdf"). Requires at least 2 meaningful tokens to avoid
 *      false positives on single-token filenames like "data.docx".
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

  // Strategy 3: Token overlap (all meaningful tokens present in message)
  for (const doc of documents) {
    const tokens = tokenizeFilename(doc.filename);
    // Need at least 2 meaningful tokens to avoid false positives
    if (tokens.length < 2) continue;

    const allPresent = tokens.every(token => {
      // Match as a word boundary or substring (handles "q3" inside "q3 report")
      return messageLower.includes(token);
    });

    if (allPresent) {
      logger.debug('Document detected via token overlap', {
        filename: doc.filename,
        tokens,
      });
      return { document: doc, matchStrategy: 'token_overlap' };
    }
  }

  // Strategy 4: Substring match (extension-stripped filename as substring,
  // ignoring separators — handles "q3report" matching "Q3_Report")
  for (const doc of documents) {
    const stripped = stripExtension(doc.filename).toLowerCase().replace(/[^a-z0-9]/g, '');
    const messageNoSep = messageNormalized.replace(/[^a-z0-9]/g, '');
    if (stripped.length >= 4 && messageNoSep.includes(stripped)) {
      logger.debug('Document detected via substring match', { filename: doc.filename });
      return { document: doc, matchStrategy: 'substring' };
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
