/**
 * Share Thread Tool
 *
 * Provides thread sharing functionality with:
 * - Copy-link sharing for authenticated users
 * - Optional email notification via send_email tool
 * - Admin-configurable settings (expiry, downloads, roles, rate limits)
 *
 * Configuration is managed through the Tools admin UI.
 */

import { getToolConfig, isToolEnabled } from '../db/compat/tool-config';
import {
  createThreadShare,
  getThreadShares,
  countActiveThreadShares,
  countUserSharesInLastHour,
  revokeShare,
  updateShare,
  getShareById,
  validateShareAccess,
} from '@/lib/db/compat';
import type { ToolDefinition, ValidationResult } from '../tools';
import type { ShareThreadToolConfig, ThreadShare } from '@/types';

// ============ Tool Configuration ============

/**
 * Get share_thread tool configuration from database
 */
export async function getShareThreadConfig(): Promise<{ enabled: boolean; config: ShareThreadToolConfig }> {
  const toolConfig = await getToolConfig('share_thread');
  if (toolConfig) {
    const config = toolConfig.config as Record<string, unknown>;
    return {
      enabled: toolConfig.isEnabled,
      config: {
        defaultExpiryDays: (config.defaultExpiryDays as number) ?? 7,
        allowDownloadsByDefault: config.allowDownloadsByDefault !== false,
        allowedRoles: (config.allowedRoles as ('admin' | 'superuser' | 'user')[]) ?? ['admin', 'superuser', 'user'],
        maxSharesPerThread: (config.maxSharesPerThread as number) ?? 10,
        rateLimitPerHour: (config.rateLimitPerHour as number) ?? 20,
      },
    };
  }
  return {
    enabled: false,
    config: {
      defaultExpiryDays: 7,
      allowDownloadsByDefault: true,
      allowedRoles: ['admin', 'superuser', 'user'],
      maxSharesPerThread: 10,
      rateLimitPerHour: 20,
    },
  };
}

/**
 * Check if a user role can create shares
 */
export async function canRoleShare(role: string): Promise<boolean> {
  const { enabled, config } = await getShareThreadConfig();
  if (!enabled) return false;
  return config.allowedRoles.includes(role as 'admin' | 'superuser' | 'user');
}

/**
 * Check rate limit for share creation
 */
export async function checkShareRateLimit(userId: number): Promise<{ allowed: boolean; message?: string }> {
  const { config } = await getShareThreadConfig();
  const recentCount = await countUserSharesInLastHour(userId);

  if (recentCount >= config.rateLimitPerHour) {
    return {
      allowed: false,
      message: `Rate limit exceeded. You can create ${config.rateLimitPerHour} shares per hour. Please try again later.`,
    };
  }

  return { allowed: true };
}

/**
 * Check if thread has reached max shares
 */
export async function checkMaxSharesPerThread(threadId: string): Promise<{ allowed: boolean; message?: string }> {
  const { config } = await getShareThreadConfig();
  const activeCount = await countActiveThreadShares(threadId);

  if (activeCount >= config.maxSharesPerThread) {
    return {
      allowed: false,
      message: `Maximum shares reached (${config.maxSharesPerThread}). Please revoke an existing share first.`,
    };
  }

  return { allowed: true };
}

// ============ Share Operations ============

export interface CreateShareOptions {
  threadId: string;
  createdBy: number;
  allowDownload?: boolean;
  expiresInDays?: number | null;
}

/**
 * Create a new share with validation
 */
export async function createShare(options: CreateShareOptions): Promise<{
  success: boolean;
  share?: ThreadShare;
  error?: string;
}> {
  const { threadId, createdBy, allowDownload, expiresInDays } = options;
  const { config } = await getShareThreadConfig();

  // Check rate limit
  const rateCheck = await checkShareRateLimit(createdBy);
  if (!rateCheck.allowed) {
    return { success: false, error: rateCheck.message };
  }

  // Check max shares per thread
  const maxCheck = await checkMaxSharesPerThread(threadId);
  if (!maxCheck.allowed) {
    return { success: false, error: maxCheck.message };
  }

  try {
    const share = await createThreadShare(threadId, createdBy, {
      allowDownload: allowDownload ?? config.allowDownloadsByDefault,
      expiresInDays: expiresInDays ?? config.defaultExpiryDays,
    });

    return { success: true, share };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create share',
    };
  }
}

/**
 * Get shares for a thread with active status
 */
