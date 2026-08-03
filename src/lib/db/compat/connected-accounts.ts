/**
 * Connected Accounts Compatibility Layer
 *
 * Async interface for per-user connected OAuth accounts (Drive connectors — Phase 2).
 * Stores encrypted access/refresh tokens. Mirrors the function-api-config pattern:
 *   - `getDb()` from ../kysely
 *   - `safeEncrypt`/`safeDecrypt` from ../../encryption
 *   - Row mapper converts snake_case DB rows to camelCase domain objects
 *
 * Identity key is `user_email` (matches session.user.email / RequestContext.userId).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../kysely';
import { safeEncrypt, safeDecrypt } from '../../encryption';
import type {
  ConnectedAccount,
  ConnectedAccountProvider,
  ConnectedAccountPublicView,
  UpsertConnectedAccountInput,
} from '@/types/connected-accounts';

// Re-export types
export type {
  ConnectedAccount,
  ConnectedAccountProvider,
  ConnectedAccountPublicView,
  UpsertConnectedAccountInput,
} from '@/types/connected-accounts';

// ============ Row Mapper ============

interface PgConnectedAccountRow {
  id: string;
  provider: string;
  user_email: string;
  display_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  scopes: string;
  token_expiry: string | Date | null;
  revoked: number | boolean;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const toIso = (v: string | Date | null | undefined): string | undefined =>
  v instanceof Date ? v.toISOString() : (v ?? undefined);

function mapRowToConnectedAccount(row: PgConnectedAccountRow): ConnectedAccount {
  return {
    id: row.id,
    provider: row.provider as ConnectedAccountProvider,
    userEmail: row.user_email,
    displayName: row.display_name || undefined,
    accessToken: row.access_token ? safeDecrypt(row.access_token) || undefined : undefined,
    refreshToken: row.refresh_token ? safeDecrypt(row.refresh_token) || undefined : undefined,
    scopes: row.scopes,
    tokenExpiry: toIso(row.token_expiry),
    revoked: Boolean(row.revoked),
    lastError: row.last_error || undefined,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapRowToPublicView(row: PgConnectedAccountRow): ConnectedAccountPublicView {
  return {
    id: row.id,
    provider: row.provider as ConnectedAccountProvider,
    userEmail: row.user_email,
    displayName: row.display_name || undefined,
    scopes: row.scopes,
    revoked: Boolean(row.revoked),
    lastError: row.last_error || undefined,
    connectedAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

// ============ CRUD Operations ============

/**
 * Insert or update a connected account for a given (userEmail, provider) pair.
 * Tokens are encrypted at rest. On update, existing values are preserved when
 * the caller omits them (e.g. a refresh that only rotates the access token).
 */
/**
 * Apply a conditional update to an existing connected account row.
 * Only rotates fields that the caller provided; preserves existing tokens otherwise.
 * Extracted so upsertConnectedAccount can reuse it after a unique-constraint race.
 */
async function applyUpdate(id: string, input: UpsertConnectedAccountInput): Promise<void> {
  const db = await getDb();
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    revoked: false,
    last_error: null,
  };
  if (input.displayName !== undefined) updateData.display_name = input.displayName;
  if (input.accessToken !== undefined) {
    updateData.access_token = input.accessToken ? safeEncrypt(input.accessToken) : null;
  }
  if (input.refreshToken !== undefined) {
    updateData.refresh_token = input.refreshToken ? safeEncrypt(input.refreshToken) : null;
  }
  if (input.scopes !== undefined) updateData.scopes = input.scopes;
  if (input.tokenExpiry !== undefined) {
    updateData.token_expiry = input.tokenExpiry || null;
  }

  await db
    .updateTable('user_connected_accounts')
    .set(updateData)
    .where('id', '=', id)
    .execute();
}

