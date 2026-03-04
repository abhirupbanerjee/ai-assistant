/**
 * Workspace Init API
 *
 * Initializes a session for workspace access (both embed and standalone modes).
 * - For embed: Creates ephemeral session with rate limiting
 * - For standalone: Creates or retrieves persistent user session
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/compat';
import {
  validateWorkspaceRequest,
  extractOrigin,
  extractIP,
  hashIP,
  getWorkspaceClientConfig,
  getWorkspaceLLMConfig,
} from '@/lib/workspace/validator';
import {
  createSession,
  getOrCreateUserSession,
  updateSessionActivity,
  getLatestThread,
} from '@/lib/db/compat';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/workspace/rate-limiter';
import type { WorkspaceInitResponse } from '@/types/workspace';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * POST /api/w/[slug]/init
 *
 * Initialize a workspace session.
 *
 * For embed mode:
 * - Validates domain (Origin header)
 * - Creates ephemeral session with 24h expiry
 * - Applies rate limiting
 *
 * For standalone mode:
 * - Checks user authentication (optional)
 * - Validates user has access to workspace categories
 * - Creates or retrieves persistent session
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const origin = extractOrigin(request.headers);
    const ip = extractIP(request.headers);
    const ipHash = hashIP(ip);

    // Parse request body for optional visitor ID
    let visitorId: string | undefined;
    let referrerUrl: string | undefined;
    try {
      const body = await request.json();
      visitorId = body.visitorId;
      referrerUrl = body.referrerUrl;
    } catch {
      // Body is optional
    }

    // Try to get authenticated user (optional for standalone)
    const authUser = await getCurrentUser();
    const dbUser = authUser ? await getUserByEmail(authUser.email) : null;

    // Validate workspace request
    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      userId: dbUser?.id,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      // Map error codes to HTTP status
      const statusMap: Record<string, number> = {
        FEATURE_DISABLED: 503,
        NOT_FOUND: 404,
        DISABLED: 403,
        DOMAIN_NOT_ALLOWED: 403,
        ACCESS_DENIED: 403,
      };
      const status = statusMap[validation.errorCode || ''] || 400;

      return NextResponse.json(
        { error: validation.error, code: validation.errorCode },
        { status }
      );
    }

    const workspace = validation.workspace;

    // Handle based on workspace type
    if (workspace.type === 'embed') {
      // Check rate limit for embed mode
      const rateLimit = await checkRateLimit(workspace.id, ipHash);

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error: 'Rate limit exceeded',
            code: 'RATE_LIMITED',
            resetAt: rateLimit.resetAt?.toISOString(),
            daily_used: rateLimit.daily_used,
            daily_limit: rateLimit.daily_limit,
          },
          {
            status: 429,
            headers: getRateLimitHeaders(rateLimit),
          }
        );
      }

      // Create ephemeral session
      const session = await createSession(workspace.id, {
        visitorId,
        referrerUrl,
        ipHash,
        expiresInHours: 24,
      });

      const response: WorkspaceInitResponse = {
        sessionId: session.id,
        workspaceId: workspace.id,
        type: 'embed',
        config: getWorkspaceClientConfig(workspace),
        llmConfig: await getWorkspaceLLMConfig(workspace),
        rateLimit: {
          remaining: rateLimit.remaining,
          daily_used: rateLimit.daily_used,
          daily_limit: rateLimit.daily_limit,
          session_limit: rateLimit.session_limit,
          resetAt: rateLimit.resetAt?.toISOString() || null,
        },
      };

      return NextResponse.json(response, {
        headers: getRateLimitHeaders(rateLimit),
      });
    } else {
      // Standalone mode
      // For standalone, user authentication is optional but recommended
      // If authenticated, check access to all workspace categories

      if (dbUser) {
        // Authenticated user - get or create their session
        const session = await getOrCreateUserSession(dbUser.id, workspace.id);
        const latestThread = await getLatestThread(session.id);

        const response: WorkspaceInitResponse = {
          sessionId: session.id,
          workspaceId: workspace.id,
          type: 'standalone',
          config: getWorkspaceClientConfig(workspace),
          llmConfig: await getWorkspaceLLMConfig(workspace),
          user: {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name || dbUser.email,
          },
          activeThreadId: latestThread?.id || null,
        };

        return NextResponse.json(response);
      } else {
        // Anonymous user for standalone - create anonymous session
        const session = await createSession(workspace.id, {
          visitorId,
          referrerUrl,
          ipHash,
          expiresInHours: 24 * 7, // 7 days for anonymous standalone
        });

        const response: WorkspaceInitResponse = {
          sessionId: session.id,
          workspaceId: workspace.id,
          type: 'standalone',
          config: getWorkspaceClientConfig(workspace),
          llmConfig: await getWorkspaceLLMConfig(workspace),
          activeThreadId: null,
        };

        return NextResponse.json(response);
      }
    }
  } catch (error) {
    console.error('Workspace init error:', error);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/w/[slug]/init
 *
 * Get workspace configuration without creating a session.
 * Useful for pre-loading workspace branding before initialization.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const origin = extractOrigin(request.headers);

    // Validate workspace (without user check)
    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      const statusMap: Record<string, number> = {
        FEATURE_DISABLED: 503,
        NOT_FOUND: 404,
        DISABLED: 403,
        DOMAIN_NOT_ALLOWED: 403,
      };
      const status = statusMap[validation.errorCode || ''] || 400;

      return NextResponse.json(
        { error: validation.error, code: validation.errorCode },
        { status }
      );
    }

    const workspace = validation.workspace;

    // Return public config only (no session creation)
    return NextResponse.json({
      workspaceId: workspace.id,
      type: workspace.type,
      config: getWorkspaceClientConfig(workspace),
    });
  } catch (error) {
    console.error('Workspace config error:', error);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
