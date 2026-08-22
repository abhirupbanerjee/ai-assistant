/**
 * Organization tenancy backfill logic — AI & API Setup Redesign, Phase B.
 *
 * Pure, database-free functions that compute the target rows for the Default
 * organization backfill. The database execution lives in
 * `scripts/backfill-org-tenancy.ts`, which calls these functions and applies the
 * results idempotently. Keeping the logic pure makes the migration invariants
 * testable with `node:test` (no live PostgreSQL required), matching the
 * existing repository test convention.
 *
 * Backfill scope (plan §12.3):
 *   1. Create the DEFAULT org (`type=DEFAULT`, `is_default=true`,
 *      `credential_mode=PLATFORM_MANAGED`) exactly once.
 *   2. Assign every active non-super_admin user a `member` membership in the
 *      Default org. `super_admin` is an implicit admin of every org and gets no
 *      membership row (plan §4). Existing global `users.role` values are never
 *      modified.
 *   3. Assign every assignable workspace to the Default org; report orphaned
 *      (unassignable) workspaces before applying any `NOT NULL` constraint.
 *   4. Map legacy `llm_providers` keys into `platform_provider_credentials`
 *      (reference rows only — no secret duplication).
 *   5. Map existing LLM / embeddings / reranker / web-search / speech / OCR
 *      settings into Default `organization_capability_config` rows.
 *   6. Backfill `token_usage_log.organization_id` → Default.
 */

import type { Insertable } from 'kysely';
import type { DB } from './db/db-types';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_ORG_NAME = 'Default Organization';

/** Tables the backfill writes to. Anything else (categories, documents, …) is out of scope. */
export const BACKFILL_TARGETS = [
  'organizations',
  'organization_memberships',
  'workspaces',
  'platform_provider_credentials',
  'organization_capability_config',
  'token_usage_log',
] as const;

/**
 * Reference provider rows seeded during backfill. These are required so the FK
 * constraints on `platform_provider_credentials` / `organization_capability_config`
 * can be satisfied before the full server-side registry lands (Phase C). The
 * first ten mirror `DEFAULT_PROVIDERS`; the last four are capability-only
 * providers referenced by existing settings (web search, reranking, OCR).
 */
export const REFERENCE_PROVIDERS: Array<{ id: string; name: string; sortOrder: number }> = [
  { id: 'openai', name: 'OpenAI', sortOrder: 10 },
  { id: 'gemini', name: 'Google Gemini', sortOrder: 20 },
  { id: 'mistral', name: 'Mistral AI', sortOrder: 30 },
  { id: 'ollama', name: 'Ollama (Local)', sortOrder: 40 },
  { id: 'anthropic', name: 'Anthropic (Claude)', sortOrder: 50 },
  { id: 'deepseek', name: 'DeepSeek', sortOrder: 60 },
  { id: 'fireworks', name: 'Fireworks AI', sortOrder: 70 },
  { id: 'ollama-cloud', name: 'Ollama Cloud', sortOrder: 80 },
  { id: 'moonshot', name: 'Moonshot AI', sortOrder: 90 },
  { id: 'azure-foundry', name: 'Azure AI Foundry', sortOrder: 100 },
  // Capability-only providers referenced by existing settings.
  { id: 'tavily', name: 'Tavily (Web Search)', sortOrder: 110 },
  { id: 'cohere', name: 'Cohere (Reranking)', sortOrder: 120 },
  { id: 'bge', name: 'BGE (Local Reranking)', sortOrder: 130 },
  { id: 'azure-di', name: 'Azure Document Intelligence', sortOrder: 140 },
];

/**
 * Core capability catalog mapped during backfill. Optional developer-tool
 * capabilities (image generation, code analysis, …) have no legacy config
 * source and are left for the full registry seed in later phases.
 */
export const REFERENCE_CAPABILITIES: Array<{
  id: string;
  name: string;
  importance: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  sortOrder: number;
}> = [
  { id: 'llm', name: 'LLM', importance: 'REQUIRED', sortOrder: 10 },
  { id: 'embeddings', name: 'Embeddings', importance: 'REQUIRED', sortOrder: 20 },
  { id: 'reranking', name: 'Reranking', importance: 'RECOMMENDED', sortOrder: 30 },
  { id: 'web-search', name: 'Web Search', importance: 'RECOMMENDED', sortOrder: 40 },
  { id: 'document-intelligence', name: 'Document Intelligence / OCR', importance: 'RECOMMENDED', sortOrder: 50 },
  { id: 'speech-to-text', name: 'Speech-to-Text', importance: 'RECOMMENDED', sortOrder: 60 },
  { id: 'text-to-speech', name: 'Text-to-Speech', importance: 'RECOMMENDED', sortOrder: 70 },
];

