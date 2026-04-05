/**
 * Database Types for Kysely
 *
 * This file defines the TypeScript types for all database tables.
 * It can be regenerated from the live database using: npm run db:types
 *
 * Note: kysely-codegen generates types automatically from the database schema.
 * Run `npm run db:types` after any schema changes to update this file.
 */

import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ============ Users & Roles ============

export interface UsersTable {
  id: Generated<number>;
  email: string;
  name: string | null;
  role: 'admin' | 'superuser' | 'user';
  added_by: string | null;
  password_hash: string | null;
  credentials_enabled: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

// ============ Categories ============

export interface CategoriesTable {
  id: Generated<number>;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  created_at: Generated<string>;
}

export type Category = Selectable<CategoriesTable>;
export type NewCategory = Insertable<CategoriesTable>;
export type CategoryUpdate = Updateable<CategoriesTable>;

// ============ Super User Categories ============

export interface SuperUserCategoriesTable {
  user_id: number;
  category_id: number;
  assigned_at: Generated<string>;
  assigned_by: string;
}

// ============ User Subscriptions ============

export interface UserSubscriptionsTable {
  user_id: number;
  category_id: number;
  is_active: Generated<number>;
  subscribed_at: Generated<string>;
  subscribed_by: string;
}

// ============ Category Prompts ============

export interface CategoryPromptsTable {
  category_id: number;
  prompt_addendum: string;
  starter_prompts: string | null;
  welcome_title: string | null;
  welcome_message: string | null;
  updated_at: Generated<string>;
  updated_by: string;
}

// ============ Skills ============

export interface SkillsTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  prompt_content: string;
  trigger_type: 'always' | 'category' | 'keyword';
  trigger_value: string | null;
  category_restricted: Generated<number>;
  is_index: Generated<number>;
  priority: Generated<number>;
  is_active: Generated<number>;
  is_core: Generated<number>;
  created_by_role: 'admin' | 'superuser';
  token_estimate: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  created_by: string;
  updated_by: string;
  // Tool routing columns
  match_type: Generated<string | null>;
  tool_name: string | null;
  force_mode: string | null;
  tool_config_override: string | null;
  data_source_filter: string | null;
  compliance_config: string | null;
}

export type Skill = Selectable<SkillsTable>;
export type NewSkill = Insertable<SkillsTable>;
export type SkillUpdate = Updateable<SkillsTable>;

// ============ Category Skills ============

export interface CategorySkillsTable {
  category_id: number;
  skill_id: number;
}

// ============ Documents ============

export interface DocumentsTable {
  id: Generated<number>;
  filename: string;
  filepath: string;
  file_size: number;
  is_global: Generated<number>;
  chunk_count: Generated<number>;
  status: 'processing' | 'ready' | 'error';
  error_message: string | null;
  uploaded_by: string;
  created_at: Generated<string>;
  folder_sync_id: string | null;
  original_relative_path: string | null;
}

export type Document = Selectable<DocumentsTable>;
export type NewDocument = Insertable<DocumentsTable>;
export type DocumentUpdate = Updateable<DocumentsTable>;

// ============ Document Categories ============

export interface DocumentCategoriesTable {
  document_id: number;
  category_id: number | null;
}

// ============ Threads ============

export interface ThreadsTable {
  id: string;
  user_id: number;
  title: string;
  selected_model: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  is_pinned: Generated<number>;
  is_summarized: Generated<number>;
  total_tokens: Generated<number>;
}

export type Thread = Selectable<ThreadsTable>;
export type NewThread = Insertable<ThreadsTable>;
export type ThreadUpdate = Updateable<ThreadsTable>;

// ============ Thread Categories ============

export interface ThreadCategoriesTable {
  thread_id: string;
  category_id: number;
}

// ============ Messages ============

export interface MessagesTable {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  sources_json: string | null;
  attachments_json: string | null;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  created_at: Generated<string>;
  token_count: number | null;
  generated_documents_json: string | null;
  visualizations_json: string | null;
  generated_images_json: string | null;
  generated_diagrams_json: string | null;
  generated_podcasts_json: string | null;
  mode: Generated<string | null>;
  plan_id: string | null;
  metadata_json: string | null;
}

