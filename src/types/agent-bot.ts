/**
 * Agent Bot Types
 *
 * Type definitions for API-accessible bots that can be called by external systems:
 * - Versioned configurations with input schemas and output options
 * - Per-agent API key authentication
 * - Sync and async execution modes with webhook support
 * - Integration with skills, categories, and tools
 */

// ============================================================================
// Core Types
// ============================================================================

export type CreatorRole = 'admin' | 'superuser';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type OutputType = 'text' | 'json' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'podcast' | 'md';
export type FileExtractionStatus = 'pending' | 'processing' | 'ready' | 'error';

// ============================================================================
// Agent Bot
// ============================================================================

export interface AgentBot {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_by: string;
  created_by_role: CreatorRole;
  created_at: string;
  updated_at: string;
}

export interface AgentBotWithRelations extends AgentBot {
  versions: AgentBotVersionSummary[];
  default_version_id: string | null;
  api_key_count: number;
  total_jobs: number;
}

export interface AgentBotVersionSummary {
  id: string;
  version_number: number;
  version_label: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

// ============================================================================
// Agent Bot Version
// ============================================================================

export interface AgentBotVersion {
  id: string;
  agent_bot_id: string;
  version_number: number;
  version_label: string | null;
  is_default: boolean;
  input_schema: InputSchema;
  output_config: OutputConfig;
  system_prompt: string | null;
  llm_model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AgentBotVersionWithRelations extends AgentBotVersion {
  category_ids: number[];
  category_names?: string[];
  skill_ids: number[];
  skill_names?: string[];
  tools: AgentBotVersionTool[];
}

export interface AgentBotVersionTool {
  id: string;
  version_id: string;
  tool_name: string;
  is_enabled: boolean;
  config_override: Record<string, unknown> | null;
}

// ============================================================================
// Input Schema
// ============================================================================

export interface InputSchema {
  parameters: InputParameter[];
  files: InputFileConfig;
}

export interface InputParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
  // String constraints
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  enum?: string[];
  // Number constraints
  minimum?: number;
  maximum?: number;
  // Array constraints
  items?: Omit<InputParameter, 'name' | 'required'>;
  maxItems?: number;
  minItems?: number;
  // Object constraints
  properties?: Record<string, Omit<InputParameter, 'name' | 'required'> & { required?: boolean }>;
}

export interface InputFileConfig {
  enabled: boolean;
  maxFiles: number;
  maxSizePerFileMB: number;
  allowedTypes: string[]; // MIME types
  required: boolean;
}

// ============================================================================
// Output Config
// ============================================================================

export interface OutputConfig {
  enabledTypes: OutputType[];
  defaultType: OutputType;
  jsonSchema?: JsonSchemaConfig;
  documentBranding?: DocumentBrandingConfig;
  fallback?: FallbackConfig;
}

export interface FallbackConfig {
  enabled: boolean;
  type: 'text' | 'json' | 'md'; // Only base types (no tool dependency)
}

export interface JsonSchemaConfig {
  type: 'object' | 'array';
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  required?: string[];
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface DocumentBrandingConfig {
  enabled: boolean;
  logoUrl?: string;
  organizationName?: string;
  primaryColor?: string;
}

// ============================================================================
// API Keys
// ============================================================================

export interface AgentBotApiKey {
  id: string;
  agent_bot_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  permissions: string[];
  rate_limit_rpm: number;
  rate_limit_rpd: number;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
}

export interface AgentBotApiKeyWithStats extends AgentBotApiKey {
  total_requests: number;
  requests_today: number;
  requests_this_hour: number;
}

export interface CreateApiKeyResult {
  apiKey: AgentBotApiKey;
  fullKey: string; // Only returned once at creation
}

// ============================================================================
// Jobs
// ============================================================================

export interface AgentBotJob {
  id: string;
  agent_bot_id: string;
  version_id: string;
  api_key_id: string;
  status: JobStatus;
  input_json: Record<string, unknown>;
  input_files_json: string[] | null;
  output_type: OutputType;
  webhook_url: string | null;
  webhook_secret: string | null;
  priority: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  error_code: string | null;
  processing_time_ms: number | null;
  token_usage_json: TokenUsage | null;
  created_at: string;
  expires_at: string | null;
}

export interface AgentBotJobWithOutputs extends AgentBotJob {
  outputs: AgentBotJobOutput[];
  input_files?: AgentBotJobFile[];
}

export interface AgentBotJobOutput {
  id: string;
  job_id: string;
  output_type: OutputType;
  content: string | null;
  filename: string | null;
  filepath: string | null;
  file_size: number | null;
  mime_type: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export interface AgentBotJobFile {
  id: string;
  job_id: string;
  original_filename: string;
  stored_filepath: string;
  file_size: number;
  mime_type: string;
  extracted_text: string | null;
  extraction_status: FileExtractionStatus;
  created_at: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ============================================================================
// Usage & Analytics
// ============================================================================

export interface AgentBotUsage {
  id: number;
  api_key_id: string;
  agent_bot_id: string;
  date: string;
  hour: number;
  request_count: number;
  token_count: number;
  error_count: number;
}

export interface AgentBotAnalyticsSummary {
  total_requests: number;
  total_tokens: number;
  total_errors: number;
  success_rate: number;
  avg_processing_time_ms: number;
  requests_by_day: { date: string; count: number }[];
  requests_by_output_type: { type: OutputType; count: number }[];
  requests_by_api_key: { key_name: string; count: number }[];
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface InvokeRequest {
  input: Record<string, unknown>;
  files?: string[]; // File IDs from upload
  version?: number | 'latest' | 'default';
  outputType?: OutputType;
  fallbackType?: 'text' | 'json' | 'md'; // Optional override for admin-set fallback
  async?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface InvokeResponse {
  success: boolean;
  jobId: string;
  status?: JobStatus;
  outputs?: InvokeOutputItem[];
  tokenUsage?: TokenUsage;
  processingTimeMs?: number;
  usedFallback?: boolean; // True if the primary output type failed and fallback was used
}

export interface InvokeOutputItem {
  type: OutputType;
  content?: string | Record<string, unknown>;
  filename?: string;
  downloadUrl?: string;
  fileSize?: number;
  mimeType?: string;
}

export interface AsyncJobResponse {
  jobId: string;
  status: JobStatus;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  outputs?: InvokeOutputItem[];
  tokenUsage?: TokenUsage;
  processingTimeMs?: number;
  error?: {
    message: string;
    code: string;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WebhookPayload {
  event: 'job.completed' | 'job.failed';
  jobId: string;
  agentBotId: string;
  agentBotSlug: string;
  status: JobStatus;
  outputs?: InvokeOutputItem[];
  tokenUsage?: TokenUsage;
  processingTimeMs?: number;
  error?: {
    message: string;
    code: string;
  };
  timestamp: string;
}

export interface UploadResponse {
  fileId: string;
  filename: string;
  fileSize: number;
  mimeType: string;
}

// ============================================================================
// Error Types
// ============================================================================

export type AgentBotErrorCode =
  | 'INVALID_API_KEY'
  | 'API_KEY_EXPIRED'
  | 'API_KEY_REVOKED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INPUT_VALIDATION_ERROR'
  | 'FILE_VALIDATION_ERROR'
  | 'OUTPUT_TYPE_NOT_SUPPORTED'
  | 'VERSION_NOT_FOUND'
  | 'AGENT_BOT_NOT_FOUND'
  | 'AGENT_BOT_DISABLED'
  | 'JOB_NOT_FOUND'
  | 'JOB_ALREADY_CANCELLED'
  | 'PROCESSING_ERROR'
  | 'WEBHOOK_DELIVERY_FAILED';

export interface AgentBotError {
  error: string;
  code: AgentBotErrorCode;
  details?: string;
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitInfo {
  limitMinute: number;
  remainingMinute: number;
  limitDay: number;
  remainingDay: number;
  resetMinute: Date;
  resetDay: Date;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  info: RateLimitInfo;
  blockedReason?: 'minute' | 'day';
}

// ============================================================================
// Input Types for CRUD
// ============================================================================

export interface CreateAgentBotInput {
  name: string;
  slug?: string; // Auto-generated if not provided
  description?: string;
}

export interface UpdateAgentBotInput {
  name?: string;
  description?: string;
  is_active?: boolean;
}

export interface CreateAgentBotVersionInput {
  version_label?: string;
  is_default?: boolean;
  input_schema: InputSchema;
  output_config: OutputConfig;
  system_prompt?: string;
  llm_model?: string;
  temperature?: number;
  max_tokens?: number;
  category_ids?: number[];
  skill_ids?: number[];
  tools?: { tool_name: string; is_enabled: boolean; config_override?: Record<string, unknown> }[];
}

export interface UpdateAgentBotVersionInput {
  version_label?: string;
  is_default?: boolean;
  is_active?: boolean;
  input_schema?: InputSchema;
  output_config?: OutputConfig;
  system_prompt?: string;
  llm_model?: string;
  temperature?: number;
  max_tokens?: number;
  category_ids?: number[];
  skill_ids?: number[];
  tools?: { tool_name: string; is_enabled: boolean; config_override?: Record<string, unknown> }[];
}

export interface CreateApiKeyInput {
  name: string;
  rate_limit_rpm?: number;
  rate_limit_rpd?: number;
  expires_in_days?: number; // null = never expires
}

// ============================================================================
// Database Row Types (raw from PostgreSQL)
// ============================================================================

export interface AgentBotRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: number;
  created_by: string;
  created_by_role: string;
  created_at: string;
  updated_at: string;
}

export interface AgentBotVersionRow {
  id: string;
  agent_bot_id: string;
  version_number: number;
  version_label: string | null;
  is_default: number;
  input_schema: string;
  output_config: string;
  system_prompt: string | null;
  llm_model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AgentBotApiKeyRow {
  id: string;
  agent_bot_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  permissions: string;
  rate_limit_rpm: number;
  rate_limit_rpd: number;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
}

export interface AgentBotJobRow {
  id: string;
  agent_bot_id: string;
  version_id: string;
  api_key_id: string;
  status: string;
  input_json: string;
  input_files_json: string | null;
  output_type: string;
  webhook_url: string | null;
  webhook_secret: string | null;
  priority: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  error_code: string | null;
  processing_time_ms: number | null;
  token_usage_json: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface AgentBotJobOutputRow {
  id: string;
  job_id: string;
  output_type: string;
  content: string | null;
  filename: string | null;
  filepath: string | null;
  file_size: number | null;
  mime_type: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface AgentBotJobFileRow {
  id: string;
  job_id: string;
  original_filename: string;
  stored_filepath: string;
  file_size: number;
  mime_type: string;
  extracted_text: string | null;
  extraction_status: string;
  created_at: string;
}

export interface AgentBotVersionToolRow {
  id: string;
  version_id: string;
  tool_name: string;
  is_enabled: number;
  config_override: string | null;
}

export interface AgentBotUsageRow {
  id: number;
  api_key_id: string;
  agent_bot_id: string;
  date: string;
  hour: number;
  request_count: number;
  token_count: number;
  error_count: number;
}
