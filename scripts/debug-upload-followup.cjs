/** Fixed-behavior regression diagnostics. Real production bodies, fake I/O, no network. */
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

function load(file, mocks) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  const sandbox = { exports, module: { exports }, console, process, Buffer,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'crypto') return require('node:crypto');
      throw new Error(`Unmocked dependency ${name} in ${file}`);
    },
  };
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.module.exports;
}

function functions(file, names, dependencies = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const bodies = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
  assert.equal(bodies.length, names.length);
  const output = ts.transpileModule(bodies.map(n => n.getText(source).replace(/^export /, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(`${output}\n({${names.join(',')}})`, dependencies);
}

const log = (name, details) => console.log(`[upload-followup] ${name}: ${JSON.stringify(details)}`);
const logger = { info() {}, warn() {}, debug() {}, error() {} };
const doc = { id: 'doc', thread_id: 'thread', user_id: 'owner', filename: 'fixture.pdf', content_hash: 'hash', status: 'ready' };
const sections = Array.from({ length: 10 }, (_, seq) => ({
  seq, text: `section ${seq}`, extract_status: 'ok', page_start: seq + 1,
  page_end: seq + 1, char_start: seq * 4000, char_end: (seq + 1) * 4000,
}));

async function main() {
  const { convertFilter } = functions('src/lib/vector-store/qdrant.ts', ['convertFilter']);
  let filterReceived;
  const source = load('src/lib/upload-source.ts', {
    './openai': { createEmbeddings: async () => [[1, 0]] },
    './db/compat': { getUploadDocumentById: async () => doc, getSectionsByDocument: async () => sections },
    './vector-store': { getVectorStore: async () => ({
      collectionExists: async () => true,
      query: async (_collection, _embedding, _topK, filter) => {
        filterReceived = convertFilter(filter);
        return { ids: ['hit'], documents: ['later section'], scores: [0.9],
          metadatas: [{ documentId: 'doc', documentName: 'fixture.pdf', chunkIndex: 7, pageNumber: 8 }] };
      },
    }) },
  });
  const hits = await source.searchUploadSections({ threadId: 'thread', userId: 'owner', documentId: 'doc', query: 'fixture' });
  assert.deepEqual(Array.from(filterReceived.must, condition => condition.key), ['threadId', 'userId', 'documentId']);
  log('adapter-filter-shape', { actual: filterReceived, expectedKeys: ['threadId', 'userId', 'documentId'] });
  assert.equal(hits[0].charStart, sections[7].char_start);
  assert.equal(hits[0].charEnd, sections[7].char_end);
  assert.equal(hits[0].text, sections[7].text);
  log('search-source-provenance', { seq: hits[0].seq, returnedCharStart: hits[0].charStart,
    expectedStoredCharStart: sections[7].char_start });

  async function traversalProbe(initialRows, fromSeq, document = doc, inputSections = sections) {
    let rows = initialRows.map(row => ({ ...row }));
    const prompts = [];
    const api = load('src/lib/document-traversal.ts', {
      './llm-client': { createInternalCompletion: async input => { prompts.push(input.messages[1].content); return '{"findings":[]}'; } },
      './db/compat/config': { getLlmSettings: async () => ({ model: 'fixture' }) },
      './logger': { ragLogger: logger },
      './db/compat': { getUploadDocumentById: async () => document, getSectionsByDocument: async () => inputSections },
      './db/compat/extraction-findings': {
        getExtractionFindingsByDocument: async () => rows,
        deleteExtractionFindingsInRange: async (_doc, _kind, start, end) => {
          const before = rows.length;
          rows = rows.filter(row => !(row.seq_start <= end && row.seq_end >= start));
          return before - rows.length;
        },
        createExtractionFindingsBatch: async inputs => {
          rows.push(...inputs.map(row => ({ seq_start: row.seqStart, seq_end: row.seqEnd, payload: row.payload })));
          return inputs.length;
        },
      },
    });
    const run = await api.runDocumentTraversal({ documentId: 'doc', kind: 'facts', instruction: 'extract', fromSeq });
    const missing = inputSections.filter(s => !rows.some(r => r.seq_start <= s.seq && r.seq_end >= s.seq)).map(s => s.seq);
    return { run, rows, missing, prompts };
  }

  const restart = await traversalProbe([{ seq_start: 0, seq_end: 4 }, { seq_start: 5, seq_end: 9 }], 2);
  assert.equal(restart.run.coverage, 'complete');
  assert.deepEqual(restart.missing, []);
  log('mid-range-restart', { coverage: restart.run.coverage, actualPersistedMissing: restart.missing,
    storedRanges: restart.rows.map(r => [r.seq_start, r.seq_end]) });

  await assert.rejects(traversalProbe([], undefined, { ...doc, status: 'processing' }, []), /not ready/);
  await assert.rejects(traversalProbe([], undefined, doc, []), /no extracted source sections/);
  log('processing-document-no-sections', { processingRejected: true, emptyReadySourceRejected: true });

  const budget = load('src/lib/request-budget.ts', {
    './summarization': { countTokens: text => Math.ceil(text.length / 4) },
    '@/lib/db/compat': { getEnabledModel: async () => ({ maxInputTokens: 128000, maxOutputTokens: 8192 }) },
  });
  await assert.rejects(budget.resolveRequestBudget('fixture', {
    requestedMaxTokens: 8192, runtimeContextTokens: 8192, safetyMargin: 512,
  }), budget.RequestBudgetExceeded);
  const tiny = await budget.resolveRequestBudget('fixture', {
    requestedMaxTokens: 1024, runtimeContextTokens: 2048, safetyMargin: 512,
  });
  assert.equal(tiny.inputLimit + tiny.maxOutputTokens + tiny.safetyMargin, 2048);
  log('runtime-window-floor', { input: tiny.inputLimit, output: tiny.maxOutputTokens, margin: tiny.safetyMargin,
    total: tiny.inputLimit + tiny.maxOutputTokens + tiny.safetyMargin, physicalWindow: 2048, impossibleReservationRejected: true });

  const enforcement = functions('src/lib/openai.ts', [
    'trimToolResultsToBudget', 'trimAnthropicToolResultsToBudget', 'enforceRequestBudgetBeforeCall',
  ], { ...budget, logger, countTokens: text => Math.ceil(text.length / 4), EVICTED_TOOL_RESULT_STUB: '[evicted]' });
  const messages = [{ role: 'user', content: 'small prompt' }];
  const anthropicMessages = [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'x'.repeat(20000), signature: 'signed' }] },
    { role: 'user', content: 'small prompt' }];
  assert.throws(() => enforcement.enforceRequestBudgetBeforeCall({ messages, anthropicMessages, tools: [], toolSchemaTokens: 0,
    inputLimit: 1024, model: 'claude-fixture', useAnthropicDirect: true, callSite: 'diagnostic' }), budget.RequestBudgetExceeded);
  assert.ok(budget.estimateMessagesTokens(anthropicMessages) > 1024);
  log('native-anthropic-budget-enforced', { mirrorTokens: budget.estimateMessagesTokens(messages),
    nativeEstimate: budget.estimateMessagesTokens(anthropicMessages), inputLimit: 1024,
    overBudgetRejected: true });

  const historyApi = functions('src/lib/conversation-context.ts', ['buildHistory'], {
    countTokens: text => text.length,
  });
  const history = historyApi.buildHistory([{ id: 'old', role: 'user', content: '12345678' },
    { id: 'recent', role: 'assistant', content: 'abcdefgh' }], 10, 10);
  assert.equal(history.tokens, 8);
  assert.deepEqual(Array.from(history.all, message => message.id), ['recent']);
  log('two-message-history-budget', { maxTokens: 10, actualTokens: history.tokens,
    mostRecentTokens: 8 });
  log('finished', { passingRegressionCases: 7, networkCalls: 0 });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
