/**
 * Swarm Control API
 *
 * GET  - Fetch the global kill-switch state and the force-swarm role allowlist.
 * PUT  - Update the global kill-switch and/or individual role allowlist entries.
 *
 * Phase 1 Agent System foundations (see
 * plans/agent_system_architecture___implementation_plan.md §3.5 Controls & Precedence).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getGlobalKillSwitch,
  setGlobalKillSwitch,
  getForceSwarmRoleAllowlist,
  setForceSwarmRoleAllowed,
  type SwarmRole,
} from '@/lib/db/compat';
import type { ApiError } from '@/types';

const VALID_ROLES: SwarmRole[] = ['super_admin', 'admin', 'superuser', 'user'];

interface SwarmControlResponse {
  killSwitch: {
    id: string;
    categoryId: number | null;
    swarmEnabled: boolean;
    updatedBy: string | null;
    updatedAt: string;
  };
  roleAllowlist: {
    id: string;
    role: SwarmRole;
    allowed: boolean;
  }[];
}

// GET /api/admin/swarm-control
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const [killSwitch, roleAllowlist] = await Promise.all([
      getGlobalKillSwitch(),
      getForceSwarmRoleAllowlist(),
    ]);

    return NextResponse.json<SwarmControlResponse>({
      killSwitch: {
        id: killSwitch.id,
        categoryId: killSwitch.categoryId,
        swarmEnabled: killSwitch.swarmEnabled,
        updatedBy: killSwitch.updatedBy,
        updatedAt: killSwitch.updatedAt,
      },
      roleAllowlist: roleAllowlist.map((r) => ({
        id: r.id,
        role: r.role,
        allowed: r.allowed,
      })),
    });
  } catch (error) {
    console.error('[Swarm Control] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch swarm control state',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// PUT /api/admin/swarm-control
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      swarmEnabled?: boolean;
      roleAllowlist?: { role: SwarmRole; allowed: boolean }[];
    };

    // Validate roleAllowlist entries before applying any mutation, so a bad
    // role in one entry doesn't leave the kill-switch half-updated.
    if (body.roleAllowlist) {
      if (!Array.isArray(body.roleAllowlist)) {
        return NextResponse.json<ApiError>(
          { error: 'roleAllowlist must be an array', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }
      for (const entry of body.roleAllowlist) {
        if (!entry || typeof entry.role !== 'string' || !VALID_ROLES.includes(entry.role)) {
          return NextResponse.json<ApiError>(
            {
              error: `role must be one of: ${VALID_ROLES.join(', ')}`,
              code: 'VALIDATION_ERROR',
            },
            { status: 400 }
          );
        }
        if (typeof entry.allowed !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'allowed must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }
      }
    }

    const updatedBy = user.email || user.id || 'admin';

    if (typeof body.swarmEnabled === 'boolean') {
      await setGlobalKillSwitch(body.swarmEnabled, updatedBy);
    }

    if (body.roleAllowlist) {
      await Promise.all(
        body.roleAllowlist.map((entry) =>
          setForceSwarmRoleAllowed(entry.role, entry.allowed)
        )
      );
    }

    // Re-read the resulting state so the response reflects the new DB rows.
    const [killSwitch, roleAllowlist] = await Promise.all([
      getGlobalKillSwitch(),
      getForceSwarmRoleAllowlist(),
    ]);

    return NextResponse.json<SwarmControlResponse>({
      killSwitch: {
        id: killSwitch.id,
        categoryId: killSwitch.categoryId,
        swarmEnabled: killSwitch.swarmEnabled,
        updatedBy: killSwitch.updatedBy,
        updatedAt: killSwitch.updatedAt,
      },
      roleAllowlist: roleAllowlist.map((r) => ({
        id: r.id,
        role: r.role,
        allowed: r.allowed,
      })),
    });
  } catch (error) {
    console.error('[Swarm Control] PUT error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update swarm control state',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
