-- Policy Bot Database Schema
-- SQLite database for users, categories, threads, messages, documents, and settings

-- ============ Users & Roles ============

-- Primary user table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'superuser', 'user')),
  added_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============ Categories ============

-- Document categories (each maps to a vector store collection)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- Super user category assignments (many-to-many)
CREATE TABLE IF NOT EXISTS super_user_categories (
  user_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  subscribed_by TEXT NOT NULL,
  PRIMARY KEY (user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_category ON user_subscriptions(category_id);

-- Category-specific prompt addendum (appended to global system prompt)
CREATE TABLE IF NOT EXISTS category_prompts (
  category_id INTEGER PRIMARY KEY,
  prompt_addendum TEXT NOT NULL,
  starter_prompts TEXT DEFAULT NULL,
  welcome_title TEXT DEFAULT NULL,
  welcome_message TEXT DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- ============ Skills ============

-- Skills table: stores modular prompt definitions
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identity
  name TEXT UNIQUE NOT NULL,
  description TEXT,

  -- Content
  prompt_content TEXT NOT NULL,

  -- Trigger configuration
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('always', 'category', 'keyword')),
  trigger_value TEXT,  -- Keywords (comma-separated) for keyword triggers

  -- Category restriction (for keyword skills)
  category_restricted INTEGER DEFAULT 0,

  -- Skill classification
  is_index INTEGER DEFAULT 0,  -- 1 = Index skill (one per category)

  -- Ordering & Status
  priority INTEGER DEFAULT 100,
  is_active INTEGER DEFAULT 1,
  is_core INTEGER DEFAULT 0,  -- Core skills cannot be deleted

  -- Permissions
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'superuser')),

  -- Metadata
  token_estimate INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
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

-- Document metadata
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  is_global INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'error')),
  error_message TEXT,
  uploaded_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_is_global ON documents(is_global);

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

-- Conversation threads
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  selected_model TEXT,  -- NULL = use global default, otherwise override model ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_pinned INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
-- Note: idx_threads_pinned and idx_threads_selected_model are created by migrations
-- to handle existing databases that don't have these columns yet

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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- Thread file uploads (user-uploaded PDFs)
CREATE TABLE IF NOT EXISTS thread_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_uploads_thread ON thread_uploads(thread_id);

-- AI-generated files
CREATE TABLE IF NOT EXISTS thread_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  message_id TEXT,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav')),
  file_size INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id);

-- ============ Memory & Summarization ============

-- User memory storage (facts per user+category)
CREATE TABLE IF NOT EXISTS user_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category_id INTEGER, -- NULL = global memory
  facts_json TEXT NOT NULL, -- JSON array of fact strings
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category_id);

-- Thread summaries
CREATE TABLE IF NOT EXISTS thread_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  messages_summarized INTEGER NOT NULL, -- count of messages included
  tokens_before INTEGER, -- estimated tokens before summarization
  tokens_after INTEGER, -- tokens in summary
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_summaries_thread ON thread_summaries(thread_id);

-- Archived messages (original messages after summarization)
CREATE TABLE IF NOT EXISTS archived_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  sources_json TEXT,
  created_at DATETIME NOT NULL,
  archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  summary_id INTEGER,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (summary_id) REFERENCES thread_summaries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_archived_messages_thread ON archived_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_archived_messages_summary ON archived_messages(summary_id);

-- ============ Settings ============

-- Key-value settings store (replaces JSON config files)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- ============ Storage Monitoring ============

-- Storage alerts
CREATE TABLE IF NOT EXISTS storage_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threshold_percent INTEGER NOT NULL,
  current_percent INTEGER NOT NULL,
  alerted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at DATETIME,
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_storage_alerts_pending ON storage_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

-- ============ LLM Configuration ============

-- LLM Provider configurations
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,              -- 'openai', 'gemini', 'mistral', 'ollama'
  name TEXT NOT NULL,               -- Display name: 'OpenAI', 'Google Gemini', etc.
  api_key TEXT,                     -- Encrypted API key (null for ollama)
  api_base TEXT,                    -- Custom endpoint (for ollama or Azure)
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Models enabled for use in Policy Bot
CREATE TABLE IF NOT EXISTS enabled_models (
  id TEXT PRIMARY KEY,              -- Model ID e.g., 'gpt-4.1-mini'
  provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tool_capable INTEGER DEFAULT 0,
  vision_capable INTEGER DEFAULT 0,
  max_input_tokens INTEGER,
  max_output_tokens INTEGER,        -- Max tokens for LLM output (provider-specific defaults)
  is_default INTEGER DEFAULT 0,     -- Only one can be default
  enabled INTEGER DEFAULT 1,        -- 0 = disabled/hidden
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_enabled_models_provider ON enabled_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_enabled_models_enabled ON enabled_models(enabled);
CREATE INDEX IF NOT EXISTS idx_enabled_models_default ON enabled_models(is_default);

-- ============ Triggers ============

-- Update user updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_user_timestamp
AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Update thread updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_thread_timestamp
AFTER UPDATE ON threads
BEGIN
  UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Update thread timestamp when message is added
CREATE TRIGGER IF NOT EXISTS update_thread_on_message
AFTER INSERT ON messages
BEGIN
  UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.thread_id;
END;

-- Update llm_providers updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_llm_provider_timestamp
AFTER UPDATE ON llm_providers
BEGIN
  UPDATE llm_providers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Update enabled_models updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_enabled_model_timestamp
AFTER UPDATE ON enabled_models
BEGIN
  UPDATE enabled_models SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Ensure only one default model
CREATE TRIGGER IF NOT EXISTS ensure_single_default_model
AFTER UPDATE OF is_default ON enabled_models
WHEN NEW.is_default = 1
BEGIN
  UPDATE enabled_models SET is_default = 0 WHERE id != NEW.id AND is_default = 1;
END;

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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  expires_at DATETIME,
  last_used_at DATETIME,
  is_active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME,
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
  started_at DATETIME,
  completed_at DATETIME,
  error_message TEXT,
  error_code TEXT,
  processing_time_ms INTEGER,
  token_usage_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES agent_bot_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_job_files_job ON agent_bot_job_files(job_id);
CREATE INDEX IF NOT EXISTS idx_agent_bot_job_files_status ON agent_bot_job_files(extraction_status);

-- Usage tracking for rate limiting and analytics
CREATE TABLE IF NOT EXISTS agent_bot_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id TEXT NOT NULL,
  agent_bot_id TEXT NOT NULL,
  date TEXT NOT NULL,
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
