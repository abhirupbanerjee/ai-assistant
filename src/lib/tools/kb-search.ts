/**
 * KB Search Tool
 *
 * The middle rung of the kb_* ladder:
 *   kb_summary  → "what documents exist?" (inventory)
 *   kb_search   → "find passages relevant to this query" (this tool)   ← semantic, iterable
 *   kb_read     → "open this specific document" (full text by filename)
 *
 * Unlike the automatic RAG pipeline, this tool is **model-callable**: the LLM
 * decides when the RAG context is insufficient and issues a precise query. It
 * returns ranked passages with filenames + page numbers so the model can cite
 * them or follow up with kb_read for the full document.
 *
 * Retrieval mirrors the RAG path: hybrid dense+sparse query across the thread's
 * category collections + global + legacy, then rerank-as-ordering with
 * `minScoreOverride: 0` so NO passage is zeroed by the 0.30 reranker floor
 * (that floor caused the original production failure where everything got
 * dropped). The model sees all retrieved passages ordered by relevance.
 *
 * The `top_k` parameter and `hasMore` flag make this iterable — the model can
 * call kb_search again with a refined query to explore different passages.
 */

import { getRequestContext } from '../request-context';
import { getDocumentsByCategory, getGlobalDocuments, getRagSettings } from '../db/compat';
import { getCategoriesByIds } from '../db/compat/categories';
import { getVectorStore, resolveActiveCollectionNames } from '../vector-store';
import { searchUploadSections, type UploadSearchHit } from '../upload-source';
import { isUploadOnDemandEnabled } from '../upload-processing';
import { rerankChunks } from '../reranker';
import { ragLogger as logger } from '../logger';
import type { RetrievedChunk } from '@/types';
import type { ToolDefinition, ValidationResult } from '../tools';

/**
 * Default and max number of passages to return per call.
 * 8 passages × ~1000 chars ≈ 8000 chars (~2000 tokens) — a safe slice that
 * leaves room for the model to call kb_search again (iterable via `hasMore`).
 */
const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;

/** Max chars of passage text returned per result (truncated with an ellipsis). */
const PASSAGE_CHAR_BUDGET = 1200;

interface KbSearchArgs {
  query?: string;
  top_k?: number;
  scope?: 'kb' | 'uploads' | 'all';
  document_id?: string;
}

/** Shape the upload-hit list into the shared kb_search response payload. */
function uploadSearchResponse(
  scope: 'kb' | 'uploads' | 'all',
  query: string,
  hits: UploadSearchHit[],
  topK: number,
): Record<string, unknown> {
  return {
    success: true,
    scope,
    query,
    exhaustive: false,
    results: hits.map(h => ({
      documentId: h.documentId,
      documentName: h.documentName,
      seq: h.seq,
      page_start: h.pageStart,
      page_end: h.pageEnd,
      char_start: h.charStart,
      char_end: h.charEnd,
      text: h.text.length > PASSAGE_CHAR_BUDGET
        ? h.text.slice(0, PASSAGE_CHAR_BUDGET) + '…'
        : h.text,
      score: Math.round(h.score * 1000) / 1000,
    })),
    totalFound: hits.length,
    hasMore: hits.length >= topK,
    ...(hits.length >= topK
      ? { note: 'Results are ranked, not exhaustive. Call kb_read with the documentId (and page_start/page_end or from_char) for exact ranges.' }
      : {}),
    ...(hits.length === 0
      ? { hint: 'No upload sections matched. Call kb_summary scope=uploads to see extracted uploads, or search the KB with scope=kb.' }
      : {}),
  };
}

/**
 * Execute the KB search tool.
 * Embeds the query, runs a hybrid query across the thread's collections,
 * reranks with no floor (ordering-only), and returns the top passages.
 */