// Legacy provider → environment variable mapping (mirrors llm-providers.ts;
// duplicated here to keep this module free of DB-import side effects).
export const PROVIDER_ENV_KEY_MAP: Record<string, { apiKey?: string; apiBase?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY' },
  gemini: { apiKey: 'GEMINI_API_KEY' },
  mistral: { apiKey: 'MISTRAL_API_KEY' },
  ollama: { apiBase: 'OLLAMA_API_BASE' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY' },
  fireworks: { apiKey: 'FIREWORKS_AI_API_KEY' },
  'ollama-cloud': { apiKey: 'OLLAMA_API_KEY' },
  moonshot: { apiKey: 'MOONSHOT_API_KEY', apiBase: 'MOONSHOT_API_BASE' },
  'azure-foundry': { apiKey: 'AZURE_FOUNDRY_API_KEY', apiBase: 'AZURE_FOUNDRY_ENDPOINT' },
};

// ============================================================================
// Types
// ============================================================================

export type UserRole = 'super_admin' | 'admin' | 'superuser' | 'user';

/** Minimal user row needed by the membership backfill. */
export interface BackfillUser {
  id: number;
  role: string;
  /** Global roles are preserved: this module never writes users. */
}

/** Minimal legacy provider row (from `llm_providers`). */
export interface LegacyProviderRow {
  id: string;
  apiKey: string | null; // encrypted or (dev) plaintext — never copied as-is
  apiBase: string | null;
}

/** Minimal workspace row needed by the workspace backfill. */
export interface BackfillWorkspace {
  id: string;
  type: string;
  createdBy: string | null;
  organizationId: number | null;
}

export interface OrphanReport {
  workspaceId: string;
  reason: string;
}

export interface MembershipRow {
  organizationId: number;
  userId: number;
  role: 'member';
}

export interface PlatformCredentialRow {
  providerId: string;
  secretRef: string;
  kekVersion: number;
  status: 'active';
  lastVerifiedAt: null;
}

export interface CapabilityConfigRow {
  capabilityId: string;
  providerId: string;
  modelOrServiceId: string | null;
  enabled: boolean;
  configuration: Record<string, unknown>;
}

export interface CapabilityConfigInput {
  llm?: { model: string };
  embeddings?: { model: string };
  reranker?: { enabled: boolean; providers: Array<{ provider: string; enabled: boolean }> };
  tavily?: { enabled: boolean };
  speech?: { stt: { default: string }; tts: { primaryProvider: string } };
  ocr?: { providers: Array<{ provider: string; enabled: boolean }> };
}

// ============================================================================
// Default org
// ============================================================================

export function buildDefaultOrgRow(): Insertable<DB['organizations']> {
  return {
    name: DEFAULT_ORG_NAME,
    type: 'DEFAULT',
    is_default: true,
    credential_mode: 'PLATFORM_MANAGED',
    status: 'active',
    isolation_mode: 'SOFT',
  };
}

/**
 * True when the Default org must be created (no existing `DEFAULT` org with
 * `is_default = true`). Idempotency: returning false the second time guarantees
 * the Default is created exactly once.
 */
export function isDefaultOrgMissing(organizations: Array<{ type: string; isDefault: boolean }>): boolean {
  return !organizations.some((org) => org.type === 'DEFAULT' && org.isDefault === true);
}

// ============================================================================
// Memberships (plan §4 role mapping)
// ============================================================================

/**
 * Map a global user role to its Default-org membership role.
 *
 *   super_admin → null (implicit admin of every org, no membership row)
 *   admin       → 'member' (assignable as org_admin later)
 *   superuser   → 'member'
 *   user        → 'member'
 *
 * Existing global roles are never modified.
 */
export function mapGlobalRoleToMembership(role: string): 'member' | null {
  if (role === 'super_admin') return null;
  return 'member';
}

/**
 * Compute membership rows for the Default org. Idempotent: the same input always
 * produces the same rows (no duplicates), and super_admin users are skipped.
 */
export function buildMembershipRows(
  users: BackfillUser[],
  defaultOrgId: number
): MembershipRow[] {
  const rows: MembershipRow[] = [];
  for (const user of users) {
    const role = mapGlobalRoleToMembership(user.role);
    if (role === null) continue; // super_admin → implicit admin
    rows.push({ organizationId: defaultOrgId, userId: user.id, role });
  }
  return rows;
}

// ============================================================================
// Workspaces (orphan diagnostic + assignment)
// ============================================================================

/**
 * A workspace is assignable to the Default org when it has a creator reference
 * and a known type. Workspaces with no creator (e.g. seeded/system rows with an
 * empty `created_by`) cannot be traced to a user and are reported as orphaned
 * rather than silently assigned.
 */
export function isAssignableWorkspace(workspace: BackfillWorkspace): boolean {
  if (workspace.type !== 'embed' && workspace.type !== 'standalone') return false;
  return typeof workspace.createdBy === 'string' && workspace.createdBy.trim() !== '';
}

/**
 * Diagnostic (plan §12.3 / §17): report workspaces with a null organization that
 * cannot be assigned to the Default org. Run this BEFORE backfill/NOT NULL.
 */
export function detectOrphanWorkspaces(workspaces: BackfillWorkspace[]): OrphanReport[] {
  const reports: OrphanReport[] = [];
  for (const ws of workspaces) {
    if (ws.organizationId !== null) continue; // already assigned
    if (isAssignableWorkspace(ws)) continue;
    const reason =
      ws.type !== 'embed' && ws.type !== 'standalone'
        ? `unknown workspace type '${ws.type}'`
        : 'missing creator reference (created_by is empty)';
    reports.push({ workspaceId: ws.id, reason });
  }
  return reports;
}

export interface WorkspaceBackfillResult {
  /** Assignable workspace ids → Default org id. */
  assignments: Array<{ id: string; organizationId: number }>;
  /** Orphaned workspaces left unassigned, for manual review. */
  orphans: OrphanReport[];
}

/**
 * Assign every assignable workspace with a null organization to the Default org.
 * Orphaned workspaces are reported and left untouched. Idempotent: workspaces
 * that already have an organization are ignored, so a second run yields an empty
 * assignment set.
 */
export function buildWorkspaceAssignments(
  workspaces: BackfillWorkspace[],
  defaultOrgId: number
): WorkspaceBackfillResult {
  const assignments: Array<{ id: string; organizationId: number }> = [];
  const orphans: OrphanReport[] = [];

  for (const ws of workspaces) {
    if (ws.organizationId !== null) continue; // already assigned → idempotent no-op
    if (!isAssignableWorkspace(ws)) {
      orphans.push(
        detectOrphanWorkspaces([ws])[0] ?? {
          workspaceId: ws.id,
          reason: 'unassignable workspace',
        }
      );
      continue;
    }
    assignments.push({ id: ws.id, organizationId: defaultOrgId });
  }

  return { assignments, orphans };
}

// ============================================================================
// Token usage backfill
// ============================================================================

export interface TokenUsageBackfillRow {
  id: number;
  organizationId: number | null;
}

/**
 * Compute token_usage_log rows to backfill. Idempotent: rows that already carry
 * an organization are ignored, so a second run produces an empty update set and
 * zero nulls remain.
 */
export function buildTokenUsageAssignments(
  rows: TokenUsageBackfillRow[],
  defaultOrgId: number
): Array<{ id: number; organizationId: number }> {
  return rows
    .filter((row) => row.organizationId === null)
    .map((row) => ({ id: row.id, organizationId: defaultOrgId }));
}

// ============================================================================
// Platform credentials (legacy keys → references)
// ============================================================================

/**
 * Map legacy `llm_providers` rows to `platform_provider_credentials` rows.
 *
 * `secret_ref` is a *reference* to where the secret actually lives — never the
 * secret itself. DB-stored keys point at the legacy row
 * (`llm_providers:<id>`), env-sourced keys point at the env var
 * (`env:<VAR>`). Legacy rows are never deleted and keys are never duplicated
 * into the new table in plaintext or ciphertext form.
 */
export function buildPlatformCredentialRows(
  providers: LegacyProviderRow[],
  env: Record<string, string | undefined>
): PlatformCredentialRow[] {
  const rows: PlatformCredentialRow[] = [];

  for (const provider of providers) {
    const envConfig = PROVIDER_ENV_KEY_MAP[provider.id];

    if (provider.apiKey) {
      rows.push({
        providerId: provider.id,
        secretRef: `llm_providers:${provider.id}`,
        kekVersion: 1,
        status: 'active',
        lastVerifiedAt: null,
      });
      continue;
    }

    // Ollama is base-URL based.
    if (provider.id === 'ollama') {
      if (provider.apiBase) {
        rows.push({
          providerId: provider.id,
          secretRef: `llm_providers:ollama`,
          kekVersion: 1,
          status: 'active',
          lastVerifiedAt: null,
        });
      } else if (envConfig?.apiBase && env[envConfig.apiBase]) {
        rows.push({
          providerId: provider.id,
          secretRef: `env:${envConfig.apiBase}`,
          kekVersion: 1,
          status: 'active',
          lastVerifiedAt: null,
        });
      }
      continue;
    }

    if (envConfig?.apiKey && env[envConfig.apiKey]) {
      rows.push({
        providerId: provider.id,
        secretRef: `env:${envConfig.apiKey}`,
        kekVersion: 1,
        status: 'active',
        lastVerifiedAt: null,
      });
    }
  }

  return rows;
}

// ============================================================================
// Capability config (settings → Default capability config)
// ============================================================================

/** Best-effort inference of a provider id from a model id. */
export function inferProviderFromModel(modelId: string): string | null {
  const m = modelId.toLowerCase();
  if (m.startsWith('openai/') || m.startsWith('gpt-') || /^o[134]/.test(m) ||
    m.startsWith('text-embedding') || m.startsWith('whisper') || m.startsWith('tts')) {
    return 'openai';
  }
  if (m.startsWith('gemini-')) return 'gemini';
  if (m.startsWith('claude-') || m.startsWith('anthropic/')) return 'anthropic';
  if (m.startsWith('mistral-')) return 'mistral';
  if (m.startsWith('fireworks/')) return 'fireworks';
  if (m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('moonshot/') || m.startsWith('kimi-k')) return 'moonshot';
  if (m.startsWith('ollama') || m.startsWith('llama') || m.startsWith('qwen') ||
    m.startsWith('mxbai') || m.startsWith('gpt-oss') || m.startsWith('deepseek-r1')) {
    return 'ollama';
  }
  return null;
}

function mapRerankerProvider(provider: string): string {
  if (provider === 'cohere') return 'cohere';
  if (provider === 'fireworks') return 'fireworks';
  // bge-large, bge-base, local (bi-encoder) → local BGE cross-encoder service
  return 'bge';
}

function mapOcrProvider(provider: string): string | null {
  if (provider === 'mistral') return 'mistral';
  if (provider === 'azure-di') return 'azure-di';
  return null; // pdf-parse is local parsing, no provider credential
}

/**
 * Translate existing settings into Default `organization_capability_config`
 * rows. Pure and idempotent; the settings objects passed in are treated as
 * read-only (never mutated).
 */
export function buildCapabilityConfigRows(input: CapabilityConfigInput): CapabilityConfigRow[] {
  const rows: CapabilityConfigRow[] = [];

  if (input.llm?.model) {
    const provider = inferProviderFromModel(input.llm.model);
    if (provider) {
      rows.push({
        capabilityId: 'llm',
        providerId: provider,
        modelOrServiceId: input.llm.model,
        enabled: true,
        configuration: { ...input.llm },
      });
    }
  }

  if (input.embeddings?.model) {
    const provider = inferProviderFromModel(input.embeddings.model) ?? 'openai';
    rows.push({
      capabilityId: 'embeddings',
      providerId: provider,
      modelOrServiceId: input.embeddings.model,
      enabled: true,
      configuration: { ...input.embeddings },
    });
  }

  if (input.reranker) {
    const primary = input.reranker.providers.find((p) => p.enabled);
    if (primary) {
      rows.push({
        capabilityId: 'reranking',
        providerId: mapRerankerProvider(primary.provider),
        modelOrServiceId: primary.provider,
        enabled: input.reranker.enabled,
        configuration: { provider: primary.provider },
      });
    }
  }

  if (input.tavily) {
    rows.push({
      capabilityId: 'web-search',
      providerId: 'tavily',
      modelOrServiceId: null,
      enabled: input.tavily.enabled,
      configuration: { ...input.tavily },
    });
  }

  if (input.speech) {
    rows.push({
      capabilityId: 'speech-to-text',
      providerId: input.speech.stt.default,
      modelOrServiceId: null,
      enabled: true,
      configuration: { sttDefault: input.speech.stt.default },
    });
    rows.push({
      capabilityId: 'text-to-speech',
      providerId: input.speech.tts.primaryProvider,
      modelOrServiceId: null,
      enabled: true,
      configuration: { ttsPrimary: input.speech.tts.primaryProvider },
    });
  }

  if (input.ocr) {
    const primary = input.ocr.providers.find((p) => p.enabled && mapOcrProvider(p.provider));
    if (primary) {
      rows.push({
        capabilityId: 'document-intelligence',
        providerId: mapOcrProvider(primary.provider)!,
        modelOrServiceId: primary.provider,
        enabled: true,
        configuration: { provider: primary.provider },
      });
    }
  }

  return rows;
}

// ============================================================================
// Reference row builders (for the registry FK references)
// ============================================================================

export function buildProviderReferenceRows(): Array<Insertable<DB['providers']>> {
  return REFERENCE_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    enabled: true,
    sort_order: p.sortOrder,
  }));
}

export function buildCapabilityReferenceRows(): Array<Insertable<DB['capabilities']>> {
  return REFERENCE_CAPABILITIES.map((c) => ({
    id: c.id,
    name: c.name,
    importance: c.importance,
    sort_order: c.sortOrder,
  }));
}
