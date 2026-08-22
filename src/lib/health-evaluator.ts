/**
 * Capability health evaluator — AI & API Setup Redesign, Phase C
 * (plan §5 "Health states", Decision 10).
 *
 * Computes a four-state health plus a separate importance axis for each
 * capability:
 *
 *   State:      READY | DEGRADED | UNAVAILABLE | NOT_CONFIGURED
 *   Importance: REQUIRED | RECOMMENDED | OPTIONAL   (separate axis)
 *
 * Rules (plan §5 / §14.1):
 *   - Missing LLM / embeddings warns without blocking save.
 *   - Missing reranker → RAG continues (RECOMMENDED absence → DEGRADED, never
 *     UNAVAILABLE/NOT_CONFIGURED at the aggregate level).
 *   - Embeddings missing → ingestion is blocked (REQUIRED absence → aggregate
 *     UNAVAILABLE/NOT_CONFIGURED).
 *   - Optional tool absence does not degrade readiness.
 *   - Claude-without-embeddings: an Anthropic LLM remains READY for chat, but a
 *     warning is surfaced and the embeddings capability is UNAVAILABLE.
 *   - Alternate embeddings suppress the provider warning: when embeddings are
 *     available through a different provider, no "provider lacks embeddings"
 *     warning is emitted for the LLM.
 *
 * This module is pure — no database access — so it is unit-testable with
 * `node:test`.
 */

import type { CapabilityId, CapabilityImportance } from './provider-registry';

// ============================================================================
// Types
// ============================================================================

export type HealthState = 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export type { CapabilityImportance as Importance };

export interface CapabilitySnapshot {
  capabilityId: CapabilityId | string;
  importance: CapabilityImportance;
  /** A config row exists for this capability (and is enabled). */
  configured: boolean;
  /** The configured provider id (may be null when not configured). */
  providerId: string | null;
  /** A valid credential has been resolved for the configured provider. */
  credentialAvailable: boolean;
}

export interface CapabilityHealth {
  capabilityId: CapabilityId | string;
  importance: CapabilityImportance;
  state: HealthState;
  providerId: string | null;
  warnings: string[];
}

export interface HealthReport {
  capabilities: CapabilityHealth[];
  /** Aggregate readiness across REQUIRED + RECOMMENDED capabilities. */
  readiness: HealthState;
  /** Always false: missing credentials must never block saving (plan §5). */
  saveBlocking: boolean;
  /** All non-empty warnings across capabilities, in catalog order. */
  warnings: string[];
}

export interface HealthContext {
  llmProviderId: string | null;
  embeddingsProviderId: string | null;
  embeddingsCredentialAvailable: boolean;
}

// ============================================================================
// Per-capability evaluation
// ============================================================================

/**
 * Evaluate the health of a single capability snapshot.
 *
 * `context` carries the cross-capability signals needed for the
 * Claude-without-embeddings / alternate-embeddings rules. When omitted, those
 * special rules are skipped (treated as a standalone capability).
 */
export function evaluateCapabilityHealth(
  snapshot: CapabilitySnapshot,
  context: HealthContext | null = null
): CapabilityHealth {
  const { capabilityId, importance, providerId, configured, credentialAvailable } = snapshot;
  const name = capabilityDisplayName(capabilityId);

  if (!configured) {
    const state: HealthState = 'NOT_CONFIGURED';
    const warnings =
      importance === 'REQUIRED'
        ? [`${name} is not configured (required capability)`]
        : [];
    return { capabilityId, importance, state, providerId, warnings };
  }

  if (!credentialAvailable) {
    return {
      capabilityId,
      importance,
      state: 'UNAVAILABLE',
      providerId,
      warnings: [`${name} credential is missing or invalid`],
    };
  }

  // Configured and credential available → READY, with special-case warnings.
  const warnings: string[] = [];
  if (
    context &&
    capabilityId === 'llm' &&
    providerId === 'anthropic' &&
    !context.embeddingsCredentialAvailable
  ) {
    warnings.push(
      'Claude does not provide embeddings; configure an embeddings provider or ingestion will be blocked'
    );
  }

  return { capabilityId, importance, state: 'READY', providerId, warnings };
}

// ============================================================================
// Aggregate readiness
// ============================================================================

function buildContext(snapshots: CapabilitySnapshot[]): HealthContext {
  const llm = snapshots.find((s) => s.capabilityId === 'llm');
  const embeddings = snapshots.find((s) => s.capabilityId === 'embeddings');
  return {
    llmProviderId: llm?.providerId ?? null,
    embeddingsProviderId: embeddings?.providerId ?? null,
    embeddingsCredentialAvailable: embeddings?.credentialAvailable ?? false,
  };
}

/**
 * Aggregate readiness across a list of capability snapshots.
 *
 *   REQUIRED   UNAVAILABLE      → UNAVAILABLE
 *   REQUIRED   NOT_CONFIGURED   → NOT_CONFIGURED   (nothing usable is set up)
 *   RECOMMENDED missing         → DEGRADED         (system works, reduced)
 *   OPTIONAL   missing          → no effect        (stays READY)
 *   otherwise                   → READY
 *
 * OPTIONAL absence never degrades readiness; RECOMMENDED absence (e.g. missing
 * reranker) degrades but keeps the system usable (RAG continues).
 */
export function evaluateReadiness(healths: CapabilityHealth[]): HealthState {
  const required = healths.filter((h) => h.importance === 'REQUIRED');
  const recommended = healths.filter((h) => h.importance === 'RECOMMENDED');

  if (required.some((h) => h.state === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (required.some((h) => h.state === 'NOT_CONFIGURED')) return 'NOT_CONFIGURED';
  if (recommended.some((h) => h.state === 'UNAVAILABLE' || h.state === 'NOT_CONFIGURED')) {
    return 'DEGRADED';
  }
  return 'READY';
}

/**
 * Evaluate every snapshot and produce a full report. The per-capability
 * evaluation is done with the cross-capability context so the
 * Claude-without-embeddings / alternate-embeddings rules fire correctly.
 */
export function evaluateHealthReport(snapshots: CapabilitySnapshot[]): HealthReport {
  const context = buildContext(snapshots);
  const capabilities = snapshots.map((snapshot) => evaluateCapabilityHealth(snapshot, context));
  const warnings = capabilities.flatMap((c) => c.warnings);

  return {
    capabilities,
    readiness: evaluateReadiness(capabilities),
    saveBlocking: false,
    warnings,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Human-readable capability name used in warning strings. */
export function capabilityDisplayName(capabilityId: string): string {
  const known: Record<string, string> = {
    llm: 'LLM',
    embeddings: 'Embeddings',
    reranking: 'Reranking',
    'web-search': 'Web Search',
    'document-intelligence': 'Document Intelligence / OCR',
    'speech-to-text': 'Speech-to-Text',
    'text-to-speech': 'Text-to-Speech',
    'image-generation': 'Image Generation',
    'podcast-audio': 'Podcast / Audio Generation',
    'code-analysis': 'Code Analysis',
    'load-testing': 'Load Testing',
    'website-analysis': 'Website Analysis',
  };
  return known[capabilityId] ?? capabilityId;
}
