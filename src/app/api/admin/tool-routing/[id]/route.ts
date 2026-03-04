/**
 * Admin Tool Routing API - Individual rule operations
 *
 * GET    /api/admin/tool-routing/[id] - Get rule by ID
 * PATCH  /api/admin/tool-routing/[id] - Update rule
 * DELETE /api/admin/tool-routing/[id] - Delete rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getRoutingRuleById,
  updateRoutingRule,
  deleteRoutingRule,
} from '@/lib/db/compat';
import type { ToolRoutingRuleInput } from '@/types/tool-routing';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/tool-routing/[id]
 * Get a routing rule by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const rule = await getRoutingRuleById(id);

    if (!rule) {
      return NextResponse.json(
        { error: 'Routing rule not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ rule });
  } catch (error) {
    console.error('Failed to fetch routing rule:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routing rule' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/tool-routing/[id]
 * Update a routing rule
 *
 * Request body: Partial<ToolRoutingRuleInput>
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // Check if rule exists
    const existing = await getRoutingRuleById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Routing rule not found' },
        { status: 404 }
      );
    }

    // Validate ruleType if provided
    if (body.ruleType && !['keyword', 'regex'].includes(body.ruleType)) {
      return NextResponse.json(
        { error: 'ruleType must be "keyword" or "regex"' },
        { status: 400 }
      );
    }

    // Validate forceMode if provided
    if (body.forceMode && !['required', 'preferred', 'suggested'].includes(body.forceMode)) {
      return NextResponse.json(
        { error: 'forceMode must be "required", "preferred", or "suggested"' },
        { status: 400 }
      );
    }

    // Validate patterns if provided
    if (body.patterns) {
      if (!Array.isArray(body.patterns) || body.patterns.length === 0) {
        return NextResponse.json(
          { error: 'patterns must be a non-empty array of strings' },
          { status: 400 }
        );
      }

      // Validate regex patterns
      const ruleType = body.ruleType || existing.ruleType;
      if (ruleType === 'regex') {
        for (const pattern of body.patterns) {
          try {
            new RegExp(pattern);
          } catch {
            return NextResponse.json(
              { error: `Invalid regex pattern: ${pattern}` },
              { status: 400 }
            );
          }
        }
      }
    }

    const updated = await updateRoutingRule(
      id,
      body as Partial<ToolRoutingRuleInput>,
      user.email
    );

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update routing rule' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      rule: updated,
    });
  } catch (error) {
    console.error('Failed to update routing rule:', error);
    return NextResponse.json(
      { error: 'Failed to update routing rule' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/tool-routing/[id]
 * Delete a routing rule
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;

    // Check if rule exists
    const existing = await getRoutingRuleById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Routing rule not found' },
        { status: 404 }
      );
    }

    const deleted = await deleteRoutingRule(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete routing rule' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Routing rule deleted',
    });
  } catch (error) {
    console.error('Failed to delete routing rule:', error);
    return NextResponse.json(
      { error: 'Failed to delete routing rule' },
      { status: 500 }
    );
  }
}
