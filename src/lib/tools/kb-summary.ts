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
import { synthesizeCategoryOverview } from '../document-summarizer';
import { ragLogger as logger } from '../logger';
import type { ToolDefinition, ValidationResult } from '../tools';

/**
 * Execute the KB summary tool.
 * Fetches per-document summaries for the thread's categories and returns
 * either a direct listing (≤3 docs) or an LLM-synthesized overview (>3 docs).
 */
async function executeKbSummary(): Promise<string> {
  const ctx = getRequestContext();
  const categoryIds = ctx.categoryIds || [];

  if (categoryIds.length === 0) {
    return JSON.stringify({
      success: true,
      summary: 'No categories are selected for this thread. Select categories to see knowledge base documents.',
      documentCount: 0,
    });
  }

  try {
    const summaries = await getDocumentSummariesByCategories(categoryIds);
    const categories = await getCategoriesByIds(categoryIds);
    const categoryName = categories.map(c => c.name).join(', ');

    if (summaries.length === 0) {
      return JSON.stringify({
        success: true,
        summary: `The selected categories (${categoryName}) contain no documents with summaries. An admin can generate summaries from Admin > Documents > Summarise All.`,
        categoryName,
        documentCount: 0,
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

    return JSON.stringify({
      success: true,
      summary: overview,
      categoryName,
      documentCount: summaries.length,
      documents: summaries.map(s => s.filename),
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
        'Get a summary overview of all documents in the knowledge base for the current categories. ' +
        'IMPORTANT: Call this when the user asks what documents are available, wants a summary or overview of the knowledge base (KB), ' +
        'asks about KB contents, or wants to know what information is in the system. ' +
        'This tool uses pre-computed document summaries stored separately from the search index — ' +
        'call it EVEN IF the knowledge base search context appears empty or returns no results. ' +
        'The search context only matches specific queries; this tool provides a complete inventory of all documents.',
      parameters: {
        type: 'object',
        properties: {},
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
