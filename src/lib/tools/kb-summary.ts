/**
 * KB Summary Tool
 *
 * Provides a summary of all documents in the knowledge base for the current
 * thread's categories. The LLM decides when to call this tool based on the
 * user's query — no regex-based intent detection needed.
 *
 * Uses pre-computed per-document summaries from the document_summaries table.
 * For categories with >3 documents, synthesizes a consolidated overview via LLM.
 */

import { getRequestContext } from '../request-context';
import { getDocumentSummariesByCategories } from '../db/compat/document-summaries';
import { getCategoriesByIds } from '../db/compat/categories';
import { listUploadDocumentsByThread } from '../db/compat';
import type { UploadDocument } from '../db/compat/upload-documents';
import type { OutlineEntry } from '../upload-processing';
import { synthesizeCategoryOverview } from '../document-summarizer';
import { ragLogger as logger } from '../logger';
import type { ToolDefinition, ValidationResult } from '../tools';

type KbSummaryScope = 'kb' | 'uploads' | 'all';

interface KbSummaryArgs {
  scope?: KbSummaryScope;
}

/**
 * Build the raw upload inventory (plan §C1): per-upload stable documentId,
 * filename, extraction status, page count, and outline when present.
 * The inventory NEVER synthesizes — it reports stored state only.
 */
function buildUploadInventory(
  threadId: string
): Promise<Array<{
  documentId: string;
  filename: string;
  status: string;
  pageCount: number | null;
  outline: OutlineEntry[] | null;
  overview: string | null;
}>> {
  return listUploadDocumentsByThread(threadId).then(docs =>
    docs.map(d => ({
      documentId: d.id,
      filename: d.filename,
      status: d.status,
      pageCount: d.page_count,
      // pg returns JSONB columns already parsed (type parser 3802 is NOT
      // overridden), so accept both a parsed array and a JSON string.
      outline: parseOutline(d.outline),
      overview: d.overview,
    }))
  );
}

function parseOutline(raw: UploadDocument['outline']): OutlineEntry[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? JSON.parse(raw)
        : null;
    return Array.isArray(parsed) ? (parsed as OutlineEntry[]) : null;
  } catch {
    return null;
  }
}

/**
 * Execute the KB summary tool.
 * Fetches per-document summaries for the thread's categories and returns
 * either a direct listing (≤3 docs) or an LLM-synthesized overview (>3 docs).
 */
async function executeKbSummary(args?: KbSummaryArgs): Promise<string> {
  const ctx = getRequestContext();
  const categoryIds = ctx.categoryIds || [];
  const scope: KbSummaryScope = args?.scope === 'kb' || args?.scope === 'uploads'
    ? args.scope
    : 'all';

  // With NO categories selected, scope 'uploads' still lists thread uploads,
  // and scope 'all' must surface them too — the previous condition hid the
  // upload inventory entirely for category-less threads.
  if (categoryIds.length === 0 && scope === 'kb') {
    return JSON.stringify({
      success: true,
      summary: 'No categories are selected for this thread. Select categories to see knowledge base documents.',
      documentCount: 0,
    });
  }

  try {
    // ---- Upload inventory (server-context identity only, plan §C4) ----
    let uploads: Awaited<ReturnType<typeof buildUploadInventory>> = [];
    let uploadsError: string | null = null;
    if (scope !== 'kb') {
      if (ctx.threadId) {
        try {
          uploads = await buildUploadInventory(ctx.threadId);
        } catch (err) {
          logger.warn('Upload inventory failed', { error: String(err) });
          uploadsError = 'Upload inventory is temporarily unavailable.';
        }
      }
      if (scope === 'uploads') {
        return JSON.stringify({
          success: true,
          scope,
          uploads,
          ...(uploadsError ? { warning: uploadsError } : {}),
          uploadCount: uploads.length,
          summary: uploads.length === 0
            ? 'No files have been uploaded to this thread.'
            : 'Raw inventory of files uploaded to this thread. Use documentId with kb_read (page_start/page_end/from_char) or kb_search (document_id) for on-demand access.',
        });
      }
    }

    const summaries = await getDocumentSummariesByCategories(categoryIds);
    const categories = await getCategoriesByIds(categoryIds);
    const categoryName = categories.map(c => c.name).join(', ');

    if (summaries.length === 0) {
      return JSON.stringify({
        success: true,
        summary: `The selected categories (${categoryName}) contain no documents with summaries. An admin can generate summaries from Admin > Documents > Summarise All.`,
        categoryName,
        documentCount: 0,
        // scope 'all' must still surface the upload inventory even when the
        // KB side is empty — otherwise uploads are invisible to the model.
        ...(scope === 'all'
          ? {
              uploads,
              uploadCount: uploads.length,
              ...(uploadsError ? { warning: uploadsError } : {}),
            }
          : {}),
      });
    }

    let overview: string;

    if (summaries.length <= 3) {
      // Small category: return per-doc summaries directly
      overview = summaries
        .map((s, i) => `### ${i + 1}. ${s.filename}\n${s.summaryText}`)
        .join('\n\n');
    } else {
      // Large category: synthesize a consolidated overview
      overview = await synthesizeCategoryOverview(summaries, categoryName);
    }

    logger.debug('KB summary tool executed', {
      categoryIds,
      categoryName,
      documentCount: summaries.length,
      overviewLength: overview.length,
    });

    const includeUploads = scope === 'all';
    return JSON.stringify({
      success: true,
      scope,
      summary: overview,
      categoryName,
      documentCount: summaries.length,
      documents: summaries.map(s => s.filename),
      ...(includeUploads
        ? {
            uploads,
            uploadCount: uploads.length,
            ...(uploadsError ? { warning: uploadsError } : {}),
          }
        : {}),
    });
  } catch (err) {
    logger.error('KB summary tool execution failed', { error: String(err) });
    return JSON.stringify({
      success: false,
      error: 'Failed to retrieve knowledge base summary',
      errorCode: 'EXECUTION_ERROR',
    });
  }
}

/**
 * KB Summary tool definition following the ToolDefinition interface.
 */
export const kbSummaryTool: ToolDefinition = {
  name: 'kb_summary',
  displayName: 'Knowledge Base Summary',
  description: 'Get an overview of all documents available in the knowledge base for the current categories.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'kb_summary',
      description:
        'Get a summary overview of all documents in the knowledge base for the current categories, ' +
        "and/or the raw inventory of files uploaded to this thread. scope: 'kb' (KB only), 'uploads' (thread uploads only), or 'all' (default). " +
        'IMPORTANT: Call this when the user asks what documents are available, wants a summary or overview, ' +
        'asks about KB contents, or wants to know what information is in the system — including uploaded files. ' +
        'This tool uses pre-computed document summaries stored separately from the search index — ' +
        'call it EVEN IF the knowledge base search context appears empty or returns no results. ' +
        'The search context only matches specific queries; this tool provides a complete inventory of all documents. ' +
        'Uploaded files expose a stable documentId usable with kb_read and kb_search.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['kb', 'uploads', 'all'],
            description: "'kb' → knowledge base documents only; 'uploads' → files uploaded to this thread only; 'all' → both (default). Upload inventory is raw (no synthesis): use documentId with kb_read/kb_search.",
          },
        },
        required: [],
      },
    },
  },

  execute: executeKbSummary,

  validateConfig: (): ValidationResult => ({ valid: true, errors: [] }),

  defaultConfig: {},

  configSchema: {
    type: 'object',
    properties: {},
  },

  subagentSafe: true,
};
