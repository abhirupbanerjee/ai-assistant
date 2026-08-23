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
  role: 'super_admin' | 'admin' | 'superuser' | 'user';
  added_by: string | null;
  password_hash: string | null;
  credentials_enabled: Generated<number>;
  /** The organization this user is currently representing in chats (multi-org switcher). */
  active_organization_id: number | null;
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
  memory_enabled: Generated<boolean>;
  /** Tenant org for category isolation. Nullable during migration; backfilled to the DEFAULT org. */
  organization_id: number | null;
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
  created_by_role: 'super_admin' | 'admin' | 'superuser';
  token_estimate: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  created_by: string;
  updated_by: string;
  // Tool routing columns
  match_type: Generated<string>;
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
  mode: Generated<string>;
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
  file_type: 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'mp3' | 'wav' | 'html' | 'zip';
  file_size: number;
  generation_config: string | null;
  expires_at: string | null;
  download_count: Generated<number>;
  created_at: Generated<string>;
}

// ============ Personal & Category Memory Foundation ============

export interface PersonalPreferenceProfilesTable {
  user_id: number;
  preferred_language: string | null;
  translation_language: string | null;
  translation_mode: Generated<'never' | 'when_requested' | 'always'>;
  tone: Generated<'default' | 'friendly' | 'formal' | 'direct' | 'professional'>;
  verbosity: Generated<'brief' | 'balanced' | 'detailed'>;
  complexity: Generated<'simple' | 'standard' | 'technical' | 'executive'>;
  preferred_format: Generated<'auto' | 'bullets' | 'steps' | 'prose' | 'table'>;
  preferred_diagram_format: Generated<'auto' | 'mermaid' | 'ascii' | 'infographic'>;
  preferred_document_format: Generated<'auto' | 'markdown' | 'docx' | 'pdf'>;
  include_examples: boolean | null;
  include_citations: boolean | null;
  source: Generated<'user_set' | 'inferred'>;
  preferred_language_source: Generated<'user_set' | 'inferred'>;
  translation_language_source: Generated<'user_set' | 'inferred'>;
  translation_mode_source: Generated<'user_set' | 'inferred'>;
  tone_source: Generated<'user_set' | 'inferred'>;
  verbosity_source: Generated<'user_set' | 'inferred'>;
  complexity_source: Generated<'user_set' | 'inferred'>;
  preferred_format_source: Generated<'user_set' | 'inferred'>;
  preferred_diagram_format_source: Generated<'user_set' | 'inferred'>;
  preferred_document_format_source: Generated<'user_set' | 'inferred'>;
  include_examples_source: Generated<'user_set' | 'inferred'>;
  include_citations_source: Generated<'user_set' | 'inferred'>;
  learning_enabled: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PersonalInterestsTable {
  id: Generated<number>;
  user_id: number;
  topic: string;
  normalized_topic: string;
  source: Generated<'user_set' | 'inferred'>;
  confidence: Generated<number>;
  is_active: Generated<boolean>;
  last_used_at: string | null;
  hit_count: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PendingPersonalPreferenceCandidatesTable {
  id: Generated<number>;
  user_id: number;
  field: 'preferredLanguage' | 'translationLanguage' | 'translationMode' | 'tone' | 'verbosity' | 'complexity' | 'preferredFormat' | 'preferredDiagramFormat' | 'preferredDocumentFormat' | 'includeExamples' | 'includeCitations';
  value: unknown;
  confidence: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface CategoryMemoriesTable {
  id: Generated<number>;
  category_id: number;
  memory_type: 'fact' | 'terminology' | 'decision' | 'process' | 'faq' | 'caveat';
  title: string;
  normalized_title: string;
  content: string;
  status: Generated<'draft' | 'suggested' | 'approved' | 'archived' | 'rejected'>;
  source_reference: string | null;
  confidence: Generated<number>;
  valid_from: string | null;
  expires_at: string | null;
  created_by: number | null;
  approved_by: number | null;
  moderation_flags: Generated<unknown>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface CategoryMemoryEventsTable {
  id: Generated<number>;
  category_memory_id: number;
  category_id: number;
  revision_number: number;
  action: 'created' | 'suggested' | 'edited' | 'approved' | 'rejected' | 'archived' | 'restored' | 'expiry_changed';
  actor_id: number | null;
  previous_value: unknown | null;
  new_value: unknown | null;
  created_at: Generated<string>;
}

export interface CategoryMemoryExtractionEventsTable {
  id: Generated<number>;
  category_id: number;
  user_id: number | null;
  thread_id: string;
  source_message_id: string;
  source_surface: Generated<'main-chat'>;
  outcome: 'pending' | 'no_candidate' | 'candidate_created' | 'duplicate_skip' | 'access_revoked' | 'error';
  category_memory_id: number | null;
  candidate_count: Generated<number>;
  duplicate_skips: Generated<number>;
  redaction_count: Generated<number>;
  created_at: Generated<string>;
  completed_at: string | null;
}

export interface NotificationsTable {
  id: Generated<number>;
  user_id: number;
  type: 'category_memory_suggestion_submitted' | 'category_memory_suggestion_approved' | 'category_memory_suggestion_rejected';
  title: string;
  message: string;
  resource_type: 'category_memory';
  resource_id: number;
  metadata: Generated<unknown>;
  read_at: string | null;
  created_at: Generated<string>;
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
  forced_tool_capable: Generated<number>;
  capability_tier: Generated<string>;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  is_default: Generated<number>;
  enabled: Generated<number>;
  sort_order: Generated<number>;
  capability_scores: unknown | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ MCP Servers ============

export interface McpServersTable {
  id: string;
  name: string;
  url: string;
  auth_token: string | null;
  enabled: Generated<number>;
  timeout_ms: Generated<number>;
  tool_count: Generated<number>;
  last_health_check: Generated<string> | null;
  health_status: Generated<string>;
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
  tool_type: Generated<string>;
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
  mode: Generated<string>;
  budget_json: Generated<string>;
  budget_used_json: Generated<string>;
  model_config_json: Generated<string>;
  paused_at: string | null;
  pause_reason: string | null;
  resumed_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  original_request: string | null;
}

// ============ Plan Memories ============

export interface PlanMemoriesTable {
  id: Generated<number>;
  plan_id: string;
  wave: number;
  task_ids: number[];
  summary: string;
  keywords: string[] | null;
  created_at: Generated<string>;
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

// ============ Connected Accounts (Drive Connectors — Phase 2) ============

export interface UserConnectedAccountsTable {
  id: string;
  provider: Generated<'google' | 'microsoft' | 'github' | 'notion' | 'slack' | 'gitbook'>;
  user_email: string;
  display_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  scopes: string;
  token_expiry: string | null;
  revoked: Generated<boolean>;
  last_error: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
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
  created_by_role: 'super_admin' | 'admin' | 'superuser';
  created_at: Generated<string>;
  updated_at: Generated<string>;
  auth_required: Generated<number>;
  web_search_enabled: Generated<number>;
  sources_enabled: Generated<number>;
  organization_id: number | null;
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
  file_type: 'pdf' | 'docx' | 'image' | 'chart' | 'md' | 'xlsx' | 'pptx' | 'mp3' | 'wav' | 'html' | 'zip';
  file_size: number;
  generation_config: string | null;
  expires_at: string | null;
  download_count: Generated<number>;
  created_at: Generated<string>;
}

// ============ Citation Trajectories ============

export interface CitationTrajectoriesTable {
  id: Generated<number>;
  message_id: string;
  thread_id: string;
  chunk_id: string;
  document_name: string;
  page_number: number;
  raw_score: number | null;
  reranked_score: number | null;
  was_selected: number;  // 0 or 1
  rank_before: number | null;
  rank_after: number | null;
  source_type: 'vector' | 'user_upload' | 'web';
  created_at: Generated<string>;
}

export type CitationTrajectory = Selectable<CitationTrajectoriesTable>;
export type NewCitationTrajectory = Insertable<CitationTrajectoriesTable>;
export type CitationTrajectoryUpdate = Updateable<CitationTrajectoriesTable>;

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
  created_by_role: 'super_admin' | 'admin' | 'superuser';
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
  include_sources: Generated<number>;
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
  encrypted_key: string | null;
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
  sources_json: string | null;
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
  output_type: 'text' | 'json' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'podcast' | 'md' | 'chart' | 'diagram';
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
export type LoadTestResults = LoadTestResult;
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
  input_tokens: number | null;
  output_tokens: number | null;
  metadata_json: string | null;
  organization_id: number | null;
  /** Vault credential used to serve the request (AI & API Setup Redesign, Phase E). */
  credential_id: string | null;
  created_at: Generated<string>;
}

export type TokenUsageLog = Selectable<TokenUsageLogTable>;
export type NewTokenUsageLog = Insertable<TokenUsageLogTable>;

// ============ AI & API Setup Redesign — Phase A (tenancy & registry) ============
// See plans/AI_API_Setup_Redesign_Implementation_Plan.md §10. Tables are created
// empty by the inline migrations in src/lib/db/kysely.ts (runPostgresMigrations).
// All timestamps are strings per the global pg type parser overrides.

export interface OrganizationsTable {
  id: Generated<number>;
  name: string;
  type: 'DEFAULT' | 'ENTITY' | 'INDIVIDUAL';
  is_default: Generated<boolean>;
  credential_mode: 'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK';
  status: 'active' | 'disabled' | 'suspended';
  isolation_mode: 'SOFT' | 'HARD';
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type Organization = Selectable<OrganizationsTable>;
export type NewOrganization = Insertable<OrganizationsTable>;
export type OrganizationUpdate = Updateable<OrganizationsTable>;

export interface OrganizationMembershipsTable {
  organization_id: number;
  user_id: number;
  role: 'org_admin' | 'member';
  status: 'active' | 'disabled';
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type OrganizationMembership = Selectable<OrganizationMembershipsTable>;
export type NewOrganizationMembership = Insertable<OrganizationMembershipsTable>;

export interface ProvidersTable {
  id: string;
  name: string;
  description: string | null;
  enabled: Generated<boolean>;
  sort_order: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type Provider = Selectable<ProvidersTable>;
export type NewProvider = Insertable<ProvidersTable>;

export interface CapabilitiesTable {
  id: string;
  name: string;
  description: string | null;
  importance: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  sort_order: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type Capability = Selectable<CapabilitiesTable>;
export type NewCapability = Insertable<CapabilitiesTable>;

export interface ProviderCapabilitiesTable {
  provider_id: string;
  capability_id: string;
  is_supported: Generated<boolean>;
  model_or_service_ids: unknown | null;
  selection_mode: Generated<'none' | 'model' | 'service'>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PlatformProviderCredentialsTable {
  provider_id: string;
  secret_ref: string;
  kek_version: number;
  status: 'active' | 'disabled';
  last_verified_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface OrganizationProviderCredentialsTable {
  id: Generated<number>;
  organization_id: number;
  provider_id: string;
  credential_id: string;
  secret_ciphertext: string;
  dek_wrapped: string;
  kek_version: number;
  aad: string;
  is_default: Generated<boolean>;
  status: 'active' | 'disabled';
  credential_version: Generated<number>;
  last_verified_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface OrganizationCapabilityConfigTable {
  organization_id: number;
  capability_id: string;
  provider_id: string;
  credential_id: string | null;
  model_or_service_id: string | null;
  enabled: Generated<boolean>;
  configuration: unknown;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface CredentialAuditLogTable {
  id: Generated<number>;
  organization_id: number | null;
  provider_id: string;
  credential_id: string | null;
  actor_user_id: number | null;
  action: 'created' | 'replaced' | 'disabled' | 'enabled' | 'tested' | 'rotated';
  redacted_detail: string | null;
  created_at: Generated<string>;
}

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
  personal_preference_profiles: PersonalPreferenceProfilesTable;
  personal_interests: PersonalInterestsTable;
  pending_personal_preference_candidates: PendingPersonalPreferenceCandidatesTable;
  category_memories: CategoryMemoriesTable;
  category_memory_events: CategoryMemoryEventsTable;
  category_memory_extraction_events: CategoryMemoryExtractionEventsTable;
  notifications: NotificationsTable;
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
  plan_memories: PlanMemoriesTable;
  data_api_configs: DataApiConfigsTable;
  data_api_categories: DataApiCategoriesTable;
  data_csv_configs: DataCsvConfigsTable;
  data_csv_categories: DataCsvCategoriesTable;
  data_source_audit: DataSourceAuditTable;
  function_api_configs: FunctionApiConfigsTable;
  function_api_categories: FunctionApiCategoriesTable;
  user_connected_accounts: UserConnectedAccountsTable;
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
  // WhatsApp Channels
  workspace_whatsapp_channels: WorkspaceWhatsappChannelsTable;
  workspace_whatsapp_contacts: WorkspaceWhatsappContactsTable;
  workspace_whatsapp_messages: WorkspaceWhatsappMessagesTable;
  // Citation Trajectories
  citation_trajectories: CitationTrajectoriesTable;
  // Slash Commands
  slash_command_configs: SlashCommandConfigsTable;
  // Model Latency Log (Auto selection)
  model_latency_log: ModelLatencyLogTable;
  // Agent System (Phase 1) — registry + swarm controls
  agent: AgentTable;
  swarm_control: SwarmControlTable;
  force_swarm_role_allowlist: ForceSwarmRoleAllowlistTable;
  // MCP Servers
  mcp_servers: McpServersTable;
  // Browser Sessions (remote browser)
  browser_sessions: BrowserSessionsTable;
  // AI & API Setup Redesign (Phase A) — tenancy & registry
  organizations: OrganizationsTable;
  organization_memberships: OrganizationMembershipsTable;
  providers: ProvidersTable;
  capabilities: CapabilitiesTable;
  provider_capabilities: ProviderCapabilitiesTable;
  platform_provider_credentials: PlatformProviderCredentialsTable;
  organization_provider_credentials: OrganizationProviderCredentialsTable;
  organization_capability_config: OrganizationCapabilityConfigTable;
  credential_audit_log: CredentialAuditLogTable;
}

// ============ Browser Sessions ============

export interface BrowserSessionsTable {
  id: string;
  user_id: number;
  thread_id: string | null;
  task: string | null;
  worker_session_id: string | null;
  state: Generated<string>;
  current_url: string | null;
  page_title: string | null;
  pending_checkpoint: string | null;
  last_aria_json: string | null;
  allowlist_json: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  expires_at: string | null;
  terminated_at: string | null;
}

export type BrowserSession = Selectable<BrowserSessionsTable>;
export type NewBrowserSession = Insertable<BrowserSessionsTable>;
export type BrowserSessionUpdate = Updateable<BrowserSessionsTable>;

// ============ WhatsApp Channels ============

export interface WorkspaceWhatsappChannelsTable {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  business_account_id: string | null;
  display_phone_number: string | null;
  access_token_encrypted: string;
  app_secret_encrypted: string;
  webhook_verify_token_hash: string;
  is_enabled: Generated<number>;
  created_by: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface WorkspaceWhatsappContactsTable {
  id: string;
  channel_id: string;
  wa_id: string;
  display_name: string | null;
  workspace_session_id: string;
  workspace_thread_id: string;
  last_inbound_at: string | null;
  service_window_expires_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface SlashCommandConfigsTable {
  id: string;
  command_key: string;
  tool_name: string;
  label: string;
  description: string;
  aliases: string;
  hint: string;
  icon: string | null;
  format_hint: string | null;
  enabled: Generated<number>;
  sort_order: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  updated_by: string;
}

export interface WorkspaceWhatsappMessagesTable {
  id: string;
  channel_id: string;
  contact_id: string | null;
  workspace_message_id: string | null;
  meta_message_id: string;
  direction: string;
  status: Generated<string>;
  message_type: string;
  text_content: string | null;
  error_message: string | null;
  raw_payload_json: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ============ Model Latency Log ============

export interface ModelLatencyLogTable {
  id: Generated<number>;
  model_id: string;
  latency_ms: number;
  output_tokens: number | null;
  success: Generated<number>;
  error_type: string | null;
  created_at: Generated<string>;
}

export type ModelLatencyLog = Selectable<ModelLatencyLogTable>;
export type NewModelLatencyLog = Insertable<ModelLatencyLogTable>;

// ============ Agent System (Phase 1) ============
// See plans/agent_system_architecture___implementation_plan.md

export interface AgentTable {
  id: string;
  name: string;
  role_family: 'planner' | 'executor' | 'critic' | 'researcher' | 'presenter';
  category_id: number | null;
  model_id: string | null;
  system_prompt: string;
  tool_allowlist: unknown | null;
  config: unknown | null;
  enabled: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type Agent = Selectable<AgentTable>;
export type NewAgent = Insertable<AgentTable>;

export interface SwarmControlTable {
  id: string;
  category_id: number | null;
  swarm_enabled: Generated<boolean>;
  updated_by: string | null;
  updated_at: Generated<string>;
}

export type SwarmControl = Selectable<SwarmControlTable>;
export type NewSwarmControl = Insertable<SwarmControlTable>;

export interface ForceSwarmRoleAllowlistTable {
  id: string;
  role: 'super_admin' | 'admin' | 'superuser' | 'user';
  allowed: Generated<boolean>;
}

export type ForceSwarmRoleAllowlist = Selectable<ForceSwarmRoleAllowlistTable>;
export type NewForceSwarmRoleAllowlist = Insertable<ForceSwarmRoleAllowlistTable>;
