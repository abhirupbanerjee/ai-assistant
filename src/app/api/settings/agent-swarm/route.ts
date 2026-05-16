/**
 * Public API: Agent Swarm Availability
 *
 * Returns whether agent swarm mode is available for the current user.
 * Called by chat UI on mount to gate the swarm toggle.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getAgentSwarmEnabled } from '@/lib/db/compat/agent-swarm';
import { getApiKey } from '@/lib/provider-helpers';

export async function GET() {
  try {
    const user = await getCurrentUser();
    const enabled = await getAgentSwarmEnabled();
    const moonshotKey = await getApiKey('moonshot');
    const moonshotConfigured = !!moonshotKey;

    // Only admin and superuser can use swarm
    const allowedForUser = !!user && (user.role === 'admin' || user.role === 'superuser');

    return NextResponse.json({
      enabled,
      moonshotConfigured,
      allowedForUser,
    });
  } catch (error) {
    console.error('[Agent Swarm Availability] Error:', error);
    return NextResponse.json({
      enabled: false,
      moonshotConfigured: false,
      allowedForUser: false,
    });
  }
}
