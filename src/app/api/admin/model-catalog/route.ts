/**
 * Model Catalog API
 *
 * GET /api/admin/model-catalog?provider=X
 *   List catalog entries with status, capabilities, pricing.
 *   Optional ?provider=X filters to a single provider.
 *   Optional ?status=new|active|retired filters by catalog status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb, sql } from '@/lib/db/kysely';
import type { ApiError } from '@/types';

interface CatalogEntry {
  id: string;
  providerId: string;
  transportModelId: string;
  capabilities: Record<string, boolean> | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputCostPer1M: number | null;
  outputCostPer1M: number | null;
  capabilityTier: string;
  capabilityScores: unknown;
  snapshotHash: string | null;
  status: 'new' | 'active' | 'retired';
  pendingChanges: boolean;
  replacedBy: string | null;
  catalogSource: string | null;
  catalogSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Deployment info (null if no deployment row)
  deploymentEnabled: boolean | null;
  deploymentIsDefault: boolean | null;
  deploymentSortOrder: number | null;
}

// GET /api/admin/model-catalog
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    const status = searchParams.get('status');

    // Build WHERE conditions safely (parameterised via sql.raw for structure,
    // values interpolated with simple escaping — provider/status are from
    // query params, not user free-text, and we single-quote-escape them)
    const conditions: string[] = [];
    if (provider) {
      conditions.push(`mc.provider_id = '${provider.replace(/'/g, "''")}'`);
    }
    if (status) {
      const validStatuses = ['new', 'active', 'retired'];
      if (validStatuses.includes(status)) {
        conditions.push(`mc.status = '${status}'`);
      }
    }

    const whereClause = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    const orderBy = ` ORDER BY mc.provider_id, mc.capability_tier, mc.id`;

    const db = await getDb();
    const result = await sql<{
      id: string;
      provider_id: string;
      transport_model_id: string;
      capabilities: unknown;
      max_input_tokens: number | null;
      max_output_tokens: number | null;
      input_cost_per_1m: number | null;
      output_cost_per_1m: number | null;
      capability_tier: string;
      capability_scores: unknown;
      snapshot_hash: string | null;
      status: string;
      pending_changes: boolean;
      replaced_by: string | null;
      catalog_source: string | null;
      catalog_seen_at: string | null;
      created_at: string;
      updated_at: string;
      od_enabled: boolean | null;
      od_is_default: boolean | null;
      od_sort_order: number | null;
    }>`
      SELECT
        mc.id, mc.provider_id, mc.transport_model_id, mc.capabilities,
        mc.max_input_tokens, mc.max_output_tokens,
        mc.input_cost_per_1m, mc.output_cost_per_1m,
        mc.capability_tier, mc.capability_scores,
        mc.snapshot_hash, mc.status, mc.pending_changes,
        mc.replaced_by, mc.catalog_source, mc.catalog_seen_at,
        mc.created_at, mc.updated_at,
        od.enabled AS od_enabled,
        od.is_default_for_capability AS od_is_default,
        od.sort_order AS od_sort_order
      FROM model_catalog mc
      LEFT JOIN organization_deployment od
        ON od.catalog_id = mc.id AND od.org_id IS NULL
      WHERE 1=1${sql.raw(whereClause)}${sql.raw(orderBy)}
    `.execute(db);

    const entries: CatalogEntry[] = result.rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      transportModelId: row.transport_model_id,
      capabilities: row.capabilities as Record<string, boolean> | null,
      maxInputTokens: row.max_input_tokens,
      maxOutputTokens: row.max_output_tokens,
      inputCostPer1M: row.input_cost_per_1m == null ? null : Number(row.input_cost_per_1m),
      outputCostPer1M: row.output_cost_per_1m == null ? null : Number(row.output_cost_per_1m),
      capabilityTier: row.capability_tier || 'unclassified',
      capabilityScores: row.capability_scores,
      snapshotHash: row.snapshot_hash,
      status: row.status as 'new' | 'active' | 'retired',
      pendingChanges: row.pending_changes,
      replacedBy: row.replaced_by,
      catalogSource: row.catalog_source,
      catalogSeenAt: row.catalog_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deploymentEnabled: row.od_enabled,
      deploymentIsDefault: row.od_is_default,
      deploymentSortOrder: row.od_sort_order,
    }));

    return NextResponse.json({ catalog: entries });
  } catch (error) {
    console.error('[Model Catalog] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch model catalog',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