async function executeKbSearch(args: KbSearchArgs): Promise<string> {
  const query = (args?.query || '').trim();
  if (!query) {
    return JSON.stringify({
      success: false,
      error: "Missing required parameter 'query'. Pass a natural-language query describing what you are looking for (e.g. 'CMS RFP eligibility criteria').",
      errorCode: 'VALIDATION_ERROR',
    });
  }

  const requestedTopK = typeof args?.top_k === 'number' ? args.top_k : DEFAULT_TOP_K;
  const topK = Math.max(1, Math.min(Math.trunc(requestedTopK), MAX_TOP_K));

  const ctx = getRequestContext();
  const categoryIds = ctx.categoryIds || [];
  const scope = args?.scope === 'kb' || args?.scope === 'uploads' ? args.scope : 'all';

  // ---- Uploads scope: search the thread's private upload sections (§C2) ----
  // For the default 'all' scope, upload hits are MERGED into the final result —
  // they are never discarded just because the KB side of the search runs too.
  let uploadHits: UploadSearchHit[] = [];
  if (scope !== 'kb') {
    const uploadsEnabled = isUploadOnDemandEnabled();
    if (uploadsEnabled && ctx.threadId) {
      const hits = await searchUploadSections({
        threadId: ctx.threadId,
        userId: ctx.userId || '',
        query,
        topK,
        documentId: args?.document_id,
      });
      if (scope === 'uploads') {
        return JSON.stringify(uploadSearchResponse(scope, query, hits, topK));
      }
      // Default 'all' scope: keep the upload hits so they can be merged with
      // the KB results below instead of being silently discarded.
      uploadHits = hits;
    } else if (scope === 'uploads') {
      return JSON.stringify({
        success: true,
        scope,
        query,
        results: [],
        totalFound: 0,
        hasMore: false,
        hint: uploadsEnabled
          ? 'No thread context available for upload search.'
          : 'Upload search is disabled (UPLOAD_ON_DEMAND=false).',
      });
    }
  }


  try {
    // Fetch category docs + global docs + categories + rag settings in parallel.
    // We load documents to (a) confirm the KB is non-empty and (b) restrict the
    // query to collections that actually contain ready documents (mirrors the
    // source-set logic in kb-read.ts and the RAG retrieval path).
    const [categoryDocSets, globalDocs, categories, ragSettings] = await Promise.all([
      Promise.all(categoryIds.map(id => getDocumentsByCategory(id))),
      getGlobalDocuments(),
      getCategoriesByIds(categoryIds),
      getRagSettings(),
    ]);

    const allKbDocs = [...globalDocs, ...categoryDocSets.flat()]
      .filter(doc => doc.status === 'ready');
    const seenDocIds = new Set<number>();
    const uniqueKbDocs = allKbDocs.filter(doc => {
      if (seenDocIds.has(doc.id)) return false;
      seenDocIds.add(doc.id);
      return true;
    });

    if (uniqueKbDocs.length === 0) {
      // With no KB documents, the upload hits (if any) are the only results —
      // never fail with NOT_FOUND while a matching upload section exists.
      if (uploadHits.length > 0) {
        return JSON.stringify(uploadSearchResponse(scope, query, uploadHits, topK));
      }
      return JSON.stringify({
        success: false,
        error: 'The knowledge base contains no documents for the current categories.',
        errorCode: 'NOT_FOUND',
        availableDocs: [],
      });
    }

    const categorySlugs = categories.map(c => c.slug);

    // Build the collection list — same logic as retrieveFullKbDocumentChunks /
    // buildContext: category collections + global + legacy, filtered to existing.
    const store = await getVectorStore();
    const collNames = await resolveActiveCollectionNames();
    const candidateCollections = (categorySlugs.length > 0
      ? [...categorySlugs.map(collNames.forCategory), collNames.global, collNames.legacy]
      : [collNames.global, collNames.legacy]);

    const existingCollections = await store.listCollections();
    const collectionsToSearch = candidateCollections.filter(name => existingCollections.includes(name));

    if (collectionsToSearch.length === 0) {
      return JSON.stringify({
        success: false,
        error: 'No vector-store collections are available for the current categories. Documents may still be processing.',
        errorCode: 'NOT_FOUND',
        availableDocs: uniqueKbDocs.map(d => d.filename),
      });
    }

    // Embed the query (reuse the same embedding path as RAG).
    // Lazy-imported: a top-level import of ../openai creates a module cycle
    // (openai → agent-tools → invoker → tools.ts → kb-search) that crashes
    // with a TDZ error whenever kb-search is the first module loaded.
    const { createEmbeddings } = await import('../openai');
    const [queryEmbedding] = await createEmbeddings([query]);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return JSON.stringify({
        success: false,
        error: 'Failed to generate query embedding.',
        errorCode: 'EXECUTION_ERROR',
      });
    }

    // Hybrid query (dense + sparse when enabled) with a 0 similarity threshold —
    // we rely on rerank-as-ordering below, not on Qdrant's pre-filter, so we
    // retrieve a generous candidate pool (topKChunks) and let the reranker order.
    // This is the key difference from the automatic RAG path: no floor zeroes
    // passages here, so the model always sees something to work with.
    const candidatePoolSize = Math.max(ragSettings.topKChunks, topK * 3);
    const results = await store.queryMultipleCollections(
      collectionsToSearch,
      queryEmbedding,
      candidatePoolSize,
      undefined, // filter
      0,         // scoreThreshold — no pre-filter; rerank handles ordering
      ragSettings.hybridSearchEnabled, // hybridSearch
      query,     // queryText for sparse vector tokenization
    );

    if (results.documents.length === 0) {
      if (uploadHits.length > 0) {
        return JSON.stringify(uploadSearchResponse(scope, query, uploadHits, topK));
      }
      return JSON.stringify({
        success: true,
        query,
        results: [],
        totalFound: 0,
        hasMore: false,
        hint: 'No passages matched the query. Try a broader or rephrased query, or call kb_summary to see what documents exist.',
      });
    }

    // Convert to RetrievedChunk[] (same shape as the RAG path). Also capture,
    // per chunk id, the canonical documentId (from payload metadata) and the
    // physical source collection so the output can report the real document id
    // distinctly from the chunk id (G13 fix) and the hit's provenance.
    const chunkProvenance = new Map<string, { documentId: string; sourceCollection: string }>();
    const chunks: RetrievedChunk[] = results.documents.map((doc, i) => {
      const chunkId = results.ids[i];
      chunkProvenance.set(chunkId, {
        documentId: results.metadatas[i]?.documentId || '',
        sourceCollection: results.collections[i] || '',
      });
      return {
        id: chunkId,
        text: doc,
        documentName: results.metadatas[i]?.documentName || 'Unknown',
        pageNumber: results.metadatas[i]?.pageNumber || 1,
        score: results.scores[i] || 0,
        source: 'global' as const,
      };
    });

    // Rerank with NO floor (minScoreOverride: 0) — ordering-only. This is the
    // critical fix: the 0.30 reranker floor that zeroed the pool in the original
    // production failure is bypassed here so the model always gets ranked results.
    const reranked = await rerankChunks(query, chunks, { minScoreOverride: 0 });

    const totalFound = reranked.length;
    const slice = reranked.slice(0, topK);
    const hasMore = totalFound > slice.length;

    const mappedResults = slice.map(chunk => {
      const provenance = chunkProvenance.get(chunk.id);
      return {
        filename: chunk.documentName,
        page: chunk.pageNumber,
        text: chunk.text.length > PASSAGE_CHAR_BUDGET
          ? chunk.text.slice(0, PASSAGE_CHAR_BUDGET) + '…'
          : chunk.text,
        score: Math.round(chunk.score * 1000) / 1000, // 3-decimal precision
        documentId: provenance?.documentId ?? '',
        chunkId: chunk.id,
        sourceCollection: provenance?.sourceCollection ?? '',
      };
    });

    logger.debug('KB search tool executed', {
      query,
      collectionsSearched: collectionsToSearch.length,
      candidates: chunks.length,
      reranked: totalFound,
      returned: mappedResults.length,
      hasMore,
    });

    // Merge upload hits into the default 'all' scope: they compete for the
    // same topK slice, uploads first (they are the user's own exact content).
    const combinedResults = uploadHits.length > 0 && scope === 'all'
      ? [
          ...uploadHits.map(h => ({
            documentId: h.documentId,
            documentName: h.documentName,
            seq: h.seq,
            page_start: h.pageStart,
            page_end: h.pageEnd,
            char_start: h.charStart,
            char_end: h.charEnd,
            text: h.text.length > PASSAGE_CHAR_BUDGET
              ? h.text.slice(0, PASSAGE_CHAR_BUDGET) + '…'
              : h.text,
            score: Math.round(h.score * 1000) / 1000,
          })),
          ...mappedResults,
        ].slice(0, topK)
      : mappedResults;

    return JSON.stringify({
      success: true,
      query,
      results: combinedResults,
      totalFound: scope === 'all' ? totalFound + uploadHits.length : totalFound,
      hasMore: scope === 'all' ? totalFound + uploadHits.length > combinedResults.length : hasMore,
      ...(hasMore
        ? { note: `${totalFound - mappedResults.length} more passages available — call kb_search again with a more specific query to refine, or call kb_read with a filename to open the full document.` }
        : {}),
    });
  } catch (err) {
    logger.error('KB search tool execution failed', { error: String(err) });
    return JSON.stringify({
      success: false,
      error: 'Failed to search the knowledge base',
      errorCode: 'EXECUTION_ERROR',
    });
  }
}

