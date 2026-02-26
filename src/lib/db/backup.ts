/**
 * Database Backup/Restore Operations
 *
 * Export and import functions for backup feature
 */

import { execute, queryAll, transaction, getDatabase } from './index';
import type { DbDocument } from './documents';
import type { DbCategory } from './categories';
import type { DbUser } from './users';

// ============ Types ============

export interface DocumentCategoryRecord {
  document_id: number;
  category_id: number | null;
}

export interface UserSubscriptionRecord {
  user_id: number;
  category_id: number;
  is_active: number;
  subscribed_at: string;
  subscribed_by: string;
}

export interface SuperUserCategoryRecord {
  user_id: number;
  category_id: number;
  assigned_at: string;
  assigned_by: string;
}

export interface ThreadRecord {
  id: string;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  sources_json: string | null;
  attachments_json: string | null;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  // Artifact columns
  generated_documents_json: string | null;
  visualizations_json: string | null;
  generated_images_json: string | null;
  created_at: string;
}

export interface ThreadCategoryRecord {
  thread_id: string;
  category_id: number;
}

export interface ThreadUploadRecord {
  id: number;
  thread_id: string;
  filename: string;
  filepath: string;
  file_size: number;
  uploaded_at: string;
}

export interface ThreadOutputRecord {
  id: number;
  thread_id: string;
  message_id: string | null;
  filename: string;
  filepath: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ToolConfigRecord {
  id: string;
  tool_name: string;
  is_enabled: number;
  config_json: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export interface CategoryToolConfigRecord {
  id: string;
  category_id: number;
  tool_name: string;
  is_enabled: number | null;
  branding_json: string | null;
  config_json: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export interface SkillRecord {
  id: number;
  name: string;
  description: string | null;
  prompt_content: string;
  trigger_type: string;
  trigger_value: string | null;
  category_restricted: number;
  is_index: number;
  priority: number;
  is_active: number;
  is_core: number;
  created_by_role: string;
  token_estimate: number | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  // Tool routing columns
  match_type: string | null;
  tool_name: string | null;
  force_mode: string | null;
  tool_config_override: string | null;
  data_source_filter: string | null;
}

export interface CategorySkillRecord {
  category_id: number;
  skill_id: number;
}

export interface CategoryPromptRecord {
  category_id: number;
  prompt_addendum: string;
  starter_prompts: string | null;
  welcome_title: string | null;
  welcome_message: string | null;
  updated_at: string;
  updated_by: string;
}

export interface DataApiConfigRecord {
  id: string;
  name: string;
  description: string | null;
  endpoint: string;
  method: string;
  response_format: string | null;
  authentication: string | null;
  headers: string | null;
  parameters: string | null;
  response_structure: string | null;
  sample_response: string | null;
  openapi_spec: string | null;
  config_method: string | null;
  status: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DataApiCategoryRecord {
  api_id: string;
  category_id: number;
  created_at: string;
}

export interface DataCsvConfigRecord {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  original_filename: string | null;
  columns: string | null;
  sample_data: string | null;
  row_count: number;
  file_size: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DataCsvCategoryRecord {
  csv_id: string;
  category_id: number;
  created_at: string;
}

// ============ NEW: Workspace Records ============

export interface WorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  type: string;
  is_enabled: number;
  access_mode: string;
  primary_color: string | null;
  logo_url: string | null;
  chat_title: string | null;
  greeting_message: string | null;
  suggested_prompts: string | null;
  footer_text: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  temperature: number | null;
  system_prompt: string | null;
  allowed_domains: string | null;
  daily_limit: number | null;
  session_limit: number | null;
  voice_enabled: number;
  file_upload_enabled: number;
  max_file_size_mb: number | null;
  created_by: string;
  created_by_role: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceCategoryRecord {
  workspace_id: string;
  category_id: number;
}

export interface WorkspaceUserRecord {
  workspace_id: string;
  user_id: number;
  added_by: string;
  added_at: string;
}

// ============ NEW: Function API Records ============

export interface FunctionApiConfigRecord {
  id: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_type: string;
  auth_header: string | null;
  auth_credentials: string | null;
  default_headers: string | null;
  tools_schema: string;
  endpoint_mappings: string;
  timeout_seconds: number;
  cache_ttl_seconds: number;
  is_enabled: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_tested: string | null;
  last_error: string | null;
}

export interface FunctionApiCategoryRecord {
  api_id: string;
  category_id: number;
  created_at: string;
}

// ============ NEW: User Memory Records ============

export interface UserMemoryRecord {
  id: number;
  user_id: number;
  category_id: number | null;
  facts_json: string;
  created_at: string;
  updated_at: string;
}

// ============ NEW: Tool Routing Rules ============

export interface ToolRoutingRuleRecord {
  id: string;
  tool_name: string;
  rule_name: string;
  rule_type: string;
  patterns: string;
  force_mode: string;
  priority: number;
  category_ids: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

// ============ NEW: Thread Share Records ============

export interface ThreadShareRecord {
  id: string;
  thread_id: string;
  share_token: string;
  created_by: number;
  allow_download: number;
  expires_at: string | null;
  view_count: number;
  created_at: string;
  last_viewed_at: string | null;
  revoked_at: string | null;
}

// ============ NEW: Agent Bot Records ============

export interface AgentBotRecord {
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

export interface AgentBotVersionRecord {
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

export interface AgentBotVersionCategoryRecord {
  version_id: string;
  category_id: number;
}

export interface AgentBotVersionSkillRecord {
  version_id: string;
  skill_id: number;
}

export interface AgentBotVersionToolRecord {
  id: string;
  version_id: string;
  tool_name: string;
  is_enabled: number;
  config_override: string | null;
}

export interface AgentBotApiKeyRecord {
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

// ============ NEW: Task Plan Records ============

export interface TaskPlanRecord {
  id: string;
  thread_id: string;
  user_id: string;
  category_slug: string | null;
  title: string | null;
  tasks_json: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  mode: string | null;
  budget_json: string | null;
  budget_used_json: string | null;
  model_config_json: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  resumed_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ============ Export Functions ============

/**
 * Export all documents
 */
export function exportDocuments(): DbDocument[] {
  return queryAll<DbDocument>(`
    SELECT id, filename, filepath, file_size, is_global, chunk_count, status, error_message, uploaded_by, created_at
    FROM documents
    ORDER BY id
  `);
}

/**
 * Export all categories
 */
export function exportCategories(): DbCategory[] {
  return queryAll<DbCategory>(`
    SELECT id, name, slug, description, created_by, created_at
    FROM categories
    ORDER BY id
  `);
}

/**
 * Export document-category relationships
 */
export function exportDocumentCategories(): DocumentCategoryRecord[] {
  return queryAll<DocumentCategoryRecord>(`
    SELECT document_id, category_id
    FROM document_categories
    ORDER BY document_id, category_id
  `);
}

/**
 * Export all users
 */
export function exportUsers(): DbUser[] {
  return queryAll<DbUser>(`
    SELECT id, email, name, role, added_by, created_at, updated_at
    FROM users
    ORDER BY id
  `);
}

/**
 * Export user subscriptions
 */
export function exportUserSubscriptions(): UserSubscriptionRecord[] {
  return queryAll<UserSubscriptionRecord>(`
    SELECT user_id, category_id, is_active, subscribed_at, subscribed_by
    FROM user_subscriptions
    ORDER BY user_id, category_id
  `);
}

/**
 * Export super user category assignments
 */
export function exportSuperUserCategories(): SuperUserCategoryRecord[] {
  return queryAll<SuperUserCategoryRecord>(`
    SELECT user_id, category_id, assigned_at, assigned_by
    FROM super_user_categories
    ORDER BY user_id, category_id
  `);
}

/**
 * Export all threads
 */
export function exportThreads(): ThreadRecord[] {
  return queryAll<ThreadRecord>(`
    SELECT id, user_id, title, created_at, updated_at
    FROM threads
    ORDER BY id
  `);
}

/**
 * Export all messages (includes artifact columns)
 */
export function exportMessages(): MessageRecord[] {
  return queryAll<MessageRecord>(`
    SELECT id, thread_id, role, content, sources_json, attachments_json,
           tool_calls_json, tool_call_id, tool_name,
           generated_documents_json, visualizations_json, generated_images_json,
           created_at
    FROM messages
    ORDER BY thread_id, created_at
  `);
}

/**
 * Export thread categories
 */
export function exportThreadCategories(): ThreadCategoryRecord[] {
  return queryAll<ThreadCategoryRecord>(`
    SELECT thread_id, category_id
    FROM thread_categories
    ORDER BY thread_id, category_id
  `);
}

/**
 * Export thread uploads
 */
export function exportThreadUploads(): ThreadUploadRecord[] {
  return queryAll<ThreadUploadRecord>(`
    SELECT id, thread_id, filename, filepath, file_size, uploaded_at
    FROM thread_uploads
    ORDER BY id
  `);
}

/**
 * Export thread outputs
 */
export function exportThreadOutputs(): ThreadOutputRecord[] {
  return queryAll<ThreadOutputRecord>(`
    SELECT id, thread_id, message_id, filename, filepath, file_type, file_size, created_at
    FROM thread_outputs
    ORDER BY id
  `);
}

/**
 * Export all settings
 */
export function exportSettings(): SettingRecord[] {
  return queryAll<SettingRecord>(`
    SELECT key, value, updated_at, updated_by
    FROM settings
    ORDER BY key
  `);
}

/**
 * Export all tool configurations
 */
export function exportToolConfigs(): ToolConfigRecord[] {
  return queryAll<ToolConfigRecord>(`
    SELECT id, tool_name, is_enabled, config_json, created_at, updated_at, updated_by
    FROM tool_configs
    ORDER BY tool_name
  `);
}

/**
 * Export category tool configurations (includes config_json)
 */
export function exportCategoryToolConfigs(): CategoryToolConfigRecord[] {
  return queryAll<CategoryToolConfigRecord>(`
    SELECT id, category_id, tool_name, is_enabled, branding_json, config_json,
           created_at, updated_at, updated_by
    FROM category_tool_configs
    ORDER BY category_id, tool_name
  `);
}

/**
 * Export all skills (includes tool routing columns)
 */
export function exportSkills(): SkillRecord[] {
  return queryAll<SkillRecord>(`
    SELECT id, name, description, prompt_content, trigger_type, trigger_value,
           category_restricted, is_index, priority, is_active, is_core,
           created_by_role, token_estimate, created_at, updated_at, created_by, updated_by,
           match_type, tool_name, force_mode, tool_config_override, data_source_filter
    FROM skills
    ORDER BY id
  `);
}

/**
 * Export category-skill relationships
 */
export function exportCategorySkills(): CategorySkillRecord[] {
  return queryAll<CategorySkillRecord>(`
    SELECT category_id, skill_id
    FROM category_skills
    ORDER BY category_id, skill_id
  `);
}

/**
 * Export category prompts (includes starter prompts and welcome fields)
 */
export function exportCategoryPrompts(): CategoryPromptRecord[] {
  return queryAll<CategoryPromptRecord>(`
    SELECT category_id, prompt_addendum, starter_prompts,
           welcome_title, welcome_message,
           updated_at, updated_by
    FROM category_prompts
    ORDER BY category_id
  `);
}

/**
 * Export data API configurations
 */
export function exportDataApiConfigs(): DataApiConfigRecord[] {
  return queryAll<DataApiConfigRecord>(`
    SELECT id, name, description, endpoint, method, response_format,
           authentication, headers, parameters, response_structure,
           sample_response, openapi_spec, config_method, status,
           created_by, created_at, updated_at
    FROM data_api_configs
    ORDER BY name
  `);
}

/**
 * Export data API to category mappings
 */
export function exportDataApiCategories(): DataApiCategoryRecord[] {
  return queryAll<DataApiCategoryRecord>(`
    SELECT api_id, category_id, created_at
    FROM data_api_categories
    ORDER BY api_id, category_id
  `);
}

/**
 * Export data CSV configurations
 */
export function exportDataCsvConfigs(): DataCsvConfigRecord[] {
  return queryAll<DataCsvConfigRecord>(`
    SELECT id, name, description, file_path, original_filename,
           columns, sample_data, row_count, file_size,
           created_by, created_at, updated_at
    FROM data_csv_configs
    ORDER BY name
  `);
}

/**
 * Export data CSV to category mappings
 */
export function exportDataCsvCategories(): DataCsvCategoryRecord[] {
  return queryAll<DataCsvCategoryRecord>(`
    SELECT csv_id, category_id, created_at
    FROM data_csv_categories
    ORDER BY csv_id, category_id
  `);
}

// ============ NEW: Workspace Export Functions ============

/**
 * Export all workspaces
 */
export function exportWorkspaces(): WorkspaceRecord[] {
  return queryAll<WorkspaceRecord>(`
    SELECT id, slug, name, type, is_enabled, access_mode,
           primary_color, logo_url, chat_title, greeting_message, suggested_prompts, footer_text,
           llm_provider, llm_model, temperature, system_prompt,
           allowed_domains, daily_limit, session_limit,
           voice_enabled, file_upload_enabled, max_file_size_mb,
           created_by, created_by_role, created_at, updated_at
    FROM workspaces
    ORDER BY name
  `);
}

/**
 * Export workspace-category relationships
 */
export function exportWorkspaceCategories(): WorkspaceCategoryRecord[] {
  return queryAll<WorkspaceCategoryRecord>(`
    SELECT workspace_id, category_id
    FROM workspace_categories
    ORDER BY workspace_id, category_id
  `);
}

/**
 * Export workspace-user relationships
 */
export function exportWorkspaceUsers(): WorkspaceUserRecord[] {
  return queryAll<WorkspaceUserRecord>(`
    SELECT workspace_id, user_id, added_by, added_at
    FROM workspace_users
    ORDER BY workspace_id, user_id
  `);
}

// ============ NEW: Function API Export Functions ============

/**
 * Export function API configurations
 */
export function exportFunctionApiConfigs(): FunctionApiConfigRecord[] {
  return queryAll<FunctionApiConfigRecord>(`
    SELECT id, name, description, base_url, auth_type, auth_header, auth_credentials,
           default_headers, tools_schema, endpoint_mappings, timeout_seconds,
           cache_ttl_seconds, is_enabled, status, created_by, created_at, updated_at,
           last_tested, last_error
    FROM function_api_configs
    ORDER BY name
  `);
}

/**
 * Export function API to category mappings
 */
export function exportFunctionApiCategories(): FunctionApiCategoryRecord[] {
  return queryAll<FunctionApiCategoryRecord>(`
    SELECT api_id, category_id, created_at
    FROM function_api_categories
    ORDER BY api_id, category_id
  `);
}

// ============ NEW: User Memory Export Functions ============

/**
 * Export user memories
 */
export function exportUserMemories(): UserMemoryRecord[] {
  return queryAll<UserMemoryRecord>(`
    SELECT id, user_id, category_id, facts_json, created_at, updated_at
    FROM user_memories
    ORDER BY user_id, category_id
  `);
}

// ============ NEW: Tool Routing Export Functions ============

/**
 * Export tool routing rules
 */
export function exportToolRoutingRules(): ToolRoutingRuleRecord[] {
  return queryAll<ToolRoutingRuleRecord>(`
    SELECT id, tool_name, rule_name, rule_type, patterns, force_mode,
           priority, category_ids, is_active, created_at, updated_at,
           created_by, updated_by
    FROM tool_routing_rules
    ORDER BY priority, tool_name
  `);
}

// ============ NEW: Thread Share Export Functions ============

/**
 * Export thread shares
 */
export function exportThreadShares(): ThreadShareRecord[] {
  return queryAll<ThreadShareRecord>(`
    SELECT id, thread_id, share_token, created_by, allow_download,
           expires_at, view_count, created_at, last_viewed_at, revoked_at
    FROM thread_shares
    ORDER BY created_at
  `);
}

// ============ NEW: Task Plan Export Functions ============

/**
 * Export task plans
 */
export function exportTaskPlans(): TaskPlanRecord[] {
  return queryAll<TaskPlanRecord>(`
    SELECT id, thread_id, user_id, category_slug, title, tasks_json, status,
           total_tasks, completed_tasks, failed_tasks, mode, budget_json,
           budget_used_json, model_config_json, paused_at, pause_reason,
           resumed_at, stopped_at, stop_reason, created_at, updated_at, completed_at
    FROM task_plans
    ORDER BY created_at
  `);
}

// ============ NEW: Agent Bot Export Functions ============

/**
 * Export all agent bots
 */
export function exportAgentBots(): AgentBotRecord[] {
  return queryAll<AgentBotRecord>(`
    SELECT id, name, slug, description, is_active, created_by, created_by_role,
           created_at, updated_at
    FROM agent_bots
    ORDER BY name
  `);
}

/**
 * Export all agent bot versions
 */
export function exportAgentBotVersions(): AgentBotVersionRecord[] {
  return queryAll<AgentBotVersionRecord>(`
    SELECT id, agent_bot_id, version_number, version_label, is_default,
           input_schema, output_config, system_prompt, llm_model, temperature,
           max_tokens, is_active, created_by, created_at, updated_at
    FROM agent_bot_versions
    ORDER BY agent_bot_id, version_number
  `);
}

/**
 * Export agent bot version to category mappings
 */
export function exportAgentBotVersionCategories(): AgentBotVersionCategoryRecord[] {
  return queryAll<AgentBotVersionCategoryRecord>(`
    SELECT version_id, category_id
    FROM agent_bot_version_categories
    ORDER BY version_id, category_id
  `);
}

/**
 * Export agent bot version to skill mappings
 */
export function exportAgentBotVersionSkills(): AgentBotVersionSkillRecord[] {
  return queryAll<AgentBotVersionSkillRecord>(`
    SELECT version_id, skill_id
    FROM agent_bot_version_skills
    ORDER BY version_id, skill_id
  `);
}

/**
 * Export agent bot version tool configurations
 */
export function exportAgentBotVersionTools(): AgentBotVersionToolRecord[] {
  return queryAll<AgentBotVersionToolRecord>(`
    SELECT id, version_id, tool_name, is_enabled, config_override
    FROM agent_bot_version_tools
    ORDER BY version_id, tool_name
  `);
}

/**
 * Export agent bot API keys (config only, no jobs/usage)
 */
export function exportAgentBotApiKeys(): AgentBotApiKeyRecord[] {
  return queryAll<AgentBotApiKeyRecord>(`
    SELECT id, agent_bot_id, name, key_prefix, key_hash, permissions,
           rate_limit_rpm, rate_limit_rpd, expires_at, last_used_at,
           is_active, created_by, created_at, revoked_at
    FROM agent_bot_api_keys
    ORDER BY agent_bot_id, name
  `);
}

// ============ Category-Filtered Export Functions ============

/**
 * Export documents for specific categories (includes global documents)
 */
export function exportDocumentsForCategories(categoryIds: number[]): DbDocument[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<DbDocument>(`
    SELECT DISTINCT d.id, d.filename, d.filepath, d.file_size, d.is_global,
           d.chunk_count, d.status, d.error_message, d.uploaded_by, d.created_at
    FROM documents d
    LEFT JOIN document_categories dc ON d.id = dc.document_id
    WHERE dc.category_id IN (${placeholders}) OR d.is_global = 1
    ORDER BY d.id
  `, categoryIds);
}

/**
 * Export threads for categories using STRICT filtering
 * Only includes threads where ALL linked categories are in the selected set
 */
export function exportThreadsForCategoriesStrict(categoryIds: number[]): ThreadRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  // Thread must have at least one category AND all its categories must be in selected set
  return queryAll<ThreadRecord>(`
    SELECT t.id, t.user_id, t.title, t.created_at, t.updated_at
    FROM threads t
    WHERE EXISTS (
      SELECT 1 FROM thread_categories tc WHERE tc.thread_id = t.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM thread_categories tc
      WHERE tc.thread_id = t.id
      AND tc.category_id NOT IN (${placeholders})
    )
    ORDER BY t.id
  `, categoryIds);
}

/**
 * Export skills for specific categories
 * Includes: all non-category-restricted skills (category_restricted=0) + skills linked to selected categories
 */
export function exportSkillsForCategories(categoryIds: number[]): SkillRecord[] {
  if (categoryIds.length === 0) {
    // If no categories, just return non-restricted skills
    return queryAll<SkillRecord>(`
      SELECT id, name, description, prompt_content, trigger_type, trigger_value,
             category_restricted, is_index, priority, is_active, is_core,
             created_by_role, token_estimate, created_at, updated_at, created_by, updated_by,
             match_type, tool_name, force_mode, tool_config_override, data_source_filter
      FROM skills
      WHERE category_restricted = 0
      ORDER BY id
    `);
  }
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<SkillRecord>(`
    SELECT DISTINCT s.id, s.name, s.description, s.prompt_content, s.trigger_type, s.trigger_value,
           s.category_restricted, s.is_index, s.priority, s.is_active, s.is_core,
           s.created_by_role, s.token_estimate, s.created_at, s.updated_at, s.created_by, s.updated_by,
           s.match_type, s.tool_name, s.force_mode, s.tool_config_override, s.data_source_filter
    FROM skills s
    LEFT JOIN category_skills cs ON s.id = cs.skill_id
    WHERE s.category_restricted = 0 OR cs.category_id IN (${placeholders})
    ORDER BY s.id
  `, categoryIds);
}

/**
 * Export workspaces for specific categories
 */
export function exportWorkspacesForCategories(categoryIds: number[]): WorkspaceRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<WorkspaceRecord>(`
    SELECT DISTINCT w.id, w.slug, w.name, w.type, w.is_enabled, w.access_mode,
           w.primary_color, w.logo_url, w.chat_title, w.greeting_message, w.suggested_prompts, w.footer_text,
           w.llm_provider, w.llm_model, w.temperature, w.system_prompt,
           w.allowed_domains, w.daily_limit, w.session_limit,
           w.voice_enabled, w.file_upload_enabled, w.max_file_size_mb,
           w.created_by, w.created_by_role, w.created_at, w.updated_at
    FROM workspaces w
    JOIN workspace_categories wc ON w.id = wc.workspace_id
    WHERE wc.category_id IN (${placeholders})
    ORDER BY w.name
  `, categoryIds);
}

/**
 * Export data API configurations for specific categories
 */
export function exportDataApiConfigsForCategories(categoryIds: number[]): DataApiConfigRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<DataApiConfigRecord>(`
    SELECT DISTINCT d.id, d.name, d.description, d.endpoint, d.method, d.response_format,
           d.authentication, d.headers, d.parameters, d.response_structure,
           d.sample_response, d.openapi_spec, d.config_method, d.status,
           d.created_by, d.created_at, d.updated_at
    FROM data_api_configs d
    JOIN data_api_categories dac ON d.id = dac.api_id
    WHERE dac.category_id IN (${placeholders})
    ORDER BY d.name
  `, categoryIds);
}

/**
 * Export data CSV configurations for specific categories
 */
export function exportDataCsvConfigsForCategories(categoryIds: number[]): DataCsvConfigRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<DataCsvConfigRecord>(`
    SELECT DISTINCT d.id, d.name, d.description, d.file_path, d.original_filename,
           d.columns, d.sample_data, d.row_count, d.file_size,
           d.created_by, d.created_at, d.updated_at
    FROM data_csv_configs d
    JOIN data_csv_categories dcc ON d.id = dcc.csv_id
    WHERE dcc.category_id IN (${placeholders})
    ORDER BY d.name
  `, categoryIds);
}

/**
 * Export function API configurations for specific categories
 */
export function exportFunctionApiConfigsForCategories(categoryIds: number[]): FunctionApiConfigRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<FunctionApiConfigRecord>(`
    SELECT DISTINCT f.id, f.name, f.description, f.base_url, f.auth_type, f.auth_header, f.auth_credentials,
           f.default_headers, f.tools_schema, f.endpoint_mappings, f.timeout_seconds,
           f.cache_ttl_seconds, f.is_enabled, f.status, f.created_by, f.created_at, f.updated_at,
           f.last_tested, f.last_error
    FROM function_api_configs f
    JOIN function_api_categories fac ON f.id = fac.api_id
    WHERE fac.category_id IN (${placeholders})
    ORDER BY f.name
  `, categoryIds);
}

/**
 * Export agent bots for specific categories (via version categories)
 */
export function exportAgentBotsForCategories(categoryIds: number[]): AgentBotRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<AgentBotRecord>(`
    SELECT DISTINCT ab.id, ab.name, ab.slug, ab.description, ab.is_active,
           ab.created_by, ab.created_by_role, ab.created_at, ab.updated_at
    FROM agent_bots ab
    JOIN agent_bot_versions abv ON ab.id = abv.agent_bot_id
    JOIN agent_bot_version_categories abvc ON abv.id = abvc.version_id
    WHERE abvc.category_id IN (${placeholders})
    ORDER BY ab.name
  `, categoryIds);
}

/**
 * Export agent bot versions for specific bot IDs
 */
export function exportAgentBotVersionsForBots(botIds: string[]): AgentBotVersionRecord[] {
  if (botIds.length === 0) return [];
  const placeholders = botIds.map(() => '?').join(',');
  return queryAll<AgentBotVersionRecord>(`
    SELECT id, agent_bot_id, version_number, version_label, is_default,
           input_schema, output_config, system_prompt, llm_model, temperature,
           max_tokens, is_active, created_by, created_at, updated_at
    FROM agent_bot_versions
    WHERE agent_bot_id IN (${placeholders})
    ORDER BY agent_bot_id, version_number
  `, botIds);
}

/**
 * Export agent bot API keys for specific bot IDs
 */
export function exportAgentBotApiKeysForBots(botIds: string[]): AgentBotApiKeyRecord[] {
  if (botIds.length === 0) return [];
  const placeholders = botIds.map(() => '?').join(',');
  return queryAll<AgentBotApiKeyRecord>(`
    SELECT id, agent_bot_id, name, key_prefix, key_hash, permissions,
           rate_limit_rpm, rate_limit_rpd, expires_at, last_used_at,
           is_active, created_by, created_at, revoked_at
    FROM agent_bot_api_keys
    WHERE agent_bot_id IN (${placeholders})
    ORDER BY agent_bot_id, name
  `, botIds);
}

/**
 * Export category prompts for specific categories
 */
export function exportCategoryPromptsForCategories(categoryIds: number[]): CategoryPromptRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<CategoryPromptRecord>(`
    SELECT category_id, prompt_addendum, starter_prompts,
           welcome_title, welcome_message,
           updated_at, updated_by
    FROM category_prompts
    WHERE category_id IN (${placeholders})
    ORDER BY category_id
  `, categoryIds);
}

/**
 * Export category tool configurations for specific categories
 */
export function exportCategoryToolConfigsForCategories(categoryIds: number[]): CategoryToolConfigRecord[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<CategoryToolConfigRecord>(`
    SELECT id, category_id, tool_name, is_enabled, branding_json, config_json,
           created_at, updated_at, updated_by
    FROM category_tool_configs
    WHERE category_id IN (${placeholders})
    ORDER BY category_id, tool_name
  `, categoryIds);
}

/**
 * Export messages for specific thread IDs
 */
export function exportMessagesForThreads(threadIds: string[]): MessageRecord[] {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => '?').join(',');
  return queryAll<MessageRecord>(`
    SELECT id, thread_id, role, content, sources_json, attachments_json,
           tool_calls_json, tool_call_id, tool_name,
           generated_documents_json, visualizations_json, generated_images_json,
           created_at
    FROM messages
    WHERE thread_id IN (${placeholders})
    ORDER BY thread_id, created_at
  `, threadIds);
}

/**
 * Export thread categories filtered by both thread IDs and category IDs
 */
export function exportThreadCategoriesFiltered(threadIds: string[], categoryIds: number[]): ThreadCategoryRecord[] {
  if (threadIds.length === 0 || categoryIds.length === 0) return [];
  const threadPlaceholders = threadIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<ThreadCategoryRecord>(`
    SELECT thread_id, category_id
    FROM thread_categories
    WHERE thread_id IN (${threadPlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY thread_id, category_id
  `, [...threadIds, ...categoryIds]);
}

/**
 * Export thread uploads for specific thread IDs
 */
export function exportThreadUploadsForThreads(threadIds: string[]): ThreadUploadRecord[] {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => '?').join(',');
  return queryAll<ThreadUploadRecord>(`
    SELECT id, thread_id, filename, filepath, file_size, uploaded_at
    FROM thread_uploads
    WHERE thread_id IN (${placeholders})
    ORDER BY id
  `, threadIds);
}

/**
 * Export thread outputs for specific thread IDs
 */
export function exportThreadOutputsForThreads(threadIds: string[]): ThreadOutputRecord[] {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => '?').join(',');
  return queryAll<ThreadOutputRecord>(`
    SELECT id, thread_id, message_id, filename, filepath, file_type, file_size, created_at
    FROM thread_outputs
    WHERE thread_id IN (${placeholders})
    ORDER BY id
  `, threadIds);
}

