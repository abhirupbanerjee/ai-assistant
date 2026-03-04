/**
 * Admin Tool Routing API - List and create routing rules
 *
 * GET  /api/admin/tool-routing - List all routing rules
 * POST /api/admin/tool-routing - Create a new routing rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAllRoutingRules,
  createRoutingRule,
  seedDefaultRoutingRules,
  hasRoutingRules,
} from '@/lib/db/compat';
import type { ToolRoutingRuleInput } from '@/types/tool-routing';

/**
 * GET /api/admin/tool-routing
 * List all routing rules
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Seed default rules if none exist
    if (!(await hasRoutingRules())) {
      await seedDefaultRoutingRules(user.email);
    }

    const rules = await getAllRoutingRules();

    return NextResponse.json({
      rules,
      count: rules.length,
    });
  } catch (error) {
    console.error('Failed to fetch routing rules:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routing rules' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/tool-routing
 * Create a new routing rule
 *
 * Request body: ToolRoutingRuleInput
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();

    // Validate required fields
    const { toolName, ruleName, ruleType, patterns } = body as ToolRoutingRuleInput;

    if (!toolName || typeof toolName !== 'string') {
      return NextResponse.json(
        { error: 'toolName is required and must be a string' },
        { status: 400 }
      );
    }

    if (!ruleName || typeof ruleName !== 'string') {
      return NextResponse.json(
        { error: 'ruleName is required and must be a string' },
        { status: 400 }
      );
    }

    if (!ruleType || !['keyword', 'regex'].includes(ruleType)) {
      return NextResponse.json(
        { error: 'ruleType must be "keyword" or "regex"' },
        { status: 400 }
      );
    }

    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
      return NextResponse.json(
        { error: 'patterns must be a non-empty array of strings' },
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

    // Validate regex patterns
    if (ruleType === 'regex') {
      for (const pattern of patterns) {
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

    const rule = createRoutingRule(body as ToolRoutingRuleInput, user.email);

    return NextResponse.json({
      success: true,
      rule,
    });
  } catch (error) {
    console.error('Failed to create routing rule:', error);
    return NextResponse.json(
      { error: 'Failed to create routing rule' },
      { status: 500 }
    );
  }
}
