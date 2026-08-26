/**
 * Pure-logic tests for the Vector Index Generation Manager decision helpers
 * (Phase 6). No live DB or Qdrant — exercises only the pure functions in
 * generation-manager.ts following the project's node:test pattern.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeNextGeneration,
  buildPhysicalCollectionName,
  logicalCollectionNames,
  organizationForLogicalName,
  evaluateValidationGate,
} from './generation-manager';

test('computeNextGeneration starts at 2 on first run (generation 1 is implicit)', () => {
  assert.equal(computeNextGeneration([]), 2);
});

test('computeNextGeneration returns max existing + 1', () => {
  assert.equal(computeNextGeneration([1]), 2);
  assert.equal(computeNextGeneration([1, 2]), 3);
  assert.equal(computeNextGeneration([2, 5, 3]), 6);
});

test('buildPhysicalCollectionName for global and legacy', () => {
  assert.equal(buildPhysicalCollectionName('global', 1), 'global_documents');
  assert.equal(buildPhysicalCollectionName('global', 2), 'global_documents__g2');
  assert.equal(buildPhysicalCollectionName('legacy', 3), 'organizational_documents__g3');
});

test('buildPhysicalCollectionName for category logical names', () => {
  assert.equal(buildPhysicalCollectionName('category:hr', 1), 'category_hr');
  assert.equal(buildPhysicalCollectionName('category:hr', 2), 'category_hr__g2');
  assert.equal(buildPhysicalCollectionName('category:legal-team', 4), 'category_legal-team__g4');
});

test('buildPhysicalCollectionName rejects unknown logical names', () => {
  assert.throws(() => buildPhysicalCollectionName('bogus', 2), /Unknown logical collection name/);
});

test('logicalCollectionNames includes global, legacy, and one entry per category', () => {
  assert.deepEqual(logicalCollectionNames([]), ['global', 'legacy']);
  assert.deepEqual(logicalCollectionNames(['hr', 'legal']), [
    'global',
    'legacy',
    'category:hr',
    'category:legal',
  ]);
});

test('organizationForLogicalName resolves category org with default fallback', () => {
  const orgs = new Map<string, number | null | undefined>([
    ['hr', 7],
    ['legal', null],
  ]);

  assert.equal(organizationForLogicalName('global', orgs, 1), 1);
  assert.equal(organizationForLogicalName('legacy', orgs, 1), 1);
  assert.equal(organizationForLogicalName('category:hr', orgs, 1), 7);
  // Missing / null category org falls back to the DEFAULT org.
  assert.equal(organizationForLogicalName('category:legal', orgs, 1), 1);
  assert.equal(organizationForLogicalName('category:finance', orgs, 3), 3);
});

test('organizationForLogicalName returns null when there is no default and no category org', () => {
  const orgs = new Map<string, number | null | undefined>();
  assert.equal(organizationForLogicalName('global', orgs, null), null);
  assert.equal(organizationForLogicalName('category:hr', orgs, null), null);
});

test('evaluateValidationGate passes only when every gate passes', () => {
  const pass = evaluateValidationGate({
    documentsRepresented: true,
    payloadsValid: true,
    countsMatch: true,
    dimensionsMatch: true,
    orgReadsAuthorized: true,
  });
  assert.equal(pass.pass, true);
  assert.deepEqual(pass.failures, []);
});

test('evaluateValidationGate lists each failed gate', () => {
  const result = evaluateValidationGate({
    documentsRepresented: false,
    payloadsValid: false,
    countsMatch: true,
    dimensionsMatch: false,
    orgReadsAuthorized: true,
  });
  assert.equal(result.pass, false);
  assert.equal(result.failures.length, 3);
  assert.ok(result.failures.some((f) => f.includes('not every ready document')));
  assert.ok(result.failures.some((f) => f.includes('payload contract')));
  assert.ok(result.failures.some((f) => f.includes('dimensions')));
});