/**
 * Export thread shares for specific thread IDs
 */
export function exportThreadSharesForThreads(threadIds: string[]): ThreadShareRecord[] {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => '?').join(',');
  return queryAll<ThreadShareRecord>(`
    SELECT id, thread_id, share_token, created_by, allow_download,
           expires_at, view_count, created_at, last_viewed_at, revoked_at
    FROM thread_shares
    WHERE thread_id IN (${placeholders})
    ORDER BY created_at
  `, threadIds);
}

/**
 * Export task plans for specific thread IDs
 */
export function exportTaskPlansForThreads(threadIds: string[]): TaskPlanRecord[] {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => '?').join(',');
  return queryAll<TaskPlanRecord>(`
    SELECT id, thread_id, user_id, category_slug, title, tasks_json, status,
           total_tasks, completed_tasks, failed_tasks, mode, budget_json,
           budget_used_json, model_config_json, paused_at, pause_reason,
           resumed_at, stopped_at, stop_reason, created_at, updated_at, completed_at
    FROM task_plans
    WHERE thread_id IN (${placeholders})
    ORDER BY created_at
  `, threadIds);
}

/**
 * Export document categories filtered by both document IDs and category IDs
 */
export function exportDocumentCategoriesFiltered(docIds: number[], categoryIds: number[]): DocumentCategoryRecord[] {
  if (docIds.length === 0 || categoryIds.length === 0) return [];
  const docPlaceholders = docIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<DocumentCategoryRecord>(`
    SELECT document_id, category_id
    FROM document_categories
    WHERE document_id IN (${docPlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY document_id, category_id
  `, [...docIds, ...categoryIds]);
}

