import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/kysely';
import { sql } from 'kysely';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30', 10);

    const db = await getDb();

    // Summary metrics
    const summaryResult = await db
      .selectFrom('query_logs' as any)
      .select([
        sql<number>`COUNT(*)`.as('totalQueries'),
        sql<number>`COALESCE(SUM(CASE WHEN graph_enabled = true AND graph_skipped = false THEN 1 ELSE 0 END), 0)`.as('graphHitCount'),
        sql<number>`COALESCE(SUM(CASE WHEN graph_enabled = true AND graph_skipped = true THEN 1 ELSE 0 END), 0)`.as('graphSkipCount'),
        sql<number>`COALESCE(AVG(CASE WHEN graph_enabled = true AND graph_skipped = false THEN latency_ms ELSE NULL END), 0)`.as('avgLatencyMs'),
      ])
      .where('created_at', '>', sql`NOW() - INTERVAL '${sql.raw(String(days))} days'`)
      .executeTakeFirst() as any;

    const totalQueries = Number(summaryResult?.totalQueries ?? 0);
    const graphHitCount = Number(summaryResult?.graphHitCount ?? 0);
    const graphSkipCount = Number(summaryResult?.graphSkipCount ?? 0);
    const graphEnabledCount = graphHitCount + graphSkipCount;
    const avgLatencyMs = Math.round(Number(summaryResult?.avgLatencyMs ?? 0));

    // Chunk expansion stats from retrieval_traces
    const expansionResult = await db
      .selectFrom('retrieval_traces' as any)
      .select([
        sql<number>`COUNT(*)`.as('traceCount'),
        sql<number>`COALESCE(AVG(
          JSON_ARRAY_LENGTH(COALESCE(graph_chunk_ids, '[]')::json)
        ), 0)`.as('avgChunkExpansion'),
      ])
      .where('created_at', '>', sql`NOW() - INTERVAL '${sql.raw(String(days))} days'`)
      .executeTakeFirst() as any;

    const avgChunkExpansion = Number(expansionResult?.avgChunkExpansion ?? 0).toFixed(1);

    // Multi-hop rate: traces where graph_chunk_ids contains chunks from different documents
    // Approximated by checking if graph_chunk_ids has more than 1 unique document prefix
    const multiHopResult = await db
      .selectFrom('retrieval_traces' as any)
      .select([
        sql<number>`COUNT(*)`.as('total'),
        sql<number>`COALESCE(SUM(CASE WHEN graph_chunk_ids IS NOT NULL AND graph_chunk_ids != '[]' AND graph_chunk_ids != 'null' THEN 1 ELSE 0 END), 0)`.as('withChunks'),
      ])
      .where('created_at', '>', sql`NOW() - INTERVAL '${sql.raw(String(days))} days'`)
      .executeTakeFirst() as any;

    const multiHopRate = Number(multiHopResult?.total ?? 0) > 0
      ? Number(multiHopResult?.withChunks ?? 0) / Number(multiHopResult?.total ?? 1)
      : 0;

    // Daily trend
    const trendResult = await db
      .selectFrom('query_logs' as any)
      .select([
        sql<string>`DATE(created_at)`.as('date'),
        sql<number>`COUNT(*)`.as('total'),
        sql<number>`COALESCE(SUM(CASE WHEN graph_enabled = true AND graph_skipped = false THEN 1 ELSE 0 END), 0)`.as('hits'),
        sql<number>`COALESCE(SUM(CASE WHEN graph_enabled = true AND graph_skipped = true THEN 1 ELSE 0 END), 0)`.as('skips'),
        sql<number>`COALESCE(AVG(CASE WHEN graph_enabled = true AND graph_skipped = false THEN latency_ms ELSE NULL END), 0)`.as('avgLatency'),
      ])
      .where('created_at', '>', sql`NOW() - INTERVAL '${sql.raw(String(days))} days'`)
      .groupBy(sql`DATE(created_at)`)
      .orderBy(sql`DATE(created_at)`, 'asc')
      .execute() as any[];

    const trend = trendResult.map(r => ({
      date: r.date,
      hitRate: Number(r.total) > 0 ? Number(r.hits) / Number(r.total) : 0,
      skipRate: Number(r.total) > 0 ? Number(r.skips) / Number(r.total) : 0,
      avgLatencyMs: Math.round(Number(r.avgLatency ?? 0)),
      total: Number(r.total),
      hits: Number(r.hits),
    }));

    // Top expanded entities from retrieval_traces (seed_entity_ids)
    const topEntitiesResult = await db
      .selectFrom('retrieval_traces' as any)
      .select([
        sql<string>`seed_entity_ids`.as('seedEntities'),
      ])
      .where('created_at', '>', sql`NOW() - INTERVAL '${sql.raw(String(days))} days'`)
      .limit(200)
      .execute() as any[];

    // Parse and count entity occurrences
    const entityCounts = new Map<string, number>();
    for (const row of topEntitiesResult) {
      try {
        const ids: string[] = JSON.parse(row.seedEntities || '[]');
        for (const id of ids) {
          entityCounts.set(id, (entityCounts.get(id) || 0) + 1);
        }
      } catch { /* skip malformed */ }
    }

    const topExpandedEntities = Array.from(entityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([entity, count]) => ({ entity, expansionCount: count }));

    return NextResponse.json({
      summary: {
        totalQueries,
        graphEnabledCount,
        graphHitRate: graphEnabledCount > 0 ? graphHitCount / graphEnabledCount : 0,
        skipRate: graphEnabledCount > 0 ? graphSkipCount / graphEnabledCount : 0,
        avgChunkExpansion: parseFloat(String(avgChunkExpansion)),
        avgLatencyMs,
        multiHopRate,
      },
      trend,
      topExpandedEntities,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to get performance data' },
      { status: 500 }
    );
  }
}
