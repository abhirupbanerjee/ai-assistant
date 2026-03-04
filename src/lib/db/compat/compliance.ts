/**
 * Compliance - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { sql } from 'kysely';
import type {
  ComplianceResultRecord,
  ComplianceDecision,
  HitlClarificationEvent,
  HitlUserResponse,
  HitlAction,
} from '../../../types/compliance';

export type { ComplianceStats } from '../compliance';
import type { ComplianceStats } from '../compliance';

// ============ Save Operations ============

/**
 * Save compliance check result to database
 */
export async function saveComplianceResult(
  messageId: string,
  conversationId: string,
  skillIds: number[],
  decision: ComplianceDecision,
  hitlEvent?: HitlClarificationEvent
): Promise<number> {
  const db = await getDb();
  const result = await db
    .insertInto('compliance_results')
    .values({
      message_id: messageId,
      conversation_id: conversationId,
      skill_ids: JSON.stringify(skillIds),
      overall_score: decision.score,
      decision: decision.decision,
      checks_performed: JSON.stringify(decision.checksPerformed),
      failed_checks: JSON.stringify(decision.failedChecks),
      hitl_triggered: hitlEvent ? 1 : 0,
      hitl_questions: hitlEvent ? JSON.stringify(hitlEvent.questions) : null,
      hitl_user_response: null,
      hitl_action: null,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  return result.id as number;
}

/**
 * Update compliance result with HITL user response
 */
export async function updateHitlResponse(
  messageId: string,
  userResponse: HitlUserResponse,
  action: HitlAction
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('compliance_results')
    .set({
      hitl_user_response: JSON.stringify(userResponse),
      hitl_action: action,
    })
    .where('message_id', '=', messageId)
    .execute();
}

// ============ Query Operations ============

/**
 * Get compliance result by message ID
 */
export async function getComplianceResult(messageId: string): Promise<ComplianceResultRecord | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('compliance_results')
    .selectAll()
    .where('message_id', '=', messageId)
    .executeTakeFirst();
  return (row as unknown as ComplianceResultRecord) ?? null;
}

/**
 * Get compliance results for a conversation
 */
export async function getComplianceResultsForConversation(
  conversationId: string
): Promise<ComplianceResultRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('compliance_results')
    .selectAll()
    .where('conversation_id', '=', conversationId)
    .orderBy('validated_at', 'desc')
    .execute();
  return rows as unknown as ComplianceResultRecord[];
}

/**
 * Get recent compliance results with optional filters
 */
export async function getRecentComplianceResults(
  filters: {
    skillId?: number;
    decision?: 'pass' | 'warn' | 'hitl';
    hitlTriggered?: boolean;
    limit?: number;
  } = {}
): Promise<ComplianceResultRecord[]> {
  const db = await getDb();
  const limit = filters.limit || 100;

  let query = db
    .selectFrom('compliance_results')
    .selectAll()
    .orderBy('validated_at', 'desc')
    .limit(limit);

  if (filters.skillId !== undefined) {
    query = query.where('skill_ids', 'like', `%${filters.skillId}%`);
  }
  if (filters.decision) {
    query = query.where('decision', '=', filters.decision);
  }
  if (filters.hitlTriggered !== undefined) {
    query = query.where('hitl_triggered', '=', filters.hitlTriggered ? 1 : 0);
  }

  const rows = await query.execute();
  return rows as unknown as ComplianceResultRecord[];
}

// ============ Statistics Operations ============

/**
 * Get compliance statistics
 */
export async function getComplianceStats(
  filters: { skillId?: number; from?: Date; to?: Date } = {}
): Promise<ComplianceStats> {
  const db = await getDb();

  let countsQuery = db
    .selectFrom('compliance_results')
    .select([
      db.fn.countAll<number>().as('total'),
      sql<number>`SUM(CASE WHEN decision = 'pass' THEN 1 ELSE 0 END)`.as('pass_count'),
      sql<number>`SUM(CASE WHEN decision = 'warn' THEN 1 ELSE 0 END)`.as('warn_count'),
      sql<number>`SUM(CASE WHEN decision = 'hitl' THEN 1 ELSE 0 END)`.as('hitl_count'),
      sql<number>`COALESCE(AVG(overall_score), 0)`.as('avg_score'),
    ]);

  let failuresQuery = db
    .selectFrom('compliance_results')
    .select('failed_checks')
    .where('failed_checks', 'is not', null)
    .orderBy('validated_at', 'desc')
    .limit(100);

  if (filters.skillId !== undefined) {
    countsQuery = countsQuery.where('skill_ids', 'like', `%${filters.skillId}%`);
    failuresQuery = failuresQuery.where('skill_ids', 'like', `%${filters.skillId}%`);
  }
  if (filters.from) {
    countsQuery = countsQuery.where('validated_at', '>=', filters.from.toISOString());
    failuresQuery = failuresQuery.where('validated_at', '>=', filters.from.toISOString());
  }
  if (filters.to) {
    countsQuery = countsQuery.where('validated_at', '<=', filters.to.toISOString());
    failuresQuery = failuresQuery.where('validated_at', '<=', filters.to.toISOString());
  }

  const [counts, failureRows] = await Promise.all([
    countsQuery.executeTakeFirst(),
    failuresQuery.execute(),
  ]);

  // Aggregate failure counts
  const failureCounts: Record<string, number> = {};
  for (const row of failureRows) {
    if (row.failed_checks) {
      try {
        const checks = JSON.parse(row.failed_checks as string) as string[];
        for (const check of checks) {
          failureCounts[check] = (failureCounts[check] || 0) + 1;
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  const commonFailures = Object.entries(failureCounts)
    .map(([check, count]) => ({ check, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const total = Number(counts?.total ?? 0);
  const passCount = Number(counts?.pass_count ?? 0);
  const hitlCount = Number(counts?.hitl_count ?? 0);

  return {
    totalChecks: total,
    passCount,
    warnCount: Number(counts?.warn_count ?? 0),
    hitlCount,
    passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
    hitlRate: total > 0 ? Math.round((hitlCount / total) * 100) : 0,
    averageScore: counts?.avg_score ? Math.round(Number(counts.avg_score)) : 0,
    commonFailures,
  };
}

// ============ Cleanup Operations ============

/**
 * Delete old compliance results (for data retention)
 */
export async function deleteOldComplianceResults(olderThanDays: number): Promise<number> {
  const db = await getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  const result = await db
    .deleteFrom('compliance_results')
    .where('validated_at', '<', cutoffDate.toISOString())
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