/**
 * Export category skills filtered by both skill IDs and category IDs
 */
export function exportCategorySkillsFiltered(skillIds: number[], categoryIds: number[]): CategorySkillRecord[] {
  if (skillIds.length === 0 || categoryIds.length === 0) return [];
  const skillPlaceholders = skillIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<CategorySkillRecord>(`
    SELECT category_id, skill_id
    FROM category_skills
    WHERE skill_id IN (${skillPlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY category_id, skill_id
  `, [...skillIds, ...categoryIds]);
}

/**
 * Export workspace categories filtered by both workspace IDs and category IDs
 */
export function exportWorkspaceCategoriesFiltered(workspaceIds: string[], categoryIds: number[]): WorkspaceCategoryRecord[] {
  if (workspaceIds.length === 0 || categoryIds.length === 0) return [];
  const workspacePlaceholders = workspaceIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<WorkspaceCategoryRecord>(`
    SELECT workspace_id, category_id
    FROM workspace_categories
    WHERE workspace_id IN (${workspacePlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY workspace_id, category_id
  `, [...workspaceIds, ...categoryIds]);
}

/**
 * Export workspace users for specific workspace IDs
 */
export function exportWorkspaceUsersForWorkspaces(workspaceIds: string[]): WorkspaceUserRecord[] {
  if (workspaceIds.length === 0) return [];
  const placeholders = workspaceIds.map(() => '?').join(',');
  return queryAll<WorkspaceUserRecord>(`
    SELECT workspace_id, user_id, added_by, added_at
    FROM workspace_users
    WHERE workspace_id IN (${placeholders})
    ORDER BY workspace_id, user_id
  `, workspaceIds);
}

