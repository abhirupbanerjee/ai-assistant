import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKFILL_TARGETS,
  buildCapabilityConfigRows,
  buildCapabilityReferenceRows,
  buildDefaultOrgRow,
  buildMembershipRows,
  buildPlatformCredentialRows,
  buildProviderReferenceRows,
  buildTokenUsageAssignments,
  buildWorkspaceAssignments,
  detectOrphanWorkspaces,
  inferProviderFromModel,
  isAssignableWorkspace,
  isDefaultOrgMissing,
  mapGlobalRoleToMembership,
  type BackfillUser,
  type BackfillWorkspace,
  type LegacyProviderRow,
} from './organization-backfill';

const DEFAULT_ORG_ID = 1;

// ============================================================================
// Migration idempotency
// ============================================================================

test('idempotency: membership backfill produces identical rows on a second run', () => {
  const users: BackfillUser[] = [
    { id: 1, role: 'super_admin' },
    { id: 2, role: 'admin' },
    { id: 3, role: 'superuser' },
    { id: 4, role: 'user' },
  ];

  const first = buildMembershipRows(users, DEFAULT_ORG_ID);
  const second = buildMembershipRows(users, DEFAULT_ORG_ID);

  assert.deepEqual(second, first);
  // No duplicates: each user appears at most once.
  const ids = first.map((r) => r.userId);
  assert.equal(new Set(ids).size, ids.length);
});

test('idempotency: workspace backfill is a no-op when organization_id is already set', () => {
  const workspaces: BackfillWorkspace[] = [
    { id: 'ws-1', type: 'standalone', createdBy: 'alice@example.com', organizationId: null },
    { id: 'ws-2', type: 'embed', createdBy: 'bob@example.com', organizationId: DEFAULT_ORG_ID },
  ];

  const first = buildWorkspaceAssignments(workspaces, DEFAULT_ORG_ID);
  assert.equal(first.assignments.length, 1);

  // Simulate the DB state after the first run.
  const afterRun = workspaces.map((ws) =>
    ws.id === 'ws-1' ? { ...ws, organizationId: DEFAULT_ORG_ID } : ws
  );
  const second = buildWorkspaceAssignments(afterRun, DEFAULT_ORG_ID);
  assert.equal(second.assignments.length, 0); // idempotent: nothing left to assign
  assert.equal(second.orphans.length, 0);
});

test('idempotency: token usage backfill leaves zero nulls after one run', () => {
  const rows = [
    { id: 1, organizationId: null },
    { id: 2, organizationId: null },
    { id: 3, organizationId: DEFAULT_ORG_ID },
  ];

  const first = buildTokenUsageAssignments(rows, DEFAULT_ORG_ID);
  assert.equal(first.length, 2);

  const afterRun = rows.map((r) => ({ ...r, organizationId: r.organizationId ?? DEFAULT_ORG_ID }));
  const second = buildTokenUsageAssignments(afterRun, DEFAULT_ORG_ID);
  assert.equal(second.length, 0); // zero nulls remain
});

test('idempotency: platform credential + capability config mapping is deterministic', () => {
  const providers: LegacyProviderRow[] = [
    { id: 'openai', apiKey: 'encrypted:key', apiBase: null },
    { id: 'gemini', apiKey: null, apiBase: null },
  ];
  const env = { OPENAI_API_KEY: 'sk-env', GEMINI_API_KEY: undefined };
  const creds1 = buildPlatformCredentialRows(providers, env);
  const creds2 = buildPlatformCredentialRows(providers, env);
  assert.deepEqual(creds2, creds1);

  const input = { llm: { model: 'gpt-4o' }, embeddings: { model: 'text-embedding-3-large' } };
  assert.deepEqual(buildCapabilityConfigRows(input), buildCapabilityConfigRows(input));
});

// ============================================================================
// Default created once
// ============================================================================

test('Default created once: buildDefaultOrgRow is DEFAULT + PLATFORM_MANAGED', () => {
  const row = buildDefaultOrgRow();
  assert.equal(row.type, 'DEFAULT');
  assert.equal(row.is_default, true);
  assert.equal(row.credential_mode, 'PLATFORM_MANAGED');
});

test('Default created once: isDefaultOrgMissing detects exactly one candidate', () => {
  assert.equal(isDefaultOrgMissing([]), true);
  assert.equal(
    isDefaultOrgMissing([{ type: 'ENTITY', isDefault: false }]),
    true
  );
  assert.equal(
    isDefaultOrgMissing([{ type: 'DEFAULT', isDefault: true }]),
    false
  );
  // Duplicate DEFAULT rows would be caught by the DB partial unique index;
  // the pure check only guards "must create vs already exists".
  assert.equal(
    isDefaultOrgMissing([
      { type: 'DEFAULT', isDefault: true },
      { type: 'DEFAULT', isDefault: false },
    ]),
    false
  );
});

