/**
 * Document Summarizer
 *
 * Generates pre-computed per-document summaries and synthesizes category-level
 * KB overviews from those summaries. Reuses the existing summarizeUserDocument()
 * infrastructure from rag.ts for the per-document pass.
 */

import { createInternalCompletion } from './llm-client';
import { readFileBuffer, getGlobalDocsDir, fileExists } from './storage';
import path from 'path';
import { extractText, getMimeTypeFromFilename } from './document-extractor';
import { getLlmSettings } from './db/compat/config';
import {
  upsertDocumentSummary,
  type DocumentSummaryWithFilename,
} from './db/compat/document-summaries';
import { getDocumentWithCategories } from './db/compat/documents';
import { ragLogger as logger } from './logger';

/**
 * Generate and store a summary for a single document.
 * Reads the file from disk, extracts text, and produces a concise summary.
 * Reuses the summarization thresholds from the RAG constants for consistency.
 *
 * @param docId - Document ID to summarize
 * @returns The generated summary text, or null if generation failed
 */
export async function generateDocumentSummary(docId: number): Promise<string | null> {
  const doc = await getDocumentWithCategories(docId);
  if (!doc || doc.status !== 'ready') {
    logger.warn('Cannot generate summary for document', { docId, reason: !doc ? 'not found' : `status=${doc.status}` });
    return null;
  }

  try {
    // Read file from disk for coherent full-text summarization
    const globalDocsDir = getGlobalDocsDir();
    const filePath = path.join(globalDocsDir, doc.filepath);

    if (!(await fileExists(filePath))) {
      logger.warn('Document file missing, cannot generate summary', { docId, filename: doc.filename });
      return null;
    }

    const buffer = await readFileBuffer(filePath);
    const mimeType = getMimeTypeFromFilename(doc.filename);
    const { text } = await extractText(buffer, mimeType, doc.filename);

    if (!text.trim()) {
      logger.warn('No text extracted from document, cannot generate summary', { docId, filename: doc.filename });
      return null;
    }

    const llmSettings = await getLlmSettings();
    const model = llmSettings.model;

    // For short documents, generate a direct summary.
    // For long documents, truncate to a reasonable size and summarize.
    const MAX_CHARS = 48000; // ~12K tokens — enough for most documents
    const textToSummarize = text.length > MAX_CHARS
      ? text.slice(0, MAX_CHARS) + '\n\n[... document truncated for summary generation ...]'
      : text;

    const summary = await createInternalCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You are a precise document summariser. Produce a concise but comprehensive summary ' +
            'of the provided document. Include: the document type/purpose, key topics covered, ' +
            'main findings or conclusions, and any notable data points. Write in clear prose. ' +
            'Keep the summary to 2-4 paragraphs. Do not add commentary or opinions.',
        },
        {
          role: 'user',
          content:
            `Summarise the document "${doc.filename}" for a knowledge base overview. ` +
            `Focus on what this document contains and what questions it could help answer.\n\n` +
            `--- DOCUMENT CONTENT ---\n\n${textToSummarize}`,
        },
      ],
      model,
      temperature: 0.2,
      maxTokens: 1024,
    });

    if (!summary || !summary.trim()) {
      logger.warn('LLM returned empty summary for document', { docId, filename: doc.filename });
      return null;
    }

    // Upsert the summary (INSERT ON CONFLICT DO UPDATE handles replacement)
    await upsertDocumentSummary(docId, summary.trim(), model);

    logger.debug('Document summary generated and stored', { docId, filename: doc.filename, summaryLength: summary.length });
    return summary.trim();
  } catch (err) {
    logger.error('Failed to generate document summary', { docId, error: String(err) });
    return null;
  }
}

/**
 * Synthesize a consolidated category overview from per-document summaries.
 * Called at query time when a user asks "summarise the knowledge base" and
 * the category has more than a few documents.
 *
 * @param summaries - Per-document summaries with filenames
 * @param categoryName - Name of the category for context
 * @returns A synthesized overview text
 */
export async function synthesizeCategoryOverview(
  summaries: DocumentSummaryWithFilename[],
  categoryName: string
): Promise<string> {
  if (summaries.length === 0) {
    return `The "${categoryName}" category contains no documents.`;
  }

  // Build a compact representation of all document summaries
  const docList = summaries
    .map((s, i) => `### Document ${i + 1}: ${s.filename}\n${s.summaryText}`)
    .join('\n\n');

  try {
    const llmSettings = await getLlmSettings();
    const model = llmSettings.model;

    const overview = await createInternalCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You are a knowledge base analyst. Given summaries of individual documents in a category, ' +
            'produce a consolidated overview that helps a user understand what information is available. ' +
            'Organize by themes or topics. Highlight relationships between documents where evident. ' +
            'Be concise but comprehensive. Do not add information not present in the summaries.',
        },
        {
          role: 'user',
          content:
            `The category "${categoryName}" contains ${summaries.length} documents. ` +
            `Below are summaries of each document. Synthesize a consolidated overview of this category's knowledge base.\n\n` +
            `${docList}\n\n` +
            `Produce a structured overview with: 1) a brief introduction, 2) key themes/topics covered, ` +
            `and 3) a listing of each document with a one-line description.`,
        },
      ],
      model,
      temperature: 0.3,
      maxTokens: 2048,
    });

    return overview?.trim() || buildFallbackOverview(summaries, categoryName);
  } catch (err) {
    logger.warn('Category overview synthesis failed, falling back to direct listing', { error: String(err) });
    return buildFallbackOverview(summaries, categoryName);
  }
}

/**
 * Fallback: build a simple concatenated overview without LLM synthesis.
 * Used when the LLM call fails or for small categories.
 */
function buildFallbackOverview(
  summaries: DocumentSummaryWithFilename[],
  categoryName: string
): string {
  if (summaries.length === 0) {
    return `The "${categoryName}" category contains no documents.`;
  }

  const header = `The "${categoryName}" category contains ${summaries.length} document(s):\n\n`;
  const docList = summaries
    .map((s, i) => `**${i + 1}. ${s.filename}**\n${s.summaryText}`)
    .join('\n\n');

  return header + docList;
}