/**
 * Export data API categories filtered by both API IDs and category IDs
 */
export function exportDataApiCategoriesFiltered(apiIds: string[], categoryIds: number[]): DataApiCategoryRecord[] {
  if (apiIds.length === 0 || categoryIds.length === 0) return [];
  const apiPlaceholders = apiIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<DataApiCategoryRecord>(`
    SELECT api_id, category_id, created_at
    FROM data_api_categories
    WHERE api_id IN (${apiPlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY api_id, category_id
  `, [...apiIds, ...categoryIds]);
}

/**
 * Export data CSV categories filtered by both CSV IDs and category IDs
 */
export function exportDataCsvCategoriesFiltered(csvIds: string[], categoryIds: number[]): DataCsvCategoryRecord[] {
  if (csvIds.length === 0 || categoryIds.length === 0) return [];
  const csvPlaceholders = csvIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<DataCsvCategoryRecord>(`
    SELECT csv_id, category_id, created_at
    FROM data_csv_categories
    WHERE csv_id IN (${csvPlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY csv_id, category_id
  `, [...csvIds, ...categoryIds]);
}

/**
 * Export function API categories filtered by both API IDs and category IDs
 */
export function exportFunctionApiCategoriesFiltered(apiIds: string[], categoryIds: number[]): FunctionApiCategoryRecord[] {
  if (apiIds.length === 0 || categoryIds.length === 0) return [];
  const apiPlaceholders = apiIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<FunctionApiCategoryRecord>(`
    SELECT api_id, category_id, created_at
    FROM function_api_categories
    WHERE api_id IN (${apiPlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY api_id, category_id
  `, [...apiIds, ...categoryIds]);
}