// ============================================================================
// Every active user assigned
// ============================================================================

test('every active non-super_admin user gets a member membership row', () => {
  const users: BackfillUser[] = [
    { id: 1, role: 'super_admin' },
    { id: 2, role: 'admin' },
    { id: 3, role: 'superuser' },
    { id: 4, role: 'user' },
  ];

  const rows = buildMembershipRows(users, DEFAULT_ORG_ID);

  assert.equal(rows.length, 3); // super_admin excluded
  assert.deepEqual(
    rows.map((r) => r.userId).sort((a, b) => a - b),
    [2, 3, 4]
  );
  for (const row of rows) {
    assert.equal(row.role, 'member');
    assert.equal(row.organizationId, DEFAULT_ORG_ID);
  }
});

// ============================================================================
// Roles preserved
// ============================================================================

test('roles preserved: global role mapping never mutates users', () => {
  assert.equal(mapGlobalRoleToMembership('super_admin'), null); // implicit admin
  assert.equal(mapGlobalRoleToMembership('admin'), 'member');
  assert.equal(mapGlobalRoleToMembership('superuser'), 'member');
  assert.equal(mapGlobalRoleToMembership('user'), 'member');

  // The backfill targets confirm `users` is never a write target, so the
  // existing global roles are preserved by construction.
  assert.equal(BACKFILL_TARGETS.includes('users' as (typeof BACKFILL_TARGETS)[number]), false);
});

// ============================================================================
// Categories / documents preserved
// ============================================================================

test('categories and documents are preserved: backfill does not target them', () => {
  assert.equal(BACKFILL_TARGETS.includes('categories' as (typeof BACKFILL_TARGETS)[number]), false);
  assert.equal(BACKFILL_TARGETS.includes('documents' as (typeof BACKFILL_TARGETS)[number]), false);
  assert.equal(BACKFILL_TARGETS.includes('document_categories' as (typeof BACKFILL_TARGETS)[number]), false);
});

test('categories and documents are preserved: capability config does not mutate input settings', () => {
  const input = {
    llm: { model: 'gpt-4o' },
    embeddings: { model: 'text-embedding-3-large' },
    reranker: { enabled: true, providers: [{ provider: 'cohere', enabled: true }] },
    tavily: { enabled: true },
    speech: { stt: { default: 'openai' }, tts: { primaryProvider: 'openai' } },
    ocr: { providers: [{ provider: 'mistral', enabled: true }] },
  };
  const snapshot = JSON.stringify(input);
  buildCapabilityConfigRows(input);
  assert.equal(JSON.stringify(input), snapshot); // inputs unchanged
});

// ============================================================================
// Provider selections preserved
// ============================================================================

test('provider selections preserved: platform credential mapping keeps provider ids', () => {
  const providers: LegacyProviderRow[] = [
    { id: 'openai', apiKey: 'iv:tag:ct', apiBase: null },
    { id: 'ollama', apiKey: null, apiBase: 'http://ollama:11434' },
    { id: 'gemini', apiKey: null, apiBase: null },
  ];
  const env = { GEMINI_API_KEY: 'sk-gemini-env' };

  const rows = buildPlatformCredentialRows(providers, env);

  assert.deepEqual(
    rows.map((r) => r.providerId),
    ['openai', 'ollama', 'gemini']
  );
  // DB-stored key → reference back to legacy row; env key → reference to env var.
  assert.equal(rows[0].secretRef, 'llm_providers:openai');
  assert.equal(rows[1].secretRef, 'llm_providers:ollama');
  assert.equal(rows[2].secretRef, 'env:GEMINI_API_KEY');
  // Legacy rows are not deleted and secrets are not duplicated: secret_ref is a
  // reference, never the secret itself.
  assert.equal(rows.every((r) => !r.secretRef.includes('sk-')), true);
});

