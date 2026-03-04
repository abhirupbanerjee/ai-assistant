/**
 * Agent Bot Authentication
 *
 * Middleware for authenticating agent bot API requests:
 * - API key extraction from Authorization header
 * - Key validation (format, existence, expiration, revocation)
 * - Rate limit checking and enforcement
 * - Agent bot validation (existence, active status)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  validateApiKey,
  checkRateLimit,
  updateLastUsed,
  incrementUsage,
  getAgentBotById,
  getActiveAgentBotBySlug,
} from '@/lib/db/compat';
import type {
  AgentBot,
  AgentBotApiKey,
  AgentBotErrorCode,
  AgentBotError,
  RateLimitInfo,
} from '@/types/agent-bot';

// ============================================================================
// Types
// ============================================================================

/**
 * Authenticated context returned after successful auth
 */
export interface AuthContext {
  agentBot: AgentBot;
  apiKey: AgentBotApiKey;
  rateLimitInfo: RateLimitInfo;
}

/**
 * Result of authentication attempt
 */
export type AuthResult =
  | { success: true; context: AuthContext }
  | { success: false; error: AgentBotError; status: number };

// ============================================================================
// Constants
// ============================================================================

const BEARER_PREFIX = 'Bearer ';

// ============================================================================
// Error Helpers
// ============================================================================

/**
 * Create an agent bot error response
 */
export function agentBotError(
  error: string,
  code: AgentBotErrorCode,
  status: number,
  details?: string
): NextResponse<AgentBotError> {
  return NextResponse.json<AgentBotError>(
    { error, code, details },
    { status }
  );
}

/**
 * Common agent bot error responses
 */
export const agentBotErrors = {
  invalidApiKey: (details?: string) =>
    agentBotError('Invalid API key', 'INVALID_API_KEY', 401, details),

  apiKeyExpired: () =>
    agentBotError('API key has expired', 'API_KEY_EXPIRED', 401),

  apiKeyRevoked: () =>
    agentBotError('API key has been revoked', 'API_KEY_REVOKED', 401),

  rateLimitExceeded: (retryAfter: number, isDaily: boolean) =>
    agentBotError(
      isDaily
        ? 'Daily rate limit exceeded'
        : 'Rate limit exceeded',
      'RATE_LIMIT_EXCEEDED',
      429,
      `Retry after ${retryAfter} seconds`
    ),

  agentBotNotFound: () =>
    agentBotError('Agent bot not found', 'AGENT_BOT_NOT_FOUND', 404),

  agentBotDisabled: () =>
    agentBotError('Agent bot is disabled', 'AGENT_BOT_DISABLED', 403),

  versionNotFound: () =>
    agentBotError('Version not found', 'VERSION_NOT_FOUND', 404),

  inputValidationError: (details: string) =>
    agentBotError('Input validation failed', 'INPUT_VALIDATION_ERROR', 400, details),

  fileValidationError: (details: string) =>
    agentBotError('File validation failed', 'FILE_VALIDATION_ERROR', 400, details),

  outputTypeNotSupported: (type: string) =>
    agentBotError(
      `Output type '${type}' is not supported`,
      'OUTPUT_TYPE_NOT_SUPPORTED',
      400
    ),

  jobNotFound: () =>
    agentBotError('Job not found', 'JOB_NOT_FOUND', 404),

  processingError: (details?: string) =>
    agentBotError('Processing error', 'PROCESSING_ERROR', 500, details),
} as const;

// ============================================================================
// Rate Limit Headers
// ============================================================================

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders<T>(
  response: NextResponse<T>,
  info: RateLimitInfo
): NextResponse<T> {
  response.headers.set('X-RateLimit-Limit-Minute', info.limitMinute.toString());
  response.headers.set('X-RateLimit-Remaining-Minute', info.remainingMinute.toString());
  response.headers.set('X-RateLimit-Reset-Minute', Math.ceil(info.resetMinute.getTime() / 1000).toString());
  response.headers.set('X-RateLimit-Limit-Day', info.limitDay.toString());
  response.headers.set('X-RateLimit-Remaining-Day', info.remainingDay.toString());
  response.headers.set('X-RateLimit-Reset-Day', Math.ceil(info.resetDay.getTime() / 1000).toString());
  return response;
}

/**
 * Create rate limit error response with proper headers
 */
function createRateLimitResponse(info: RateLimitInfo, isDaily: boolean): NextResponse<AgentBotError> {
  const retryAfter = isDaily
    ? Math.ceil((info.resetDay.getTime() - Date.now()) / 1000)
    : Math.ceil((info.resetMinute.getTime() - Date.now()) / 1000);

  const response = agentBotErrors.rateLimitExceeded(retryAfter, isDaily);
  response.headers.set('Retry-After', retryAfter.toString());
  return addRateLimitHeaders(response, info);
}

// ============================================================================
// Authentication Functions
// ============================================================================

/**
 * Extract API key from request headers
 */
