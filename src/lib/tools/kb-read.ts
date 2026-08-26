/**
 * KB Read Tool
 *
 * Reads the full content of a specific knowledge-base document by filename or
 * partial name. Complements kb_summary (which only returns one-line inventory
 * summaries): the model calls kb_summary to discover what exists, then kb_read
 * to retrieve the actual text of a document it has identified — instead of
 * falling back to web search for a document that is already indexed.
 *
 * Filename matching reuses detectReferencedDocument() (exact → extension-
 * stripped → token-overlap → substring), so partial references like "CMS RFP"
 * match "FINAL-1-CMS-RFP-September-2024.pdf".
 *
 * Output is truncated to a character budget to avoid blowing the model's
 * context; the `truncated` flag tells the model to ask for specific sections.
 */

import { getRequestContext } from '../request-context';
import { getDocumentsByCategory, getGlobalDocuments } from '../db/compat';
import { getCategoriesByIds } from '../db/compat/categories';
import { detectReferencedDocument, retrieveFullKbDocumentChunks } from '../document-detection';
import type { DetectedDocument } from '../document-detection';
import { ragLogger as logger } from '../logger';
import type { ToolDefinition, ValidationResult } from '../tools';

/**
 * Character budget for the returned document content (~3000 tokens).
 * Keeps the tool result within a safe slice of the model's context window.
 */
const KB_READ_CHAR_BUDGET = 12000;

/** Confidence band for the detected document, used to decide HITL behavior. */
type KbReadConfidence = 'high' | 'ambiguous' | 'none';

/**
 * Thresholds for grading token_overlap matches. A match with ratio ≥ 0.9 is a
 * near-certain hit (HIGH). 0.6–0.9 is AMBIGUOUS — especially when competing
 * candidates exist — and should trigger clarification. Substring matches use
 * the stripped length as the overlapRatio: ≥8 chars is specific (HIGH), <8 is
 * AMBIGUOUS (may incidentally match several documents).
 */
const HIGH_OVERLAP_THRESHOLD = 0.9;
const SUBSTRING_HIGH_LENGTH = 8;

interface KbReadArgs {
  filename?: string;
}

/**
 * Grade the detected document into a confidence tier.
 * - exact / extension_stripped → HIGH (unambiguous name presence)
 * - token_overlap ≥ 0.9 → HIGH; 0.6–0.9 → AMBIGUOUS
 * - substring: length ≥ 8 → HIGH; < 8 → AMBIGUOUS
 * - no detection → NONE (caller handles null before calling this)
 */
export function gradeConfidence(detected: DetectedDocument): KbReadConfidence {
  switch (detected.matchStrategy) {
    case 'exact':
    case 'extension_stripped':
      return 'high';
    case 'token_overlap':
      return (detected.overlapRatio ?? 0) >= HIGH_OVERLAP_THRESHOLD ? 'high' : 'ambiguous';
    case 'substring':
      return (detected.overlapRatio ?? 0) >= SUBSTRING_HIGH_LENGTH ? 'high' : 'ambiguous';
    default:
      return 'ambiguous';
  }
}

/**
 * Execute the KB read tool.
 * Resolves the filename against the thread's KB documents (fuzzy), fetches
 * all of the document's chunks from the vector store, and returns them in
 * page order up to the character budget.
 */