export async function getSharesForThread(threadId: string): Promise<ThreadShare[]> {
  return getThreadShares(threadId);
}

/**
 * Revoke a share by ID
 */
export async function revokeShareById(shareId: string): Promise<boolean> {
  return revokeShare(shareId);
}

/**
 * Update share settings
 */
export async function updateShareSettings(
  shareId: string,
  updates: { allowDownload?: boolean; expiresInDays?: number | null }
): Promise<ThreadShare | undefined> {
  return updateShare(shareId, updates);
}

/**
 * Get share by ID (re-export for convenience)
 */
export { getShareById, validateShareAccess };

/**
 * Check if send_email tool is available for email notifications
 */
export async function isSendEmailAvailable(): Promise<boolean> {
  return await isToolEnabled('send_email');
}

// ============ Tool Definition ============

/**
 * Share Thread tool definition
 * Category: processor (user-initiated, not LLM-autonomous)
 */
export const shareThreadTool: ToolDefinition = {
  name: 'share_thread',
  displayName: 'Share Thread',
  description: 'Share conversation threads with other registered users via copy-link or optional email notification.',
  category: 'processor',

  // No OpenAI function definition - this is user-initiated, not LLM-triggered
  definition: undefined,

  // Execute function (not used for processor tools)
  execute: async () => {
    return JSON.stringify({
      error: 'share_thread is a processor tool and should not be executed via LLM',
      errorCode: 'NOT_AUTONOMOUS',
    });
  },

  // Validate configuration
  validateConfig: (config: Record<string, unknown>): ValidationResult => {
    const errors: string[] = [];

    // Validate defaultExpiryDays
    if (config.defaultExpiryDays !== undefined && config.defaultExpiryDays !== null) {
      const days = config.defaultExpiryDays as number;
      if (typeof days !== 'number' || days < 1 || days > 365) {
        errors.push('defaultExpiryDays must be between 1 and 365');
      }
    }

    // Validate allowedRoles
    if (config.allowedRoles) {
      const roles = config.allowedRoles as string[];
      const validRoles = ['admin', 'superuser', 'user'];
      for (const role of roles) {
        if (!validRoles.includes(role)) {
          errors.push(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`);
        }
      }
    }

    // Validate maxSharesPerThread
    if (config.maxSharesPerThread !== undefined) {
      const max = config.maxSharesPerThread as number;
      if (typeof max !== 'number' || max < 1 || max > 100) {
        errors.push('maxSharesPerThread must be between 1 and 100');
      }
    }

    // Validate rateLimitPerHour
    if (config.rateLimitPerHour !== undefined) {
      const limit = config.rateLimitPerHour as number;
      if (typeof limit !== 'number' || limit < 1 || limit > 1000) {
        errors.push('rateLimitPerHour must be between 1 and 1000');
      }
    }

    return { valid: errors.length === 0, errors };
  },

  // Default configuration
  defaultConfig: {
    defaultExpiryDays: 7,
    allowDownloadsByDefault: true,
    allowedRoles: ['admin', 'superuser', 'user'],
    maxSharesPerThread: 10,
    rateLimitPerHour: 20,
  },

  // JSON Schema for admin UI
  configSchema: {
    type: 'object',
    properties: {
      defaultExpiryDays: {
        type: 'number',
        title: 'Default Expiry (Days)',
        description: 'Number of days until shares expire by default. Set to 0 for never expires.',
        minimum: 0,
        maximum: 365,
        default: 7,
      },
      allowDownloadsByDefault: {
        type: 'boolean',
        title: 'Allow Downloads by Default',
        description: 'Whether new shares allow downloading attachments and documents by default.',
        default: true,
      },
      allowedRoles: {
        type: 'array',
        title: 'Allowed Roles',
        description: 'User roles that can create thread shares.',
        items: {
          type: 'string',
          enum: ['admin', 'superuser', 'user'],
        },
        default: ['admin', 'superuser', 'user'],
      },
      maxSharesPerThread: {
        type: 'number',
        title: 'Max Shares per Thread',
        description: 'Maximum number of active shares allowed per thread.',
        minimum: 1,
        maximum: 100,
        default: 10,
      },
      rateLimitPerHour: {
        type: 'number',
        title: 'Rate Limit (per hour)',
        description: 'Maximum number of shares a user can create per hour.',
        minimum: 1,
        maximum: 1000,
        default: 20,
      },
    },
  },
};
