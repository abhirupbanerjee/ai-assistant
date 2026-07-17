/**
 * Load Test Results Database Operations
 *
 * Stores and retrieves k6 Cloud load test results.
 * Uses Kysely query builder for PostgreSQL.
 *
 * IMPORTANT: Types are derived from DB['load_test_results'] rather than
 * importing named exports (e.g. LoadTestResultsTable) because `npm run db:types`
 * regenerates db-types.ts from scratch via kysely-codegen, which can change
 * interface names and wipes convenience aliases.  Using indexed access on DB
 * is immune to regeneration.
 */

import { getDb } from '../kysely';
import type { Selectable, Insertable } from 'kysely';
import type { DB } from '../db-types';

type LoadTestResult = Selectable<DB['load_test_results']>;
type NewLoadTestResult = Insertable<DB['load_test_results']>;

/**
 * Insert a new load test result
 */
export async function insertLoadTestResult(
  result: NewLoadTestResult
): Promise<LoadTestResult> {
  const db = await getDb();
  const inserted = await db
    .insertInto('load_test_results')
    .values(result)
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as LoadTestResult;
}

/**
 * Get the most recent load test result for a URL
 */
export async function getLatestLoadTestResult(
  url: string
): Promise<LoadTestResult | null> {
  const db = await getDb();
  const result = await db
    .selectFrom('load_test_results')
    .selectAll()
    .where('url', '=', url)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return result ?? null;
}

/**
 * Get all load test results (for admin listing), most recent first
 */
export async function getAllLoadTestResults(
  limit: number = 50
): Promise<LoadTestResult[]> {
  const db = await getDb();
  return db
    .selectFrom('load_test_results')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
}

/**
 * Delete load test results older than a given date
 */
export async function deleteOldLoadTestResults(
  olderThanDays: number = 90
): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('load_test_results')
    .where('created_at', '<', new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString())
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
