/** Review-only diagnostics: real functions, fake I/O, no external services. */
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
      throw new Error(`Unmocked dependency ${name} in ${file}`);
    },
  };
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.module.exports;
}
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const log = (name, details) => console.log(`[upload-review] ${name}: ${JSON.stringify(details)}`);
const doc = { id: 'doc', thread_id: 'thread', user_id: 'owner', filename: 'report.pdf', content_hash: 'hash', status: 'ready' };
const sections = Array.from({ length: 12 }, (_, seq) => ({
  seq, document_id: 'doc', page_start: seq + 1, page_end: seq + 1,
  char_start: seq * 4000, char_end: (seq + 1) * 4000,
  text: `section ${seq}: ` + 'x'.repeat(3980), extract_status: 'ok',
}));

async function main() {
  const budget = load('src/lib/request-budget.ts', {
    './summarization': { countTokens: text => Math.ceil(text.length / 4) },
    '@/lib/db/compat': { getEnabledModel: async () => ({ maxInputTokens: 128000, maxOutputTokens: 8192 }) },
  });
  // Defect 5 (fixed): the tool schemas are fetched ONCE with await, before
  // truncation — so the schema estimate counts the real serialized schemas.
  const tools = [{ type: 'function', function: { name: 'fixture', description: 's'.repeat(12000) } }];
  const openaiSource = fs.readFileSync('src/lib/openai.ts', 'utf8');
  const schemaCode = openaiSource.match(
    /let tools = effectiveEnableTools \? await getToolDefinitions\(categoryIds\) : undefined;[\s\S]*?const toolSchemaTokens = estimateToolSchemaTokens\(tools \?\? \[\]\);/
  )[0];
  const AsyncFunction = (async () => {}).constructor;
  const schemaTokens = await new AsyncFunction('effectiveEnableTools', 'categoryIds', 'excludeTools', 'getToolDefinitions', 'estimateToolSchemaTokens',
    `${schemaCode}\nreturn toolSchemaTokens;`)(true, [], undefined, async () => tools, budget.estimateToolSchemaTokens);
  assert.ok(schemaTokens > 3000, `awaited schema estimate must count real schemas, got ${schemaTokens}`);
  log('awaited-tool-schemas', { schemaTokens });

  // Reuse the existing test harness with actual production function bodies,
  // but exercise the small-budget paths its permissive defaults never reach.
  const compatibility = load('src/lib/model-compatibility.ts', {});
  const native = load('src/lib/anthropic-native-state.ts', { './model-compatibility': compatibility });
  const thinking = load('src/lib/llm-thinking.ts', { './model-compatibility': compatibility });
  const fallback = load('src/lib/llm-fallback-policy.ts', {});
  const responses = load('src/lib/llm/providers/openai-responses.ts', {
    '../../model-compatibility': compatibility, '../../llm-fallback-policy': fallback,
  });
  const state = load('src/lib/tool-completion-state.ts', {
    './anthropic-native-state': native, './llm/providers/openai-responses': responses,
  });
  const harnessSource = fs.readFileSync('src/lib/openai-tool-loop.test.ts', 'utf8');
  const harnessAst = ts.createSourceFile('harness.ts', harnessSource, ts.ScriptTarget.Latest, true);
  const harnessNode = harnessAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'harness');
  const names = ['streamAnthropicCompletion', 'generateToolCompletion', 'generateToolCompletionWithFallback',
    'generateResponseWithTools', 'convertToolsToAnthropic', 'truncateContextToBudget', 'trimToolResultsToBudget', 'trimAnthropicToolResultsToBudget', 'enforceRequestBudgetBeforeCall'];
  const openaiAst = ts.createSourceFile('openai.ts', openaiSource, ts.ScriptTarget.Latest, true);
  const declarations = openaiAst.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  const compiled = ts.transpileModule(
    `const EVICTED_TOOL_RESULT_STUB = '[evicted]';\n` + declarations.map(node => node.getText(openaiAst).replace(/^export /, '')).join('\n')
      .replace("await import('./llm-fallback')", 'await loadFallback()'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText;
  const harnessCode = ts.transpileModule(harnessNode.getText(harnessAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const scope = { native, thinking, ...compatibility, ...state, ...fallback, ...budget, compiled, names,
    tools: [{ type: 'function', function: { name: 'inspect', parameters: { type: 'object', properties: {} } } }], noop() {} };
  const harness = new Function(...Object.keys(scope), `${harnessCode}\nreturn harness;`)(...Object.values(scope));
  const smallBudget = { model: 'fixture', inputLimit: 1024, maxOutputTokens: 4096, contextWindow: 5632, safetyMargin: 512, separateInputCeiling: null };
  // Defect 4 (fixed): the INITIAL provider call is budget-enforced. There are
  // no evictable tool results on the first call, so enforcement must throw
  // RequestBudgetExceeded BEFORE anything reaches the provider.
  const initialRequests = [];
  let initialOverBudget = false;
  try {
    await harness({
      resolveRequestBudget: async () => smallBudget,
      streamOpenAICompletion: async (_model, messages, options) => {
        initialRequests.push(budget.estimateMessagesTokens(messages) + budget.estimateToolSchemaTokens(options.tools));
        return { content: 'done', totalTokens: 0 };
      },
    }).generateResponseWithTools('system', [], '', 'u'.repeat(20000), true, []);
  } catch (error) {
    if (error instanceof budget.RequestBudgetExceeded) initialOverBudget = true;
    else throw error;
  }
  const firstCallTokens = initialRequests[0];
  assert.ok(
    initialOverBudget || (firstCallTokens !== undefined && firstCallTokens <= smallBudget.inputLimit),
    `over-budget initial request reached the provider (${firstCallTokens} > ${smallBudget.inputLimit}) with no RequestBudgetExceeded`
  );
  log('initial-request-budget-enforced', { limit: smallBudget.inputLimit, providerInputTokens: firstCallTokens ?? null, threwRequestBudgetExceeded: initialOverBudget });

  // Defect 4 (fixed): the tool-limit FINAL answer call is enforced too. The
  // 40k tool result sits at the tail of the messages (not evictable), so the
  // valid outcomes are: a RequestBudgetExceeded throw, OR a final call whose
  // assembled tokens fit the limit. An over-budget call reaching the provider
  // is a regression.
  const finalRequests = [];
  let finalOverBudgetThrew = false;
  await harness({
    resolveRequestBudget: async () => smallBudget,
    getLimitsSettings: async () => ({ maxTotalToolCalls: 1, maxPerToolCalls: 1, conversationHistoryMessages: 20 }),
    executeTool: async () => JSON.stringify({ success: true, data: 'x'.repeat(40000) }),
    streamOpenAICompletion: async (_model, messages, options) => {
      finalRequests.push(budget.estimateMessagesTokens(messages) + budget.estimateToolSchemaTokens(options.tools));
      return finalRequests.length === 1
        ? { content: null, totalTokens: 0, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'inspect', arguments: '{}' } }] }
        : { content: 'done', totalTokens: 0 };
    },
  }).generateResponseWithTools('system', [], '', 'inspect', true, []).catch(error => {
    if (error instanceof budget.RequestBudgetExceeded) { finalOverBudgetThrew = true; return; }
    throw error;
  });
  const finalCallTokens = finalRequests[1];
  assert.ok(
    finalOverBudgetThrew || (finalCallTokens !== undefined && finalCallTokens <= smallBudget.inputLimit),
    `over-budget tool-limit final request reached the provider (${finalCallTokens} > ${smallBudget.inputLimit}) with no RequestBudgetExceeded`
  );
  log('tool-limit-request-budget-enforced', { limit: smallBudget.inputLimit, providerInputTokens: finalRequests, threwRequestBudgetExceeded: finalOverBudgetThrew });

  // Defect 6 (fixed): the runtime (Ollama num_ctx) window reserves output +
  // safety margin — input can no longer consume the whole shared window.
  const runtime = await budget.resolveRequestBudget('fixture', { requestedMaxTokens: 8192, runtimeContextTokens: 16384 });
  assert.ok(runtime.inputLimit + runtime.maxOutputTokens + runtime.safetyMargin <= 16384,
    `runtime window over-subscribed: ${runtime.inputLimit} + ${runtime.maxOutputTokens} + ${runtime.safetyMargin} > 16384`);
  log('runtime-output-reserved', { input: runtime.inputLimit, output: runtime.maxOutputTokens, margin: runtime.safetyMargin, runtimeWindow: 16384 });

  const hit = { documentId: 'doc', documentName: 'report.pdf', seq: 0, pageStart: 1, pageEnd: 1, charStart: 0, charEnd: 4000, text: 'UPLOAD_ONLY_MATCH', score: 0.9 };
  let uploadSearches = 0;
  const search = load('src/lib/tools/kb-search.ts', {
    '../request-context': { getRequestContext: () => ({ threadId: 'thread', userId: 'owner', categoryIds: [] }) },
    '../db/compat': { getDocumentsByCategory: async () => [], getGlobalDocuments: async () => [], getRagSettings: async () => ({}) },
    '../db/compat/categories': { getCategoriesByIds: async () => [] },
    '../vector-store': {}, '../reranker': {},
    '../upload-source': { searchUploadSections: async () => { uploadSearches++; return [hit]; } },
    '../upload-processing': { isUploadOnDemandEnabled: () => true },
    '../logger': { ragLogger: logger },
  });
  // Defect 1 (fixed): the default combined scope MERGES upload hits with KB
  // results instead of discarding them, and never NOT_FOUNDs while upload
  // hits exist.
  const combined = JSON.parse(await search.kbSearchTool.execute({ query: 'upload facts' }));
  const uploadsOnly = JSON.parse(await search.kbSearchTool.execute({ query: 'upload facts', scope: 'uploads' }));
  assert.equal(uploadsOnly.results.length, 1);
  assert.equal(uploadSearches, 2);
  assert.equal(JSON.stringify(combined).includes('UPLOAD_ONLY_MATCH'), true,
    'default combined scope must include upload-only hits');
  log('combined-search-includes-upload-hits', { uploadSearches, combinedTotal: combined.totalFound, uploadsOnlyCount: uploadsOnly.results.length });

  const saved = [];
  let llmCalls = 0;
  let failFirstBatch = true;
  const traversal = load('src/lib/document-traversal.ts', {
    './llm-client': { createInternalCompletion: async () => {
      llmCalls++;
      if (failFirstBatch && llmCalls <= 2) throw new Error('fixture first batch failure');
      return '{"findings":[{"fact":"fixture"}]}';
    } },
    './db/compat/config': { getLlmSettings: async () => ({ model: 'fixture' }) },
    './logger': { ragLogger: logger },
    './db/compat': { getUploadDocumentById: async () => doc, getSectionsByDocument: async () => sections },
    './db/compat/extraction-findings': {
      getMaxExtractedSeq: async () => saved.length ? Math.max(...saved.map(row => row.seqEnd)) : 0,
      createExtractionFindingsBatch: async rows => { saved.push(...rows); return rows.length; },
      getExtractionFindingsByDocument: async () => saved.map(row => ({
        ...row, payload: row.payload, seq_start: row.seqStart, seq_end: row.seqEnd,
      })),
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
  const args = { documentId: 'doc', kind: 'facts', instruction: 'all facts' };
  const first = await traversal.runDocumentTraversal(args);
  failFirstBatch = false;
  const resumed = await traversal.runDocumentTraversal(args);
  const missingSeqs = sections.filter(s => !saved.some(row => row.seqStart <= s.seq && row.seqEnd >= s.seq)).map(s => s.seq);
  // Defect 2 (fixed): resume is range-based — it fills the hole left by the
  // failed batch instead of trusting max(seq_end), so coverage is honest.
  assert.equal(first.coverage, 'partial');
  assert.equal(resumed.coverage, 'complete');
  assert.deepEqual(missingSeqs, [], 'resume must re-extract every uncovered seq (gap-fill, not max-seq)');
  log('resume-gap-filled', { firstCoverage: first.coverage, resumedCoverage: resumed.coverage, reportedProcessed: resumed.processedSections, missingSeqs });

  // Defect 2/8 (fixed): fromSeq is clamped to [0, maxSectionSeq+1]. An
  // out-of-range start must neither fabricate coverage nor delete valid
  // findings — with the document fully covered by persisted rows, a
  // fromSeq=999 run is a no-op continuation.
  const countBeforeLateStart = saved.length;
  assert.ok(countBeforeLateStart > 0);
  const lateStart = await traversal.runDocumentTraversal({ ...args, fromSeq: 999 });
  assert.equal(saved.length, countBeforeLateStart, 'out-of-range fromSeq must not delete or duplicate persisted findings');
  assert.equal(lateStart.coverage, 'complete');
  assert.equal(lateStart.processedSections, 12);
  log('out-of-range-start-clamped', { clampedFromSeq: 999, coverage: lateStart.coverage, processedSections: lateStart.processedSections, persistedRows: saved.length });

  // Defect 8 (fixed): an explicit restart DELETES the restarted window's
  // previous findings before re-running — replace, never duplicate.
  saved.length = 0;
  await traversal.runDocumentTraversal({ ...args, fromSeq: 0 });
  const beforeRestart = saved.length;
  assert.ok(beforeRestart > 0);
  await traversal.runDocumentTraversal({ ...args, fromSeq: 0 });
  assert.equal(saved.length, beforeRestart, 'restart must replace findings, not duplicate them');
  log('restart-replaces-findings', { beforeRestart, afterRestart: saved.length });

  // Defect 3 (fixed): findings reporting pages via nextOffset instead of
  // silently capping at 50.
  saved.length = 0;
  saved.push(...Array.from({ length: 60 }, (_, seq) => ({ seqStart: seq, seqEnd: seq, payload: { fact: `fact-${seq}` } })));
  const reported = await traversal.reportExtractionFindings('doc', 'facts');
  assert.equal(reported.total, 60);
  assert.equal(reported.findings.length, 50);
  assert.equal(reported.nextOffset, 50, 'page 1 must expose nextOffset for the next call');
  const page2 = await traversal.reportExtractionFindings('doc', 'facts', 50, reported.nextOffset);
  assert.equal(page2.findings.length, 10);
  assert.equal(page2.nextOffset, null, 'page 2 is the last page');
  log('findings-report-paginated', { total: reported.total, page1: reported.findings.length, nextOffset: reported.nextOffset, page2: page2.findings.length });

  const writes = [];
  let fixturePages = [{ pageNumber: 1, text: 'x'.repeat(4000) }, { pageNumber: 2, text: '' }];
  const processing = load('src/lib/upload-processing.ts', {
    'fs/promises': { readFile: async () => Buffer.from('fixture') },
    './document-extractor': { extractText: async () => ({ pages: fixturePages, numPages: fixturePages.length, provider: 'fixture' }), getMimeTypeFromFilename: () => 'application/pdf' },
    './db/compat': {
      getUploadDocumentByUploadId: async () => undefined,
      createUploadDocument: async () => doc,
      replaceSections: async (_id, rows) => { writes.push({ rows }); },
      updateUploadDocumentStatus: async (_id, status) => { writes.push({ status }); },
      updateUploadDocumentOverview: async () => {},
    },
    './upload-source': { indexUploadSections: async () => {} },
    './llm-client': { createInternalCompletion: async () => 'overview' },
  });
  // Defect 7 (fixed): a trailing blank page contributes zero chars, so the
  // final section's range matches no page span — it must clamp to the last
  // real page instead of producing ±Infinity.
  const chunked = processing.chunkPagesIntoSections(fixturePages);
  const invalidRanges = chunked.filter(s => !Number.isFinite(s.pageStart) || !Number.isFinite(s.pageEnd));
  assert.equal(invalidRanges.length, 0, 'page ranges must always be finite integers');
  const last = chunked[chunked.length - 1];
  assert.equal(last.pageStart, 1, 'trailing blank page must clamp to the last real page');
  assert.equal(last.pageEnd, 1);
  log('blank-page-clamped-to-real-page', { sections: chunked.map(s => ({ seq: s.seq, length: s.text.length, pageStart: s.pageStart, pageEnd: s.pageEnd })) });

  // Defect 9 (fixed): a document with no extractable text is honestly 'failed'
  // — a 'ready' upload with zero sections breaks the kb_read/kb_search ladder.
  fixturePages = [{ pageNumber: 1, text: '' }];
  writes.length = 0;
  await processing.processUploadExtraction({ uploadId: 1, threadId: 'thread', userId: 'owner', filename: 'blank.pdf', filepath: 'fixture' });
  const statusWrite = writes.find(w => w.status)?.status;
  assert.equal(statusWrite?.status, 'failed');
  assert.equal(statusWrite?.errorMessage, 'Document contained no extractable text.');
  assert.equal(writes.find(w => w.rows)?.rows.length, 0);
  log('empty-document-marked-failed', { sections: writes.find(w => w.rows).rows.length, status: statusWrite.status, errorMessage: statusWrite.errorMessage });

  log('finished', { networkCalls: 0, productionFilesChanged: 0 });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
