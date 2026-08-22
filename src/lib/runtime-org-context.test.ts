/**
 * Integration-style tests for the runtime organization-context plumbing
 * (security findings #1/#2):
 *
 *   - The request context (AsyncLocalStorage) propagates `organizationId`
 *     through nested async scopes and nested `runWithContextAsync` calls.
 *   - The server-side membership resolver picks the session user's org.
 *   - `resolveProviderCredential` is BYOK fail-closed: an ORGANIZATION_BYOK org
 *     resolves its own org key (never the platform key), and an unresolvable
 *     organization returns `available: false` instead of silently defaulting to
 *     platform credentials.
 *   - Vector tenancy: org A ingest → org B search produces a non-matching
 *     tenant filter through the actual context plumbing (not just pure helpers).
 *
 * DB access is exercised via a minimal in-memory Kysely stand-in so the tests
 * run without a live PostgreSQL connection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import { runWithContextAsync, getRequestContext } from './request-context';
import {
  resolveUserMembership,
  resolveUserOrganizationIdByUserId,
} from './org-membership';
import { resolveProviderCredential } from './provider-credential';
import { resolveCapability } from './capability-resolver';
import { resolveVectorTenancyOrgIdFromContext } from './org-context';
import { buildOrgAwareFilter, stampOrganizationId, ORG_ID_PAYLOAD_KEY } from './vector-store/qdrant';
import { KEK_ENV_VAR, encryptCredentialSecret } from './credential-vault';

const TEST_KEK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test.before(() => {
  process.env[KEK_ENV_VAR] = TEST_KEK;
});

test.after(() => {
  delete process.env[KEK_ENV_VAR];
});

// ============================================================================
// Minimal in-memory Kysely stand-in (select/where/orderBy/limit + execute)
// ============================================================================

type FakeRow = Record<string, unknown>;

function makeFakeDb(tables: Record<string, FakeRow[]>): Kysely<DB> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectFrom = (table: string): any => {
    const state: {
      filters: Array<{ col: string; op: string; value: unknown }>;
      orderCol: string | null;
      limitVal: number | null;
    } = { filters: [], orderCol: null, limitVal: null };

    const rows = (): FakeRow[] => {
      let result = (tables[table] ?? []).filter((row) =>
        state.filters.every((f) => {
          if (f.op === 'in') {
            return Array.isArray(f.value) && f.value.includes(row[f.col]);
          }
          return row[f.col] === f.value;
        })
      );
      if (state.orderCol) {
        result = [...result].sort(
          (a, b) => Number(a[state.orderCol!] ?? 0) - Number(b[state.orderCol!] ?? 0)
        );
      }
      if (state.limitVal != null) result = result.slice(0, state.limitVal);
      return result;
    };

    const api: Record<string, unknown> = {
      select: () => api,
      where(col: string, opOrValue: unknown, maybeValue?: unknown) {
        if (maybeValue === undefined) {
          state.filters.push({ col, op: '=', value: opOrValue });
        } else {
          state.filters.push({ col, op: opOrValue as string, value: maybeValue });
        }
        return api;
      },
      orderBy(col: string) {
        state.orderCol = col;
        return api;
      },
      limit(n: number) {
        state.limitVal = n;
        return api;
      },
      async execute(): Promise<FakeRow[]> {
        return rows();
      },
      async executeTakeFirst(): Promise<FakeRow | undefined> {
        return rows()[0];
      },
    };
    return api;
  };

  const db = { selectFrom };
  return db as unknown as Kysely<DB>;
}

const FLAGS_ON = {
  orgTenancyEnabled: true,
  vectorTenancyEnabled: true,
  orgCredentialResolverEnabled: true,
  aiApiSetupUiEnabled: false,
};

// ============================================================================
// Context plumbing
// ============================================================================

test('runWithContextAsync propagates organizationId through nested async scopes', async () => {
  const observed: Array<number | undefined> = [];
  await runWithContextAsync({ organizationId: 42, threadId: 't1' }, async () => {
    observed.push(getRequestContext().organizationId);
    await Promise.resolve();
    observed.push(getRequestContext().organizationId);
  });
  assert.deepEqual(observed, [42, 42]);
});

test('nested runWithContextAsync inherits organizationId from the parent scope', async () => {
  await runWithContextAsync({ organizationId: 7, threadId: 'outer' }, async () => {
    await runWithContextAsync({ messageId: 'inner' }, async () => {
      assert.equal(getRequestContext().organizationId, 7);
      assert.equal(getRequestContext().threadId, 'outer');
      assert.equal(getRequestContext().messageId, 'inner');
    });
  });
});

// ============================================================================
// Server-side membership resolution
// ============================================================================

test('resolveUserMembership picks the org_admin membership when several exist', async () => {
  const db = makeFakeDb({
    users: [{ id: 1, email: 'alice@example.com' }],
    organization_memberships: [
      { user_id: 1, organization_id: 10, role: 'member', status: 'active' },
      { user_id: 1, organization_id: 11, role: 'org_admin', status: 'active' },
    ],
  });

  const membership = await resolveUserMembership({ email: 'alice@example.com' }, db);
  assert.equal(membership.userId, 1);
  assert.equal(membership.organizationId, 11);
  assert.equal(membership.membershipRole, 'org_admin');
});

test('resolveUserOrganizationIdByUserId resolves the sole active membership', async () => {
  const db = makeFakeDb({
    organization_memberships: [
      { user_id: 5, organization_id: 22, role: 'member', status: 'active' },
    ],
  });
  assert.equal(await resolveUserOrganizationIdByUserId(5, db), 22);
  assert.equal(await resolveUserOrganizationIdByUserId(null, db), null);
});

// ============================================================================
// BYOK fail-closed resolution through the actual resolver
// ============================================================================

function settingsTable(): FakeRow[] {
  return [
    { key: 'org-tenancy-enabled', value: 'true' },
    { key: 'vector-tenancy-enabled', value: 'false' },
    { key: 'org-credential-resolver-enabled', value: 'true' },
    { key: 'ai-api-setup-ui-enabled', value: 'false' },
  ];
}

test('ORGANIZATION_BYOK org resolves its own org key, never the platform key', async () => {
  const encrypted = encryptCredentialSecret('sk-org-123', {
    organizationId: 2,
    providerId: 'openai',
    credentialId: 'openai-org-key',
  });

  const db = makeFakeDb({
    settings: settingsTable(),
    organizations: [
      { id: 1, type: 'DEFAULT', is_default: true, credential_mode: 'PLATFORM_MANAGED' },
      { id: 2, type: 'ENTITY', is_default: false, credential_mode: 'ORGANIZATION_BYOK' },
    ],
    organization_provider_credentials: [
      {
        organization_id: 2,
        provider_id: 'openai',
        credential_id: 'openai-org-key',
        credential_version: 3,
        status: 'active',
        is_default: true,
        secret_ciphertext: encrypted.secretCiphertext,
        dek_wrapped: encrypted.dekWrapped,
        aad: encrypted.aad,
        kek_version: encrypted.kekVersion,
      },
    ],
  });

  const resolved = await resolveProviderCredential(db, 2, 'openai');
  assert.equal(resolved.available, true);
  assert.equal(resolved.credentialId, 'openai-org-key');
  assert.equal(resolved.apiKey, 'sk-org-123');
});

test('ORGANIZATION_BYOK org with no org credential is UNAVAILABLE (no platform fallback)', async () => {
  const db = makeFakeDb({
    settings: settingsTable(),
    organizations: [
      { id: 1, type: 'DEFAULT', is_default: true, credential_mode: 'PLATFORM_MANAGED' },
      { id: 2, type: 'ENTITY', is_default: false, credential_mode: 'ORGANIZATION_BYOK' },
    ],
    organization_provider_credentials: [],
  });

  const resolved = await resolveProviderCredential(db, 2, 'openai');
  assert.equal(resolved.available, false);
  assert.equal(resolved.credentialId, 'unavailable');
  assert.equal(resolved.apiKey, null);
});

test('an unresolvable organization id fails closed (no DEFAULT fallback)', async () => {
  const db = makeFakeDb({
    settings: settingsTable(),
    organizations: [
      { id: 1, type: 'DEFAULT', is_default: true, credential_mode: 'PLATFORM_MANAGED' },
    ],
    organization_provider_credentials: [],
  });

  const resolved = await resolveProviderCredential(db, 99, 'openai');
  assert.equal(resolved.available, false);
  assert.equal(resolved.credentialId, 'unavailable');
});

test('capability-resolver fails closed for a requested-but-missing org id (NEW-3)', async () => {
  const db = makeFakeDb({
    settings: settingsTable(),
    organizations: [
      { id: 1, type: 'DEFAULT', is_default: true, credential_mode: 'PLATFORM_MANAGED' },
    ],
    organization_provider_credentials: [],
  });

  await assert.rejects(
    () => resolveCapability(db, 99, 'llm'),
    /organization 99 not found/
  );
});

// ============================================================================
// Auxiliary-capability BYOK no-fallback (NEW-2)
// ============================================================================

test('ORGANIZATION_BYOK auxiliary providers fail closed with no org credential', async () => {
  const db = makeFakeDb({
    settings: settingsTable(),
    organizations: [
      { id: 1, type: 'DEFAULT', is_default: true, credential_mode: 'PLATFORM_MANAGED' },
      { id: 2, type: 'ENTITY', is_default: false, credential_mode: 'ORGANIZATION_BYOK' },
    ],
    organization_provider_credentials: [],
  });

  // OCR (mistral / azure-di), translation/TTS/image-gen (mistral / gemini),
  // and web-search (tavily) all resolve provider-keyed; a BYOK org with no org
  // credential must get `unavailable`, never the platform/legacy key.
  for (const providerId of ['mistral', 'azure-di', 'gemini', 'tavily']) {
    const resolved = await resolveProviderCredential(db, 2, providerId);
    assert.equal(resolved.available, false, providerId);
    assert.equal(resolved.credentialId, 'unavailable', providerId);
    assert.equal(resolved.apiKey, null, providerId);
  }
});

test('ORGANIZATION_BYOK org resolves its own auxiliary provider credential', async () => {
  const encrypted = encryptCredentialSecret('sk-tavily-org', {
    organizationId: 2,
    providerId: 'tavily',
    credentialId: 'tavily-org-key',
  });

  const db = makeFakeDb({
    settings: settingsTable(),
    organizations: [
      { id: 1, type: 'DEFAULT', is_default: true, credential_mode: 'PLATFORM_MANAGED' },
      { id: 2, type: 'ENTITY', is_default: false, credential_mode: 'ORGANIZATION_BYOK' },
    ],
    organization_provider_credentials: [
      {
        organization_id: 2,
        provider_id: 'tavily',
        credential_id: 'tavily-org-key',
        credential_version: 1,
        status: 'active',
        is_default: true,
        secret_ciphertext: encrypted.secretCiphertext,
        dek_wrapped: encrypted.dekWrapped,
        aad: encrypted.aad,
        kek_version: encrypted.kekVersion,
      },
    ],
  });

  const resolved = await resolveProviderCredential(db, 2, 'tavily');
  assert.equal(resolved.available, true);
  assert.equal(resolved.credentialId, 'tavily-org-key');
  assert.equal(resolved.apiKey, 'sk-tavily-org');
});

// ============================================================================
// Deterministic multi-membership resolution (NEW-4)
// ============================================================================

test('resolveUserMembership picks the lowest organization_id when no admin exists', async () => {
  const db = makeFakeDb({
    users: [{ id: 1, email: 'bob@example.com' }],
    organization_memberships: [
      { user_id: 1, organization_id: 30, role: 'member', status: 'active' },
      { user_id: 1, organization_id: 10, role: 'member', status: 'active' },
      { user_id: 1, organization_id: 20, role: 'member', status: 'active' },
    ],
  });

  const membership = await resolveUserMembership({ email: 'bob@example.com' }, db);
  assert.equal(membership.organizationId, 10);
  assert.equal(membership.membershipRole, 'member');
});

// ============================================================================
// Vector tenancy through context plumbing (org A ingest → org B search)
// ============================================================================

test('vector tenancy: org A ingest cannot be matched by org B search filter', async () => {
  const stampAndFilter = () => {
    const orgId = resolveVectorTenancyOrgIdFromContext(FLAGS_ON, 1);
    return {
      payload: stampOrganizationId({ documentId: 'd1' }, orgId),
      filter: buildOrgAwareFilter(orgId, { categoryId: 5 })!,
    };
  };

  const asA = await runWithContextAsync({ organizationId: 100 }, async () => stampAndFilter());
  const asB = await runWithContextAsync({ organizationId: 200 }, async () => stampAndFilter());

  assert.equal(asA.payload[ORG_ID_PAYLOAD_KEY], 100);
  assert.equal(asB.filter[ORG_ID_PAYLOAD_KEY], 200);
  // Org A's stamped payload cannot satisfy org B's mandatory filter.
  assert.notEqual(asA.payload[ORG_ID_PAYLOAD_KEY], asB.filter[ORG_ID_PAYLOAD_KEY]);
});

test('vector tenancy is disabled when the flag is off (no stamp, no filter)', () => {
  const orgId = resolveVectorTenancyOrgIdFromContext(
    { ...FLAGS_ON, vectorTenancyEnabled: false },
    1
  );
  assert.equal(orgId, null);
});
