/**
 * Legacy write blocking — AI & API Setup Redesign, Phase F (plan §12.3).
 *
 * Phase F retires the fragmented legacy settings surface without deleting it.
 * The consolidated AI & API Setup page (`ai-setup`) now owns provider keys
 * (CredentialVault / `platform_provider_credentials`) and capability routing
 * (`organization_capability_config`), so the legacy write paths for those same
 * knobs must stop accepting writes while their reads keep working for rollback.
 *
 * The block is gated on the `ai-api-setup-ui-enabled` feature flag so a
 * rollback is a single flag flip: with the flag off, every legacy write path
 * works exactly as it did before Phase F.
 *
 * The pure decision functions here are unit-testable without a database
 * (`src/lib/legacy-writes.test.ts`); the async guard is used by route handlers.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import { readFeatureFlagCombinations } from '@/lib/feature-flag-combinations';

/** API error code returned when a legacy write is refused. */
export const LEGACY_WRITE_DISABLED_CODE = 'LEGACY_WRITE_DISABLED';

/** Human-readable message pointing admins at the consolidated page. */
export const LEGACY_WRITE_DISABLED_MESSAGE =
  'This legacy settings page is read-only. Configure provider keys and AI/API capabilities from the consolidated AI & API Setup page.';

/**
 * `/api/admin/settings` PUT `type` values whose settings keys are now owned by
 * the consolidated AI & API Setup page (LLM, embeddings, reranking, OCR, web
 * search). Deliberately excludes `rag` (retrieval/chunking tuning), which has
 * no consolidated replacement yet, and all non-AI admin settings.
 */
export const CONSOLIDATED_SETTINGS_TYPES = [
  'llm',
  'embedding',
  'reranker',
  'ocr',
  'tavily',
] as const;

/**
 * True when a `/api/admin/settings` PUT `type` writes a settings key that the
 * consolidated AI & API Setup page now owns.
 */
export function isConsolidatedSettingsType(type: string): boolean {
  return (CONSOLIDATED_SETTINGS_TYPES as readonly string[]).includes(type);
}

/**
 * Legacy SQLite settings keys (rows) owned by the consolidated AI & API Setup
 * page. These are the rollback data source while `org-credential-resolver-enabled`
 * is off, so Phase F must not delete them even on a "restore all defaults" reset.
 */
export const CONSOLIDATED_SETTINGS_KEYS = [
  'llm-settings',
  'embedding-settings',
  'reranker-settings',
  'ocr-settings',
  'tavily-settings',
] as const;

/**
 * True when a legacy settings *key* (e.g. the `deleteSetting()` key in the
 * `restoreAllDefaults` reset) is owned by the consolidated AI & API Setup page.
 */
export function isConsolidatedSettingsKey(key: string): boolean {
  return (CONSOLIDATED_SETTINGS_KEYS as readonly string[]).includes(key);
}

/**
 * Pure gate decision: legacy writes are blocked only while the consolidated
 * AI & API Setup UI flag is enabled.
 */
export function shouldBlockLegacyWrites(aiApiSetupUiEnabled: boolean): boolean {
  return aiApiSetupUiEnabled;
}

/**
 * Read the flag and decide whether legacy provider-key/config writes must be
 * refused right now.
 */
export async function areLegacyWritesDisabled(): Promise<boolean> {
  const db = await getDb();
  const flags = await readFeatureFlagCombinations(db);
  return shouldBlockLegacyWrites(flags.aiApiSetupUiEnabled);
}

/**
 * Convenience guard for route handlers. Returns a ready-to-return 409 response
 * when legacy writes are disabled, or `null` when the write may proceed.
 */
export async function blockLegacyWrite(): Promise<NextResponse | null> {
  if (await areLegacyWritesDisabled()) {
    return NextResponse.json(
      { error: LEGACY_WRITE_DISABLED_MESSAGE, code: LEGACY_WRITE_DISABLED_CODE },
      { status: 409 }
    );
  }
  return null;
}
