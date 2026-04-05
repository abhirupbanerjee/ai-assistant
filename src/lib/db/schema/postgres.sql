-- Policy Bot Database Schema (PostgreSQL)
-- Converted from SQLite schema for PostgreSQL compatibility

-- ============ Users & Roles ============

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'superuser', 'user')),
  added_by TEXT,
  password_hash TEXT,
  credentials_enabled INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============ Categories ============

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- Super user category assignments (many-to-many)
CREATE TABLE IF NOT EXISTS super_user_categories (
  user_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  assigned_at TIMESTAMP DEFAULT NOW(),
  assigned_by TEXT NOT NULL,
  PRIMARY KEY (user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- User category subscriptions (many-to-many)
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  subscribed_at TIMESTAMP DEFAULT NOW(),
  subscribed_by TEXT NOT NULL,
  PRIMARY KEY (user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_category ON user_subscriptions(category_id);

-- Category-specific prompt addendum
CREATE TABLE IF NOT EXISTS category_prompts (
  category_id INTEGER PRIMARY KEY,
  prompt_addendum TEXT NOT NULL,
  starter_prompts TEXT DEFAULT NULL,
  welcome_title TEXT DEFAULT NULL,
  welcome_message TEXT DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- ============ Skills ============

CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  prompt_content TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('always', 'category', 'keyword')),
  trigger_value TEXT,
  category_restricted INTEGER DEFAULT 0,
  is_index INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 100,
  is_active INTEGER DEFAULT 1,
  is_core INTEGER DEFAULT 0,
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'superuser')),
  token_estimate INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  -- Tool routing columns
  match_type TEXT DEFAULT 'keyword' CHECK (match_type IN ('keyword', 'regex')),
  tool_name TEXT,
  force_mode TEXT CHECK (force_mode IN ('required', 'preferred', 'suggested')),
  tool_config_override TEXT,
  data_source_filter TEXT,
  compliance_config TEXT
);

CREATE INDEX IF NOT EXISTS idx_skills_trigger ON skills(trigger_type, is_active);
CREATE INDEX IF NOT EXISTS idx_skills_priority ON skills(priority);
CREATE INDEX IF NOT EXISTS idx_skills_core ON skills(is_core);

-- Links skills to categories (many-to-many)
CREATE TABLE IF NOT EXISTS category_skills (
  category_id INTEGER NOT NULL,
  skill_id INTEGER NOT NULL,
  PRIMARY KEY (category_id, skill_id),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_category_skills_category ON category_skills(category_id);
CREATE INDEX IF NOT EXISTS idx_category_skills_skill ON category_skills(skill_id);

-- ============ Documents ============

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  is_global INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'error')),
  error_message TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  folder_sync_id TEXT,
  original_relative_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_is_global ON documents(is_global);
CREATE INDEX IF NOT EXISTS idx_documents_folder_sync ON documents(folder_sync_id);

