/**
 * Compliance Database Operations
 *
 * CRUD operations for compliance_results table.
 * Handles saving and querying compliance check results.
 */

import { execute, queryOne, queryAll } from './index';
import type {
  ComplianceResultRecord,
  ComplianceDecision,
  HitlClarificationEvent,
  HitlUserResponse,
  HitlAction,
} from '../../types/compliance';

// ============ Save Operations ============

/**
 * Save compliance check result to database
 */
export function saveComplianceResult(
  messageId: string,
  conversationId: string,
  skillIds: number[],
  decision: ComplianceDecision,
  hitlEvent?: HitlClarificationEvent
): number {
  const result = execute(
    `INSERT INTO compliance_results (
      message_id,
      conversation_id,
      skill_ids,
      overall_score,
      decision,
      checks_performed,
      failed_checks,
      hitl_triggered,
      hitl_questions,
      hitl_user_response,
      hitl_action
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      messageId,
      conversationId,
      JSON.stringify(skillIds),
      decision.score,
      decision.decision,
      JSON.stringify(decision.checksPerformed),
      JSON.stringify(decision.failedChecks),
      hitlEvent ? 1 : 0,
      hitlEvent ? JSON.stringify(hitlEvent.questions) : null,
      null, // User response filled in later
      null, // Action filled in later
    ]
  );

  return result.lastInsertRowid as number;
}

/**
 * Update compliance result with HITL user response
 */
export function updateHitlResponse(
  messageId: string,
  userResponse: HitlUserResponse,
  action: HitlAction
): void {
  execute(
    `UPDATE compliance_results
     SET hitl_user_response = ?,
         hitl_action = ?
     WHERE message_id = ?`,
    [
      JSON.stringify(userResponse),
      action,
      messageId,
    ]
  );
}

// ============ Query Operations ============

/**
 * Get compliance result by message ID
 */
export function getComplianceResult(
  messageId: string
): ComplianceResultRecord | null {
  const row = queryOne<ComplianceResultRecord>(
    'SELECT * FROM compliance_results WHERE message_id = ?',
    [messageId]
  );

  return row || null;
}

/**
 * Get compliance results for a conversation
 */
export function getComplianceResultsForConversation(
  conversationId: string
): ComplianceResultRecord[] {
  return queryAll<ComplianceResultRecord>(
    `SELECT * FROM compliance_results
     WHERE conversation_id = ?
     ORDER BY validated_at DESC`,
    [conversationId]
  );
}

/**
 * Get recent compliance results with optional filters
 */
export function getRecentComplianceResults(
  filters: {
    skillId?: number;
    decision?: 'pass' | 'warn' | 'hitl';
    hitlTriggered?: boolean;
    limit?: number;
  } = {}
): ComplianceResultRecord[] {
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.skillId !== undefined) {
    conditions.push('skill_ids LIKE ?');
    params.push(`%${filters.skillId}%`);
  }

  if (filters.decision) {
    conditions.push('decision = ?');
    params.push(filters.decision);
  }

  if (filters.hitlTriggered !== undefined) {
    conditions.push('hitl_triggered = ?');
    params.push(filters.hitlTriggered ? 1 : 0);
  }

  const limit = filters.limit || 100;

  return queryAll<ComplianceResultRecord>(
    `SELECT * FROM compliance_results
     WHERE ${conditions.join(' AND ')}
     ORDER BY validated_at DESC
     LIMIT ?`,
    [...params, limit]
  );
}

// ============ Statistics Operations ============

export interface ComplianceStats {
  totalChecks: number;
  passCount: number;
  warnCount: number;
  hitlCount: number;
  passRate: number;
  hitlRate: number;
  averageScore: number;
  commonFailures: { check: string; count: number }[];
}

/**
 * Get compliance statistics
 */
export function getComplianceStats(
  filters: {
    skillId?: number;
    from?: Date;
    to?: Date;
  } = {}
): ComplianceStats {
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.skillId !== undefined) {
    conditions.push('skill_ids LIKE ?');
    params.push(`%${filters.skillId}%`);
  }

  if (filters.from) {
    conditions.push('validated_at >= ?');
    params.push(filters.from.toISOString());
  }

  if (filters.to) {
    conditions.push('validated_at <= ?');
    params.push(filters.to.toISOString());
  }

  const whereClause = conditions.join(' AND ');

  // Get counts
  const counts = queryOne<{
    total: number;
    pass_count: number;
    warn_count: number;
    hitl_count: number;
    avg_score: number;
  }>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN decision = 'pass' THEN 1 ELSE 0 END) as pass_count,
      SUM(CASE WHEN decision = 'warn' THEN 1 ELSE 0 END) as warn_count,
      SUM(CASE WHEN decision = 'hitl' THEN 1 ELSE 0 END) as hitl_count,
      AVG(overall_score) as avg_score
     FROM compliance_results
     WHERE ${whereClause}`,
    params
  );

  // Get common failures
  const failureRows = queryAll<ComplianceResultRecord>(
    `SELECT failed_checks FROM compliance_results
     WHERE ${whereClause} AND failed_checks IS NOT NULL
     ORDER BY validated_at DESC
     LIMIT 100`,
    params
  );

  // Aggregate failure counts
  const failureCounts: Record<string, number> = {};
  for (const row of failureRows) {
    if (row.failed_checks) {
      try {
        const checks = JSON.parse(row.failed_checks) as string[];
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

  const total = counts?.total || 0;
  const passCount = counts?.pass_count || 0;
  const hitlCount = counts?.hitl_count || 0;

  return {
    totalChecks: total,
    passCount: passCount,
    warnCount: counts?.warn_count || 0,
    hitlCount: hitlCount,
    passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
    hitlRate: total > 0 ? Math.round((hitlCount / total) * 100) : 0,
    averageScore: counts?.avg_score ? Math.round(counts.avg_score) : 0,
    commonFailures,
  };
}

// ============ Cleanup Operations ============

/**
 * Delete old compliance results (for data retention)
 */
export function deleteOldComplianceResults(
  olderThanDays: number
): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = execute(
    'DELETE FROM compliance_results WHERE validated_at < ?',
    [cutoffDate.toISOString()]
  );

  return result.changes;
}