/**
 * Export agent bot version categories filtered by both version IDs and category IDs
 */
export function exportAgentBotVersionCategoriesFiltered(versionIds: string[], categoryIds: number[]): AgentBotVersionCategoryRecord[] {
  if (versionIds.length === 0 || categoryIds.length === 0) return [];
  const versionPlaceholders = versionIds.map(() => '?').join(',');
  const categoryPlaceholders = categoryIds.map(() => '?').join(',');
  return queryAll<AgentBotVersionCategoryRecord>(`
    SELECT version_id, category_id
    FROM agent_bot_version_categories
    WHERE version_id IN (${versionPlaceholders})
    AND category_id IN (${categoryPlaceholders})
    ORDER BY version_id, category_id
  `, [...versionIds, ...categoryIds]);
}

/**
 * Export agent bot version skills for specific version IDs
 */
export function exportAgentBotVersionSkillsForVersions(versionIds: string[]): AgentBotVersionSkillRecord[] {
  if (versionIds.length === 0) return [];
  const placeholders = versionIds.map(() => '?').join(',');
  return queryAll<AgentBotVersionSkillRecord>(`
    SELECT version_id, skill_id
    FROM agent_bot_version_skills
    WHERE version_id IN (${placeholders})
    ORDER BY version_id, skill_id
  `, versionIds);
}

