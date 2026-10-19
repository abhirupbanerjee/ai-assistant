/**
 * Phase B tests: section chunking + cursor signing/verification (pure parts).
 *
 * Run: npx tsx --test src/lib/upload-processing.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPagesIntoSections } from './upload-processing';
import {
  signUploadCursor,
  verifyUploadCursor,
  uploadCollectionName,
  sectionVectorId,
} from './upload-source';

function makePages(count: number, charsPerPage: number, fill = 'a'): { pageNumber: number; text: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    text: fill.repeat(charsPerPage),
  }));
}

test('chunkPagesIntoSections: single small page yields one section', () => {
  const sections = chunkPagesIntoSections([{ pageNumber: 1, text: 'hello world' }]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].seq, 0);
  assert.equal(sections[0].pageStart, 1);
  assert.equal(sections[0].pageEnd, 1);
  assert.equal(sections[0].charStart, 0);
  assert.equal(sections[0].charEnd, 11);
  assert.equal(sections[0].text, 'hello world');
});

test('chunkPagesIntoSections: empty page list yields no sections', () => {
  assert.deepEqual(chunkPagesIntoSections([]), []);
});

test('chunkPagesIntoSections: offsets are contiguous, gap-free and length-matched', () => {
  const pages = makePages(10, 900); // 9000 chars total, target 4000
  const sections = chunkPagesIntoSections(pages, 4000, 1000);
  assert.ok(sections.length > 1);

  let expectedStart = 0;
  // Concatenated length includes the '\n\n' join between pages.
  const total = pages.reduce((acc, p) => acc + p.text.length, 0)
    + (pages.length - 1) * 2;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    assert.equal(s.seq, i);
    assert.equal(s.charStart, expectedStart, `section ${i} start`);
    assert.equal(s.charEnd - s.charStart, s.text.length, `section ${i} length invariant`);
    expectedStart = s.charEnd;
  }
  assert.equal(expectedStart, total, 'sections cover the full text with no gaps');
});

test('chunkPagesIntoSections: snaps forward to page boundary within overshoot', () => {
  // Page is 4500 chars, target 4000, maxOvershoot 1000 → the cut absorbs the
  // remaining 500 chars of page 1 instead of splitting it.
  const pages = [{ pageNumber: 1, text: 'a'.repeat(4500) }, { pageNumber: 2, text: 'b'.repeat(100) }];
  const sections = chunkPagesIntoSections(pages, 4000, 1000);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].charEnd, 4500);
  assert.equal(sections[0].pageEnd, 1);
  assert.equal(sections[1].pageStart, 2);
});

test('chunkPagesIntoSections: snaps backward when overshoot too large', () => {
  // Page 1 is 9000 chars: nominal cut at 4000 has 5000 chars of overshoot
  // (max 1000) — the cut stays at 4000 rather than absorbing the page.
  const pages = [{ pageNumber: 1, text: 'a'.repeat(9000) }, { pageNumber: 2, text: 'b'.repeat(50) }];
  const sections = chunkPagesIntoSections(pages, 4000, 1000);
  assert.equal(sections[0].charEnd, 4000);
  assert.equal(sections[0].pageEnd, 1);
});

test('chunkPagesIntoSections: trailing blank page clamps to the last real page (defect 7)', () => {
  // The trailing blank page contributes zero chars, so the final section's
  // char range matches no page span — the range must clamp to the last real
  // page (1) instead of becoming ±Infinity and breaking NOT NULL int columns.
  const pages = [{ pageNumber: 1, text: 'x'.repeat(4000) }, { pageNumber: 2, text: '' }];
  const sections = chunkPagesIntoSections(pages, 4000, 1000);
  assert.ok(sections.length >= 1);
  for (const s of sections) {
    assert.ok(Number.isFinite(s.pageStart) && Number.isFinite(s.pageEnd), `section ${s.seq} range must be finite`);
    assert.ok(Number.isInteger(s.pageStart) && Number.isInteger(s.pageEnd), `section ${s.seq} range must be integers`);
  }
  const last = sections[sections.length - 1];
  assert.equal(last.pageStart, 1);
  assert.equal(last.pageEnd, 1);
});

test('chunkPagesIntoSections: blank page in the middle clamps to the preceding real page', () => {
  // Page 2 is blank: the section covering the joined text of pages 2–3 can
  // only carry real page numbers from surrounding text-bearing pages.
  const pages = [
    { pageNumber: 1, text: 'a'.repeat(200) },
    { pageNumber: 2, text: '' },
    { pageNumber: 3, text: 'b'.repeat(200) },
  ];
  const sections = chunkPagesIntoSections(pages, 4000, 1000);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].pageStart, 1);
  assert.equal(sections[0].pageEnd, 3);
});

test('chunkPagesIntoSections: page spans track multi-page sections', () => {
  const pages = [
    { pageNumber: 1, text: 'x'.repeat(100) },
    { pageNumber: 2, text: 'y'.repeat(100) },
  ];
  const sections = chunkPagesIntoSections(pages, 4000, 1000);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].pageStart, 1);
  assert.equal(sections[0].pageEnd, 2);
  // Pages joined with '\n\n' → 202 chars.
  assert.equal(sections[0].charEnd, 202);
});

test('signUploadCursor / verifyUploadCursor: round-trips payload', () => {
  const payload = { documentId: 'doc-1', contentHash: 'abc123', charOffset: 4200 };
  const token = signUploadCursor(payload);
  const decoded = verifyUploadCursor(token);
  assert.deepEqual(decoded, payload);
});

test('signUploadCursor / verifyUploadCursor: rejects tampered token', () => {
  const token = signUploadCursor({ documentId: 'doc-1', contentHash: 'h', charOffset: 0 });
  const tampered = token.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
  assert.equal(verifyUploadCursor(tampered), null);
  assert.equal(verifyUploadCursor('garbage'), null);
  assert.equal(verifyUploadCursor('no-dot-here'), null);
});

test('signUploadCursor / verifyUploadCursor: rejects invalid payload shapes', () => {
  const forged = Buffer.from(
    JSON.stringify({ documentId: 'doc-1', contentHash: 'h', charOffset: -5 })
  ).toString('base64url');
  // Unsigned — must fail signature check.
  assert.equal(verifyUploadCursor(forged), null);
});

test('uploadCollectionName / sectionVectorId: stable ids', () => {
  assert.equal(uploadCollectionName('thread-1'), 'uploads-thread-1');
  assert.equal(sectionVectorId('doc-9', 3), 'doc-9-chunk-3');
});
