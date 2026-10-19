/** Offline integration contracts: real production bodies, isolated DB/vector/LLM I/O. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import type { UploadSection } from './db/compat/upload-documents';
import type { NewExtractionFinding } from './db/compat/extraction-findings';

function load<T>(filename: string, mocks: Record<string, unknown>): T {
  const file = new URL(filename, import.meta.url);
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file.pathname,
  }).outputText;
  const exports = {};
  const sandbox = { exports, module: { exports }, console, process, Buffer,
    require(name: string) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'crypto') return crypto;
      throw new Error(`Unmocked dependency ${name} in ${filename}`);
    },
  };
  vm.runInNewContext(output, sandbox, { filename: file.pathname });
  return sandbox.module.exports as T;
}

const logger = { info() {}, warn() {}, debug() {}, error() {} };
const document = { id: 'doc', thread_id: 'thread', user_id: 'owner', filename: 'fixture.pdf', status: 'ready' };
const sections: UploadSection[] = Array.from({ length: 10 }, (_, seq) => ({
  id: `section-${seq}`, document_id: 'doc', seq, text: `text ${seq}`,
  page_start: seq + 1, page_end: seq + 2,
  char_start: seq * 4000, char_end: seq * 4000 + 100,
  extract_status: 'ok', created_at: '2026-10-19T00:00:00Z',
}));

function searchHarness(owner = 'owner', sourceExists = true) {
  let receivedFilter: Record<string, unknown> | undefined;
  const api = load<typeof import('./upload-source')>('./upload-source.ts', {
    './openai': { createEmbeddings: async () => [[1, 0]] },
    './db/compat': {
      getUploadDocumentById: async () => sourceExists ? { ...document, user_id: owner } : undefined,
      getSectionsByDocument: async () => sections,
    },
    './vector-store': { getVectorStore: async () => ({
      collectionExists: async () => true,
      query: async (_name: string, _embedding: number[], _topK: number, filter: Record<string, unknown>) => {
        receivedFilter = filter;
        return { ids: ['hit'], documents: ['stale vector text'], scores: [0.9], collections: ['uploads-thread'],
          metadatas: [{ documentId: 'doc', documentName: 'fixture.pdf', chunkIndex: 7, pageNumber: 8 }] };
      },
    }) },
  });
  return { api, filter: () => receivedFilter };
}

const searchInput = { threadId: 'thread', userId: 'owner', query: 'fixture', documentId: 'doc' };

test('upload search uses the vector adapter flat-filter contract, including optional document scoping', async () => {
  const harness = searchHarness();
  await harness.api.searchUploadSections(searchInput);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.filter())), {
    threadId: 'thread', userId: 'owner', documentId: 'doc',
  });
  // Exercise the adapter's real conversion too: the transport must filter on
  // identity fields, never on a payload field named "must".
  const file = new URL('./vector-store/qdrant.ts', import.meta.url);
  const parsed = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'convertFilter');
  assert.ok(declaration);
  const output = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const convert = vm.runInNewContext(`${output}\nconvertFilter`) as (filter: unknown) => { must: Array<{ key: string }> };
  assert.deepEqual(Array.from(convert(harness.filter()).must, condition => condition.key), ['threadId', 'userId', 'documentId']);
  await harness.api.searchUploadSections({ threadId: 'thread', userId: 'owner', query: 'fixture' });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.filter())), { threadId: 'thread', userId: 'owner' });
});

test('upload search hydrates exact multi-page and character provenance from durable sections', async () => {
  const { api } = searchHarness();
  const hits = await api.searchUploadSections(searchInput);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pageStart, 8);
  assert.equal(hits[0].pageEnd, 9);
  assert.equal(hits[0].charStart, 28000);
  assert.equal(hits[0].charEnd, 28100);
  assert.equal(hits[0].text, sections[7].text);
});

test('upload search drops stale vectors with deleted or foreign-owner source rows', async () => {
  for (const harness of [searchHarness('foreign-owner'), searchHarness('owner', false)]) {
    const hits = await harness.api.searchUploadSections(searchInput);
    assert.equal(hits.length, 0);
  }
});

interface StoredRange { seq_start: number; seq_end: number }

function traversalHarness(status = 'ready', inputSections = sections, persisted: StoredRange[] = []) {
  let rows = persisted.map(row => ({ ...row }));
  let llmCalls = 0;
  let deleteCalls = 0;
  const api = load<typeof import('./document-traversal')>('./document-traversal.ts', {
    './llm-client': { createInternalCompletion: async () => { llmCalls++; return '{"findings":[]}'; } },
    './db/compat/config': { getLlmSettings: async () => ({ model: 'fixture' }) },
    './logger': { ragLogger: logger },
    './db/compat': {
      getUploadDocumentById: async () => ({ ...document, status }),
      getSectionsByDocument: async () => inputSections,
    },
    './db/compat/extraction-findings': {
      getExtractionFindingsByDocument: async () => rows,
      deleteExtractionFindingsInRange: async (_doc: string, _kind: string, start: number, end: number) => {
        deleteCalls++;
        const before = rows.length;
        rows = rows.filter(row => !(row.seq_start <= end && row.seq_end >= start));
        return before - rows.length;
      },
      createExtractionFindingsBatch: async (inputs: NewExtractionFinding[]) => {
        rows.push(...inputs.map(row => ({ seq_start: row.seqStart, seq_end: row.seqEnd })));
        return inputs.length;
      },
    },
  });
  return { api, rows: () => rows, llmCalls: () => llmCalls, deleteCalls: () => deleteCalls };
}

test('mid-range traversal restart rebuilds the full deleted range including its prefix', async () => {
  const harness = traversalHarness('ready', sections, [{ seq_start: 0, seq_end: 4 }, { seq_start: 5, seq_end: 9 }]);
  const input = { documentId: 'doc', kind: 'facts', instruction: 'extract', fromSeq: 2 };
  const run = await harness.api.runDocumentTraversal(input);
  assert.equal(run.coverage, 'complete');
  assert.equal(run.processedSections, sections.length);
  assert.ok(sections.every(s => harness.rows().some(row => row.seq_start <= s.seq && row.seq_end >= s.seq)));
  const count = harness.rows().length;
  const resumed = await harness.api.runDocumentTraversal({ ...input, fromSeq: undefined });
  assert.equal(resumed.coverage, 'complete');
  assert.equal(harness.rows().length, count, 'a follow-up resume must not discover forgotten prefix holes');
});

test('mid-range restart preserves coverage from rows that survive the overlap deletion', async () => {
  const harness = traversalHarness('ready', sections, [
    { seq_start: 0, seq_end: 1 }, { seq_start: 0, seq_end: 4 }, { seq_start: 5, seq_end: 9 },
  ]);
  const run = await harness.api.runDocumentTraversal({ documentId: 'doc', kind: 'facts', instruction: 'extract', fromSeq: 2 });
  assert.equal(run.coverage, 'complete');
  assert.equal(harness.rows().filter(row => row.seq_start === 0).length, 1, 'surviving prefix is not re-extracted');
  assert.ok(sections.every(s => harness.rows().some(row => row.seq_start <= s.seq && row.seq_end >= s.seq)));
});

for (const status of ['processing', 'failed']) {
  test(`traversal rejects ${status} documents before restart deletion or LLM work`, async () => {
    const harness = traversalHarness(status);
    await assert.rejects(harness.api.runDocumentTraversal({ documentId: 'doc', kind: 'facts', instruction: 'extract', fromSeq: 0 }), /not ready/);
    assert.equal(harness.llmCalls(), 0);
    assert.equal(harness.deleteCalls(), 0);
  });
}

test('traversal rejects an empty source even when the document is marked ready', async () => {
  const harness = traversalHarness('ready', []);
  await assert.rejects(harness.api.runDocumentTraversal({ documentId: 'doc', kind: 'facts', instruction: 'extract' }), /no extracted source sections/);
  assert.equal(harness.llmCalls(), 0);
  assert.equal(harness.deleteCalls(), 0);
});
