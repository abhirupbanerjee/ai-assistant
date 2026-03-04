/**
 * Load Test Results Database Operations
 *
 * Stores and retrieves k6 Cloud load test results.
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import type { LoadTestResult, NewLoadTestResult } from '../db-types';

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
  return inserted;
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