/**
 * Export agent bot version tools for specific version IDs
 */
export function exportAgentBotVersionToolsForVersions(versionIds: string[]): AgentBotVersionToolRecord[] {
  if (versionIds.length === 0) return [];
  const placeholders = versionIds.map(() => '?').join(',');
  return queryAll<AgentBotVersionToolRecord>(`
    SELECT id, version_id, tool_name, is_enabled, config_override
    FROM agent_bot_version_tools
    WHERE version_id IN (${placeholders})
    ORDER BY version_id, tool_name
  `, versionIds);
}

/**
 * Export specific categories by IDs
 */
export function exportCategoriesById(categoryIds: number[]): DbCategory[] {
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');
  return queryAll<DbCategory>(`
    SELECT id, name, slug, description, created_by, created_at
    FROM categories
    WHERE id IN (${placeholders})
    ORDER BY id
  `, categoryIds);
}

// ============ Import Functions ============

/**
 * Import documents (preserves IDs)
 */
export function importDocuments(records: DbDocument[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO documents (id, filename, filepath, file_size, is_global, chunk_count, status, error_message, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const doc of records) {
    stmt.run(
      doc.id,
      doc.filename,
      doc.filepath,
      doc.file_size,
      doc.is_global,
      doc.chunk_count,
      doc.status,
      doc.error_message,
      doc.uploaded_by,
      doc.created_at
    );
  }
}

/**
 * Import categories (preserves IDs)
 */
export function importCategories(records: DbCategory[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, slug, description, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const cat of records) {
    stmt.run(
      cat.id,
      cat.name,
      cat.slug,
      cat.description,
      cat.created_by,
      cat.created_at
    );
  }
}

/**
 * Import document-category relationships
 */
export function importDocumentCategories(records: DocumentCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO document_categories (document_id, category_id)
    VALUES (?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.document_id, rec.category_id);
  }
}

/**
 * Import users (preserves IDs)
 */
export function importUsers(records: DbUser[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO users (id, email, name, role, added_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const user of records) {
    stmt.run(
      user.id,
      user.email,
      user.name,
      user.role,
      user.added_by,
      user.created_at,
      user.updated_at
    );
  }
}

/**
 * Import user subscriptions
 */
export function importUserSubscriptions(records: UserSubscriptionRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO user_subscriptions (user_id, category_id, is_active, subscribed_at, subscribed_by)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.user_id,
      rec.category_id,
      rec.is_active,
      rec.subscribed_at,
      rec.subscribed_by
    );
  }
}

/**
 * Import super user category assignments
 */
export function importSuperUserCategories(records: SuperUserCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO super_user_categories (user_id, category_id, assigned_at, assigned_by)
    VALUES (?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.user_id,
      rec.category_id,
      rec.assigned_at,
      rec.assigned_by
    );
  }
}

/**
 * Import threads (preserves IDs)
 */
export function importThreads(records: ThreadRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO threads (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const thread of records) {
    stmt.run(
      thread.id,
      thread.user_id,
      thread.title,
      thread.created_at,
      thread.updated_at
    );
  }
}

/**
 * Import messages (includes artifact columns)
 */
export function importMessages(records: MessageRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO messages (
      id, thread_id, role, content, sources_json, attachments_json,
      tool_calls_json, tool_call_id, tool_name,
      generated_documents_json, visualizations_json, generated_images_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const msg of records) {
    stmt.run(
      msg.id,
      msg.thread_id,
      msg.role,
      msg.content,
      msg.sources_json,
      msg.attachments_json,
      msg.tool_calls_json,
      msg.tool_call_id,
      msg.tool_name,
      msg.generated_documents_json ?? null,
      msg.visualizations_json ?? null,
      msg.generated_images_json ?? null,
      msg.created_at
    );
  }
}

/**
 * Import thread categories
 */
export function importThreadCategories(records: ThreadCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO thread_categories (thread_id, category_id)
    VALUES (?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.thread_id, rec.category_id);
  }
}

/**
 * Import thread uploads
 */
export function importThreadUploads(records: ThreadUploadRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO thread_uploads (id, thread_id, filename, filepath, file_size, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id,
      rec.thread_id,
      rec.filename,
      rec.filepath,
      rec.file_size,
      rec.uploaded_at
    );
  }
}

/**
 * Import thread outputs
 */
export function importThreadOutputs(records: ThreadOutputRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO thread_outputs (id, thread_id, message_id, filename, filepath, file_type, file_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id,
      rec.thread_id,
      rec.message_id,
      rec.filename,
      rec.filepath,
      rec.file_type,
      rec.file_size,
      rec.created_at
    );
  }
}

/**
 * Import settings
 */
