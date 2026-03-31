/**
 * Workspace Types
 *
 * Type definitions for the dual-mode workspace feature:
 * - Embed: Lightweight chat widget for external websites
 * - Standalone: Full-featured chat with threads and history
 */

// ============================================================================
// Core Types
// ============================================================================

export type WorkspaceType = 'embed' | 'standalone';
export type AccessMode = 'category' | 'explicit';
export type CreatorRole = 'admin' | 'superuser';

// ============================================================================
// Workspace
// ============================================================================

export interface Workspace {
  id: string;
  slug: string; // Random 16-char URL path
  name: string;
  type: WorkspaceType;
  is_enabled: boolean;

  // Access control (standalone only)
  access_mode: AccessMode;

  // Branding
  primary_color: string;
  logo_url: string | null;
  chat_title: string | null;
  greeting_message: string;
  suggested_prompts: string[] | null;
  footer_text: string | null;

  // LLM overrides (null = use global settings)
  llm_provider: string | null;
  llm_model: string | null;
  temperature: number | null;
  system_prompt: string | null;

  // Embed-specific settings
  allowed_domains: string[];
  daily_limit: number;
  session_limit: number;

  // Feature toggles
  voice_enabled: boolean;
  file_upload_enabled: boolean;
  max_file_size_mb: number;
  web_search_enabled: boolean;

  // Authentication (embed only)
  auth_required: boolean;

  // Ownership & timestamps
  created_by: string;
  created_by_role: CreatorRole;
  created_at: string;
  updated_at: string;
}

// Extended workspace with related data
export interface WorkspaceWithRelations extends Workspace {
  category_ids: number[];
  category_names?: string[];
  user_count?: number;
  session_count?: number;
  message_count?: number;
}

// ============================================================================
// Workspace Users (for explicit access mode)
// ============================================================================

export interface WorkspaceUser {
  workspace_id: string;
  user_id: number;
  user_email: string;
  user_name: string | null;
  added_by: string;
  added_at: string;
}

// ============================================================================
// Workspace Sessions
// ============================================================================

export interface WorkspaceSession {
  id: string;
  workspace_id: string;
  visitor_id: string | null;
  user_id: number | null;
  referrer_url: string | null;
  ip_hash: string | null;
  message_count: number;
  started_at: string;
  last_activity: string;
  expires_at: string | null;
}

// ============================================================================
// Workspace Threads (standalone only)
// ============================================================================

export interface WorkspaceThread {
  id: string;
  workspace_id: string;
  session_id: string;
  title: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceThreadWithMessages extends WorkspaceThread {
  messages: WorkspaceMessage[];
  message_count: number;
}

// ============================================================================
// Workspace Messages
// ============================================================================

export interface WorkspaceMessage {
  id: string;
  workspace_id: string;
  session_id: string;
  thread_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  sources_json: string | null;
  latency_ms: number | null;
  tokens_used: number | null;
  model: string | null;
  created_at: string;
}

export interface WorkspaceMessageSource {
  document_name: string;
  page_number: number;
  chunk_text: string;
  score: number;
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface WorkspaceRateLimit {
  id: number;
  workspace_id: string;
  ip_hash: string;
  window_start: string;
  request_count: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
  daily_used: number;
  daily_limit: number;
  session_used: number;
  session_limit: number;
}

// ============================================================================
// Analytics
// ============================================================================

export interface WorkspaceAnalytics {
  id: number;
  workspace_id: string;
  date: string;
  sessions_count: number;
  messages_count: number;
  unique_visitors: number;
  avg_response_time_ms: number | null;
  total_tokens_used: number;
}

export interface WorkspaceAnalyticsSummary {
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  unique_visitors: number;
  avg_response_time_ms: number;
  daily_breakdown: WorkspaceAnalytics[];
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateWorkspaceInput {
  name: string;
  type: WorkspaceType;
  category_ids: number[];

  // Optional branding
  primary_color?: string;
  logo_url?: string;
  chat_title?: string;
  greeting_message?: string;
  suggested_prompts?: string[];
  footer_text?: string;

  // Optional LLM overrides
  llm_provider?: string;
  llm_model?: string;
  temperature?: number;
  system_prompt?: string;

  // Embed-specific
  allowed_domains?: string[];
  daily_limit?: number;
  session_limit?: number;

  // Features
  voice_enabled?: boolean;
  file_upload_enabled?: boolean;
  max_file_size_mb?: number;
  web_search_enabled?: boolean;

  // Authentication (embed only)
  auth_required?: boolean;

  // Standalone-specific
  access_mode?: AccessMode;
}

export interface UpdateWorkspaceInput {
  name?: string;
  is_enabled?: boolean;

