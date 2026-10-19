/**
 * Tests for document-traversal.ts (Phase E — coverage-tracked exhaustive
 * extraction). Only the pure parts are unit tested: buildExtractionBatches
 * (batch boundaries, overlap, char budget, oversized sections) and
 * isKnowledgeExtractEnabled (flag default-off / opt-in).
 *
 * Run: npx tsx --test src/lib/document-traversal.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractionBatches, isKnowledgeExtractEnabled } from './document-traversal';
import type { UploadSection } from './db/compat/upload-documents';

function makeSection(seq: number, text: string): UploadSection {
  return {
    id: `sec-${seq}`,
    document_id: 'doc-1',
    seq,
    page_start: seq,
    page_end: seq,
    char_start: seq * 100,
    char_end: seq * 100 + text.length,
    text,
    extract_status: 'ok',
    created_at: '2026-10-19T00:00:00Z',
  };
}

test('buildExtractionBatches returns [] for empty input', () => {
  assert.deepEqual(buildExtractionBatches([]), []);
});

test('buildExtractionBatches groups 5 sections per batch by default', () => {
  const sections = Array.from({ length: 12 }, (_, i) => makeSection(i + 1, `s${i + 1}`));
  const batches = buildExtractionBatches(sections);
  assert.equal(batches.length, 3);
  // seqStart/seqEnd cover each batch's own members (overlap sections are
  // prepended to `sections`/`text` but do not widen the reported range).
  assert.deepEqual(
    batches.map(b => [b.seqStart, b.seqEnd]),
    [[1, 5], [6, 9], [10, 12]]
  );
});

test('buildExtractionBatches sorts out-of-order input by seq', () => {
  const sections = [makeSection(3, 'c'), makeSection(1, 'a'), makeSection(2, 'b')];
  const batches = buildExtractionBatches(sections, 2, 0);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].seqStart, 1);
  assert.equal(batches[1].seqStart, 3);
});

test('buildExtractionBatches prepends overlap tail from previous batch without exceeding perBatch', () => {
  const sections = Array.from({ length: 10 }, (_, i) => makeSection(i + 1, `s${i + 1}`));
  const batches = buildExtractionBatches(sections, 5, 1);
  // Members per batch are capped so that members + overlap NEVER exceeds
  // perBatch (5): batch 2 members are seq 6-9 with overlap seq 5 (5 total),
  // and batch 3 carries the remaining seq 10 with overlap seq 9.
  assert.equal(batches.length, 3);
  assert.deepEqual(
    batches.map(b => [b.seqStart, b.seqEnd]),
    [[1, 5], [6, 9], [10, 10]]
  );
  assert.deepEqual(
    batches[1].sections.map(s => s.seq),
    [5, 6, 7, 8, 9]
  );
  assert.deepEqual(
    batches[2].sections.map(s => s.seq),
    [9, 10]
  );
  // Batch 1 has no overlap.
  assert.deepEqual(
    batches[0].sections.map(s => s.seq),
    [1, 2, 3, 4, 5]
  );
});

test('buildExtractionBatches overlap join includes the overlapping text once', () => {
  const sections = Array.from({ length: 10 }, (_, i) => makeSection(i + 1, `s${i + 1}`));
  const batches = buildExtractionBatches(sections, 5, 1);
  assert.equal(batches[1].text, 's5\n\ns6\n\ns7\n\ns8\n\ns9');
});

test('buildExtractionBatches respects the char budget', () => {
  // Each section is 1000 chars; budget 3000 fits 2 sections + '\n\n' joins (2002) but not 3 (3004).
  const sections = Array.from({ length: 6 }, (_, i) => makeSection(i + 1, 'x'.repeat(1000)));
  const batches = buildExtractionBatches(sections, 5, 0, 3000);
  assert.equal(batches.length, 3);
  for (const b of batches) {
    assert.ok(b.text.length <= 3000, `batch text ${b.text.length} exceeds budget`);
  }
  assert.deepEqual(
    batches.map(b => [b.seqStart, b.seqEnd]),
    [[1, 2], [3, 4], [5, 6]]
  );
});

test('buildExtractionBatches takes an oversized single section alone', () => {
  const big = makeSection(2, 'y'.repeat(5000));
  const sections = [makeSection(1, 'a'), big, makeSection(3, 'b')];
  const batches = buildExtractionBatches(sections, 5, 0, 3000);
  assert.equal(batches.length, 3);
  const bigBatch = batches.find(b => b.seqStart === 2);
  assert.ok(bigBatch);
  assert.equal(bigBatch.text.length, 5000);
  assert.deepEqual(batches.map(b => [b.seqStart, b.seqEnd]), [[1, 1], [2, 2], [3, 3]]);
});

test('buildExtractionBatches single small document stays in one batch', () => {
  const sections = Array.from({ length: 4 }, (_, i) => makeSection(i + 1, `s${i + 1}`));
  const batches = buildExtractionBatches(sections);
  assert.equal(batches.length, 1);
  assert.deepEqual([batches[0].seqStart, batches[0].seqEnd], [1, 4]);
});

test('isKnowledgeExtractEnabled defaults to disabled and respects the flag', () => {
  const prev = process.env.KNOWLEDGE_EXTRACT;
  try {
    delete process.env.KNOWLEDGE_EXTRACT;
    assert.equal(isKnowledgeExtractEnabled(), false);
    process.env.KNOWLEDGE_EXTRACT = 'false';
    assert.equal(isKnowledgeExtractEnabled(), false);
    process.env.KNOWLEDGE_EXTRACT = 'true';
    assert.equal(isKnowledgeExtractEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.KNOWLEDGE_EXTRACT;
    else process.env.KNOWLEDGE_EXTRACT = prev;
  }
});
