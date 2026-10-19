/** Diagnostic-only probes. Runs real TS functions with isolated fake I/O. */
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

function load(file, mocks) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  const exports = {};
  const sandbox = {
    exports, module: { exports }, console, process, Buffer,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'crypto') return require('node:crypto');
      throw new Error(`Unmocked dependency: ${name} in ${file}`);
    },
  };
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.module.exports;
}
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const doc = { id: 'doc', thread_id: 'thread', user_id: 'owner', filename: 'report.pdf', content_hash: 'hash', status: 'ready', page_count: 3 };
const sections = Array.from({ length: 12 }, (_, seq) => ({
  id: `s${seq}`, document_id: 'doc', seq,
  page_start: seq + 1, page_end: seq + 1,
  char_start: seq * 4000, char_end: (seq + 1) * 4000,
  text: 'x'.repeat(4000), extract_status: 'ok',
}));
function log(name, details) { console.log(`[upload-debug] ${name}: ${JSON.stringify(details)}`); }

async function main() {
  // ---- Probe 1: uploads are NOT vector-searched per chat turn by default;
  // vector evidence is strictly opt-in via UPLOAD_EVIDENCE=true. ----
  let vectorCalls = 0;
  const retrieval = load('src/lib/upload-retrieval.ts', {
    './request-context': { getRequestContext: () => ({ threadId: 'thread', userId: 'owner' }) },
    './upload-processing': { isUploadOnDemandEnabled: () => true },
    './db/compat': { listUploadDocumentsByThread: async () => [doc] },
    './upload-source': { searchUploadSections: async () => { vectorCalls++; return []; } },
    './logger': { ragLogger: logger },
  });
  await retrieval.buildUploadOnDemandContext([doc], 'hello');
  await retrieval.buildUploadOnDemandContext([doc], 'thanks');
  log('eager-vector-search-off-by-default', { unrelatedChatTurns: 2, vectorCalls });
  assert.equal(vectorCalls, 0, 'vector search must NOT run per chat turn by default');

  // Opt-in check: the explicit UPLOAD_EVIDENCE=true flag enables it.
  process.env.UPLOAD_EVIDENCE = 'true';
  try {
    await retrieval.buildUploadOnDemandContext([doc], 'hello again');
    log('evidence-opt-in-flag', { flag: 'UPLOAD_EVIDENCE=true', vectorCallsAfterEnable: vectorCalls });
    assert.equal(vectorCalls, 1, 'UPLOAD_EVIDENCE=true must enable opt-in vector evidence');
  } finally {
    delete process.env.UPLOAD_EVIDENCE;
  }

  // ---- Probe 2: cursor pagination strictly advances and terminates. ----
  const source = load('src/lib/upload-source.ts', {
    './openai': {}, './vector-store': {},
    './db/compat': {
      getUploadDocumentById: async () => doc,
      getSectionsByDocument: async () => sections,
      getSectionsByCharRange: async (_id, start, end) => sections.filter(s => s.char_end >= start && s.char_start <= end),
      getSectionsByPageRange: async (_id, start, end) => sections.filter(s => s.page_end >= start && s.page_start <= end),
    },
  });
  const readInput = { documentId: 'doc', threadId: 'thread', userId: 'owner', maxChars: 4000 };
  let slice = await source.readUploadSections(readInput);
  const seenSeqs = slice.result.sections.map(s => s.seq);
  let reads = 1;
  while (slice.result.next) {
    const prevCursor = slice.result.next.cursor;
    slice = await source.readUploadSections({ ...readInput, cursor: prevCursor });
    assert.ok(slice.result.sections.length > 0, 'cursor read must always return new sections (no infinite loop)');
    assert.ok(slice.result.sections[0].seq > seenSeqs[seenSeqs.length - 1], 'cursor must advance to unread sections');
    seenSeqs.push(...slice.result.sections.map(s => s.seq));
    reads++;
  }
  log('cursor-pagination-terminates', { reads, sectionsSeen: seenSeqs.length, firstSeq: seenSeqs[0], lastSeq: seenSeqs[seenSeqs.length - 1] });
  // Array.from: seenSeqs may originate from the vm sandbox realm (different
  // Array.prototype), which strict deep-equality would otherwise reject.
  assert.deepEqual(Array.from(seenSeqs), sections.map(s => s.seq), 'cursor chain must cover every section exactly once, in order');
  assert.equal(slice.result.next, null, 'final read must report completion');

  // ---- Probe 3: knowledge_extract must reject foreign document_id BEFORE
  // any traversal work happens. ----
  let traversalCalls = 0;
  const tool = load('src/lib/tools/knowledge-extract.ts', {
    '../request-context': { getRequestContext: () => ({ threadId: 'attacker-thread', userId: 'attacker' }) },
    '../db/compat': { listUploadDocumentsByThread: async () => [] },
    '../upload-source': { getAccessibleUploadDocument: async () => ({ failure: 'forbidden' }) },
    '../document-traversal': {
      isKnowledgeExtractEnabled: () => true,
      runDocumentTraversal: async input => { traversalCalls++; return { ...input, coverage: 'complete', totalSections: 1, processedSections: 1, findingsCount: 1, failedBatches: [] }; },
      reportExtractionFindings: async () => ({ total: 1, findings: [{ summary: 'private fixture' }] }),
    },
    '../logger': { ragLogger: logger },
  });
  const result = JSON.parse(await tool.knowledgeExtractTool.execute({ document_id: 'foreign-document', instruction: 'extract everything' }));
  log('extraction-authorization', { foreignDocTraversalCalls: traversalCalls, success: result.success, errorCode: result.errorCode });
  assert.equal(result.success, false, 'foreign document_id must be rejected');
  assert.equal(result.errorCode, 'FORBIDDEN');
  assert.equal(traversalCalls, 0, 'traversal must never run for a foreign document');

  // ---- Probes 4–9: document traversal semantics. ----
  async function traversalProbe({ persisted = [], raw = '{"findings":[]}', status = 'ready', sectionStatus = 'ok', fromSeq } = {}) {
    const saved = [];
    const traversal = load('src/lib/document-traversal.ts', {
      './llm-client': { createInternalCompletion: async () => raw },
      './db/compat/config': { getLlmSettings: () => ({ model: 'fixture' }) },
      './logger': { ragLogger: logger },
      './db/compat': {
        getUploadDocumentById: async () => ({ ...doc, status }),
        getSectionsByDocument: async () => sections.map(s => ({ ...s, extract_status: sectionStatus })),
      },
      './db/compat/extraction-findings': {
        createExtractionFindingsBatch: async rows => { saved.push(...rows); return rows.length; },
        getExtractionFindingsByDocument: async () => persisted,
        deleteExtractionFindingsInRange: async (documentId, kind, seqStart, seqEnd) => {
          const before = saved.length;
          for (let i = saved.length - 1; i >= 0; i--) {
            const row = saved[i];
            if (row.seqStart <= seqEnd && row.seqEnd >= seqStart) saved.splice(i, 1);
          }
          return before - saved.length;
        },
      },
    });
    const run = await traversal.runDocumentTraversal({ documentId: 'doc', kind: 'facts', instruction: 'all facts', fromSeq });
    return { traversal, run, saved };
  }
  const fresh = await traversalProbe();
  log('fresh-traversal-includes-section-zero', { firstSavedSeq: fresh.saved[0].seqStart, savedBatches: fresh.saved.length, reportedProcessed: fresh.run.processedSections, total: fresh.run.totalSections, coverage: fresh.run.coverage });
  assert.equal(fresh.saved[0].seqStart, 0, 'a fresh run must process seq 0 (sections are 0-based)');
  assert.deepEqual(fresh.saved.map(s => [s.seqStart, s.seqEnd]), [[0, 4], [5, 8], [9, 11]]);
  assert.equal(fresh.run.coverage, 'complete');
  assert.equal(fresh.run.processedSections, 12);

  const invalid = await traversalProbe({ raw: 'truncated invalid response' });
  log('invalid-json-coverage', { coverage: invalid.run.coverage, failedBatches: invalid.run.failedBatches.length, persistedEmptyMarkers: invalid.saved.length });
  assert.equal(invalid.run.coverage, 'partial', 'malformed model output must NOT count as complete coverage');
  assert.equal(invalid.run.failedBatches.length, 3, 'every malformed batch must be recorded as failed');
  assert.equal(invalid.saved.length, 0, 'malformed output must never be persisted as an empty tombstone');

  // Range-based resume: persisted coverage comes from finding ROWS, not a
  // max seq. A fully covered document re-extracts nothing.
  const persistedRows = sections.map(s => ({
    document_id: 'doc', kind: 'facts', seq_start: s.seq, seq_end: s.seq,
    payload: { empty: true }, page_start: s.page_start, page_end: s.page_end,
    char_start: s.char_start, char_end: s.char_end,
  }));
  const resumed = await traversalProbe({ persisted: persistedRows });
  log('resume-fully-covered-no-op', { persistedRows: persistedRows.length, reExtracted: resumed.saved.length, coverage: resumed.run.coverage });
  assert.deepEqual(resumed.saved.map(s => [s.seqStart, s.seqEnd]), [], 'a fully covered document must not re-extract anything');
  assert.equal(resumed.run.coverage, 'complete');
  assert.equal(resumed.run.processedSections, 12);

  // Hole in the middle (seqs 1–5 uncovered by persisted rows): resume must
  // fill ONLY the hole — the original maxSeq-based resume skipped it.
  const holedRows = sections
    .map(s => ({ seq: s.seq }))
    .filter(s => s.seq < 1 || s.seq > 5)
    .map(s => ({
      document_id: 'doc', kind: 'facts', seq_start: s.seq, seq_end: s.seq,
      payload: { empty: true }, page_start: s.page_start, page_end: s.page_end,
      char_start: s.char_start, char_end: s.char_end,
    }));
  const holeFilled = await traversalProbe({ persisted: holedRows });
  log('resume-gap-fill', { uncoveredSeqs: [1, 2, 3, 4, 5], reExtracted: holeFilled.saved.map(s => [s.seqStart, s.seqEnd]), coverage: holeFilled.run.coverage });
  assert.deepEqual(holeFilled.saved.map(s => [s.seqStart, s.seqEnd]), [[1, 5]], 'resume must re-extract exactly the uncovered range');
  assert.equal(holeFilled.run.coverage, 'complete');

  const restarted = await traversalProbe({ persisted: persistedRows, fromSeq: 0 });
  log('explicit-restart-honored', { requestedFromSeq: 0, actualFirstSeq: restarted.saved[0].seqStart, savedBatches: restarted.saved.length });
  assert.equal(restarted.saved[0].seqStart, 0, 'explicit fromSeq=0 must be a genuine restart, not ignored');
  assert.deepEqual(restarted.saved.map(s => [s.seqStart, s.seqEnd]), [[0, 4], [5, 8], [9, 11]], 'restart must re-extract the whole window after deleting old findings');

  // processedSections counts extraction-finding COVERAGE (the ranges the
  // extraction ran over); coverage is the honesty signal — sections whose
  // source text was never extractable must keep the run 'partial' forever.
  const failed = await traversalProbe({ status: 'partial', sectionStatus: 'failed' });
  log('unavailable-source-coverage', { sourceStatus: 'partial', allSectionsFailed: true, coverage: failed.run.coverage, reportedProcessed: failed.run.processedSections });
  assert.equal(failed.run.coverage, 'partial', 'sections whose source failed must not be reported as covered');
  assert.equal(failed.run.processedSections, 12);

  const batches = fresh.traversal.buildExtractionBatches(sections);
  const maxSections = Math.max(...batches.map(b => b.sections.length));
  const maxChars = Math.max(...batches.map(b => b.text.length));
  log('batch-budget-with-overlap', { configuredMaxSections: 5, configuredMaxChars: 24000, actualMaxSections: maxSections, actualMaxChars: maxChars });
  assert.ok(maxSections <= 5, 'no batch may exceed 5 sections including overlap');
  assert.ok(maxChars <= 24000, 'no batch may exceed the 24000-char budget including overlap');

  // ---- Probe 10: kb_read routes uploads first — by filename AND by a lone
  // cursor (reusing the real upload-source module and its mocked I/O). ----
  const kb = load('src/lib/tools/kb-read.ts', {
    '../request-context': { getRequestContext: () => ({ threadId: 'thread', userId: 'owner', categoryIds: [] }) },
    '../db/compat': { getDocumentsByCategory: async () => [], getGlobalDocuments: async () => [], listUploadDocumentsByThread: async () => [doc] },
    '../db/compat/categories': { getCategoriesByIds: async () => [] },
    '../document-detection': {},
    '../upload-source': source,
    '../upload-processing': { isUploadOnDemandEnabled: () => true },
    '../logger': { ragLogger: logger },
  });
  const byName = JSON.parse(await kb.kbReadTool.execute({ filename: 'report.pdf' }));
  log('upload-read-by-filename', { existingUpload: doc.filename, success: byName.success, source: byName.source });
  assert.equal(byName.success, true, 'kb_read by filename must read the thread upload');
  assert.equal(byName.source, 'upload');
  const cursorOnly = JSON.parse(await kb.kbReadTool.execute({ cursor: byName.next.cursor }));
  log('upload-read-cursor-alone', { success: cursorOnly.success, firstSeq: cursorOnly.sections?.[0]?.seq, truncated: cursorOnly.truncated });
  assert.equal(cursorOnly.success, true, 'a lone cursor must resolve the document on its own');
  const prevLastSeq = byName.sections[byName.sections.length - 1].seq;
  assert.equal(cursorOnly.sections[0].seq, prevLastSeq + 1, 'cursor continuation must start after the previously returned section');
  assert.notEqual(byName.next.cursor, undefined);

  // ---- Probe 11: kb_summary with NO categories must still surface uploads. ----
  const summary = load('src/lib/tools/kb-summary.ts', {
    '../request-context': { getRequestContext: () => ({ threadId: 'thread', userId: 'owner', categoryIds: [] }) },
    '../db/compat/document-summaries': { getDocumentSummariesByCategories: async () => [] },
    '../db/compat/categories': { getCategoriesByIds: async () => [] },
    '../db/compat': { listUploadDocumentsByThread: async () => [doc] },
    '../document-summarizer': {},
    '../logger': { ragLogger: logger },
  });
  const inventory = JSON.parse(await summary.kbSummaryTool.execute({}));
  log('default-inventory-no-categories', { existingUploads: 1, returnedUploadCount: inventory.uploadCount, documentCount: inventory.documentCount });
  assert.equal(inventory.uploadCount, 1, 'kb_summary default scope must list thread uploads even with no categories');

  // ---- Probe 12: pg JSONB outlines arrive already parsed (type parser 3802
  // is not overridden) — the inventory card must render them anyway. ----
  const pgOutline = require('pg').types.getTypeParser(3802)('[{"seq":0,"page_start":1,"heading":"Introduction"}]');
  const inventoryCard = retrieval.formatUploadInventoryCard([{ ...doc, outline: pgOutline }]);
  log('native-jsonb-outline', { databaseReturnsArray: Array.isArray(pgOutline), renderedOutline: inventoryCard.includes('Introduction') });
  assert.equal(Array.isArray(pgOutline), true);
  assert.ok(inventoryCard.includes('Introduction'), 'already-parsed JSONB outlines must render in the inventory card');

  log('probe-finished', { externalNetworkCalls: 0, productionFilesChanged: 0 });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