-- Document to category mapping (many-to-many)
CREATE TABLE IF NOT EXISTS document_categories (
  document_id INTEGER NOT NULL,
  category_id INTEGER,
  PRIMARY KEY (document_id, category_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_document_categories_doc ON document_categories(document_id);
CREATE INDEX IF NOT EXISTS idx_document_categories_cat ON document_categories(category_id);

-- ============ Threads & Messages ============

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  selected_model TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_pinned INTEGER DEFAULT 0,
  is_summarized INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_pinned ON threads(is_pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_selected_model ON threads(selected_model);

-- Thread category selection (many-to-many)
CREATE TABLE IF NOT EXISTS thread_categories (
  thread_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (thread_id, category_id),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_categories_thread ON thread_categories(thread_id);

-- Conversation messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  sources_json TEXT,
  attachments_json TEXT,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  token_count INTEGER,
  generated_documents_json TEXT,
  visualizations_json TEXT,
  generated_images_json TEXT,
  generated_diagrams_json TEXT,
  mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'autonomous')),
  plan_id TEXT,
  metadata_json TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- Thread file uploads (user-uploaded PDFs)
CREATE TABLE IF NOT EXISTS thread_uploads (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_uploads_thread ON thread_uploads(thread_id);

-- AI-generated files
CREATE TABLE IF NOT EXISTS thread_outputs (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav')),
  file_size INTEGER NOT NULL,
  generation_config TEXT,
  expires_at TIMESTAMP,
  download_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_outputs_expires ON thread_outputs(expires_at);

-- ============ Memory & Summarization ============

CREATE TABLE IF NOT EXISTS user_memories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  category_id INTEGER,
  facts_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category_id);

CREATE TABLE IF NOT EXISTS thread_summaries (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  messages_summarized INTEGER NOT NULL,
  tokens_before INTEGER,
  tokens_after INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_summaries_thread ON thread_summaries(thread_id);

CREATE TABLE IF NOT EXISTS archived_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  sources_json TEXT,
  created_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP DEFAULT NOW(),
  summary_id INTEGER,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (summary_id) REFERENCES thread_summaries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archived_messages_thread ON archived_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_archived_messages_summary ON archived_messages(summary_id);

-- ============ Settings ============

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT
);

-- ============ Storage Monitoring ============

CREATE TABLE IF NOT EXISTS storage_alerts (
  id SERIAL PRIMARY KEY,
  threshold_percent INTEGER NOT NULL,
  current_percent INTEGER NOT NULL,
  alerted_at TIMESTAMP DEFAULT NOW(),
  acknowledged_at TIMESTAMP,
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_storage_alerts_pending ON storage_alerts(acknowledged_at)
  WHERE acknowledged_at IS NULL;

-- ============ LLM Configuration ============

CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT,
  api_base TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enabled_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tool_capable INTEGER DEFAULT 0,
  vision_capable INTEGER DEFAULT 0,
  parallel_tool_capable INTEGER DEFAULT 0,
  thinking_capable INTEGER DEFAULT 0,
  max_input_tokens INTEGER,
  max_output_tokens INTEGER,
  is_default INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_enabled_models_provider ON enabled_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_enabled_models_enabled ON enabled_models(enabled);
CREATE INDEX IF NOT EXISTS idx_enabled_models_default ON enabled_models(is_default);

-- ============ Tool Configs ============

CREATE TABLE IF NOT EXISTS tool_configs (
  id TEXT PRIMARY KEY,
  tool_name TEXT UNIQUE NOT NULL,
  is_enabled INTEGER DEFAULT 0,
  config_json TEXT NOT NULL,
  description_override TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_config_audit (
  id SERIAL PRIMARY KEY,
  tool_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  old_config TEXT,
  new_config TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_config_audit_name ON tool_config_audit(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_config_audit_time ON tool_config_audit(changed_at DESC);

CREATE TABLE IF NOT EXISTS category_tool_configs (
  id TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  is_enabled INTEGER,
  branding_json TEXT,
  config_json TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT NOT NULL,
  UNIQUE(category_id, tool_name),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_category_tool_configs_category ON category_tool_configs(category_id);
CREATE INDEX IF NOT EXISTS idx_category_tool_configs_tool ON category_tool_configs(tool_name);

-- ============ Tool Routing Rules ============

CREATE TABLE IF NOT EXISTS tool_routing_rules (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('keyword', 'regex')),
  patterns TEXT NOT NULL,
  force_mode TEXT NOT NULL DEFAULT 'required'
    CHECK (force_mode IN ('required', 'preferred', 'suggested')),
  priority INTEGER DEFAULT 100,
  category_ids TEXT DEFAULT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_tool ON tool_routing_rules(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_active ON tool_routing_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_priority ON tool_routing_rules(priority);

-- ============ Task Plans ============

CREATE TABLE IF NOT EXISTS task_plans (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  category_slug TEXT,
  title TEXT,
  tasks_json TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed', 'stopped', 'paused')),
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'autonomous')),
  budget_json TEXT DEFAULT '{"max_llm_calls": 100, "max_tokens": 500000}',
  budget_used_json TEXT DEFAULT '{"llm_calls": 0, "tokens_used": 0, "web_searches": 0}',
  model_config_json TEXT DEFAULT '{}',
  paused_at TIMESTAMP,
  pause_reason TEXT,
  resumed_at TIMESTAMP,
  stopped_at TIMESTAMP,
  stop_reason TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_plans_thread ON task_plans(thread_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_status ON task_plans(status);
CREATE INDEX IF NOT EXISTS idx_task_plans_user ON task_plans(user_id);

-- ============ Data Sources ============

CREATE TABLE IF NOT EXISTS data_api_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET' CHECK(method IN ('GET', 'POST')),
  response_format TEXT DEFAULT 'json' CHECK(response_format IN ('json', 'csv')),
  authentication TEXT,
  headers TEXT,
  parameters TEXT,
  response_structure TEXT,
  sample_response TEXT,
  openapi_spec TEXT,
  config_method TEXT DEFAULT 'manual' CHECK(config_method IN ('manual', 'openapi')),
  status TEXT DEFAULT 'untested' CHECK(status IN ('active', 'inactive', 'error', 'untested')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_tested TIMESTAMP,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_api_status ON data_api_configs(status);
CREATE INDEX IF NOT EXISTS idx_data_api_name ON data_api_configs(name);

CREATE TABLE IF NOT EXISTS data_api_categories (
  api_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (api_id) REFERENCES data_api_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (api_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_data_api_categories_api ON data_api_categories(api_id);
CREATE INDEX IF NOT EXISTS idx_data_api_categories_cat ON data_api_categories(category_id);

CREATE TABLE IF NOT EXISTS data_csv_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  columns TEXT,
  sample_data TEXT,
  row_count INTEGER DEFAULT 0,
  file_size INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_csv_name ON data_csv_configs(name);

CREATE TABLE IF NOT EXISTS data_csv_categories (
  csv_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (csv_id) REFERENCES data_csv_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (csv_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_data_csv_categories_csv ON data_csv_categories(csv_id);
CREATE INDEX IF NOT EXISTS idx_data_csv_categories_cat ON data_csv_categories(category_id);

CREATE TABLE IF NOT EXISTS data_source_audit (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('api', 'csv')),
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'tested', 'deleted')),
  changed_by TEXT NOT NULL,
  details TEXT,
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_source_audit_source ON data_source_audit(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_data_source_audit_time ON data_source_audit(changed_at DESC);

-- ============ Function APIs ============

CREATE TABLE IF NOT EXISTS function_api_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'api_key' CHECK(auth_type IN ('api_key', 'bearer', 'basic', 'none')),
  auth_header TEXT,
  auth_credentials TEXT,
  default_headers TEXT,
  tools_schema TEXT NOT NULL,
  endpoint_mappings TEXT NOT NULL,
  timeout_seconds INTEGER DEFAULT 30,
  cache_ttl_seconds INTEGER DEFAULT 3600,
  is_enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'untested' CHECK(status IN ('active', 'inactive', 'error', 'untested')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_tested TIMESTAMP,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_function_api_status ON function_api_configs(status);
CREATE INDEX IF NOT EXISTS idx_function_api_name ON function_api_configs(name);
CREATE INDEX IF NOT EXISTS idx_function_api_enabled ON function_api_configs(is_enabled);

CREATE TABLE IF NOT EXISTS function_api_categories (
  api_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (api_id) REFERENCES function_api_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (api_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_function_api_categories_api ON function_api_categories(api_id);
CREATE INDEX IF NOT EXISTS idx_function_api_categories_cat ON function_api_categories(category_id);

-- ============ RAG Testing ============

CREATE TABLE IF NOT EXISTS rag_test_queries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  category_ids TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_test_queries_created ON rag_test_queries(created_at DESC);

CREATE TABLE IF NOT EXISTS rag_test_results (
  id SERIAL PRIMARY KEY,
  query_id INTEGER,
  test_query TEXT NOT NULL,
  settings_snapshot TEXT NOT NULL,
  chunks_retrieved INTEGER NOT NULL,
  avg_similarity REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  top_chunks TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (query_id) REFERENCES rag_test_queries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_test_results_created ON rag_test_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_test_results_query ON rag_test_results(query_id);

-- ============ Thread Shares ============

CREATE TABLE IF NOT EXISTS thread_shares (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  created_by INTEGER NOT NULL,
  allow_download INTEGER DEFAULT 1,
  expires_at TIMESTAMP,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  last_viewed_at TIMESTAMP,
  revoked_at TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_thread_shares_token ON thread_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_thread_shares_thread ON thread_shares(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_shares_creator ON thread_shares(created_by);

CREATE TABLE IF NOT EXISTS share_access_log (
  id SERIAL PRIMARY KEY,
  share_id TEXT NOT NULL,
  accessed_by INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'download')),
  resource_type TEXT,
  resource_id TEXT,
  accessed_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (share_id) REFERENCES thread_shares(id) ON DELETE CASCADE,
  FOREIGN KEY (accessed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_share_access_log_share ON share_access_log(share_id);
CREATE INDEX IF NOT EXISTS idx_share_access_log_accessed ON share_access_log(accessed_at DESC);

-- ============ Workspaces ============

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('embed', 'standalone')),
  is_enabled INTEGER DEFAULT 1,
  access_mode TEXT DEFAULT 'category' CHECK (access_mode IN ('category', 'explicit')),
  primary_color TEXT DEFAULT '#2563eb',
  logo_url TEXT,
  chat_title TEXT,
  greeting_message TEXT DEFAULT 'How can I help you today?',
  suggested_prompts TEXT,
  footer_text TEXT,
  llm_provider TEXT,
  llm_model TEXT,
  temperature REAL,
  system_prompt TEXT,
  allowed_domains TEXT DEFAULT '[]',
  daily_limit INTEGER DEFAULT 1000,
  session_limit INTEGER DEFAULT 50,
  voice_enabled INTEGER DEFAULT 0,
  file_upload_enabled INTEGER DEFAULT 0,
  max_file_size_mb INTEGER DEFAULT 5,
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'superuser')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  auth_required INTEGER DEFAULT 0,
  web_search_enabled INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
CREATE INDEX IF NOT EXISTS idx_workspaces_type ON workspaces(type);
CREATE INDEX IF NOT EXISTS idx_workspaces_enabled ON workspaces(is_enabled);

CREATE TABLE IF NOT EXISTS workspace_categories (
  workspace_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, category_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_categories_workspace ON workspace_categories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_categories_category ON workspace_categories(category_id);

CREATE TABLE IF NOT EXISTS workspace_users (
  workspace_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  added_by TEXT NOT NULL,
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_users_workspace ON workspace_users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_users_user ON workspace_users(user_id);

CREATE TABLE IF NOT EXISTS workspace_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  visitor_id TEXT,
  user_id INTEGER,
  referrer_url TEXT,
  ip_hash TEXT,
  message_count INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  last_activity TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_sessions_workspace ON workspace_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_expires ON workspace_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_user ON workspace_sessions(user_id);

CREATE TABLE IF NOT EXISTS workspace_threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT DEFAULT 'New Chat',
  is_archived INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_threads_session ON workspace_threads(session_id);
CREATE INDEX IF NOT EXISTS idx_workspace_threads_workspace ON workspace_threads(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  thread_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources_json TEXT,
  latency_ms INTEGER,
  tokens_used INTEGER,
  model TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_messages_thread ON workspace_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_session ON workspace_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_workspace ON workspace_messages(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_rate_limits (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  window_start TIMESTAMP NOT NULL,
  request_count INTEGER DEFAULT 0,
  UNIQUE(workspace_id, ip_hash, window_start),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_analytics (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  date DATE NOT NULL,
  sessions_count INTEGER DEFAULT 0,
  messages_count INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  total_tokens_used INTEGER DEFAULT 0,
  UNIQUE(workspace_id, date),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_analytics_date ON workspace_analytics(workspace_id, date);

CREATE TABLE IF NOT EXISTS workspace_outputs (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  thread_id TEXT,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'mp3', 'wav')),
  file_size INTEGER NOT NULL,
  generation_config TEXT,
  expires_at TIMESTAMP,
  download_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_outputs_workspace ON workspace_outputs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_outputs_session ON workspace_outputs(session_id);
CREATE INDEX IF NOT EXISTS idx_workspace_outputs_thread ON workspace_outputs(thread_id);

-- ============ Folder Syncs ============

CREATE TABLE IF NOT EXISTS folder_syncs (
  id TEXT PRIMARY KEY,
  folder_name TEXT NOT NULL,
  original_path TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  category_ids TEXT,
  is_global INTEGER DEFAULT 0,
  total_files INTEGER DEFAULT 0,
  synced_files INTEGER DEFAULT 0,
  failed_files INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'syncing', 'error')),
  error_message TEXT,
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_folder_syncs_user ON folder_syncs(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_folder_syncs_status ON folder_syncs(status);

CREATE TABLE IF NOT EXISTS folder_sync_files (
  id SERIAL PRIMARY KEY,
  folder_sync_id TEXT NOT NULL,
  document_id INTEGER,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_hash TEXT,
  file_size INTEGER NOT NULL,
  last_modified INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'skipped', 'error')),
  error_message TEXT,
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (folder_sync_id) REFERENCES folder_syncs(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_folder_sync_files_sync ON folder_sync_files(folder_sync_id);
CREATE INDEX IF NOT EXISTS idx_folder_sync_files_doc ON folder_sync_files(document_id);
CREATE INDEX IF NOT EXISTS idx_folder_sync_files_hash ON folder_sync_files(file_hash);

-- ============ Compliance Results ============

CREATE TABLE IF NOT EXISTS compliance_results (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  skill_ids TEXT,
  overall_score INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('pass', 'warn', 'hitl')),
  checks_performed TEXT NOT NULL,
  failed_checks TEXT,
  hitl_triggered INTEGER DEFAULT 0,
  hitl_questions TEXT,
  hitl_user_response TEXT,
  hitl_action TEXT,
  validated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (conversation_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_compliance_conversation ON compliance_results(conversation_id);
CREATE INDEX IF NOT EXISTS idx_compliance_decision ON compliance_results(decision, validated_at);
CREATE INDEX IF NOT EXISTS idx_compliance_hitl ON compliance_results(hitl_triggered, validated_at);
CREATE INDEX IF NOT EXISTS idx_compliance_message ON compliance_results(message_id);

-- ============ Agent Bots ============

-- Core agent bot entity
CREATE TABLE IF NOT EXISTS agent_bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'superuser')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_bots_slug ON agent_bots(slug);
CREATE INDEX IF NOT EXISTS idx_agent_bots_active ON agent_bots(is_active);

-- Versioned configurations for agent bots
CREATE TABLE IF NOT EXISTS agent_bot_versions (
  id TEXT PRIMARY KEY,
  agent_bot_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  version_label TEXT,
  is_default INTEGER DEFAULT 0,
  input_schema TEXT NOT NULL,
  output_config TEXT NOT NULL,
  system_prompt TEXT,
  llm_model TEXT,
  temperature REAL,
  max_tokens INTEGER,
  is_active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(agent_bot_id, version_number),
  FOREIGN KEY (agent_bot_id) REFERENCES agent_bots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_versions_bot ON agent_bot_versions(agent_bot_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_versions_default ON agent_bot_versions(agent_bot_id, is_default);
CREATE INDEX IF NOT EXISTS idx_agent_bot_versions_active ON agent_bot_versions(is_active);

-- Version to categories mapping (many-to-many)
CREATE TABLE IF NOT EXISTS agent_bot_version_categories (
  version_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (version_id, category_id),
  FOREIGN KEY (version_id) REFERENCES agent_bot_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_version_categories_version ON agent_bot_version_categories(version_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_version_categories_category ON agent_bot_version_categories(category_id);

-- Version to skills mapping (many-to-many)
CREATE TABLE IF NOT EXISTS agent_bot_version_skills (
  version_id TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  PRIMARY KEY (version_id, skill_id),
  FOREIGN KEY (version_id) REFERENCES agent_bot_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_version_skills_version ON agent_bot_version_skills(version_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_version_skills_skill ON agent_bot_version_skills(skill_id);

-- Version tool configurations with optional overrides
CREATE TABLE IF NOT EXISTS agent_bot_version_tools (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  is_enabled INTEGER DEFAULT 1,
  config_override TEXT,
  UNIQUE(version_id, tool_name),
  FOREIGN KEY (version_id) REFERENCES agent_bot_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_version_tools_version ON agent_bot_version_tools(version_id);

-- API keys for agent bot authentication
CREATE TABLE IF NOT EXISTS agent_bot_api_keys (
  id TEXT PRIMARY KEY,
  agent_bot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '["invoke"]',
  rate_limit_rpm INTEGER DEFAULT 60,
  rate_limit_rpd INTEGER DEFAULT 1000,
  expires_at TIMESTAMP,
  last_used_at TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP,
  FOREIGN KEY (agent_bot_id) REFERENCES agent_bots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_api_keys_bot ON agent_bot_api_keys(agent_bot_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_api_keys_prefix ON agent_bot_api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_bot_api_keys_active ON agent_bot_api_keys(is_active);

-- Jobs for tracking async execution
CREATE TABLE IF NOT EXISTS agent_bot_jobs (
  id TEXT PRIMARY KEY,
  agent_bot_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  input_json TEXT NOT NULL,
  input_files_json TEXT,
  output_type TEXT NOT NULL DEFAULT 'text',
  webhook_url TEXT,
  webhook_secret TEXT,
  priority INTEGER DEFAULT 100,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  error_code TEXT,
  processing_time_ms INTEGER,
  token_usage_json TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  FOREIGN KEY (agent_bot_id) REFERENCES agent_bots(id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES agent_bot_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES agent_bot_api_keys(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_jobs_bot ON agent_bot_jobs(agent_bot_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_jobs_status ON agent_bot_jobs(status);
CREATE INDEX IF NOT EXISTS idx_agent_bot_jobs_api_key ON agent_bot_jobs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_jobs_created ON agent_bot_jobs(created_at DESC);

-- Job outputs (generated files and content)
CREATE TABLE IF NOT EXISTS agent_bot_job_outputs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  output_type TEXT NOT NULL CHECK (output_type IN ('text', 'json', 'pdf', 'docx', 'xlsx', 'pptx', 'image', 'podcast', 'md')),
  content TEXT,
  filename TEXT,
  filepath TEXT,
  file_size INTEGER,
  mime_type TEXT,
  metadata_json TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (job_id) REFERENCES agent_bot_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_job_outputs_job ON agent_bot_job_outputs(job_id);

-- Job input files (uploaded documents)
CREATE TABLE IF NOT EXISTS agent_bot_job_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filepath TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  extracted_text TEXT,
  extraction_status TEXT DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'processing', 'ready', 'error')),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (job_id) REFERENCES agent_bot_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_job_files_job ON agent_bot_job_files(job_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_job_files_status ON agent_bot_job_files(extraction_status);

-- Usage tracking for rate limiting and analytics
CREATE TABLE IF NOT EXISTS agent_bot_usage (
  id SERIAL PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  agent_bot_id TEXT NOT NULL,
  date DATE NOT NULL,
  hour INTEGER NOT NULL,
  request_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  UNIQUE(api_key_id, date, hour),
  FOREIGN KEY (api_key_id) REFERENCES agent_bot_api_keys(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_bot_id) REFERENCES agent_bots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_usage_key ON agent_bot_usage(api_key_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_usage_bot ON agent_bot_usage(agent_bot_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_usage_date ON agent_bot_usage(date);

-- ============ Load Test Results ============

-- Stores k6 Cloud load test results for LLM retrieval
CREATE TABLE IF NOT EXISTS load_test_results (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  test_run_id TEXT,                -- k6 Cloud run ID
  output_url TEXT,                 -- k6 Cloud dashboard link
  users INTEGER NOT NULL,
  duration INTEGER NOT NULL,       -- test duration in seconds
  metrics_json TEXT NOT NULL,      -- JSON blob of all metrics (p50/p95/p99/avg, error rate, etc.)
  passed BOOLEAN DEFAULT FALSE,
  run_by TEXT,                     -- admin email who triggered the test
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_load_test_results_url ON load_test_results(url);
CREATE INDEX IF NOT EXISTS idx_load_test_results_created ON load_test_results(created_at DESC);

-- ============ Triggers (PostgreSQL syntax) ============

-- Update user updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_timestamp ON users;
CREATE TRIGGER update_user_timestamp
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_user_timestamp();

-- Update thread updated_at timestamp
CREATE OR REPLACE FUNCTION update_thread_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_thread_timestamp ON threads;
CREATE TRIGGER update_thread_timestamp
  BEFORE UPDATE ON threads
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_timestamp();

-- Update thread timestamp when message is added
CREATE OR REPLACE FUNCTION update_thread_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE threads SET updated_at = NOW() WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_thread_on_message ON messages;
CREATE TRIGGER update_thread_on_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_on_message();

-- Update llm_providers updated_at timestamp
CREATE OR REPLACE FUNCTION update_llm_provider_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_llm_provider_timestamp ON llm_providers;
CREATE TRIGGER update_llm_provider_timestamp
  BEFORE UPDATE ON llm_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_llm_provider_timestamp();

-- Update enabled_models updated_at timestamp
CREATE OR REPLACE FUNCTION update_enabled_model_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_enabled_model_timestamp ON enabled_models;
CREATE TRIGGER update_enabled_model_timestamp
  BEFORE UPDATE ON enabled_models
  FOR EACH ROW
  EXECUTE FUNCTION update_enabled_model_timestamp();

-- Ensure only one default model
CREATE OR REPLACE FUNCTION ensure_single_default_model()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = 1 THEN
    UPDATE enabled_models SET is_default = 0 WHERE id != NEW.id AND is_default = 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_single_default_model ON enabled_models;
CREATE TRIGGER ensure_single_default_model
  AFTER UPDATE OF is_default ON enabled_models
  FOR EACH ROW
  WHEN (NEW.is_default = 1)
  EXECUTE FUNCTION ensure_single_default_model();

-- Update agent_bots updated_at timestamp
CREATE OR REPLACE FUNCTION update_agent_bot_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_bot_timestamp ON agent_bots;
CREATE TRIGGER update_agent_bot_timestamp
  BEFORE UPDATE ON agent_bots
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_bot_timestamp();

-- Update agent_bot_versions updated_at timestamp
CREATE OR REPLACE FUNCTION update_agent_bot_version_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_bot_version_timestamp ON agent_bot_versions;
CREATE TRIGGER update_agent_bot_version_timestamp
  BEFORE UPDATE ON agent_bot_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_bot_version_timestamp();

-- Ensure only one default version per agent bot
CREATE OR REPLACE FUNCTION ensure_single_default_agent_bot_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = 1 THEN
    UPDATE agent_bot_versions SET is_default = 0
    WHERE agent_bot_id = NEW.agent_bot_id AND id != NEW.id AND is_default = 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_single_default_agent_bot_version ON agent_bot_versions;
CREATE TRIGGER ensure_single_default_agent_bot_version
  AFTER UPDATE OF is_default ON agent_bot_versions
  FOR EACH ROW
  WHEN (NEW.is_default = 1)
  EXECUTE FUNCTION ensure_single_default_agent_bot_version();

-- ============ Token Usage Log ============

CREATE TABLE IF NOT EXISTS token_usage_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  model TEXT NOT NULL,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_log_created ON token_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_log_category ON token_usage_log(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_log_user ON token_usage_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_log_model ON token_usage_log(model, created_at DESC);