/**
 * KB Search tool definition following the ToolDefinition interface.
 */
export const kbSearchTool: ToolDefinition = {
  name: 'kb_search',
  displayName: 'Knowledge Base Search',
  description: 'Search the knowledge base for passages matching a natural-language query.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'kb_search',
      description:
        'Search the knowledge base for passages matching a natural-language query. ' +
        'Use this when the RAG context is insufficient or when the user asks about a ' +
        'specific topic that may be in indexed documents. Returns ranked passages with ' +
        'filenames and page numbers for citation. Call again with a refined query to ' +
        'explore more passages (check the hasMore flag). ' +
        'Prefer this over web_search for information that should already be in the ' +
        'knowledge base. Pair with kb_read to open a full document, or kb_summary to ' +
        'see what documents exist.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A natural-language query describing what you are looking for (e.g. "CMS RFP eligibility criteria", "Q3 revenue growth").',
          },
          top_k: {
            type: 'number',
            description: `Number of passages to return (default ${DEFAULT_TOP_K}, max ${MAX_TOP_K}). Increase for broader coverage or decrease for precision.`,
          },
          scope: {
            type: 'string',
            enum: ['kb', 'uploads', 'all'],
            description: "'kb' → knowledge base collections only; 'uploads' → files uploaded to this thread only; 'all' → both (default).",
          },
          document_id: {
            type: 'string',
            description: "Restrict the search to a single uploaded document (from kb_summary scope='uploads'). Only used for upload scopes.",
          },
        },
        required: ['query'],
      },
    },
  },

  execute: executeKbSearch,

  validateConfig: (): ValidationResult => ({ valid: true, errors: [] }),

  defaultConfig: {},

  configSchema: {
    type: 'object',
    properties: {},
  },

  subagentSafe: true,
};