export function extractApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return null;
  }

  if (authHeader.startsWith(BEARER_PREFIX)) {
    return authHeader.slice(BEARER_PREFIX.length);
  }

  // Also accept raw API key (without Bearer prefix)
  if (authHeader.startsWith('ab_pk_')) {
    return authHeader;
  }

  return null;
}

/**
 * Authenticate request by slug
 * Used for public API endpoints like /api/agent-bots/[slug]/invoke
 */
export async function authenticateBySlug(
  request: NextRequest,
  slug: string
): Promise<AuthResult> {
  // Extract API key
  const apiKeyString = extractApiKey(request);
  if (!apiKeyString) {
    return {
      success: false,
      error: { error: 'API key required', code: 'INVALID_API_KEY' },
      status: 401,
    };
  }

  // Validate API key
  const keyValidation = await validateApiKey(apiKeyString);
  if (!keyValidation.valid || !keyValidation.apiKey) {
    return {
      success: false,
      error: {
        error: keyValidation.error || 'Invalid API key',
        code: (keyValidation.errorCode as AgentBotErrorCode) || 'INVALID_API_KEY',
      },
      status: 401,
    };
  }

  const apiKey = keyValidation.apiKey;

  // Get agent bot by slug
  const agentBot = await getActiveAgentBotBySlug(slug);
  if (!agentBot) {
    // Check if it exists but is disabled
    const inactive = await getAgentBotById(apiKey.agent_bot_id);
    if (inactive && inactive.slug === slug && !inactive.is_active) {
      return {
        success: false,
        error: { error: 'Agent bot is disabled', code: 'AGENT_BOT_DISABLED' },
        status: 403,
      };
    }
    return {
      success: false,
      error: { error: 'Agent bot not found', code: 'AGENT_BOT_NOT_FOUND' },
      status: 404,
    };
  }

  // Verify API key belongs to this agent bot
  if (apiKey.agent_bot_id !== agentBot.id) {
    return {
      success: false,
      error: { error: 'API key does not match agent bot', code: 'INVALID_API_KEY' },
      status: 401,
    };
  }

  // Check rate limits
  const rateLimitResult = await checkRateLimit(apiKey.id);
  if (!rateLimitResult.allowed) {
    return {
      success: false,
      error: {
        error: rateLimitResult.blockedReason === 'day'
          ? 'Daily rate limit exceeded'
          : 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        details: `Retry after ${
          rateLimitResult.blockedReason === 'day'
            ? Math.ceil((rateLimitResult.info.resetDay.getTime() - Date.now()) / 1000)
            : Math.ceil((rateLimitResult.info.resetMinute.getTime() - Date.now()) / 1000)
        } seconds`,
      },
      status: 429,
    };
  }

  // Update last used timestamp
  await updateLastUsed(apiKey.id);

  return {
    success: true,
    context: {
      agentBot,
      apiKey,
      rateLimitInfo: rateLimitResult.info,
    },
  };
}

/**
 * Authenticate request and return response or context
 * Convenience wrapper for route handlers
 */
export async function authenticateRequest(
  request: NextRequest,
  slug: string
): Promise<NextResponse<AgentBotError> | AuthContext> {
  const result = await authenticateBySlug(request, slug);

  if (!result.success) {
    const response = agentBotError(
      result.error.error,
      result.error.code,
      result.status,
      result.error.details
    );

    // Add rate limit headers if we have them (even for errors)
    if (result.status === 429) {
      // Rate limit info would be available from the check
      const keyString = extractApiKey(request);
      if (keyString) {
        const keyValidation = await validateApiKey(keyString);
        if (keyValidation.valid && keyValidation.apiKey) {
          const rateLimitResult = await checkRateLimit(keyValidation.apiKey.id);
          return createRateLimitResponse(
            rateLimitResult.info,
            rateLimitResult.blockedReason === 'day'
          );
        }
      }
    }

    return response;
  }

  return result.context;
}

/**
 * Check if result is an error response
 */
export function isAuthError(
  result: NextResponse<AgentBotError> | AuthContext
): result is NextResponse<AgentBotError> {
  return result instanceof NextResponse;
}

// ============================================================================
// Usage Tracking
// ============================================================================

/**
 * Record API usage after request completion
 */
export async function recordUsage(
  context: AuthContext,
  tokenCount: number = 0,
  isError: boolean = false
): Promise<void> {
  await incrementUsage(
    context.apiKey.id,
    context.agentBot.id,
    tokenCount,
    isError
  );
}

// ============================================================================
// Permission Checking
// ============================================================================

/**
 * Check if API key has a specific permission
 */
export function hasPermission(apiKey: AgentBotApiKey, permission: string): boolean {
  return apiKey.permissions.includes(permission);
}

/**
 * Require a specific permission, return error if not present
 */
export function requirePermission(
  apiKey: AgentBotApiKey,
  permission: string
): NextResponse<AgentBotError> | null {
  if (!hasPermission(apiKey, permission)) {
    return agentBotError(
      `API key lacks '${permission}' permission`,
      'INVALID_API_KEY',
      403
    );
  }
  return null;
}
