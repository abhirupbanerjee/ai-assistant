/**
 * Pure-logic tests for generation dual-write target selection (Phase 4).
 * No live DB or Qdrant — exercises only the pure functions in dual-write.ts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldMirrorToLogicalName,
  candidateTargetsForDocument,
  type CandidateTarget,
  type DocumentCollectionShape,
} from './dual-write';
import {
  LOGICAL_GLOBAL,
  LOGICAL_LEGACY,
  logicalNameForCategory,
} from './collection-names';

const globalShape: DocumentCollectionShape = { isGlobal: true, categorySlugs: [] };
const categorizedShape: DocumentCollectionShape = {
  isGlobal: false,
  categorySlugs: ['hr', 'finance'],
};
const legacyShape: DocumentCollectionShape = { isGlobal: false, categorySlugs: [] };

test('shouldMirrorToLogicalName maps a global document to global and all categories', () => {
  assert.equal(shouldMirrorToLogicalName(LOGICAL_GLOBAL, globalShape), true);
  assert.equal(shouldMirrorToLogicalName(LOGICAL_LEGACY, globalShape), false);
  // A global document belongs to every category logical name.
  assert.equal(shouldMirrorToLogicalName(logicalNameForCategory('hr'), globalShape), true);
  assert.equal(shouldMirrorToLogicalName(logicalNameForCategory('finance'), globalShape), true);
});

test('shouldMirrorToLogicalName maps a categorized document to its own categories only', () => {
  assert.equal(shouldMirrorToLogicalName(LOGICAL_GLOBAL, categorizedShape), false);
  assert.equal(shouldMirrorToLogicalName(LOGICAL_LEGACY, categorizedShape), false);
  assert.equal(shouldMirrorToLogicalName(logicalNameForCategory('hr'), categorizedShape), true);
  assert.equal(shouldMirrorToLogicalName(logicalNameForCategory('finance'), categorizedShape), true);
  assert.equal(shouldMirrorToLogicalName(logicalNameForCategory('engineering'), categorizedShape), false);
});

test('shouldMirrorToLogicalName maps an uncategorized document to legacy only', () => {
  assert.equal(shouldMirrorToLogicalName(LOGICAL_GLOBAL, legacyShape), false);
  assert.equal(shouldMirrorToLogicalName(LOGICAL_LEGACY, legacyShape), true);
  assert.equal(shouldMirrorToLogicalName(logicalNameForCategory('hr'), legacyShape), false);
});

test('shouldMirrorToLogicalName ignores unknown logical names', () => {
  assert.equal(shouldMirrorToLogicalName('something-else', globalShape), false);
  assert.equal(shouldMirrorToLogicalName('something-else', categorizedShape), false);
  assert.equal(shouldMirrorToLogicalName('something-else', legacyShape), false);
});

test('candidateTargetsForDocument selects matching candidates and preserves generation', () => {
  const mappings: Record<string, CandidateTarget> = {
    [LOGICAL_GLOBAL]: { physicalName: 'global_documents__g2', generation: 2 },
    [LOGICAL_LEGACY]: { physicalName: 'organizational_documents__g2', generation: 2 },
    [logicalNameForCategory('hr')]: { physicalName: 'category_hr__g2', generation: 2 },
    [logicalNameForCategory('engineering')]: { physicalName: 'category_engineering__g2', generation: 3 },
  };

  const targets = candidateTargetsForDocument(mappings, categorizedShape);
  assert.deepEqual(targets, [{ physicalName: 'category_hr__g2', generation: 2 }]);
});

test('candidateTargetsForDocument deduplicates by physical name', () => {
  const mappings: Record<string, CandidateTarget> = {
    // Two logical names pointing at the same physical collection must not
    // produce a double write.
    [LOGICAL_GLOBAL]: { physicalName: 'global_documents__g2', generation: 2 },
    [logicalNameForCategory('hr')]: { physicalName: 'global_documents__g2', generation: 2 },
  };

  const targets = candidateTargetsForDocument(mappings, globalShape);
  assert.deepEqual(targets, [{ physicalName: 'global_documents__g2', generation: 2 }]);
});

test('candidateTargetsForDocument returns no targets when nothing matches', () => {
  const mappings: Record<string, CandidateTarget> = {
    [logicalNameForCategory('engineering')]: { physicalName: 'category_engineering__g2', generation: 2 },
  };

  assert.deepEqual(candidateTargetsForDocument(mappings, categorizedShape), []);
  assert.deepEqual(candidateTargetsForDocument({}, globalShape), []);
});

test('candidateTargetsForDocument returns all category candidates plus global for a global doc', () => {
  const mappings: Record<string, CandidateTarget> = {
    [LOGICAL_GLOBAL]: { physicalName: 'global_documents__g2', generation: 2 },
    [logicalNameForCategory('hr')]: { physicalName: 'category_hr__g2', generation: 2 },
    [logicalNameForCategory('finance')]: { physicalName: 'category_finance__g2', generation: 2 },
  };

  const targets = candidateTargetsForDocument(mappings, globalShape);
  assert.deepEqual(targets, [
    { physicalName: 'global_documents__g2', generation: 2 },
    { physicalName: 'category_hr__g2', generation: 2 },
    { physicalName: 'category_finance__g2', generation: 2 },
  ]);
});
