/**
 * Knowledge Extract Tool (Phase E — coverage-tracked exhaustive extraction)
 *
 * Terminal tool: walks the durable upload_sections store for an uploaded
 * document in batches, asks the LLM to extract structured findings per batch,
 * and persists them in `extraction_findings` (with per-batch seq coverage so a
 * re-run resumes where it left off). Unlike kb_read (which returns raw text
 * into the chat context), findings live OUTSIDE the chat context — the tool
 * returns only the distilled findings plus a coverage report.
 *
 * Gated by KNOWLEDGE_EXTRACT=true (default OFF). Identity comes exclusively
 * from the request context (plan §C4) — never from model-supplied args.
 */

import { getRequestContext } from '../request-context';
import { listUploadDocumentsByThread } from '../db/compat';
import { getAccessibleUploadDocument } from '../upload-source';
import {
  isKnowledgeExtractEnabled,
  runDocumentTraversal,
  reportExtractionFindings,
} from '../document-traversal';
import { ragLogger as logger } from '../logger';
import type { ToolDefinition, ValidationResult } from '../tools';

/** Hard cap on findings echoed back into the chat context per call. */
const MAX_REPORTED_FINDINGS = 50;

interface KnowledgeExtractArgs {
  document_id?: string;
  filename?: string;
  kind?: string;
  instruction?: string;
  from_seq?: number;
  findings_offset?: number;
}

async function executeKnowledgeExtract(args: KnowledgeExtractArgs): Promise<string> {
  if (!isKnowledgeExtractEnabled()) {
    return JSON.stringify({
      success: false,
      error: 'Exhaustive extraction is disabled (KNOWLEDGE_EXTRACT=false).',
      errorCode: 'DISABLED',
    });
  }

  const ctx = getRequestContext();
  if (!ctx.threadId) {
    return JSON.stringify({
      success: false,
      error: 'No thread context available for extraction.',
      errorCode: 'VALIDATION_ERROR',
    });
  }

  const documentId = (args?.document_id || '').trim();
  const filename = (args?.filename || '').trim();

  // Resolve the target document against the thread's upload inventory.
  let resolvedDocumentId = documentId;
  if (!resolvedDocumentId && filename) {
    const uploads = await listUploadDocumentsByThread(ctx.threadId);
    const lower = filename.toLowerCase();
    const match = uploads.find(u => u.filename.toLowerCase() === lower)
      ?? uploads.find(u => u.filename.toLowerCase().includes(lower));
    if (!match) {
      return JSON.stringify({
        success: false,
        error: `No uploaded file matching '${filename}' found in this thread.`,
        errorCode: 'NOT_FOUND',
        availableUploads: uploads.map(u => ({ documentId: u.id, filename: u.filename, status: u.status })),
      });
    }
    resolvedDocumentId = match.id;
  }

  if (!resolvedDocumentId) {
    return JSON.stringify({
      success: false,
      error: "Pass 'document_id' (from kb_summary) or 'filename' of an uploaded file.",
      errorCode: 'VALIDATION_ERROR',
    });
  }

  // Ownership guard (plan §C4): the document_id path must be checked against
  // the thread inventory — a model-supplied id must never cross threads.
  const access = await getAccessibleUploadDocument(
    resolvedDocumentId,
    ctx.threadId,
    ctx.userId || ''
  );
  if ('failure' in access) {
    return JSON.stringify({
      success: false,
      error: access.failure === 'not_found'
        ? `Upload document '${resolvedDocumentId}' not found in this thread.`
        : 'Upload document is not accessible from this thread.',
      errorCode: access.failure === 'not_found' ? 'NOT_FOUND' : 'FORBIDDEN',
    });
  }

  const kind = (args?.kind || 'general').trim() || 'general';
  const instruction = (args?.instruction || '').trim();

  try {
    const run = await runDocumentTraversal({
      documentId: resolvedDocumentId,
      kind,
      instruction,
      fromSeq: args?.from_seq,
    });

    const findings = await reportExtractionFindings(
      resolvedDocumentId,
      kind,
      MAX_REPORTED_FINDINGS,
      typeof args?.findings_offset === 'number' ? args.findings_offset : 0
    );

    logger.info('knowledge_extract run finished', {
      documentId: run.documentId,
      kind: run.kind,
      coverage: run.coverage,
      totalSections: run.totalSections,
      processedSections: run.processedSections,
      findingsCount: run.findingsCount,
      failedBatches: run.failedBatches.length,
    });

    return JSON.stringify({
      success: true,
      source: 'upload',
      documentId: run.documentId,
      kind: run.kind,
      coverage: run.coverage,
      totalSections: run.totalSections,
      processedSections: run.processedSections,
      findingsCount: run.findingsCount,
      ...(run.failedBatches.length > 0
        ? {
            failedBatches: run.failedBatches,
            note: 'Some batches failed — coverage is partial. Retry with the same kind to resume from the last extracted section.',
          }
        : {}),
      findings: findings.findings,
      findingsTotal: findings.total,
      findingsOffset: findings.offset,
      ...(findings.nextOffset !== null
        ? {
            findingsNextOffset: findings.nextOffset,
            findingsNote: `${findings.total - (findings.offset + findings.findings.length)} more findings available — call again with findings_offset=${findings.nextOffset} (same document_id and kind) to fetch the next page.`,
          }
        : {}),
    });
  } catch (err) {
    logger.error('knowledge_extract execution failed', { error: String(err) });
    return JSON.stringify({
      success: false,
      error: 'Failed to run exhaustive extraction on the uploaded document.',
      errorCode: 'EXECUTION_ERROR',
    });
  }
}

/**
 * Knowledge Extract tool definition following the ToolDefinition interface.
 */
export const knowledgeExtractTool: ToolDefinition = {
  name: 'knowledge_extract',
  displayName: 'Knowledge Extract',
  description: 'Exhaustively extract structured facts from an uploaded document with coverage tracking.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'knowledge_extract',
      description:
        'Exhaustively read an uploaded document section by section and extract structured findings (persisted outside the chat context). ' +
        'Use this when you need EVERY occurrence of something in a long document (e.g. all dates, all monetary amounts, all obligations, ' +
        'all named entities) rather than the most relevant sections. Extraction is batched and coverage-tracked: a partial run can be ' +
        'resumed by calling again with the same kind. Returns the extracted findings plus a coverage report (complete/partial).',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: "Stable documentId of an uploaded file (from kb_summary scope='uploads').",
          },
          filename: {
            type: 'string',
            description: "Filename (or recognizable part) of an uploaded file, if document_id is unknown (e.g. 'CMS RFP').",
          },
          kind: {
            type: 'string',
            description: "Label for the extraction goal, e.g. 'dates', 'amounts', 'obligations', 'entities'. Re-running the same kind resumes the previous run for that kind. Default: 'general'.",
          },
          instruction: {
            type: 'string',
            description: 'What to extract, in plain language (e.g. "every deadline and the page it appears on").',
          },
          from_seq: {
            type: 'number',
            description: 'Optional section number to force the run to restart from (overrides automatic resume). Findings in the restarted range are replaced, not duplicated.',
          },
          findings_offset: {
            type: 'number',
            description: 'Pagination offset into the persisted findings list (use findingsNextOffset from a previous response when findingsTotal exceeds one page).',
          },
        },
        required: ['instruction'],
      },
    },
  },

  execute: executeKnowledgeExtract,

  validateConfig: (): ValidationResult => ({ valid: true, errors: [] }),

  defaultConfig: {},

  configSchema: {
    type: 'object',
    properties: {},
  },

  subagentSafe: false,
};
