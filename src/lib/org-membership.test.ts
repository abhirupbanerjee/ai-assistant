/**
 * Tests for the active-organization selection logic in org-membership.ts:
 *
 *   - super_admin resolves their selected active organization (or null).
 *   - members resolve their active selection only when backed by membership.
 *   - members fall back to the deterministic membership resolution otherwise.
 *   - session-user org id resolution routes through the active selection.
 *
 * Uses a minimal in-memory Kysely stand-in (selectFrom/select/where/orderBy/
 * limit + execute/executeTakeFirst) so the tests run without PostgreSQL.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import {
  resolveActiveOrganizationIdByUserId,
  resolveUserOrganizationId,
  listRepresentableOrganizations,
} from './org-membership';

type FakeRow = Record<string, unknown>;

function makeFakeDb(tables: Record<string, FakeRow[]>): Kysely<DB> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectFrom = (table: string): any => {
    const state: {
      filters: Array<{ col: string; value: unknown }>;
      orderCol: string | null;
      limitVal: number | null;
    } = { filters: [], orderCol: null, limitVal: null };

    const rows = (): FakeRow[] => {
      let result = (tables[table] ?? []).filter((row) =>
        state.filters.every((f) => row[f.col] === f.value)
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
        state.filters.push({
          col,
          value: maybeValue === undefined ? opOrValue : maybeValue,
        });
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

  return { selectFrom } as unknown as Kysely<DB>;
}

test('super_admin resolves their selected active organization', async () => {
  const db = makeFakeDb({
    users: [{ id: 1, role: 'super_admin', active_organization_id: 22 }],
  });
  assert.equal(await resolveActiveOrganizationIdByUserId(1, db), 22);
});

test('super_admin with no active selection resolves null', async () => {
  const db = makeFakeDb({
    users: [{ id: 1, role: 'super_admin', active_organization_id: null }],
  });
  assert.equal(await resolveActiveOrganizationIdByUserId(1, db), null);
});

test('member resolves active selection only when backed by membership', async () => {
  const db = makeFakeDb({
    users: [{ id: 5, role: 'user', active_organization_id: 22 }],
    organization_memberships: [
      { organization_id: 22, user_id: 5, role: 'member', status: 'active' },
    ],
  });
  assert.equal(await resolveActiveOrganizationIdByUserId(5, db), 22);
});

test('member falls back to deterministic membership when active selection is stale', async () => {
  const db = makeFakeDb({
    users: [{ id: 5, role: 'user', active_organization_id: 999 }],
    organization_memberships: [
      { organization_id: 10, user_id: 5, role: 'member', status: 'active' },
    ],
  });
  // active_organization_id 999 has no membership → fall back to lowest org id.
  assert.equal(await resolveActiveOrganizationIdByUserId(5, db), 10);
});

test('org_admin membership wins over a lower-id member membership', async () => {
  const db = makeFakeDb({
    users: [{ id: 5, role: 'user', active_organization_id: null }],
    organization_memberships: [
      { organization_id: 10, user_id: 5, role: 'member', status: 'active' },
      { organization_id: 20, user_id: 5, role: 'org_admin', status: 'active' },
    ],
  });
  assert.equal(await resolveActiveOrganizationIdByUserId(5, db), 20);
});

test('resolveUserOrganizationId routes through active selection', async () => {
  const db = makeFakeDb({
    users: [{ id: 7, email: 'admin@example.com', role: 'super_admin', active_organization_id: 33 }],
  });
  assert.equal(await resolveUserOrganizationId({ email: 'admin@example.com' }, db), 33);
});

test('listRepresentableOrganizations returns all orgs for super_admin', async () => {
  const db = makeFakeDb({
    users: [{ id: 1, email: 'root@example.com', role: 'super_admin', active_organization_id: 2 }],
    organizations: [
      { id: 1, name: 'Default', type: 'DEFAULT', is_default: true, credential_mode: 'PLATFORM_MANAGED' },
      { id: 2, name: 'Acme', type: 'ENTITY', is_default: false, credential_mode: 'ORGANIZATION_BYOK' },
    ],
  });
  const result = await listRepresentableOrganizations({ email: 'root@example.com' }, db);
  assert.equal(result.activeOrganizationId, 2);
  assert.equal(result.organizations.length, 2);
  assert.equal(result.organizations.every((o) => o.membershipRole === null), true);
});
