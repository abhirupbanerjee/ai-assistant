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
import { getDocumentWithCategories, type DocumentWithCategories } from './db/compat/documents';
import { retrieveFullKbDocumentChunks } from './document-detection';
import { ragLogger as logger } from './logger';

/**
 * Load the full text of a document for summarisation.
 *
 * PRIMARY PATH — Qdrant chunks: the document was already extracted during
 * ingestion (text → chunks → embed → Qdrant). We reassemble the chunk texts
 * in their original order (chunkIndex then pageNumber, see
 * `retrieveFullKbDocumentChunks`). This avoids re-paying for Azure DI on
 * every summary run and removes the dependency on the source file being on
 * disk.
 *
 * FALLBACK PATH — disk + extractText: used when no chunks are found in
 * Qdrant (e.g. the document was ingested before reliable chunking, or chunks
 * were purged) but the original file is still present. Preserves the
 * pre-fix behaviour for those edge cases.
 *
 * @returns `{ text, source }` where source is 'qdrant' | 'disk' | 'none'.
 *   'none' means neither chunks nor a readable file were available.
 */
async function loadDocumentText(
  doc: DocumentWithCategories
): Promise<{ text: string; source: 'qdrant' | 'disk' | 'none'; chunkCount?: number }> {
  // PRIMARY: reassemble text from Qdrant chunks (already-extracted text)
  const categorySlugs = doc.categories.map(c => c.slug);
  // retrieveFullKbDocumentChunks expects a DbDocument (with is_global), while
  // DocumentWithCategories carries isGlobal instead. Reconstruct the DbDocument
  // shape — only filename is actually read by the chunk fetcher.
  const docForChunks = {
    ...doc,
    is_global: doc.isGlobal ? 1 : 0,
  };
  try {
    const chunks = await retrieveFullKbDocumentChunks(docForChunks, categorySlugs);
    if (chunks.length > 0) {
      const text = chunks
        .map(c => c.text)
        .filter(t => typeof t === 'string' && t.length > 0)
        .join('\n\n');
      if (text.trim()) {
        return { text, source: 'qdrant', chunkCount: chunks.length };
      }
    }
    logger.debug('No usable chunks found in Qdrant, falling back to disk', {
      docId: doc.id, filename: doc.filename, chunkCount: chunks.length,
    });
  } catch (err) {
    logger.warn('Qdrant chunk fetch failed, falling back to disk', {
      docId: doc.id, filename: doc.filename, error: String(err),
    });
  }

  // FALLBACK: re-extract from the original file on disk
  const globalDocsDir = getGlobalDocsDir();
  const filePath = path.join(globalDocsDir, doc.filepath);
  if (!(await fileExists(filePath))) {
    return { text: '', source: 'none' };
  }
  const buffer = await readFileBuffer(filePath);
  const mimeType = getMimeTypeFromFilename(doc.filename);
  const { text } = await extractText(buffer, mimeType, doc.filename);
  return { text, source: 'disk' };
}

/**
 * Generate and store a summary for a single document.
 *
 * Loads the document text from Qdrant chunks first (the text already
 * extracted during ingestion), falling back to re-extraction from the
 * original file on disk only when chunks are unavailable. Produces a
 * concise summary via the internal LLM completion API and upserts it into
 * the document_summaries table.
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
    const { text, source, chunkCount } = await loadDocumentText(doc);

    if (source === 'none' || !text.trim()) {
      logger.warn('No text available for document — no chunks in Qdrant and file missing', {
        docId, filename: doc.filename,
      });
      return null;
    }

    logger.debug('Document text loaded for summarisation', {
      docId, filename: doc.filename, source, chunkCount, textLength: text.length,
    });

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
            'Keep the summary to 2-4 paragraphs. Do not add commentary or opinions.\n\n' +
            'The document content below is reassembled from retrieval chunks and may contain ' +
            'artefacts: (1) duplicated passages where chunks overlap — treat these as a single ' +
            'passage and do not repeat content; (2) lines like "[Document: <filename>]" which ' +
            'are metadata markers — ignore them entirely and do not mention the filename beyond ' +
            'the explicit request; (3) lines starting with "##" or similar which are section ' +
            'headings extracted from the document — use these as structural cues to organise ' +
            'your summary. Synthesise across the entire provided text; do not narrate it ' +
            'sequentially.',
        },
        {
          role: 'user',
          content:
            `Summarise the document "${doc.filename}" for a knowledge base overview. ` +
            `Focus on what this document contains and what questions it could help answer. ` +
            `Note: the content may include chunking artefacts (duplicated passages, metadata ` +
            `markers, heading prefixes) as described in the system instructions — focus on the ` +
            `substantive content only.\n\n` +
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
