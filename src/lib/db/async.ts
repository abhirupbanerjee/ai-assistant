/**
 * Async Database Operations using Kysely
 *
 * This module provides async versions of the standard database operations
 * that work with both SQLite and PostgreSQL via Kysely.
 *
 * Use these functions for:
 * - New code that needs PostgreSQL support
 * - Progressive migration from sync to async
 *
 * Import example:
 *   import { queryAllAsync, queryOneAsync, executeAsync } from '@/lib/db/async';
 */

import { sql } from 'kysely';
import { getDb, transaction as kyselyTransaction } from './kysely';
import type { DB } from './db-types';
import type { Kysely } from 'kysely';

/**
 * Run a query and return all results (async)
 * Note: This executes raw SQL without parameters.
 * For parameterized queries, use the Kysely query builder via getDb().
 */
export async function queryAllAsync<T>(
  sqlQuery: string
): Promise<T[]> {
  const db = await getDb();
  const result = await sql.raw<T>(sqlQuery).execute(db);
  return result.rows as T[];
}

/**
 * Run a query and return the first result (async)
 * Note: This executes raw SQL without parameters.
 * For parameterized queries, use the Kysely query builder via getDb().
 */
export async function queryOneAsync<T>(
  sqlQuery: string
): Promise<T | undefined> {
  const results = await queryAllAsync<T>(sqlQuery);
  return results[0];
}

/**
 * Run an insert/update/delete and return affected rows (async)
 * Note: This executes raw SQL without parameters.
 * For parameterized queries, use the Kysely query builder via getDb().
 */
export async function executeAsync(
  sqlQuery: string
): Promise<{ numAffectedRows: bigint; insertId?: bigint }> {
  const db = await getDb();
  const result = await sql.raw(sqlQuery).execute(db);
  return {
    numAffectedRows: result.numAffectedRows ?? BigInt(0),
    // Note: insertId availability depends on the dialect
  };
}

/**
 * Run multiple statements in a transaction (async)
 */
export async function transactionAsync<T>(
  fn: (trx: Kysely<DB>) => Promise<T>
): Promise<T> {
  return kyselyTransaction(fn);
}

/**
 * Get the Kysely database instance for direct query builder usage
 * Prefer using the query builder over raw SQL for type safety
 */
export { getDb } from './kysely';

// ============ Kysely Query Builder Helpers ============

/**
 * Example of using Kysely query builder (type-safe, works on both DBs):
 *
 * const db = await getDb();
 *
 * // Select all users
 * const users = await db.selectFrom('users').selectAll().execute();
 *
 * // Select with condition
 * const user = await db
 *   .selectFrom('users')
 *   .selectAll()
 *   .where('email', '=', email)
 *   .executeTakeFirst();
 *
 * // Insert
 * const newUser = await db
 *   .insertInto('users')
 *   .values({ email, name, role, added_by })
 *   .returningAll()
 *   .executeTakeFirst();
 *
 * // Update
 * await db
 *   .updateTable('users')
 *   .set({ name: 'New Name' })
 *   .where('id', '=', id)
 *   .execute();
 *
 * // Delete
 * const result = await db
 *   .deleteFrom('users')
 *   .where('id', '=', id)
 *   .executeTakeFirst();
 */
