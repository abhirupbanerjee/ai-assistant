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
import { ragLogger as logger } from '../logger';
import type { ToolDefinition, ValidationResult } from '../tools';

/**
 * Character budget for the returned document content (~3000 tokens).
 * Keeps the tool result within a safe slice of the model's context window.
 */
const KB_READ_CHAR_BUDGET = 12000;

interface KbReadArgs {
  filename?: string;
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
      return JSON.stringify({
        success: false,
        error: `No document matching '${filename}' found in the knowledge base. Retry with one of the available filenames.`,
        errorCode: 'NOT_FOUND',
        availableDocs: uniqueKbDocs.map(d => d.filename),
      });
    }

    const categorySlugs = categories.map(c => c.slug);
    const chunks = await retrieveFullKbDocumentChunks(detected.document, categorySlugs);

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
      totalChunks: chunks.length,
      returnedChunks: resultChunks.length,
      truncated,
    });

    return JSON.stringify({
      success: true,
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
        "Pass the filename or a recognizable part of it (e.g. 'CMS RFP' matches 'FINAL-1-CMS-RFP-September-2024.pdf').",
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