export async function upsertConnectedAccount(
  input: UpsertConnectedAccountInput
): Promise<ConnectedAccount | undefined> {
  const db = await getDb();

  const existing = await db
    .selectFrom('user_connected_accounts')
    .selectAll()
    .where('user_email', '=', input.userEmail)
    .where('provider', '=', input.provider)
    .executeTakeFirst();

  if (existing) {
    await applyUpdate(existing.id, input);
    return getConnectedAccountById(existing.id);
  }

  // No existing row — attempt INSERT. A concurrent call for the same
  // (userEmail, provider) pair may insert first and trip the unique index.
  // On PostgreSQL error code 23505 (unique_violation) we re-query and UPDATE.
  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    await db
      .insertInto('user_connected_accounts')
      .values({
        id,
        provider: input.provider,
        user_email: input.userEmail,
        display_name: input.displayName || null,
        access_token: input.accessToken ? safeEncrypt(input.accessToken) : null,
        refresh_token: input.refreshToken ? safeEncrypt(input.refreshToken) : null,
        scopes: input.scopes,
        token_expiry: input.tokenExpiry || null,
        revoked: false,
        created_at: now,
        updated_at: now,
      })
      .execute();

    return getConnectedAccountById(id);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    // 23505 = unique_violation (PostgreSQL). Also tolerate node-postgres message match
    // in case the error wrapper doesn't expose the code property.
    const isUniqueViolation =
      code === '23505' ||
      /unique constraint "idx_user_connected_accounts_unique"/i.test(String((err as Error)?.message ?? ''));

    if (!isUniqueViolation) throw err;

    // A concurrent insert won the race — re-query and update that row instead.
    const raced = await db
      .selectFrom('user_connected_accounts')
      .select('id')
      .where('user_email', '=', input.userEmail)
      .where('provider', '=', input.provider)
      .executeTakeFirst();

    if (!raced) {
      // Row vanished between the violation and re-query — extremely unlikely,
      // but fall back to a fresh insert attempt.
      throw err;
    }

    await applyUpdate(raced.id, input);
    return getConnectedAccountById(raced.id);
  }
}

export async function getConnectedAccountById(id: string): Promise<ConnectedAccount | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('user_connected_accounts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!row) return undefined;
  return mapRowToConnectedAccount(row as unknown as PgConnectedAccountRow);
}

/**
 * Fetch a single connected account by user + provider.
 * Returns the account with decrypted tokens (for server-side use only).
 */
export async function getConnectedAccount(
  userEmail: string,
  provider: ConnectedAccountProvider
): Promise<ConnectedAccount | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('user_connected_accounts')
    .selectAll()
    .where('user_email', '=', userEmail)
    .where('provider', '=', provider)
    .executeTakeFirst();

  if (!row) return undefined;
  return mapRowToConnectedAccount(row as unknown as PgConnectedAccountRow);
}

/**
 * List all connected accounts for a user (public view — no decrypted tokens).
 */
export async function listConnectedAccounts(userEmail: string): Promise<ConnectedAccountPublicView[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('user_connected_accounts')
    .selectAll()
    .where('user_email', '=', userEmail)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map(row => mapRowToPublicView(row as unknown as PgConnectedAccountRow));
}

/**
 * Mark a connected account as revoked and clear stored tokens.
 * Called when a user disconnects or when the provider reports the token is invalid.
 * The row is retained (not deleted) for audit history; tokens are wiped.
 */
export async function revokeConnectedAccount(
  userEmail: string,
  provider: ConnectedAccountProvider,
  errorReason?: string
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('user_connected_accounts')
    .set({
      revoked: true,
      access_token: null,
      refresh_token: null,
      token_expiry: null,
      last_error: errorReason || null,
      updated_at: new Date().toISOString(),
    })
    .where('user_email', '=', userEmail)
    .where('provider', '=', provider)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0) > 0;
}

/**
 * Permanently delete a connected account row.
 */
export async function deleteConnectedAccount(
  userEmail: string,
  provider: ConnectedAccountProvider
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('user_connected_accounts')
    .where('user_email', '=', userEmail)
    .where('provider', '=', provider)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

/**
 * Record the latest error for a connected account (without revoking).
 * Useful when a refresh fails transiently.
 */
export async function setConnectedAccountError(
  userEmail: string,
  provider: ConnectedAccountProvider,
  errorMessage: string
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('user_connected_accounts')
    .set({
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .where('user_email', '=', userEmail)
    .where('provider', '=', provider)
    .execute();
}

/**
 * Check whether a user has at least one non-revoked connected account for a provider.
 */
export async function hasConnectedAccount(
  userEmail: string,
  provider: ConnectedAccountProvider
): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .selectFrom('user_connected_accounts')
    .select('id')
    .where('user_email', '=', userEmail)
    .where('provider', '=', provider)
    .where('revoked', '=', false)
    .executeTakeFirst();

  return !!row;
}