test('provider selections preserved: capability config maps models to their providers', () => {
  const rows = buildCapabilityConfigRows({
    llm: { model: 'gpt-4o' },
    embeddings: { model: 'text-embedding-3-large' },
    reranker: { enabled: true, providers: [{ provider: 'cohere', enabled: true }] },
    tavily: { enabled: true },
    speech: { stt: { default: 'openai' }, tts: { primaryProvider: 'gemini' } },
    ocr: { providers: [{ provider: 'mistral', enabled: true }] },
  });

  const byCapability = new Map(rows.map((r) => [r.capabilityId, r]));

  assert.equal(byCapability.get('llm')?.providerId, 'openai');
  assert.equal(byCapability.get('llm')?.modelOrServiceId, 'gpt-4o');
  assert.equal(byCapability.get('embeddings')?.providerId, 'openai');
  assert.equal(byCapability.get('reranking')?.providerId, 'cohere');
  assert.equal(byCapability.get('web-search')?.providerId, 'tavily');
  assert.equal(byCapability.get('speech-to-text')?.providerId, 'openai');
  assert.equal(byCapability.get('text-to-speech')?.providerId, 'gemini');
  assert.equal(byCapability.get('document-intelligence')?.providerId, 'mistral');
});

test('inferProviderFromModel maps known model prefixes', () => {
  assert.equal(inferProviderFromModel('gpt-4o'), 'openai');
  assert.equal(inferProviderFromModel('gemini-2.5-flash'), 'gemini');
  assert.equal(inferProviderFromModel('claude-sonnet-4-6'), 'anthropic');
  assert.equal(inferProviderFromModel('mistral-large'), 'mistral');
  assert.equal(inferProviderFromModel('fireworks/deepseek-v4-pro'), 'fireworks');
  assert.equal(inferProviderFromModel('deepseek-v4-flash'), 'deepseek');
  assert.equal(inferProviderFromModel('moonshot/kimi-k3'), 'moonshot');
  assert.equal(inferProviderFromModel('unknown-model'), null);
});

// ============================================================================
// workspaces.organization_id zero nulls + orphan diagnostic
// ============================================================================

test('workspaces.organization_id zero nulls after backfill (assignable ones)', () => {
  const workspaces: BackfillWorkspace[] = [
    { id: 'ws-1', type: 'standalone', createdBy: 'alice@example.com', organizationId: null },
    { id: 'ws-2', type: 'embed', createdBy: 'bob@example.com', organizationId: null },
  ];

  const { assignments, orphans } = buildWorkspaceAssignments(workspaces, DEFAULT_ORG_ID);

  assert.equal(assignments.length, 2);
  assert.equal(orphans.length, 0);

  // No assignable workspace is left with a null organization.
  const assigned = new Set(assignments.map((a) => a.id));
  for (const ws of workspaces) {
    if (isAssignableWorkspace(ws)) assert.equal(assigned.has(ws.id), true);
  }
});

test('orphan diagnostic reports unassignable workspaces before backfill', () => {
  const workspaces: BackfillWorkspace[] = [
    { id: 'ws-1', type: 'standalone', createdBy: 'alice@example.com', organizationId: null },
    { id: 'ws-2', type: 'standalone', createdBy: '', organizationId: null }, // no creator
    { id: 'ws-3', type: 'weird', createdBy: 'bob@example.com', organizationId: null }, // unknown type
  ];

  const orphans = detectOrphanWorkspaces(workspaces);
  assert.deepEqual(
    orphans.map((o) => o.workspaceId).sort(),
    ['ws-2', 'ws-3']
  );

  // The backfill assigns only the assignable workspace and leaves the orphans.
  const { assignments, orphans: reported } = buildWorkspaceAssignments(workspaces, DEFAULT_ORG_ID);
  assert.deepEqual(assignments.map((a) => a.id), ['ws-1']);
  assert.deepEqual(reported.map((o) => o.workspaceId).sort(), ['ws-2', 'ws-3']);
});

// ============================================================================
// Reference rows
// ============================================================================

test('reference provider + capability rows are valid for FK references', () => {
  const providers = buildProviderReferenceRows();
  const capabilities = buildCapabilityReferenceRows();

  assert.equal(new Set(providers.map((p) => p.id)).size, providers.length); // unique ids
  assert.equal(new Set(capabilities.map((c) => c.id)).size, capabilities.length);

  // Capability ids referenced by buildCapabilityConfigRows must exist.
  const capabilityIds = new Set(capabilities.map((c) => c.id));
  for (const cap of ['llm', 'embeddings', 'reranking', 'web-search', 'document-intelligence', 'speech-to-text', 'text-to-speech']) {
    assert.equal(capabilityIds.has(cap), true);
  }

  // Provider ids referenced by capability config / platform creds must exist.
  const providerIds = new Set(providers.map((p) => p.id));
  for (const provider of ['openai', 'gemini', 'mistral', 'anthropic', 'deepseek', 'fireworks', 'moonshot', 'ollama', 'tavily', 'cohere', 'bge', 'azure-di']) {
    assert.equal(providerIds.has(provider), true);
  }
});