export type Message = Selectable<MessagesTable>;
export type NewMessage = Insertable<MessagesTable>;
export type MessageUpdate = Updateable<MessagesTable>;

// ============ Thread Uploads ============

export interface ThreadUploadsTable {
  id: Generated<number>;
  thread_id: string;
  filename: string;
  filepath: string;
  file_size: number;
  uploaded_at: Generated<string>;
}

// ============ Thread Outputs ============

export interface ThreadOutputsTable {
  id: Generated<number>;
  thread_id: string;
  message_id: string | null;
  filename: string;
  filepath: string;
  file_type: 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'mp3' | 'wav';
  file_size: number;
  generation_config: string | null;
  expires_at: string | null;
  download_count: Generated<number>;
  created_at: Generated<string>;
}

// ============ User Memories ============

export interface UserMemoriesTable {
  id: Generated<number>;
  user_id: number;
  category_id: number | null;
  facts_json: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ Thread Summaries ============

export interface ThreadSummariesTable {
  id: Generated<number>;
  thread_id: string;
  summary: string;
  messages_summarized: number;
  tokens_before: number | null;
  tokens_after: number | null;
  created_at: Generated<string>;
}

// ============ Archived Messages ============

export interface ArchivedMessagesTable {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  sources_json: string | null;
  created_at: string;
  archived_at: Generated<string>;
  summary_id: number | null;
}

// ============ Settings ============

export interface SettingsTable {
  key: string;
  value: string;
  updated_at: Generated<string>;
  updated_by: string | null;
}

export type Setting = Selectable<SettingsTable>;
export type NewSetting = Insertable<SettingsTable>;
export type SettingUpdate = Updateable<SettingsTable>;

// ============ Storage Alerts ============

export interface StorageAlertsTable {
  id: Generated<number>;
  threshold_percent: number;
  current_percent: number;
  alerted_at: Generated<string>;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

// ============ LLM Providers ============

export interface LlmProvidersTable {
  id: string;
  name: string;
  api_key: string | null;
  api_base: string | null;
  enabled: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ Enabled Models ============

export interface EnabledModelsTable {
  id: string;
  provider_id: string;
  display_name: string;
  tool_capable: Generated<number>;
  vision_capable: Generated<number>;
  parallel_tool_capable: Generated<number>;
  thinking_capable: Generated<number>;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  is_default: Generated<number>;
  enabled: Generated<number>;
  sort_order: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ Tool Configs ============

export interface ToolConfigsTable {
  id: string;
  tool_name: string;
  is_enabled: Generated<number>;
  config_json: string;
  description_override: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  updated_by: string;
}

// ============ Tool Config Audit ============

export interface ToolConfigAuditTable {
  id: Generated<number>;
  tool_name: string;
  operation: 'create' | 'update' | 'delete';
  old_config: string | null;
  new_config: string | null;
  changed_by: string;
  changed_at: Generated<string>;
}

// ============ Category Tool Configs ============

export interface CategoryToolConfigsTable {
  id: string;
  category_id: number;
  tool_name: string;
  is_enabled: number | null;
  branding_json: string | null;
  config_json: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  updated_by: string;
}

// ============ Tool Routing Rules ============

export interface ToolRoutingRulesTable {
  id: string;
  tool_name: string;
  rule_name: string;
  rule_type: 'keyword' | 'regex';
  patterns: string;
  force_mode: Generated<'required' | 'preferred' | 'suggested'>;
  priority: Generated<number>;
  category_ids: string | null;
  is_active: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  created_by: string;
  updated_by: string;
}

// ============ Task Plans ============

export interface TaskPlansTable {
  id: string;
  thread_id: string;
  user_id: string;
  category_slug: string | null;
  title: string | null;
  tasks_json: string;
  status: Generated<'active' | 'completed' | 'cancelled' | 'failed' | 'paused' | 'stopped'>;
  total_tasks: Generated<number>;
  completed_tasks: Generated<number>;
  failed_tasks: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  completed_at: string | null;
  mode: Generated<string | null>;
  budget_json: Generated<string | null>;
  budget_used_json: Generated<string | null>;
  model_config_json: Generated<string | null>;
  paused_at: string | null;
  pause_reason: string | null;
  resumed_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  original_request: string | null;
}

// ============ Data API Configs ============

export interface DataApiConfigsTable {
  id: string;
  name: string;
  description: string | null;
  endpoint: string;
  method: Generated<'GET' | 'POST'>;
  response_format: Generated<'json' | 'csv'>;
  authentication: string | null;
  headers: string | null;
  parameters: string | null;
  response_structure: string | null;
  sample_response: string | null;
  openapi_spec: string | null;
  config_method: Generated<'manual' | 'openapi'>;
  status: Generated<'active' | 'inactive' | 'error' | 'untested'>;
  created_by: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  last_tested: string | null;
  last_error: string | null;
}

// ============ Data API Categories ============

export interface DataApiCategoriesTable {
  api_id: string;
  category_id: number;
  created_at: Generated<string>;
}

// ============ Data CSV Configs ============

export interface DataCsvConfigsTable {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  original_filename: string | null;
  columns: string | null;
  sample_data: string | null;
  row_count: Generated<number>;
  file_size: Generated<number>;
  created_by: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ Data CSV Categories ============

export interface DataCsvCategoriesTable {
  csv_id: string;
  category_id: number;
  created_at: Generated<string>;
}

// ============ Data Source Audit ============

export interface DataSourceAuditTable {
  id: Generated<number>;
  source_type: 'api' | 'csv';
  source_id: string;
  action: 'created' | 'updated' | 'tested' | 'deleted';
  changed_by: string;
  details: string | null;
  changed_at: Generated<string>;
}

// ============ Function API Configs ============

export interface FunctionApiConfigsTable {
  id: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_type: Generated<'api_key' | 'bearer' | 'basic' | 'none'>;
  auth_header: string | null;
  auth_credentials: string | null;
  default_headers: string | null;
  tools_schema: string;
  endpoint_mappings: string;
  timeout_seconds: Generated<number>;
  cache_ttl_seconds: Generated<number>;
  is_enabled: Generated<number>;
  status: Generated<'active' | 'inactive' | 'error' | 'untested'>;
  created_by: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  last_tested: string | null;
  last_error: string | null;
}

// ============ Function API Categories ============

export interface FunctionApiCategoriesTable {
  api_id: string;
  category_id: number;
  created_at: Generated<string>;
}

// ============ RAG Test Queries ============

export interface RagTestQueriesTable {
  id: Generated<number>;
  name: string;
  query: string;
  category_ids: string | null;
  created_by: string;
  created_at: Generated<string>;
}

// ============ RAG Test Results ============

export interface RagTestResultsTable {
  id: Generated<number>;
  query_id: number | null;
  test_query: string;
  settings_snapshot: string;
  chunks_retrieved: number;
  avg_similarity: number;
  latency_ms: number;
  top_chunks: string | null;
  created_by: string;
  created_at: Generated<string>;
}

// ============ Thread Shares ============

export interface ThreadSharesTable {
  id: string;
  thread_id: string;
  share_token: string;
  created_by: number;
  allow_download: Generated<number>;
  expires_at: string | null;
  view_count: Generated<number>;
  created_at: Generated<string>;
  last_viewed_at: string | null;
  revoked_at: string | null;
}

// ============ Share Access Log ============

export interface ShareAccessLogTable {
  id: Generated<number>;
  share_id: string;
  accessed_by: number;
  action: 'view' | 'download';
  resource_type: string | null;
  resource_id: string | null;
  accessed_at: Generated<string>;
}

// ============ Workspaces ============

export interface WorkspacesTable {
  id: string;
  slug: string;
  name: string;
  type: 'embed' | 'standalone';
  is_enabled: Generated<number>;
  access_mode: Generated<'category' | 'explicit'>;
  primary_color: Generated<string>;
  logo_url: string | null;
  chat_title: string | null;
  greeting_message: Generated<string>;
  suggested_prompts: string | null;
  footer_text: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  temperature: number | null;
  system_prompt: string | null;
  allowed_domains: Generated<string>;
  daily_limit: Generated<number>;
  session_limit: Generated<number>;
  voice_enabled: Generated<number>;
  file_upload_enabled: Generated<number>;
  max_file_size_mb: Generated<number>;
  created_by: string;
  created_by_role: 'admin' | 'superuser';
  created_at: Generated<string>;
  updated_at: Generated<string>;
  auth_required: Generated<number>;
  web_search_enabled: Generated<number>;
}

// ============ Workspace Categories ============

export interface WorkspaceCategoriesTable {
  workspace_id: string;
  category_id: number;
}

// ============ Workspace Users ============

export interface WorkspaceUsersTable {
  workspace_id: string;
  user_id: number;
  added_by: string;
  added_at: Generated<string>;
}

// ============ Workspace Sessions ============

export interface WorkspaceSessionsTable {
  id: string;
  workspace_id: string;
  visitor_id: string | null;
  user_id: number | null;
  referrer_url: string | null;
  ip_hash: string | null;
  message_count: Generated<number>;
  started_at: Generated<string>;
  last_activity: Generated<string>;
  expires_at: string | null;
}

// ============ Workspace Threads ============

export interface WorkspaceThreadsTable {
  id: string;
  workspace_id: string;
  session_id: string;
  title: Generated<string>;
  is_archived: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ Workspace Messages ============

export interface WorkspaceMessagesTable {
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
  created_at: Generated<string>;
}

// ============ Workspace Rate Limits ============

export interface WorkspaceRateLimitsTable {
  id: Generated<number>;
  workspace_id: string;
  ip_hash: string;
  window_start: string;
  request_count: Generated<number>;
}

// ============ Workspace Analytics ============

export interface WorkspaceAnalyticsTable {
  id: Generated<number>;
  workspace_id: string;
  date: string;
  sessions_count: Generated<number>;
  messages_count: Generated<number>;
  unique_visitors: Generated<number>;
  avg_response_time_ms: number | null;
  total_tokens_used: Generated<number>;
}

// ============ Workspace Outputs ============

export interface WorkspaceOutputsTable {
  id: Generated<number>;
  workspace_id: string;
  session_id: string;
  thread_id: string | null;
  filename: string;
  filepath: string;
  file_type: 'pdf' | 'docx' | 'image' | 'chart' | 'md' | 'xlsx' | 'pptx' | 'mp3' | 'wav';
  file_size: number;
  generation_config: string | null;
  expires_at: string | null;
  download_count: Generated<number>;
  created_at: Generated<string>;
}

// ============ Folder Syncs ============

export interface FolderSyncsTable {
  id: string;
  folder_name: string;
  original_path: string;
  uploaded_by: string;
  category_ids: string | null;
  is_global: Generated<number>;
  total_files: Generated<number>;
  synced_files: Generated<number>;
  failed_files: Generated<number>;
  status: Generated<'active' | 'syncing' | 'error'>;
  error_message: string | null;
  last_synced_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ Folder Sync Files ============

export interface FolderSyncFilesTable {
  id: Generated<number>;
  folder_sync_id: string;
  document_id: number | null;
  relative_path: string;
  filename: string;
  file_hash: string | null;
  file_size: number;
  last_modified: number | null;
  status: Generated<'pending' | 'synced' | 'skipped' | 'error'>;
  error_message: string | null;
  synced_at: string | null;
  created_at: Generated<string>;
}

// ============ Compliance Results ============

export interface ComplianceResultsTable {
  id: Generated<number>;
  message_id: string;
  conversation_id: string;
  skill_ids: string | null;
  overall_score: number;
  decision: 'pass' | 'warn' | 'hitl';
  checks_performed: string;
  failed_checks: string | null;
  hitl_triggered: Generated<number>;
  hitl_questions: string | null;
  hitl_user_response: string | null;
  hitl_action: string | null;
  validated_at: Generated<string>;
}

// ============ Agent Bots ============

export interface AgentBotsTable {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: Generated<number>;
  created_by: string;
  created_by_role: 'admin' | 'superuser';
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type AgentBot = Selectable<AgentBotsTable>;
export type NewAgentBot = Insertable<AgentBotsTable>;
export type AgentBotUpdate = Updateable<AgentBotsTable>;

// ============ Agent Bot Versions ============

export interface AgentBotVersionsTable {
  id: string;
  agent_bot_id: string;
  version_number: number;
  version_label: string | null;
  is_default: Generated<number>;
  input_schema: string;
  output_config: string;
  system_prompt: string | null;
  llm_model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  is_active: Generated<number>;
  created_by: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type AgentBotVersion = Selectable<AgentBotVersionsTable>;
export type NewAgentBotVersion = Insertable<AgentBotVersionsTable>;
export type AgentBotVersionUpdate = Updateable<AgentBotVersionsTable>;

// ============ Agent Bot Version Categories ============

export interface AgentBotVersionCategoriesTable {
  version_id: string;
  category_id: number;
}

// ============ Agent Bot Version Skills ============

export interface AgentBotVersionSkillsTable {
  version_id: string;
  skill_id: number;
}

// ============ Agent Bot Version Tools ============

export interface AgentBotVersionToolsTable {
  id: string;
  version_id: string;
  tool_name: string;
  is_enabled: Generated<number>;
  config_override: string | null;
}

// ============ Agent Bot API Keys ============

export interface AgentBotApiKeysTable {
  id: string;
  agent_bot_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  permissions: Generated<string>;
  rate_limit_rpm: Generated<number>;
  rate_limit_rpd: Generated<number>;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: Generated<number>;
  created_by: string;
  created_at: Generated<string>;
  revoked_at: string | null;
}

export type AgentBotApiKey = Selectable<AgentBotApiKeysTable>;
export type NewAgentBotApiKey = Insertable<AgentBotApiKeysTable>;
export type AgentBotApiKeyUpdate = Updateable<AgentBotApiKeysTable>;

// ============ Agent Bot Jobs ============

export interface AgentBotJobsTable {
  id: string;
  agent_bot_id: string;
  version_id: string;
  api_key_id: string;
  status: Generated<'pending' | 'running' | 'completed' | 'failed' | 'cancelled'>;
  input_json: string;
  input_files_json: string | null;
  output_type: Generated<string>;
  webhook_url: string | null;
  webhook_secret: string | null;
  priority: Generated<number>;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  error_code: string | null;
  processing_time_ms: number | null;
  token_usage_json: string | null;
  created_at: Generated<string>;
  expires_at: string | null;
}

export type AgentBotJob = Selectable<AgentBotJobsTable>;
export type NewAgentBotJob = Insertable<AgentBotJobsTable>;
export type AgentBotJobUpdate = Updateable<AgentBotJobsTable>;

// ============ Agent Bot Job Outputs ============

export interface AgentBotJobOutputsTable {
  id: string;
  job_id: string;
  output_type: 'text' | 'json' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'podcast' | 'md';
  content: string | null;
  filename: string | null;
  filepath: string | null;
  file_size: number | null;
  mime_type: string | null;
  metadata_json: string | null;
  created_at: Generated<string>;
}

export type AgentBotJobOutput = Selectable<AgentBotJobOutputsTable>;
export type NewAgentBotJobOutput = Insertable<AgentBotJobOutputsTable>;

// ============ Agent Bot Job Files ============

export interface AgentBotJobFilesTable {
  id: string;
  job_id: string;
  original_filename: string;
  stored_filepath: string;
  file_size: number;
  mime_type: string;
  extracted_text: string | null;
  extraction_status: Generated<'pending' | 'processing' | 'ready' | 'error'>;
  created_at: Generated<string>;
}

export type AgentBotJobFile = Selectable<AgentBotJobFilesTable>;
export type NewAgentBotJobFile = Insertable<AgentBotJobFilesTable>;

// ============ Agent Bot Usage ============

export interface AgentBotUsageTable {
  id: Generated<number>;
  api_key_id: string;
  agent_bot_id: string;
  date: string;
  hour: number;
  request_count: Generated<number>;
  token_count: Generated<number>;
  error_count: Generated<number>;
}

// ============ Load Test Results ============

export interface LoadTestResultsTable {
  id: Generated<number>;
  url: string;
  test_run_id: string | null;
  output_url: string | null;
  users: number;
  duration: number;
  metrics_json: string;
  passed: Generated<boolean>;
  run_by: string | null;
  created_at: Generated<string>;
}

export type LoadTestResult = Selectable<LoadTestResultsTable>;
export type NewLoadTestResult = Insertable<LoadTestResultsTable>;

// ============ Reindex Jobs ============

export interface ReindexJobsTable {
  id: string;
  status: Generated<string>;
  target_model: string;
  target_dimensions: number;
  previous_model: string;
  previous_dimensions: number;
  total_documents: Generated<number>;
  processed_documents: Generated<number>;
  failed_documents: Generated<number>;
  errors: Generated<string>;
  started_at: string | null;
  completed_at: string | null;
  created_at: Generated<string>;
  created_by: string;
}

// ============ Token Usage Log ============

export interface TokenUsageLogTable {
  id: Generated<number>;
  user_id: number | null;
  category: 'chat' | 'autonomous' | 'embeddings' | 'workspace';
  model: string;
  total_tokens: number;
  metadata_json: string | null;
  created_at: Generated<string>;
}

export type TokenUsageLog = Selectable<TokenUsageLogTable>;
export type NewTokenUsageLog = Insertable<TokenUsageLogTable>;

// ============ Complete Database Interface ============

export interface DB {
  users: UsersTable;
  categories: CategoriesTable;
  super_user_categories: SuperUserCategoriesTable;
  user_subscriptions: UserSubscriptionsTable;
  category_prompts: CategoryPromptsTable;
  skills: SkillsTable;
  category_skills: CategorySkillsTable;
  documents: DocumentsTable;
  document_categories: DocumentCategoriesTable;
  threads: ThreadsTable;
  thread_categories: ThreadCategoriesTable;
  messages: MessagesTable;
  thread_uploads: ThreadUploadsTable;
  thread_outputs: ThreadOutputsTable;
  user_memories: UserMemoriesTable;
  thread_summaries: ThreadSummariesTable;
  archived_messages: ArchivedMessagesTable;
  settings: SettingsTable;
  storage_alerts: StorageAlertsTable;
  llm_providers: LlmProvidersTable;
  enabled_models: EnabledModelsTable;
  tool_configs: ToolConfigsTable;
  tool_config_audit: ToolConfigAuditTable;
  category_tool_configs: CategoryToolConfigsTable;
  tool_routing_rules: ToolRoutingRulesTable;
  task_plans: TaskPlansTable;
  data_api_configs: DataApiConfigsTable;
  data_api_categories: DataApiCategoriesTable;
  data_csv_configs: DataCsvConfigsTable;
  data_csv_categories: DataCsvCategoriesTable;
  data_source_audit: DataSourceAuditTable;
  function_api_configs: FunctionApiConfigsTable;
  function_api_categories: FunctionApiCategoriesTable;
  rag_test_queries: RagTestQueriesTable;
  rag_test_results: RagTestResultsTable;
  thread_shares: ThreadSharesTable;
  share_access_log: ShareAccessLogTable;
  workspaces: WorkspacesTable;
  workspace_categories: WorkspaceCategoriesTable;
  workspace_users: WorkspaceUsersTable;
  workspace_sessions: WorkspaceSessionsTable;
  workspace_threads: WorkspaceThreadsTable;
  workspace_messages: WorkspaceMessagesTable;
  workspace_rate_limits: WorkspaceRateLimitsTable;
  workspace_analytics: WorkspaceAnalyticsTable;
  workspace_outputs: WorkspaceOutputsTable;
  folder_syncs: FolderSyncsTable;
  folder_sync_files: FolderSyncFilesTable;
  compliance_results: ComplianceResultsTable;
  // Agent Bots
  agent_bots: AgentBotsTable;
  agent_bot_versions: AgentBotVersionsTable;
  agent_bot_version_categories: AgentBotVersionCategoriesTable;
  agent_bot_version_skills: AgentBotVersionSkillsTable;
  agent_bot_version_tools: AgentBotVersionToolsTable;
  agent_bot_api_keys: AgentBotApiKeysTable;
  agent_bot_jobs: AgentBotJobsTable;
  agent_bot_job_outputs: AgentBotJobOutputsTable;
  agent_bot_job_files: AgentBotJobFilesTable;
  agent_bot_usage: AgentBotUsageTable;
  // Load Test Results
  load_test_results: LoadTestResultsTable;
  // Reindex Jobs
  reindex_jobs: ReindexJobsTable;
  // Token Usage Log
  token_usage_log: TokenUsageLogTable;
}