async function executeKbRead(args: KbReadArgs): Promise<string> {
  const filename = (args?.filename || '').trim();
  if (!filename) {
    return JSON.stringify({
      success: false,
      error: "Missing required parameter 'filename'. Pass the filename or a recognizable part of it (e.g. 'CMS RFP').",
      errorCode: 'VALIDATION_ERROR',
    });
  }

  const ctx = getRequestContext();
  const categoryIds = ctx.categoryIds || [];

  try {
    // Fetch category docs + global docs in parallel (same source set as the
    // RAG retrieval path in streaming/rag-retrieval.ts)
    const [categoryDocSets, globalDocs, categories] = await Promise.all([
      Promise.all(categoryIds.map(id => getDocumentsByCategory(id))),
      getGlobalDocuments(),
      getCategoriesByIds(categoryIds),
    ]);

    // Combine all documents (deduplicate by id), filter to 'ready' status
    const allKbDocs = [...globalDocs, ...categoryDocSets.flat()]
      .filter(doc => doc.status === 'ready');
    const seenDocIds = new Set<number>();
    const uniqueKbDocs = allKbDocs.filter(doc => {
      if (seenDocIds.has(doc.id)) return false;
      seenDocIds.add(doc.id);
      return true;
    });

    if (uniqueKbDocs.length === 0) {
      return JSON.stringify({
        success: false,
        error: 'The knowledge base contains no documents for the current categories.',
        errorCode: 'NOT_FOUND',
        availableDocs: [],
      });
    }

    // Fuzzy-match the requested filename against KB documents
    const detected = detectReferencedDocument(filename, uniqueKbDocs);
    if (!detected) {
      // NONE confidence: no document matched. Surface the full inventory so the
      // model can call kb_summary for descriptions or kb_search for topical
      // passages instead of falling back to web_search.
      return JSON.stringify({
        success: false,
        confidence: 'none' as const,
        error: `No document matching '${filename}' found in the knowledge base.`,
        errorCode: 'NOT_FOUND',
        availableDocs: uniqueKbDocs.map(d => d.filename),
        hint: "Call kb_summary to see document descriptions, or call kb_search with a topic query to find passages. Only use web_search if the topic is not in the knowledge base.",
      });
    }

    const confidence = gradeConfidence(detected);

    // AMBIGUOUS confidence: the filename partially matches and there are
    // competing candidates. Do not fetch chunks — return the candidates and
    // instruct the model to clarify with the user (request_clarification is
    // injected whenever kb_* tools are active) or retry with an exact name.
    if (confidence === 'ambiguous') {
      const candidates = [
        { filename: detected.document.filename, overlapRatio: detected.overlapRatio ?? null },
        ...(detected.candidateDocuments ?? []).map(c => ({
          filename: c.document.filename,
          overlapRatio: c.overlapRatio,
        })),
      ];
      return JSON.stringify({
        success: false,
        confidence: 'ambiguous' as const,
        error: `Multiple documents could match '${filename}'. Please confirm which one you mean.`,
        errorCode: 'AMBIGUOUS_MATCH',
        candidates,
        hint: "Call request_clarification to ask the user which document to open (pass the candidate filenames as options, allowFreeText: true), then call kb_read again with the exact filename. If request_clarification is unavailable, ask the user in plain text.",
      });
    }

    const categorySlugs = categories.map(c => c.slug);
    // Retrieval is keyed on the stable canonical DB document id; the filename
    // (`detected.document.filename`) is used above for fuzzy matching and below
    // only for output display.
    const chunks = await retrieveFullKbDocumentChunks(String(detected.document.id), categorySlugs);

    if (chunks.length === 0) {
      return JSON.stringify({
        success: false,
        error: `Document '${detected.document.filename}' was found but has no indexed content. It may still be processing — try again later.`,
        errorCode: 'NOT_FOUND',
        availableDocs: uniqueKbDocs.map(d => d.filename),
      });
    }

    // Accumulate chunks in page order up to the character budget
    const resultChunks: { page: number; text: string }[] = [];
    let usedChars = 0;
    let truncated = false;

    for (const chunk of chunks) {
      if (usedChars + chunk.text.length > KB_READ_CHAR_BUDGET) {
        truncated = true;
        break;
      }
      resultChunks.push({ page: chunk.pageNumber, text: chunk.text });
      usedChars += chunk.text.length;
    }

    const totalPages = Math.max(...chunks.map(c => c.pageNumber));

    logger.debug('KB read tool executed', {
      requestedFilename: filename,
      matchedFilename: detected.document.filename,
      matchStrategy: detected.matchStrategy,
      confidence,
      totalChunks: chunks.length,
      returnedChunks: resultChunks.length,
      truncated,
    });

    return JSON.stringify({
      success: true,
      confidence: 'high' as const,
      filename: detected.document.filename,
      matchStrategy: detected.matchStrategy,
      chunks: resultChunks,
      totalPages,
      truncated,
      ...(truncated
        ? { note: `Content truncated to ${KB_READ_CHAR_BUDGET} characters (${resultChunks.length} of ${chunks.length} sections). Ask the user which section to focus on, or call kb_read again with a more specific request.` }
        : {}),
    });
  } catch (err) {
    logger.error('KB read tool execution failed', { error: String(err) });
    return JSON.stringify({
      success: false,
      error: 'Failed to read document from the knowledge base',
      errorCode: 'EXECUTION_ERROR',
    });
  }
}

/**
 * KB Read tool definition following the ToolDefinition interface.
 */
export const kbReadTool: ToolDefinition = {
  name: 'kb_read',
  displayName: 'Knowledge Base Read',
  description: 'Read the full content of a specific document from the knowledge base by filename or partial name.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'kb_read',
      description:
        'Read the full content of a specific document from the knowledge base by filename or partial name. ' +
        'Use this AFTER kb_summary to retrieve the actual text of a document you have identified. ' +
        'Returns the document content with page numbers for citation. ' +
        'Always prefer this over web_search for documents that exist in the knowledge base. ' +
        "Pass the filename or a recognizable part of it (e.g. 'CMS RFP' matches 'FINAL-1-CMS-RFP-September-2024.pdf'). " +
        'The result includes a confidence field: "high" (content returned), "ambiguous" (multiple candidates — ' +
        'call request_clarification with the candidate filenames as options, then retry with the exact name), ' +
        'or "none" (no match — call kb_summary or kb_search instead).',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: "The filename or a recognizable part of it (e.g. 'CMS RFP', 'Q3 report'). Fuzzy-matched against indexed documents.",
          },
        },
        required: ['filename'],
      },
    },
  },

  execute: executeKbRead,

  validateConfig: (): ValidationResult => ({ valid: true, errors: [] }),

  defaultConfig: {},

  configSchema: {
    type: 'object',
    properties: {},
  },

  subagentSafe: true,
};