export function importSettings(records: SettingRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
  `);

  for (const setting of records) {
    stmt.run(
      setting.key,
      setting.value,
      setting.updated_at,
      setting.updated_by
    );
  }
}

/**
 * Import tool configurations
 */
export function importToolConfigs(records: ToolConfigRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tool_configs (id, tool_name, is_enabled, config_json, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id,
      rec.tool_name,
      rec.is_enabled,
      rec.config_json,
      rec.created_at,
      rec.updated_at,
      rec.updated_by
    );
  }
}

/**
 * Import category tool configurations (includes config_json)
 */
export function importCategoryToolConfigs(records: CategoryToolConfigRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO category_tool_configs (
      id, category_id, tool_name, is_enabled, branding_json, config_json,
      created_at, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id,
      rec.category_id,
      rec.tool_name,
      rec.is_enabled,
      rec.branding_json,
      rec.config_json ?? null,
      rec.created_at,
      rec.updated_at,
      rec.updated_by
    );
  }
}

/**
 * Import skills (preserves IDs, includes tool routing columns)
 */
export function importSkills(records: SkillRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO skills (
      id, name, description, prompt_content, trigger_type, trigger_value,
      category_restricted, is_index, priority, is_active, is_core,
      created_by_role, token_estimate, created_at, updated_at, created_by, updated_by,
      match_type, tool_name, force_mode, tool_config_override, data_source_filter
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id,
      rec.name,
      rec.description,
      rec.prompt_content,
      rec.trigger_type,
      rec.trigger_value,
      rec.category_restricted,
      rec.is_index,
      rec.priority,
      rec.is_active,
      rec.is_core,
      rec.created_by_role,
      rec.token_estimate,
      rec.created_at,
      rec.updated_at,
      rec.created_by,
      rec.updated_by,
      rec.match_type ?? null,
      rec.tool_name ?? null,
      rec.force_mode ?? null,
      rec.tool_config_override ?? null,
      rec.data_source_filter ?? null
    );
  }
}

/**
 * Import category-skill relationships
 */
export function importCategorySkills(records: CategorySkillRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO category_skills (category_id, skill_id)
    VALUES (?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.category_id, rec.skill_id);
  }
}

/**
 * Import category prompts (includes starter prompts and welcome fields)
 */
export function importCategoryPrompts(records: CategoryPromptRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO category_prompts (
      category_id, prompt_addendum, starter_prompts,
      welcome_title, welcome_message,
      updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.category_id,
      rec.prompt_addendum,
      rec.starter_prompts,
      rec.welcome_title ?? null,
      rec.welcome_message ?? null,
      rec.updated_at,
      rec.updated_by
    );
  }
}

/**
 * Import data API configurations
 */
export function importDataApiConfigs(records: DataApiConfigRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO data_api_configs (
      id, name, description, endpoint, method, response_format,
      authentication, headers, parameters, response_structure,
      sample_response, openapi_spec, config_method, status,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id,
      rec.name,
      rec.description,
      rec.endpoint,
      rec.method,
      rec.response_format,
      rec.authentication,
      rec.headers,
      rec.parameters,
      rec.response_structure,
      rec.sample_response,
      rec.openapi_spec,
      rec.config_method,
      rec.status,
      rec.created_by,
      rec.created_at,
      rec.updated_at
    );
  }
}

/**
 * Import data API to category mappings
 */
export function importDataApiCategories(records: DataApiCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO data_api_categories (api_id, category_id, created_at)
    VALUES (?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.api_id, rec.category_id, rec.created_at);
  }
}

/**
 * Import data CSV configurations
 */
export function importDataCsvConfigs(records: DataCsvConfigRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO data_csv_configs (
      id, name, description, file_path, original_filename,
      columns, sample_data, row_count, file_size,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id,
      rec.name,
      rec.description,
      rec.file_path,
      rec.original_filename,
      rec.columns,
      rec.sample_data,
      rec.row_count,
      rec.file_size,
      rec.created_by,
      rec.created_at,
      rec.updated_at
    );
  }
}

/**
 * Import data CSV to category mappings
 */
export function importDataCsvCategories(records: DataCsvCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO data_csv_categories (csv_id, category_id, created_at)
    VALUES (?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.csv_id, rec.category_id, rec.created_at);
  }
}

// ============ NEW: Workspace Import Functions ============

/**
 * Import workspaces
 */
export function importWorkspaces(records: WorkspaceRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO workspaces (
      id, slug, name, type, is_enabled, access_mode,
      primary_color, logo_url, chat_title, greeting_message, suggested_prompts, footer_text,
      llm_provider, llm_model, temperature, system_prompt,
      allowed_domains, daily_limit, session_limit,
      voice_enabled, file_upload_enabled, max_file_size_mb,
      created_by, created_by_role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.slug, rec.name, rec.type, rec.is_enabled, rec.access_mode,
      rec.primary_color, rec.logo_url, rec.chat_title, rec.greeting_message,
      rec.suggested_prompts, rec.footer_text, rec.llm_provider, rec.llm_model,
      rec.temperature, rec.system_prompt, rec.allowed_domains, rec.daily_limit,
      rec.session_limit, rec.voice_enabled, rec.file_upload_enabled,
      rec.max_file_size_mb, rec.created_by, rec.created_by_role,
      rec.created_at, rec.updated_at
    );
  }
}

/**
 * Import workspace-category relationships
 */
export function importWorkspaceCategories(records: WorkspaceCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO workspace_categories (workspace_id, category_id)
    VALUES (?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.workspace_id, rec.category_id);
  }
}

/**
 * Import workspace-user relationships
 */
export function importWorkspaceUsers(records: WorkspaceUserRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO workspace_users (workspace_id, user_id, added_by, added_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.workspace_id, rec.user_id, rec.added_by, rec.added_at);
  }
}

// ============ NEW: Function API Import Functions ============

/**
 * Import function API configurations
 */
export function importFunctionApiConfigs(records: FunctionApiConfigRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO function_api_configs (
      id, name, description, base_url, auth_type, auth_header, auth_credentials,
      default_headers, tools_schema, endpoint_mappings, timeout_seconds,
      cache_ttl_seconds, is_enabled, status, created_by, created_at, updated_at,
      last_tested, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.name, rec.description, rec.base_url, rec.auth_type,
      rec.auth_header, rec.auth_credentials, rec.default_headers,
      rec.tools_schema, rec.endpoint_mappings, rec.timeout_seconds,
      rec.cache_ttl_seconds, rec.is_enabled, rec.status, rec.created_by,
      rec.created_at, rec.updated_at, rec.last_tested, rec.last_error
    );
  }
}

/**
 * Import function API to category mappings
 */
export function importFunctionApiCategories(records: FunctionApiCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO function_api_categories (api_id, category_id, created_at)
    VALUES (?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.api_id, rec.category_id, rec.created_at);
  }
}

// ============ NEW: User Memory Import Functions ============

/**
 * Import user memories
 */
export function importUserMemories(records: UserMemoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO user_memories (id, user_id, category_id, facts_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.id, rec.user_id, rec.category_id, rec.facts_json, rec.created_at, rec.updated_at);
  }
}

// ============ NEW: Tool Routing Import Functions ============

/**
 * Import tool routing rules
 */
export function importToolRoutingRules(records: ToolRoutingRuleRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tool_routing_rules (
      id, tool_name, rule_name, rule_type, patterns, force_mode,
      priority, category_ids, is_active, created_at, updated_at,
      created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.tool_name, rec.rule_name, rec.rule_type, rec.patterns,
      rec.force_mode, rec.priority, rec.category_ids, rec.is_active,
      rec.created_at, rec.updated_at, rec.created_by, rec.updated_by
    );
  }
}

// ============ NEW: Thread Share Import Functions ============

/**
 * Import thread shares
 */
export function importThreadShares(records: ThreadShareRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO thread_shares (
      id, thread_id, share_token, created_by, allow_download,
      expires_at, view_count, created_at, last_viewed_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.thread_id, rec.share_token, rec.created_by, rec.allow_download,
      rec.expires_at, rec.view_count, rec.created_at, rec.last_viewed_at, rec.revoked_at
    );
  }
}

// ============ NEW: Task Plan Import Functions ============

/**
 * Import task plans
 */
export function importTaskPlans(records: TaskPlanRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO task_plans (
      id, thread_id, user_id, category_slug, title, tasks_json, status,
      total_tasks, completed_tasks, failed_tasks, mode, budget_json,
      budget_used_json, model_config_json, paused_at, pause_reason,
      resumed_at, stopped_at, stop_reason, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.thread_id, rec.user_id, rec.category_slug, rec.title,
      rec.tasks_json, rec.status, rec.total_tasks, rec.completed_tasks,
      rec.failed_tasks, rec.mode, rec.budget_json, rec.budget_used_json,
      rec.model_config_json, rec.paused_at, rec.pause_reason, rec.resumed_at,
      rec.stopped_at, rec.stop_reason, rec.created_at, rec.updated_at, rec.completed_at
    );
  }
}

// ============ NEW: Agent Bot Import Functions ============

/**
 * Import agent bots
 */
export function importAgentBots(records: AgentBotRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_bots (
      id, name, slug, description, is_active, created_by, created_by_role,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.name, rec.slug, rec.description, rec.is_active,
      rec.created_by, rec.created_by_role, rec.created_at, rec.updated_at
    );
  }
}

/**
 * Import agent bot versions
 */
export function importAgentBotVersions(records: AgentBotVersionRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_bot_versions (
      id, agent_bot_id, version_number, version_label, is_default,
      input_schema, output_config, system_prompt, llm_model, temperature,
      max_tokens, is_active, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.agent_bot_id, rec.version_number, rec.version_label,
      rec.is_default, rec.input_schema, rec.output_config, rec.system_prompt,
      rec.llm_model, rec.temperature, rec.max_tokens, rec.is_active,
      rec.created_by, rec.created_at, rec.updated_at
    );
  }
}

/**
 * Import agent bot version to category mappings
 */
export function importAgentBotVersionCategories(records: AgentBotVersionCategoryRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_bot_version_categories (version_id, category_id)
    VALUES (?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.version_id, rec.category_id);
  }
}

/**
 * Import agent bot version to skill mappings
 */
export function importAgentBotVersionSkills(records: AgentBotVersionSkillRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_bot_version_skills (version_id, skill_id)
    VALUES (?, ?)
  `);

  for (const rec of records) {
    stmt.run(rec.version_id, rec.skill_id);
  }
}

