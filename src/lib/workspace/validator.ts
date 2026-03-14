/**
 * Workspace Request Validation
 *
 * Validates workspace requests for both embed and standalone modes.
 * Handles domain validation, access control, and feature enablement checks.
 */

import { getWorkspaceBySlug, canUserAccessWorkspace, validateDomain as checkDomain } from '../db/compat/workspaces';
import { getSetting } from '../db/compat/config';
import { getDefaultModel } from '../db/compat/enabled-models';
import type { Workspace, WorkspaceValidationResult } from '@/types/workspace';

// ============================================================================
// Feature Toggle
// ============================================================================

/**
 * Check if the workspaces feature is enabled globally
 */
export async function isWorkspacesFeatureEnabled(): Promise<boolean> {
  try {
    const settings = await getSetting<{ enabled: boolean }>('workspaces-settings');
    return settings?.enabled !== false; // Default to enabled if not set
  } catch {
    return true; // Default to enabled
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a workspace request
 *
 * @param slug - The workspace slug from URL
 * @param options - Validation options
 * @returns Validation result with workspace if valid
 */
export async function validateWorkspaceRequest(
  slug: string,
  options: {
    origin?: string; // For embed domain validation
    userId?: number; // For standalone access control
    checkEnabled?: boolean; // Check if workspace is enabled
  } = {}
): Promise<WorkspaceValidationResult> {
  const { origin, userId, checkEnabled = true } = options;

  // Check if feature is enabled globally
  if (!(await isWorkspacesFeatureEnabled())) {
    return {
      valid: false,
      error: 'Workspaces feature is disabled',
      errorCode: 'FEATURE_DISABLED',
    };
  }

  // Validate slug format (16-char alphanumeric)
  if (!isValidSlug(slug)) {
    return {
      valid: false,
      error: 'Invalid workspace URL',
      errorCode: 'NOT_FOUND',
    };
  }

  // Get workspace
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) {
    return {
      valid: false,
      error: 'Workspace not found',
      errorCode: 'NOT_FOUND',
    };
  }

  // Check if workspace is enabled
  if (checkEnabled && !workspace.is_enabled) {
    return {
      valid: false,
      error: 'Workspace is disabled',
      errorCode: 'DISABLED',
    };
  }

  // For embed mode: validate domain if provided
  if (workspace.type === 'embed' && origin) {
    // Skip validation for hosted embed (same origin as app)
    let isHostedEmbed = false;
    try {
      const appOrigin = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const appHostname = new URL(appOrigin).hostname;
      const requestHostname = new URL(origin).hostname;
      isHostedEmbed = appHostname === requestHostname;
    } catch {
      // If URL parsing fails, proceed with validation
    }

    if (!isHostedEmbed && !(await validateDomain(workspace, origin))) {
      return {
        valid: false,
        workspace,
        error: 'Domain not allowed',
        errorCode: 'DOMAIN_NOT_ALLOWED',
      };
    }
  }

  // For standalone mode with explicit access mode: check user access
  // For category-based mode, we allow access but RAG queries will be scoped to user's categories
  if (workspace.type === 'standalone' && workspace.access_mode === 'explicit' && userId !== undefined) {
    if (!(await canUserAccessWorkspace(userId, workspace.id))) {
      return {
        valid: false,
        workspace,
        error: 'Access denied',
        errorCode: 'ACCESS_DENIED',
      };
    }
  }

  return {
    valid: true,
    workspace,
  };
}

/**
 * Validate workspace slug format
 * Must be 16 characters, lowercase alphanumeric
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]{16}$/.test(slug);
}

/**
 * Validate domain for embed workspace
 */
export async function validateDomain(workspace: Workspace, origin: string): Promise<boolean> {
  return checkDomain(workspace.id, origin);
}

// ============================================================================
// Session Validation
// ============================================================================

/**
 * Validate session for a workspace request
 */
export function validateSessionForWorkspace(
  sessionWorkspaceId: string,
  workspaceId: string
): boolean {
  return sessionWorkspaceId === workspaceId;
}

/**
 * Extract and validate origin from request headers
 */
export function extractOrigin(headers: Headers): string | null {
  const origin = headers.get('origin');
  const referer = headers.get('referer');

  if (origin) return origin;

  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      return null;
    }
  }

  return null;
}

// ============================================================================
// IP Hashing
// ============================================================================

