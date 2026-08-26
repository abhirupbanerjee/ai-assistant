/**
 * Pure-logic tests for logical → physical collection naming and generation
 * suffix parsing (Phase 2). No live DB or Qdrant — exercises only the pure
 * functions in collection-names.ts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  logicalNameForCategory,
  isCategoryLogicalName,
  categorySlugFromLogicalName,
  isGenerationSuffixed,
  generationOfPhysicalName,
  stripGenerationSuffix,
  isCategoryName,
  categorySlugFromName,
} from './collection-names';

test('logical name for category', () => {
  assert.equal(logicalNameForCategory('hr'), 'category:hr');
  assert.equal(logicalNameForCategory('legal-team'), 'category:legal-team');
});

test('isCategoryLogicalName', () => {
  assert.equal(isCategoryLogicalName('category:hr'), true);
  assert.equal(isCategoryLogicalName('global'), false);
  assert.equal(isCategoryLogicalName('legacy'), false);
  assert.equal(isCategoryLogicalName('category_hr'), false);
});

test('categorySlugFromLogicalName', () => {
  assert.equal(categorySlugFromLogicalName('category:hr'), 'hr');
  assert.equal(categorySlugFromLogicalName('global'), 'global');
  assert.equal(categorySlugFromLogicalName(''), '');
});

test('generation suffix detection', () => {
  assert.equal(isGenerationSuffixed('category_hr__g2'), true);
  assert.equal(isGenerationSuffixed('global_documents__g12'), true);
  assert.equal(isGenerationSuffixed('category_hr'), false);
  assert.equal(isGenerationSuffixed('global_documents'), false);
});

test('generationOfPhysicalName', () => {
  assert.equal(generationOfPhysicalName('category_hr__g2'), 2);
  assert.equal(generationOfPhysicalName('global_documents__g12'), 12);
  assert.equal(generationOfPhysicalName('category_hr'), null);
  assert.equal(generationOfPhysicalName('organizational_documents'), null);
});

test('stripGenerationSuffix', () => {
  assert.equal(stripGenerationSuffix('category_hr__g2'), 'category_hr');
  assert.equal(stripGenerationSuffix('global_documents__g2'), 'global_documents');
  assert.equal(stripGenerationSuffix('category_hr'), 'category_hr');
  assert.equal(stripGenerationSuffix('organizational_documents'), 'organizational_documents');
});

test('isCategoryName is generation-aware', () => {
  assert.equal(isCategoryName('category_hr'), true);
  assert.equal(isCategoryName('category_hr__g2'), true);
  assert.equal(isCategoryName('global_documents'), false);
  assert.equal(isCategoryName('global_documents__g2'), false);
  assert.equal(isCategoryName('organizational_documents'), false);
});

test('categorySlugFromName strips prefix and generation suffix', () => {
  assert.equal(categorySlugFromName('category_hr'), 'hr');
  assert.equal(categorySlugFromName('category_hr__g2'), 'hr');
  assert.equal(categorySlugFromName('category_legal-team__g3'), 'legal-team');
  // Non-category names still get their generation suffix stripped (the
  // `category_` prefix check then leaves the base untouched).
  assert.equal(categorySlugFromName('global_documents__g2'), 'global_documents');
});