/**
 * Import agent bot version tool configurations
 */
export function importAgentBotVersionTools(records: AgentBotVersionToolRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_bot_version_tools (
      id, version_id, tool_name, is_enabled, config_override
    ) VALUES (?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.version_id, rec.tool_name, rec.is_enabled, rec.config_override
    );
  }
}

/**
 * Import agent bot API keys
 */
export function importAgentBotApiKeys(records: AgentBotApiKeyRecord[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_bot_api_keys (
      id, agent_bot_id, name, key_prefix, key_hash, permissions,
      rate_limit_rpm, rate_limit_rpd, expires_at, last_used_at,
      is_active, created_by, created_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of records) {
    stmt.run(
      rec.id, rec.agent_bot_id, rec.name, rec.key_prefix, rec.key_hash,
      rec.permissions, rec.rate_limit_rpm, rec.rate_limit_rpd, rec.expires_at,
      rec.last_used_at, rec.is_active, rec.created_by, rec.created_at, rec.revoked_at
    );
  }
}

// ============ Clear Functions ============

/**
 * Clear all data from tables (for fresh restore)
 * Respects foreign key constraints by deleting in correct order
 */
export function clearAllData(): void {
  transaction(() => {
    // Clear task plans (depends on threads)
    execute('DELETE FROM task_plans');

    // Clear thread shares (depends on threads and users)
    execute('DELETE FROM thread_shares');

    // Clear thread-related tables first (depend on threads)
    execute('DELETE FROM thread_outputs');
    execute('DELETE FROM thread_uploads');
    execute('DELETE FROM thread_categories');
    execute('DELETE FROM messages');
    execute('DELETE FROM threads');

    // Clear document relationships
    execute('DELETE FROM document_categories');
    execute('DELETE FROM documents');

    // Clear user memories (depends on users and categories)
    execute('DELETE FROM user_memories');

    // Clear user relationships
    execute('DELETE FROM user_subscriptions');
    execute('DELETE FROM super_user_categories');
    execute('DELETE FROM users');

    // Clear workspace-related tables (depend on workspaces, users, categories)
    execute('DELETE FROM workspace_users');
    execute('DELETE FROM workspace_categories');
    execute('DELETE FROM workspaces');

    // Clear agent bot tables (depend on agent_bots, categories, skills)
    execute('DELETE FROM agent_bot_api_keys');
    execute('DELETE FROM agent_bot_version_tools');
    execute('DELETE FROM agent_bot_version_skills');
    execute('DELETE FROM agent_bot_version_categories');
    execute('DELETE FROM agent_bot_versions');
    execute('DELETE FROM agent_bots');

    // Clear tools, skills, and category prompts (depend on categories)
    execute('DELETE FROM category_tool_configs');
    execute('DELETE FROM tool_configs');
    execute('DELETE FROM tool_routing_rules');
    execute('DELETE FROM category_skills');
    execute('DELETE FROM skills');
    execute('DELETE FROM category_prompts');

    // Clear function API sources (depend on categories)
    execute('DELETE FROM function_api_categories');
    execute('DELETE FROM function_api_configs');

    // Clear data sources (depend on categories)
    execute('DELETE FROM data_api_categories');
    execute('DELETE FROM data_api_configs');
    execute('DELETE FROM data_csv_categories');
    execute('DELETE FROM data_csv_configs');

    // Clear categories
    execute('DELETE FROM categories');

    // Clear settings
    execute('DELETE FROM settings');

    // Clear storage alerts
    execute('DELETE FROM storage_alerts');
  });
}

/**
 * Clear only document-related data
 */
export function clearDocumentData(): void {
  transaction(() => {
    execute('DELETE FROM document_categories');
    execute('DELETE FROM documents');
  });
}

/**
 * Clear only user-related data
 */
export function clearUserData(): void {
  transaction(() => {
    execute('DELETE FROM user_subscriptions');
    execute('DELETE FROM super_user_categories');
    execute('DELETE FROM users');
  });
}

/**
 * Clear only thread-related data
 */
export function clearThreadData(): void {
  transaction(() => {
    execute('DELETE FROM thread_outputs');
    execute('DELETE FROM thread_uploads');
    execute('DELETE FROM thread_categories');
    execute('DELETE FROM messages');
    execute('DELETE FROM threads');
  });
}

/**
 * Clear settings only
 */
export function clearSettings(): void {
  execute('DELETE FROM settings');
}

/**
 * Clear categories (also removes document_categories due to ON DELETE SET NULL)
 */
export function clearCategories(): void {
  execute('DELETE FROM categories');
}