/**
 * Hash IP address for rate limiting and analytics
 * Uses a simple hash for privacy while maintaining uniqueness
 */
export function hashIP(ip: string): string {
  // Simple hash function for IP privacy
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract IP from request headers
 */
export function extractIP(headers: Headers): string {
  // Check common proxy headers
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP (original client)
    return forwardedFor.split(',')[0].trim();
  }

  const realIP = headers.get('x-real-ip');
  if (realIP) return realIP;

  // Cloudflare
  const cfConnectingIP = headers.get('cf-connecting-ip');
  if (cfConnectingIP) return cfConnectingIP;

  return '127.0.0.1'; // Fallback
}

// ============================================================================
// Workspace Configuration Helpers
// ============================================================================

/**
 * Get workspace configuration for client (safe to expose)
 */
export function getWorkspaceClientConfig(workspace: Workspace): {
  id: string;
  slug: string;
  name: string;
  type: string;
  primary_color: string;
  logo_url: string | null;
  chat_title: string | null;
  greeting_message: string;
  suggested_prompts: string[] | null;
  footer_text: string | null;
  voice_enabled: boolean;
  file_upload_enabled: boolean;
  max_file_size_mb: number;
} {
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    type: workspace.type,
    primary_color: workspace.primary_color,
    logo_url: workspace.logo_url,
    chat_title: workspace.chat_title,
    greeting_message: workspace.greeting_message,
    suggested_prompts: workspace.suggested_prompts,
    footer_text: workspace.footer_text,
    voice_enabled: workspace.voice_enabled,
    file_upload_enabled: workspace.file_upload_enabled,
    max_file_size_mb: workspace.max_file_size_mb,
  };
}

/**
 * Get LLM configuration for a workspace
 * Falls back to global settings if not overridden
 */
export async function getWorkspaceLLMConfig(workspace: Workspace): Promise<{
  provider: string;
  model: string;
  temperature: number;
}> {
  const globalSettings = await getSetting<{
    model: string;
    temperature: number;
  }>('llm-settings');

  // Resolve model: workspace override > llm-settings > enabled_models default > fallback
  let model = workspace.llm_model || globalSettings?.model;
  if (!model) {
    const defaultModel = await getDefaultModel();
    model = defaultModel?.id || 'gpt-4o-mini';
  }

  return {
    provider: workspace.llm_provider || 'openai',
    model,
    temperature: workspace.temperature ?? globalSettings?.temperature ?? 0.3,
  };
}

/**
 * Embed mode system prompt addition
 * Tells LLM to not use image/chart/document generation tools
 * and to avoid Mermaid diagrams (use structured lists instead)
 */
const EMBED_MODE_SYSTEM_PROMPT = `
IMPORTANT: This is an embedded chat widget with TEXT-ONLY output.
- Do NOT use image generation, chart generation, or document generation tools.
- Do NOT generate Mermaid diagrams (flowcharts, mindmaps, sequence diagrams, etc.) - they cannot be rendered.
- If the user requests images, charts, infographics, Word documents, PDFs, or similar generated content, politely inform them:
  "This feature is not available in embed mode. Please contact the administrator for access to the full-featured chat."
- You CAN and SHOULD use: web search, text formatting (tables, lists, code blocks), markdown formatting.
- For data visualization requests, provide formatted markdown tables or structured lists instead of charts.
- For mindmaps or hierarchical concepts, use nested bullet lists instead of diagram syntax:
  - Main Topic
    - Subtopic 1
      - Detail 1.1
      - Detail 1.2
    - Subtopic 2
      - Detail 2.1
`;

/**
 * Get system prompt for a workspace
 * Combines workspace-specific prompt with global default
 * For embed mode, adds restrictions about unavailable features
 */
export async function getWorkspaceSystemPrompt(workspace: Workspace): Promise<string> {
  const globalPrompt = (await getSetting<{ content: string }>('system-prompt'))?.content || '';

  let prompt = globalPrompt;

  // For embed mode, add restrictions about unavailable features
  if (workspace.type === 'embed') {
    prompt = `${EMBED_MODE_SYSTEM_PROMPT}\n\n${prompt}`;
  }

  if (workspace.system_prompt) {
    // Prepend workspace-specific instructions
    prompt = `${workspace.system_prompt}\n\n${prompt}`;
  }

  return prompt;
}
