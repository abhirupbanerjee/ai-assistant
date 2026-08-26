/**
 * Versioned vector point payload contract (Phase 3).
 *
 * Defines the exact payload shape stamped onto every point written through
 * `addDocuments()` (schema version 2), plus pure helpers to build and validate
 * such payloads.
 *
 * This module is intentionally free of I/O and side effects (only type imports
 * from `@/types` and `./types`) so the contract can be unit-tested in isolation
 * following the project's node:test pure-logic pattern (see
 * `collection-names.test.ts`).
 */

import type { ChunkMetadata } from '@/types';
import type { VectorPointPayload } from './types';

/** Current payload contract schema version. */
export const VECTOR_PAYLOAD_SCHEMA_VERSION = 2 as const;

/**
 * Payload key holding the owning organization id. Single source of truth for
 * the tenancy field name; `qdrant.ts` re-exports it as `ORG_ID_PAYLOAD_KEY`.
 */
export const ORGANIZATION_ID_PAYLOAD_KEY = 'organization_id';

/**
 * Fields that are always required by the payload contract. `organization_id`
 * is conditional (required only when vector tenancy is enabled) and handled
 * separately by `validateVectorPayload`.
 */
export const REQUIRED_PAYLOAD_FIELDS = [
  'schemaVersion',
  'generation',
  'documentId',
  'documentName',
  'pageNumber',
  'chunkIndex',
  'source',
  'text',
  'originalId',
] as const;

/**
 * Build a versioned point payload from a chunk metadata record.
 *
 * The resulting payload carries the canonical document identity (`documentId`,
 * `documentName`, `pageNumber`, `chunkIndex`, `source`), the chunk `text`, the
 * `originalId` chunk id, the `schemaVersion`, and the collection `generation`.
 * `organization_id` is stamped only when a non-null id is provided.
 */
export function buildVectorPayload(input: {
  metadata: ChunkMetadata;
  text: string;
  originalId: string;
  generation: number;
  organizationId?: number | null;
}): VectorPointPayload {
  return {
    ...input.metadata,
    schemaVersion: VECTOR_PAYLOAD_SCHEMA_VERSION,
    generation: input.generation,
    text: input.text,
    originalId: input.originalId,
    ...(input.organizationId != null
      ? { [ORGANIZATION_ID_PAYLOAD_KEY]: input.organizationId }
      : {}),
  };
}

/**
 * Options for `validateVectorPayload`.
 */
export interface ValidateVectorPayloadOptions {
  /**
   * Require the `organization_id` field (vector tenancy enabled). When false
   * (default) a missing `organization_id` is accepted, matching the pre-tenancy
   * stamping behavior.
   */
  requireOrganizationId?: boolean;
}

/**
 * Result of validating a candidate payload against the contract.
 */
export interface VectorPayloadValidationResult {
  /** True when no required field is missing and no value is invalid. */
  valid: boolean;
  /** Required fields that are missing (or null). */
  missing: string[];
  /** Fields present but carrying an invalid value (wrong type/version). */
  errors: string[];
}

/**
 * Validate a candidate payload is complete per the versioned contract.
 *
 * Rejects payloads missing `schemaVersion`, `generation`, `documentId`,
 * `documentName`, `pageNumber`, `chunkIndex`, `source`, `text`, or
 * `originalId`, and rejects a missing `organization_id` when
 * `requireOrganizationId` is set. Also flags a `schemaVersion` other than the
 * current contract version and non-numeric `generation`/`chunkIndex`.
 *
 * Returns a result object rather than throwing so callers can aggregate
 * validation failures across many points.
 */
export function validateVectorPayload(
  payload: Record<string, unknown>,
  options: ValidateVectorPayloadOptions = {}
): VectorPayloadValidationResult {
  const missing: string[] = [];
  const errors: string[] = [];

  for (const field of REQUIRED_PAYLOAD_FIELDS) {
    const value = payload[field];
    if (value === undefined || value === null) {
      missing.push(field);
    }
  }

  if (options.requireOrganizationId) {
    const orgId = payload[ORGANIZATION_ID_PAYLOAD_KEY];
    if (orgId === undefined || orgId === null) {
      missing.push(ORGANIZATION_ID_PAYLOAD_KEY);
    } else if (typeof orgId !== 'number') {
      errors.push(`${ORGANIZATION_ID_PAYLOAD_KEY} must be a number`);
    }
  }

  if (
    payload.schemaVersion !== undefined &&
    payload.schemaVersion !== VECTOR_PAYLOAD_SCHEMA_VERSION
  ) {
    errors.push(
      `schemaVersion must be ${VECTOR_PAYLOAD_SCHEMA_VERSION}, got ${String(payload.schemaVersion)}`
    );
  }

  if (payload.generation !== undefined && typeof payload.generation !== 'number') {
    errors.push('generation must be a number');
  }

  if (payload.documentId !== undefined && typeof payload.documentId !== 'string') {
    errors.push('documentId must be a string');
  }

  if (payload.chunkIndex !== undefined && typeof payload.chunkIndex !== 'number') {
    errors.push('chunkIndex must be a number');
  }

  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors,
  };
}