  // Branding
  primary_color?: string;
  logo_url?: string | null;
  chat_title?: string | null;
  greeting_message?: string;
  suggested_prompts?: string[] | null;
  footer_text?: string | null;

  // LLM overrides
  llm_provider?: string | null;
  llm_model?: string | null;
  temperature?: number | null;
  system_prompt?: string | null;

  // Embed-specific
  allowed_domains?: string[];
  daily_limit?: number;
  session_limit?: number;

  // Features
  voice_enabled?: boolean;
  file_upload_enabled?: boolean;
  max_file_size_mb?: number;
  web_search_enabled?: boolean;

  // Authentication (embed only)
  auth_required?: boolean;

  // Standalone-specific
  access_mode?: AccessMode;
  category_ids?: number[];
}

export interface CreateWorkspaceThreadInput {
  title?: string;
}

export interface UpdateWorkspaceThreadInput {
  title?: string;
  is_archived?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface WorkspaceClientConfig {
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
}

export interface WorkspaceLLMConfig {
  provider: string;
  model: string;
  temperature: number;
}

export interface WorkspaceInitResponse {
  sessionId: string;
  workspaceId: string;
  type: WorkspaceType;
  config: WorkspaceClientConfig;
  llmConfig: WorkspaceLLMConfig;
  // For embed mode
  rateLimit?: {
    remaining: number;
    daily_used: number;
    daily_limit: number;
    session_limit: number;
    resetAt: string | null;
  };
  // For standalone mode
  user?: {
    id: number;
    email: string;
    name: string;
  };
  activeThreadId?: string | null;
}

export interface WorkspaceChatRequest {
  sessionId: string;
  threadId?: string; // null for embed mode
  message: string;
  files?: File[];
}

export interface WorkspaceChatStreamEvent {
  type: 'text' | 'sources' | 'done' | 'error';
  content?: string;
  sources?: WorkspaceMessageSource[];
  messageId?: string;
  error?: string;
}

// ============================================================================
// Validation Types
// ============================================================================

export interface WorkspaceValidationResult {
  valid: boolean;
  workspace?: Workspace;
  error?: string;
  errorCode?: 'NOT_FOUND' | 'DISABLED' | 'DOMAIN_NOT_ALLOWED' | 'ACCESS_DENIED' | 'RATE_LIMITED' | 'FEATURE_DISABLED';
}

// ============================================================================
// Database Row Types (raw from SQLite)
// ============================================================================

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  is_enabled: number;
  access_mode: string;
  primary_color: string;
  logo_url: string | null;
  chat_title: string | null;
  greeting_message: string;
  suggested_prompts: string | null;
  footer_text: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  temperature: number | null;
  system_prompt: string | null;
  allowed_domains: string;
  daily_limit: number;
  session_limit: number;
  voice_enabled: number;
  file_upload_enabled: number;
  max_file_size_mb: number;
  web_search_enabled: number;
  auth_required: number;
  created_by: string;
  created_by_role: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSessionRow {
  id: string;
  workspace_id: string;
  visitor_id: string | null;
  user_id: number | null;
  referrer_url: string | null;
  ip_hash: string | null;
  message_count: number;
  started_at: string;
  last_activity: string;
  expires_at: string | null;
}

export interface WorkspaceThreadRow {
  id: string;
  workspace_id: string;
  session_id: string;
  title: string;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMessageRow {
  id: string;
  workspace_id: string;
  session_id: string;
  thread_id: string | null;
  role: string;
  content: string;
  sources_json: string | null;
  latency_ms: number | null;
  tokens_used: number | null;
  model: string | null;
  created_at: string;
}
