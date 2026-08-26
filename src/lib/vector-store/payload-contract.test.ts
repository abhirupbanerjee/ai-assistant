/**
 * Pure-logic tests for the versioned vector payload contract (Phase 3).
 * No live DB or Qdrant — exercises only the pure functions in
 * payload-contract.ts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChunkMetadata } from '@/types';
import {
  VECTOR_PAYLOAD_SCHEMA_VERSION,
  ORGANIZATION_ID_PAYLOAD_KEY,
  buildVectorPayload,
  validateVectorPayload,
} from './payload-contract';

const baseMetadata: ChunkMetadata = {
  documentId: '42',
  documentName: 'Q3_Report.pdf',
  pageNumber: 1,
  chunkIndex: 0,
  source: 'global',
};

test('buildVectorPayload stamps schemaVersion 2, generation, and canonical documentId', () => {
  const payload = buildVectorPayload({
    metadata: baseMetadata,
    text: 'Quarterly revenue grew 12%.',
    originalId: '42-chunk-0',
    generation: 3,
    organizationId: null,
  });

  assert.equal(payload.schemaVersion, VECTOR_PAYLOAD_SCHEMA_VERSION);
  assert.equal(payload.generation, 3);
  assert.equal(payload.documentId, '42');
  assert.equal(payload.documentName, 'Q3_Report.pdf');
  assert.equal(payload.originalId, '42-chunk-0');
  assert.equal(payload.text, 'Quarterly revenue grew 12%.');
  assert.equal(payload.source, 'global');
  assert.equal(ORGANIZATION_ID_PAYLOAD_KEY in payload, false);
});

test('buildVectorPayload stamps organization_id only when provided', () => {
  const withOrg = buildVectorPayload({
    metadata: baseMetadata,
    text: 'hello',
    originalId: '42-chunk-0',
    generation: 1,
    organizationId: 7,
  });
  assert.equal(withOrg[ORGANIZATION_ID_PAYLOAD_KEY], 7);

  const withoutOrg = buildVectorPayload({
    metadata: baseMetadata,
    text: 'hello',
    originalId: '42-chunk-0',
    generation: 1,
    organizationId: null,
  });
  assert.equal(ORGANIZATION_ID_PAYLOAD_KEY in withoutOrg, false);
});

test('validateVectorPayload accepts a complete payload with org id when required', () => {
  const payload = buildVectorPayload({
    metadata: baseMetadata,
    text: 'hello',
    originalId: '42-chunk-0',
    generation: 2,
    organizationId: 9,
  });

  const result = validateVectorPayload(payload, { requireOrganizationId: true });
  assert.equal(result.valid, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.errors, []);
});

test('validateVectorPayload rejects missing documentId, schemaVersion, and chunkIndex', () => {
  const result = validateVectorPayload({}, {});

  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('documentId'));
  assert.ok(result.missing.includes('schemaVersion'));
  assert.ok(result.missing.includes('chunkIndex'));
});

test('validateVectorPayload requires organization_id only when requested', () => {
  const payload = buildVectorPayload({
    metadata: baseMetadata,
    text: 'hello',
    originalId: '42-chunk-0',
    generation: 1,
    organizationId: null,
  });

  // Tenancy disabled: missing organization_id is acceptable.
  assert.equal(validateVectorPayload(payload, {}).valid, true);

  // Tenancy enabled: missing organization_id is a contract violation.
  const strict = validateVectorPayload(payload, { requireOrganizationId: true });
  assert.equal(strict.valid, false);
  assert.ok(strict.missing.includes(ORGANIZATION_ID_PAYLOAD_KEY));
});

test('validateVectorPayload flags a schemaVersion other than the current version', () => {
  const payload = buildVectorPayload({
    metadata: baseMetadata,
    text: 'hello',
    originalId: '42-chunk-0',
    generation: 1,
    organizationId: null,
  });

  const result = validateVectorPayload({ ...payload, schemaVersion: 1 }, {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('schemaVersion')));
});

test('validateVectorPayload flags non-numeric generation and chunkIndex', () => {
  const payload = buildVectorPayload({
    metadata: baseMetadata,
    text: 'hello',
    originalId: '42-chunk-0',
    generation: 1,
    organizationId: null,
  });

  const result = validateVectorPayload(
    { ...payload, generation: 'two', chunkIndex: 'zero' },
    {}
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('generation')));
  assert.ok(result.errors.some((e) => e.includes('chunkIndex')));
});
