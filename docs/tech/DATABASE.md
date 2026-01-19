# Policy Bot - Database & Storage Architecture

## Overview

Policy Bot uses a hybrid storage approach:
- **SQLite**: Structured metadata (users, categories, documents, threads, messages, settings)
- **ChromaDB**: Vector embeddings for semantic search (per-category collections)
- **Redis**: Caching (RAG responses, Tavily results) and session management
- **Filesystem**: PDF files (global-docs, thread uploads)

---

## 1. SQLite Database Schema

The SQLite database (`data/policy-bot.db`) stores all structured metadata with ACID transactions and efficient queries.

### Entity Relationship Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     users       │     │   categories    │     │   documents     │
│─────────────────│     │─────────────────│     │─────────────────│
│ id (PK)         │     │ id (PK)         │     │ id (PK)         │
│ email           │     │ name            │     │ filename        │
│ name            │     │ slug            │     │ filepath        │
│ role            │     │ description     │     │ file_size       │
│ added_by        │     │ created_by      │     │ is_global       │
│ created_at      │     │ created_at      │     │ chunk_count     │
│ updated_at      │     └────────┬────────┘     │ status          │
└────────┬────────┘              │              │ error_message   │
         │                       │              │ uploaded_by     │
         │    ┌──────────────────┼──────────────┤ created_at      │
         │    │                  │              └────────┬────────┘
         ▼    ▼                  ▼                       │
┌─────────────────┐     ┌─────────────────┐     ┌────────▼────────┐
│super_user_cats  │     │user_subscriptions│    │document_categories│
│─────────────────│     │─────────────────│     │─────────────────│
│ user_id (FK)    │     │ user_id (FK)    │     │ document_id (FK)│
│ category_id(FK) │     │ category_id(FK) │     │ category_id(FK) │
│ assigned_at     │     │ is_active       │     └─────────────────┘
│ assigned_by     │     │ subscribed_at   │
└─────────────────┘     │ subscribed_by   │
                        └─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    threads      │     │   messages      │     │ thread_uploads  │
│─────────────────│     │─────────────────│     │─────────────────│
│ id (PK)         │◄────│ thread_id (FK)  │     │ id (PK)         │
│ user_id (FK)    │     │ id (PK)         │     │ thread_id (FK)  │
│ title           │     │ role            │     │ filename        │
│ created_at      │     │ content         │     │ filepath        │
│ updated_at      │     │ sources_json    │     │ file_size       │
└────────┬────────┘     │ attachments_json│     │ uploaded_at     │
         │              │ tool_calls_json │     └─────────────────┘
         │              │ tool_call_id    │
         ▼              │ tool_name       │     ┌─────────────────┐
┌─────────────────┐     │ created_at      │     │    settings     │
│thread_categories│     └─────────────────┘     │─────────────────│
│─────────────────│                             │ key (PK)        │
│ thread_id (FK)  │     ┌─────────────────┐     │ value           │
│ category_id(FK) │     │ thread_outputs  │     │ updated_at      │
└─────────────────┘     │─────────────────│     │ updated_by      │
                        │ id (PK)         │     └─────────────────┘
                        │ thread_id (FK)  │
                        │ message_id (FK) │     ┌─────────────────┐
                        │ filename        │     │ storage_alerts  │
                        │ filepath        │     │─────────────────│
                        │ file_type       │     │ id (PK)         │
                        │ file_size       │     │ threshold_%     │
                        │ created_at      │     │ current_%       │
                        └─────────────────┘     │ alerted_at      │
                                                │ acknowledged_at │
                                                │ acknowledged_by │
                                                └─────────────────┘

┌─────────────────┐     ┌─────────────────┐
│  thread_shares  │     │share_access_log │
│─────────────────│     │─────────────────│
│ id (PK)         │◄────│ share_id (FK)   │
│ thread_id (FK)  │     │ id (PK)         │
│ share_token     │     │ accessed_by(FK) │
│ created_by (FK) │     │ action          │
│ allow_download  │     │ resource_type   │
│ expires_at      │     │ resource_id     │
│ view_count      │     │ accessed_at     │
│ revoked_at      │     └─────────────────┘
│ created_at      │
└─────────────────┘
```

### Complete Schema Definition

```sql
-- ============ Users & Roles ============

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

-- ============ Documents ============

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

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);

-- Thread category selection (many-to-many)
CREATE TABLE IF NOT EXISTS thread_categories (
  thread_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (thread_id, category_id),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_categories_thread ON thread_categories(thread_id);

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
  file_type TEXT NOT NULL CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx')),
  file_size INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id);

-- ============ Settings ============

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- ============ Storage Monitoring ============

CREATE TABLE IF NOT EXISTS storage_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threshold_percent INTEGER NOT NULL,
  current_percent INTEGER NOT NULL,
  alerted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at DATETIME,
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_storage_alerts_pending
ON storage_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

-- ============ Skills ============

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_trigger_type ON skills(trigger_type);
CREATE INDEX IF NOT EXISTS idx_skills_is_active ON skills(is_active);

-- Skill to category mapping (many-to-many)
CREATE TABLE IF NOT EXISTS category_skills (
  category_id INTEGER NOT NULL,
  skill_id INTEGER NOT NULL,
  PRIMARY KEY (category_id, skill_id),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_category_skills_category ON category_skills(category_id);
CREATE INDEX IF NOT EXISTS idx_category_skills_skill ON category_skills(skill_id);

-- ============ Category Prompts ============

CREATE TABLE IF NOT EXISTS category_prompts (
  category_id INTEGER PRIMARY KEY,
  prompt_addendum TEXT NOT NULL,
  starter_prompts TEXT DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- ============ Tools Configuration ============

CREATE TABLE IF NOT EXISTS tool_configs (
  id TEXT PRIMARY KEY,
  tool_name TEXT UNIQUE NOT NULL,
  is_enabled INTEGER DEFAULT 0,
  config_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_configs_name ON tool_configs(tool_name);

-- Tool configuration audit trail
CREATE TABLE IF NOT EXISTS tool_config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  old_config TEXT,
  new_config TEXT,
  changed_by TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tool_config_audit_tool ON tool_config_audit(tool_name);

-- Category-level tool overrides
CREATE TABLE IF NOT EXISTS category_tool_configs (
  id TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  is_enabled INTEGER,
  branding_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  patterns TEXT NOT NULL,           -- JSON array: ["chart", "graph", "visualize"]
  force_mode TEXT NOT NULL DEFAULT 'required'
    CHECK (force_mode IN ('required', 'preferred', 'suggested')),
  priority INTEGER DEFAULT 100,     -- Lower = higher priority
  category_ids TEXT DEFAULT NULL,   -- JSON array, NULL = all categories
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_tool ON tool_routing_rules(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_active ON tool_routing_rules(is_active);

-- ============ Data Sources ============

-- API Data Source Configurations
CREATE TABLE IF NOT EXISTS data_api_configs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST')),
  response_format TEXT NOT NULL CHECK (response_format IN ('json', 'csv')),
  authentication TEXT,           -- JSON: {type, credentials}
  headers TEXT,                  -- JSON: custom headers
  parameters TEXT,               -- JSON: parameter definitions
  response_structure TEXT,       -- JSON: {jsonPath, fields, ...}
  sample_response TEXT,          -- JSON: example response
  openapi_spec TEXT,             -- JSON: original OpenAPI spec
  config_method TEXT NOT NULL CHECK (config_method IN ('manual', 'openapi')),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'error', 'untested')),
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_tested DATETIME,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_api_configs_name ON data_api_configs(name);
CREATE INDEX IF NOT EXISTS idx_data_api_configs_status ON data_api_configs(status);

-- API to Category mapping (many-to-many)
CREATE TABLE IF NOT EXISTS data_api_categories (
  api_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (api_id, category_id),
  FOREIGN KEY (api_id) REFERENCES data_api_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_api_categories_api ON data_api_categories(api_id);
CREATE INDEX IF NOT EXISTS idx_data_api_categories_category ON data_api_categories(category_id);

-- CSV Data Source Configurations
CREATE TABLE IF NOT EXISTS data_csv_configs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  columns TEXT,                  -- JSON: column definitions
  sample_data TEXT,              -- JSON: first 5 rows
  row_count INTEGER DEFAULT 0,
  file_size INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_csv_configs_name ON data_csv_configs(name);

-- CSV to Category mapping (many-to-many)
CREATE TABLE IF NOT EXISTS data_csv_categories (
  csv_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (csv_id, category_id),
  FOREIGN KEY (csv_id) REFERENCES data_csv_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_csv_categories_csv ON data_csv_categories(csv_id);
CREATE INDEX IF NOT EXISTS idx_data_csv_categories_category ON data_csv_categories(category_id);

-- Data Source Audit Trail
CREATE TABLE IF NOT EXISTS data_source_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('api', 'csv')),
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'tested', 'deleted')),
  changed_by TEXT NOT NULL,
  details TEXT,                  -- JSON: change details
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_source_audit_source ON data_source_audit(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_data_source_audit_action ON data_source_audit(action);

-- ============ Function APIs ============

-- Function API Configurations
CREATE TABLE IF NOT EXISTS function_api_configs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('api_key', 'bearer', 'basic', 'none')),
  auth_header TEXT,
  auth_credentials TEXT,         -- Encrypted
  default_headers TEXT,          -- JSON: default headers
  tools_schema TEXT NOT NULL,    -- JSON: OpenAI tool definitions
  endpoint_mappings TEXT NOT NULL, -- JSON: function name -> endpoint mapping
  timeout_seconds INTEGER DEFAULT 30,
  cache_ttl_seconds INTEGER DEFAULT 3600,
  is_enabled INTEGER DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'error', 'untested')),
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_tested DATETIME,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_function_api_configs_name ON function_api_configs(name);
CREATE INDEX IF NOT EXISTS idx_function_api_configs_status ON function_api_configs(status);

-- Function API to Category mapping (many-to-many)
CREATE TABLE IF NOT EXISTS function_api_categories (
  api_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (api_id, category_id),
  FOREIGN KEY (api_id) REFERENCES function_api_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_function_api_categories_api ON function_api_categories(api_id);
CREATE INDEX IF NOT EXISTS idx_function_api_categories_category ON function_api_categories(category_id);

-- ============ Memory ============

CREATE TABLE IF NOT EXISTS user_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category_id INTEGER,
  facts_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category_id);

-- ============ Thread Summarization ============

CREATE TABLE IF NOT EXISTS thread_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  messages_summarized INTEGER NOT NULL,
  tokens_before INTEGER,
  tokens_after INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_summaries_thread ON thread_summaries(thread_id);

CREATE TABLE IF NOT EXISTS archived_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
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

-- ============ Task Plans ============

CREATE TABLE IF NOT EXISTS task_plans (
  id TEXT PRIMARY KEY,                    -- UUID
  thread_id TEXT NOT NULL,
  template_key TEXT,                      -- Links to task_planner_templates
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  tasks TEXT NOT NULL,                    -- JSON array of task objects
  current_task_index INTEGER DEFAULT 0,
  results TEXT,                           -- JSON array of task results
  placeholders TEXT,                      -- JSON object of placeholder values
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_plans_thread ON task_plans(thread_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_status ON task_plans(status);

-- ============ RAG Testing ============

CREATE TABLE IF NOT EXISTS rag_test_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  expected_docs TEXT,                     -- JSON array of expected document names
  category_ids TEXT,                      -- JSON array of category IDs to test
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id INTEGER NOT NULL,
  run_id TEXT NOT NULL,                   -- Groups results from same test run
  top_k INTEGER NOT NULL,
  similarity_threshold REAL NOT NULL,
  reranker_enabled INTEGER NOT NULL,
  retrieved_docs TEXT NOT NULL,           -- JSON array of retrieved docs
  precision_score REAL,
  recall_score REAL,
  latency_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (query_id) REFERENCES rag_test_queries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rag_test_results_query ON rag_test_results(query_id);
CREATE INDEX IF NOT EXISTS idx_rag_test_results_run ON rag_test_results(run_id);

-- ============ Thread Sharing ============

-- Thread share links
CREATE TABLE IF NOT EXISTS thread_shares (
  id TEXT PRIMARY KEY,                    -- UUID
  thread_id TEXT NOT NULL,
  share_token TEXT UNIQUE NOT NULL,       -- URL-safe cryptographic token
  created_by INTEGER NOT NULL,            -- User who created the share
  allow_download INTEGER DEFAULT 1,       -- Can download attachments
  expires_at DATETIME,                    -- NULL = never expires
  view_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_viewed_at DATETIME,
  revoked_at DATETIME,                    -- NULL = active
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_thread_shares_token ON thread_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_thread_shares_thread ON thread_shares(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_shares_creator ON thread_shares(created_by);

-- Share access audit log
CREATE TABLE IF NOT EXISTS share_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id TEXT NOT NULL,
  accessed_by INTEGER NOT NULL,           -- User who accessed
  action TEXT NOT NULL CHECK (action IN ('view', 'download')),
  resource_type TEXT,                     -- 'upload' or 'output' for downloads
  resource_id TEXT,                       -- ID of downloaded resource
  accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (share_id) REFERENCES thread_shares(id) ON DELETE CASCADE,
  FOREIGN KEY (accessed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_share_access_log_share ON share_access_log(share_id);
CREATE INDEX IF NOT EXISTS idx_share_access_log_user ON share_access_log(accessed_by);

-- ============ Workspaces ============

-- Workspaces table (both embed and standalone types)
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,                          -- UUID
  slug TEXT NOT NULL UNIQUE,                    -- Random 16-char URL path (e.g., '2yibbnmbmctyu')
  name TEXT NOT NULL,                           -- Display name for admin
  type TEXT NOT NULL CHECK (type IN ('embed', 'standalone')),
  is_enabled INTEGER DEFAULT 1,

  -- Access Control (standalone only)
  access_mode TEXT DEFAULT 'category' CHECK (access_mode IN ('category', 'explicit')),
  -- 'category' = users with ALL workspace categories can access
  -- 'explicit' = only users in workspace_users table can access

  -- Branding
  primary_color TEXT DEFAULT '#2563eb',
  logo_url TEXT,
  chat_title TEXT,
  greeting_message TEXT DEFAULT 'How can I help you today?',
  suggested_prompts TEXT,                       -- JSON array
  footer_text TEXT,

  -- LLM Configuration (overrides global settings)
  llm_provider TEXT,                            -- NULL = use global
  llm_model TEXT,                               -- NULL = use global
  temperature REAL,                             -- NULL = use global
  system_prompt TEXT,                           -- Additional prompt prepended

  -- Embed-specific settings
  allowed_domains TEXT DEFAULT '[]',            -- JSON array (embed only)
  daily_limit INTEGER DEFAULT 1000,             -- embed only
  session_limit INTEGER DEFAULT 50,             -- embed only

  -- Feature toggles
  voice_enabled INTEGER DEFAULT 0,
  file_upload_enabled INTEGER DEFAULT 0,
  max_file_size_mb INTEGER DEFAULT 5,

  -- Ownership & Timestamps
  created_by TEXT NOT NULL,                     -- User ID (admin or superuser)
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'superuser')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
CREATE INDEX IF NOT EXISTS idx_workspaces_type ON workspaces(type);

-- Many-to-many: Workspace to Categories
CREATE TABLE IF NOT EXISTS workspace_categories (
  workspace_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, category_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_categories_workspace ON workspace_categories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_categories_category ON workspace_categories(category_id);

-- Many-to-many: Workspace to Users (for explicit access mode, standalone only)
CREATE TABLE IF NOT EXISTS workspace_users (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,                       -- Admin/SuperUser who added this user
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_users_workspace ON workspace_users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_users_user ON workspace_users(user_id);

-- Workspace sessions (for both types)
CREATE TABLE IF NOT EXISTS workspace_sessions (
  id TEXT PRIMARY KEY,                          -- UUID (session token)
  workspace_id TEXT NOT NULL,
  visitor_id TEXT,                              -- Optional fingerprint/cookie
  user_id TEXT,                                 -- NULL for embed, set for standalone auth users
  referrer_url TEXT,
  ip_hash TEXT,
  message_count INTEGER DEFAULT 0,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,                          -- NULL = no expiry (standalone)
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_sessions_workspace ON workspace_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_expires ON workspace_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_user ON workspace_sessions(user_id);

-- Workspace threads (standalone only - for persistent conversations)
CREATE TABLE IF NOT EXISTS workspace_threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT DEFAULT 'New Chat',
  is_archived INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_threads_session ON workspace_threads(session_id);
CREATE INDEX IF NOT EXISTS idx_workspace_threads_workspace ON workspace_threads(workspace_id);

-- Workspace messages (stored for analytics + standalone history)
CREATE TABLE IF NOT EXISTS workspace_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  thread_id TEXT,                               -- NULL for embed mode
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources_json TEXT,                            -- RAG sources used
  latency_ms INTEGER,
  tokens_used INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_messages_thread ON workspace_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_session ON workspace_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_workspace ON workspace_messages(workspace_id);

-- Rate limiting state (embed only)
CREATE TABLE IF NOT EXISTS workspace_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  request_count INTEGER DEFAULT 0,
  UNIQUE(workspace_id, ip_hash, window_start),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_rate_limits_workspace ON workspace_rate_limits(workspace_id);

-- Daily analytics rollup
CREATE TABLE IF NOT EXISTS workspace_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- ============ Triggers ============

CREATE TRIGGER IF NOT EXISTS update_user_timestamp
AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_thread_timestamp
AFTER UPDATE ON threads
BEGIN
  UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_thread_on_message
AFTER INSERT ON messages
BEGIN
  UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.thread_id;
END;
```

---

## 2. Table Descriptions

### users

Primary user table with role-based access control.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| email | TEXT | Unique email (case-insensitive lookup) |
| name | TEXT | Optional display name |
| role | TEXT | `admin`, `superuser`, or `user` |
| added_by | TEXT | Email of admin who added (or 'system') |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

### categories

Document categories, each mapping to a ChromaDB collection.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| name | TEXT | Unique category name (e.g., "HR", "Finance") |
| slug | TEXT | URL-safe slug (e.g., "hr", "finance") |
| description | TEXT | Optional description |
| created_by | TEXT | Admin email who created |
| created_at | DATETIME | Creation timestamp |

### super_user_categories

Maps super users to categories they can manage (full control: upload documents, manage users).

| Column | Type | Description |
|--------|------|-------------|
| user_id | INTEGER | FK to users.id |
| category_id | INTEGER | FK to categories.id |
| assigned_at | DATETIME | When assigned |
| assigned_by | TEXT | Admin email who assigned |

### user_subscriptions

Maps users to categories they can query (read-only access for chat/queries).

**Hybrid Role Support:** Superusers can exist in BOTH `super_user_categories` (for management access) AND `user_subscriptions` (for read-only access to additional categories). This allows a superuser to:
- **Manage** categories in `super_user_categories` (upload docs, manage subscribers)
- **Query** additional categories in `user_subscriptions` (chat access only)

The `getCategoriesForSuperUser()` function queries both tables to return all accessible categories.

| Column | Type | Description |
|--------|------|-------------|
| user_id | INTEGER | FK to users.id |
| category_id | INTEGER | FK to categories.id |
| is_active | INTEGER | 1=active, 0=paused |
| subscribed_at | DATETIME | When subscribed |
| subscribed_by | TEXT | Admin/superuser email who subscribed |

### documents

Metadata for global policy documents.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| filename | TEXT | Original filename |
| filepath | TEXT | Path relative to global-docs/ |
| file_size | INTEGER | File size in bytes |
| is_global | INTEGER | 1=indexed in all categories |
| chunk_count | INTEGER | Number of chunks in ChromaDB |
| status | TEXT | `processing`, `ready`, or `error` |
| error_message | TEXT | Error details if status='error' |
| uploaded_by | TEXT | Admin email who uploaded |
| created_at | DATETIME | Upload timestamp |

### document_categories

Maps documents to categories (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| document_id | INTEGER | FK to documents.id |
| category_id | INTEGER | FK to categories.id (NULL if category deleted) |

### threads

Conversation threads belonging to users.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID v4 primary key |
| user_id | INTEGER | FK to users.id |
| title | TEXT | Auto-generated from first message |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last activity timestamp |

### thread_categories

Categories selected for a thread (for RAG queries).

| Column | Type | Description |
|--------|------|-------------|
| thread_id | TEXT | FK to threads.id |
| category_id | INTEGER | FK to categories.id |

### messages

Conversation messages within threads.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID v4 primary key |
| thread_id | TEXT | FK to threads.id |
| role | TEXT | `user`, `assistant`, or `tool` |
| content | TEXT | Message text (markdown supported) |
| sources_json | TEXT | JSON array of Source objects |
| attachments_json | TEXT | JSON array of attachment filenames |
| tool_calls_json | TEXT | JSON array of tool calls (OpenAI format) |
| tool_call_id | TEXT | Tool call ID (for tool responses) |
| tool_name | TEXT | Tool name (for tool responses) |
| created_at | DATETIME | Message timestamp |

### thread_uploads

User-uploaded PDFs attached to threads.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| thread_id | TEXT | FK to threads.id |
| filename | TEXT | Original filename |
| filepath | TEXT | Path to stored file |
| file_size | INTEGER | File size in bytes |
| uploaded_at | DATETIME | Upload timestamp |

### thread_outputs

AI-generated files (images, documents).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| thread_id | TEXT | FK to threads.id |
| message_id | TEXT | FK to messages.id (nullable) |
| filename | TEXT | Generated filename |
| filepath | TEXT | Path to stored file |
| file_type | TEXT | `image`, `pdf`, `docx`, `xlsx`, `pptx` |
| file_size | INTEGER | File size in bytes |
| created_at | DATETIME | Creation timestamp |

### settings

Key-value configuration store.

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT | Setting key (primary key) |
| value | TEXT | JSON-encoded value |
| updated_at | DATETIME | Last update timestamp |
| updated_by | TEXT | Admin email who updated |

**Settings Keys:**

| Key | Type | Description |
|-----|------|-------------|
| `rag-settings` | RagSettings | RAG retrieval parameters |
| `llm-settings` | LlmSettings | LLM model and parameters |
| `tavily-settings` | TavilySettings | Web search configuration (legacy) |
| `upload-limits` | UploadLimits | File upload constraints |
| `system-prompt` | SystemPrompt | AI system prompt content |
| `acronym-mappings` | AcronymMappings | Custom acronym expansions |
| `retention-settings` | RetentionSettings | Data retention policies |
| `branding-settings` | BrandingSettings | Bot name and icon for sidebar |
| `embedding-settings` | EmbeddingSettings | Embedding model configuration |
| `reranker-settings` | RerankerSettings | Chunk reranking configuration |
| `skills-settings` | SkillsSettings | Skills system configuration |
| `memory-settings` | MemorySettings | User memory extraction configuration |
| `summarization-settings` | SummarizationSettings | Thread summarization configuration |

**Settings Interfaces:**

```typescript
export interface RagSettings {
  topKChunks: number;           // Number of chunks to retrieve (default: 15)
  maxContextChunks: number;     // Max chunks in context (default: 10)
  similarityThreshold: number;  // Min similarity score (default: 0.5)
  chunkSize: number;            // Characters per chunk (default: 1200)
  chunkOverlap: number;         // Overlap between chunks (default: 200)
  queryExpansionEnabled: boolean; // Expand acronyms (default: true)
  cacheEnabled: boolean;        // Redis caching (default: true)
  cacheTTLSeconds: number;      // Cache TTL (default: 3600)
}

export interface LlmSettings {
  model: string;               // Model name routed via LiteLLM (default: 'gpt-4.1-mini')
  temperature: number;         // Response randomness (default: 0.2)
  maxTokens: number;           // Max response tokens (default: 2000)
  streaming: boolean;          // Enable streaming responses (default: true)
  memoryExtractionMaxTokens: number;  // Max tokens for memory extraction
  promptMaxTokens: number;     // Max tokens for prompt context
}

export interface TavilySettings {
  enabled: boolean;                              // Enable web search (default: false)
  defaultTopic: 'general' | 'news' | 'finance'; // Search category
  defaultSearchDepth: 'basic' | 'advanced';     // Search depth
  maxResults: number;                            // Max results (default: 5)
  includeDomains: string[];                      // Whitelist domains
  excludeDomains: string[];                      // Blacklist domains
  cacheTTLSeconds: number;                       // Web cache TTL (default: 3600)
}

export interface UploadLimits {
  maxFilesPerThread: number;   // Max files per thread (default: 5)
  maxFileSizeMB: number;       // Max file size in MB (default: 10)
  allowedTypes: string[];      // MIME types (default: ['application/pdf'])
}

export interface RetentionSettings {
  threadRetentionDays: number;     // Days to keep threads (default: 90)
  storageAlertThreshold: number;   // Storage alert % (default: 70)
}

export interface BrandingSettings {
  botName: string;    // Display name in sidebar (default: "Grenada AI Assistant")
  botIcon: string;    // Icon key: government, operations, finance, kpi, logs, data, monitoring, architecture, internet, systems, policy
}

export interface EmbeddingSettings {
  model: string;       // Embedding model (default: 'text-embedding-3-large')
  dimensions: number;  // Vector dimensions (default: 3072)
}

export interface RerankerSettings {
  enabled: boolean;        // Enable reranking (default: false)
  provider: string;        // Provider: 'cohere' or 'local'
  topKForReranking: number;  // Chunks to rerank (default: 50)
  minRerankerScore: number;  // Minimum rerank score (default: 0.3)
  cacheTTLSeconds: number;   // Cache TTL (default: 3600)
}

export interface SkillsSettings {
  enabled: boolean;        // Master enable/disable (default: true)
  maxTotalTokens: number;  // Budget for all skills combined (default: 3000)
  debugMode: boolean;      // Log skill activation details (default: false)
}

export interface MemorySettings {
  enabled: boolean;           // Enable memory extraction (default: false)
  maxFactsPerCategory: number; // Max facts to store per category (default: 50)
  maxFactAge: number;         // Days to keep facts (default: 90)
}

export interface SummarizationSettings {
  enabled: boolean;           // Enable auto-summarization (default: false)
  messageThreshold: number;   // Messages before summarization (default: 20)
  tokenThreshold: number;     // Token count before summarization (default: 8000)
  keepRecentMessages: number; // Messages to keep after summary (default: 5)
}
```

### storage_alerts

Storage usage alerts for monitoring.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| threshold_percent | INTEGER | Threshold that was crossed |
| current_percent | INTEGER | Current usage percentage |
| alerted_at | DATETIME | Alert timestamp |
| acknowledged_at | DATETIME | When acknowledged (NULL if pending) |
| acknowledged_by | TEXT | Admin who acknowledged |

### skills

Modular prompt components that can be dynamically injected into the system prompt.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| name | TEXT | Unique skill name |
| description | TEXT | Optional description |
| prompt_content | TEXT | The actual skill prompt text |
| trigger_type | TEXT | `always`, `category`, or `keyword` |
| trigger_value | TEXT | Keywords (comma-separated) for keyword-type |
| category_restricted | INTEGER | 1=only applies to linked categories |
| is_index | INTEGER | 1=broader domain expertise skill |
| priority | INTEGER | Lower = higher priority (for sorting) |
| is_active | INTEGER | 1=enabled, 0=disabled |
| is_core | INTEGER | 1=core skill (cannot be deleted) |
| created_by_role | TEXT | `admin` or `superuser` |
| token_estimate | INTEGER | Estimated token count (~4 chars per token) |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |
| created_by | TEXT | Email of creator |
| updated_by | TEXT | Email of last updater |

### category_skills

Maps skills to categories (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| category_id | INTEGER | FK to categories.id |
| skill_id | INTEGER | FK to skills.id |

### category_prompts

Category-specific prompt addendums and starter prompts.

| Column | Type | Description |
|--------|------|-------------|
| category_id | INTEGER | FK to categories.id (primary key) |
| prompt_addendum | TEXT | Category-specific system prompt addition |
| starter_prompts | TEXT | JSON array of starter prompt objects |
| updated_at | DATETIME | Last update timestamp |
| updated_by | TEXT | Email of last updater |

### tool_configs

Global tool configurations.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| tool_name | TEXT | Unique tool identifier (e.g., `web_search`) |
| is_enabled | INTEGER | 1=enabled, 0=disabled |
| config_json | TEXT | JSON configuration object |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |
| updated_by | TEXT | Email of last updater |

### tool_config_audit

Audit trail for tool configuration changes.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| tool_name | TEXT | Tool that was changed |
| operation | TEXT | `create`, `update`, or `delete` |
| old_config | TEXT | Previous configuration JSON |
| new_config | TEXT | New configuration JSON |
| changed_by | TEXT | Email of admin who made change |
| changed_at | DATETIME | Change timestamp |

### category_tool_configs

Category-level tool configuration overrides.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| category_id | INTEGER | FK to categories.id |
| tool_name | TEXT | Tool being overridden |
| is_enabled | INTEGER | NULL=inherit from global, 0/1=override |
| branding_json | TEXT | Category-specific branding config |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |
| updated_by | TEXT | Email of last updater |

### tool_routing_rules

Keyword and regex-based routing rules that force specific tools when patterns match user messages.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| tool_name | TEXT | Target tool name (e.g., `chart_gen`, `task_planner`) |
| rule_name | TEXT | Descriptive name for the rule |
| rule_type | TEXT | `keyword` (word boundary matching) or `regex` |
| patterns | TEXT | JSON array of patterns to match (e.g., `["chart", "graph"]`) |
| force_mode | TEXT | `required` (force specific tool), `preferred` (force tool use), `suggested` (hint) |
| priority | INTEGER | Lower = higher priority, determines order of matching |
| category_ids | TEXT | JSON array of category IDs (NULL = applies to all categories) |
| is_active | INTEGER | 1=enabled, 0=disabled |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |
| created_by | TEXT | Email of admin who created |
| updated_by | TEXT | Email of last updater |

**Force Mode Behavior:**

| Mode | OpenAI `tool_choice` | Effect |
|------|---------------------|--------|
| `required` | `{type: 'function', function: {name: '...'}}` | Forces specific tool to be called |
| `preferred` | `'required'` | LLM must use some tool, but can choose which |
| `suggested` | `'auto'` | Hint only, LLM decides |

### data_api_configs

API data source configurations for external REST APIs.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| name | TEXT | Unique data source name |
| description | TEXT | Human-readable description |
| endpoint | TEXT | Full API endpoint URL |
| method | TEXT | `GET` or `POST` |
| response_format | TEXT | `json` or `csv` |
| authentication | TEXT | JSON: {type, credentials} (credentials encrypted) |
| headers | TEXT | JSON: custom request headers |
| parameters | TEXT | JSON: parameter definitions array |
| response_structure | TEXT | JSON: {jsonPath, dataIsArray, fields, totalCountPath} |
| sample_response | TEXT | JSON: example response for LLM context |
| openapi_spec | TEXT | JSON: original OpenAPI spec if imported |
| config_method | TEXT | `manual` or `openapi` |
| status | TEXT | `active`, `inactive`, `error`, `untested` |
| created_by | TEXT | Admin email who created |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |
| last_tested | DATETIME | Last test timestamp |
| last_error | TEXT | Error message from last failed test |

### data_api_categories

Maps API data sources to categories (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| api_id | TEXT | FK to data_api_configs.id |
| category_id | INTEGER | FK to categories.id |
| created_at | DATETIME | When linked |

### data_csv_configs

CSV data source configurations for uploaded CSV files.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| name | TEXT | Unique data source name |
| description | TEXT | Human-readable description |
| file_path | TEXT | Server storage path |
| original_filename | TEXT | Original upload filename |
| columns | TEXT | JSON: column definitions [{name, type, description, format}] |
| sample_data | TEXT | JSON: first 5 rows for preview |
| row_count | INTEGER | Total number of rows |
| file_size | INTEGER | File size in bytes |
| created_by | TEXT | Admin email who uploaded |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

### data_csv_categories

Maps CSV data sources to categories (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| csv_id | TEXT | FK to data_csv_configs.id |
| category_id | INTEGER | FK to categories.id |
| created_at | DATETIME | When linked |

### data_source_audit

Audit trail for data source changes.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| source_type | TEXT | `api` or `csv` |
| source_id | TEXT | ID of the data source |
| action | TEXT | `created`, `updated`, `tested`, `deleted` |
| changed_by | TEXT | Email of admin who made change |
| details | TEXT | JSON: change details |
| changed_at | DATETIME | Change timestamp |

### function_api_configs

Function API configurations with OpenAI-format tool schemas.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| name | TEXT | Unique configuration name |
| description | TEXT | Human-readable description |
| base_url | TEXT | Base URL for the API |
| auth_type | TEXT | `api_key`, `bearer`, `basic`, `none` |
| auth_header | TEXT | Header name for API key (e.g., `X-API-Key`) |
| auth_credentials | TEXT | Encrypted credentials |
| default_headers | TEXT | JSON: default headers to include |
| tools_schema | TEXT | JSON: Array of OpenAI tool definitions |
| endpoint_mappings | TEXT | JSON: function name → {method, path} mapping |
| timeout_seconds | INTEGER | Request timeout (default: 30) |
| cache_ttl_seconds | INTEGER | Cache TTL (default: 3600) |
| is_enabled | INTEGER | 1=enabled, 0=disabled |
| status | TEXT | `active`, `inactive`, `error`, `untested` |
| created_by | TEXT | Admin email who created |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |
| last_tested | DATETIME | Last test timestamp |
| last_error | TEXT | Error message from last failed test |

### function_api_categories

Maps Function APIs to categories (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| api_id | TEXT | FK to function_api_configs.id |
| category_id | INTEGER | FK to categories.id |
| created_at | DATETIME | When linked |

### user_memories

Extracted facts for user memory across sessions.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| user_id | INTEGER | FK to users.id |
| category_id | INTEGER | FK to categories.id (NULL for global) |
| facts_json | TEXT | JSON array of extracted facts |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

### thread_summaries

Summary records when threads are summarized to reduce token usage.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| thread_id | TEXT | FK to threads.id |
| summary | TEXT | Generated summary text |
| messages_summarized | INTEGER | Number of messages summarized |
| tokens_before | INTEGER | Token count before summarization |
| tokens_after | INTEGER | Token count after summarization |
| created_at | DATETIME | Summarization timestamp |

### archived_messages

Original messages preserved after summarization.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| thread_id | TEXT | FK to threads.id |
| role | TEXT | Message role (user/assistant) |
| content | TEXT | Original message content |
| sources_json | TEXT | Original sources JSON |
| created_at | DATETIME | Original message timestamp |
| archived_at | DATETIME | When archived |
| summary_id | INTEGER | FK to thread_summaries.id |

### task_plans

Active and completed task plans from the Task Planner tool.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| thread_id | TEXT | FK to threads.id |
| template_key | TEXT | Links to task_planner_templates (NULL for ad-hoc) |
| name | TEXT | Plan display name |
| status | TEXT | `pending`, `in_progress`, `completed`, `failed`, `cancelled` |
| tasks | TEXT | JSON array of task objects with id, description, status |
| current_task_index | INTEGER | Index of currently executing task |
| results | TEXT | JSON array of task results/outputs |
| placeholders | TEXT | JSON object of substituted placeholder values |
| created_at | DATETIME | Plan creation timestamp |
| updated_at | DATETIME | Last status change timestamp |
| completed_at | DATETIME | Completion timestamp |

### rag_test_queries

Test queries for RAG tuning evaluation.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| query | TEXT | Test question text |
| expected_docs | TEXT | JSON array of expected document names |
| category_ids | TEXT | JSON array of category IDs to test |
| created_at | DATETIME | Creation timestamp |
| created_by | TEXT | Admin email who created |

### rag_test_results

Results from RAG test query runs.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| query_id | INTEGER | FK to rag_test_queries.id |
| run_id | TEXT | Groups results from same test run |
| top_k | INTEGER | Top K setting used |
| similarity_threshold | REAL | Similarity threshold used |
| reranker_enabled | INTEGER | 1=reranker on, 0=off |
| retrieved_docs | TEXT | JSON array of retrieved document info |
| precision_score | REAL | Precision metric |
| recall_score | REAL | Recall metric |
| latency_ms | INTEGER | Query latency in milliseconds |
| created_at | DATETIME | Result creation timestamp |

### thread_shares

Secure share links for conversation threads.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| thread_id | TEXT | FK to threads.id |
| share_token | TEXT | Unique URL-safe cryptographic token (32 bytes, base64) |
| created_by | INTEGER | FK to users.id (share creator) |
| allow_download | INTEGER | 1=allow file downloads, 0=view only |
| expires_at | DATETIME | Expiration timestamp (NULL = never expires) |
| view_count | INTEGER | Number of times share has been viewed |
| created_at | DATETIME | Share creation timestamp |
| last_viewed_at | DATETIME | Most recent view timestamp |
| revoked_at | DATETIME | Revocation timestamp (NULL = active) |

**Share token generation:**
```typescript
const token = crypto.randomBytes(32).toString('base64url');
```

### share_access_log

Audit trail for share access events.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| share_id | TEXT | FK to thread_shares.id |
| accessed_by | INTEGER | FK to users.id (viewer) |
| action | TEXT | `view` or `download` |
| resource_type | TEXT | `upload` or `output` (for downloads) |
| resource_id | TEXT | ID of downloaded resource |
| accessed_at | DATETIME | Access timestamp |

### workspaces

Workspace configurations for embed and standalone chatbot instances.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| slug | TEXT | Unique 16-char URL path (e.g., '2yibbnmbmctyu') |
| name | TEXT | Display name for admin |
| type | TEXT | `embed` or `standalone` |
| is_enabled | INTEGER | 1=active, 0=disabled |
| access_mode | TEXT | `category` (users with ALL workspace categories) or `explicit` (user list) |
| primary_color | TEXT | Hex color for branding |
| logo_url | TEXT | Optional logo URL |
| chat_title | TEXT | Optional custom chat title |
| greeting_message | TEXT | Welcome message |
| suggested_prompts | TEXT | JSON array of starter prompts |
| footer_text | TEXT | Optional footer text |
| llm_provider | TEXT | LLM provider override (NULL=use global) |
| llm_model | TEXT | LLM model override (NULL=use global) |
| temperature | REAL | Temperature override (NULL=use global) |
| system_prompt | TEXT | Additional system prompt |
| allowed_domains | TEXT | JSON array of allowed embed domains |
| daily_limit | INTEGER | Daily request limit (embed) |
| session_limit | INTEGER | Per-session request limit (embed) |
| voice_enabled | INTEGER | 1=voice input enabled |
| file_upload_enabled | INTEGER | 1=file upload enabled |
| max_file_size_mb | INTEGER | Maximum upload file size |
| created_by | TEXT | User ID of creator |
| created_by_role | TEXT | `admin` or `superuser` |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

### workspace_categories

Many-to-many relationship between workspaces and categories.

| Column | Type | Description |
|--------|------|-------------|
| workspace_id | TEXT | FK to workspaces.id |
| category_id | INTEGER | FK to categories.id |

### workspace_users

Explicit user list for workspace access control (standalone mode with `access_mode='explicit'`).

| Column | Type | Description |
|--------|------|-------------|
| workspace_id | TEXT | FK to workspaces.id |
| user_id | TEXT | FK to users.id |
| added_by | TEXT | Admin/SuperUser who added this user |
| added_at | DATETIME | When added |

### workspace_sessions

Session tracking for both embed and standalone workspaces.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID session token |
| workspace_id | TEXT | FK to workspaces.id |
| visitor_id | TEXT | Optional fingerprint/cookie ID |
| user_id | TEXT | FK to users.id (NULL for embed) |
| referrer_url | TEXT | Original referrer URL |
| ip_hash | TEXT | Hashed IP address |
| message_count | INTEGER | Number of messages in session |
| started_at | DATETIME | Session start time |
| last_activity | DATETIME | Last activity timestamp |
| expires_at | DATETIME | Expiration time (NULL=no expiry) |

### workspace_threads

Conversation threads for standalone workspaces.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| workspace_id | TEXT | FK to workspaces.id |
| session_id | TEXT | FK to workspace_sessions.id |
| title | TEXT | Thread title |
| is_archived | INTEGER | 1=archived, 0=active |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

### workspace_messages

Message storage for workspace conversations (analytics + standalone history).

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| workspace_id | TEXT | FK to workspaces.id |
| session_id | TEXT | FK to workspace_sessions.id |
| thread_id | TEXT | FK to workspace_threads.id (NULL for embed) |
| role | TEXT | `user` or `assistant` |
| content | TEXT | Message content |
| sources_json | TEXT | JSON: RAG sources used |
| latency_ms | INTEGER | Response latency in milliseconds |
| tokens_used | INTEGER | Token count for response |
| created_at | DATETIME | Message timestamp |

### workspace_rate_limits

Rate limiting state for embed mode.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| workspace_id | TEXT | FK to workspaces.id |
| ip_hash | TEXT | Hashed IP address |
| window_start | DATETIME | Rate limit window start |
| request_count | INTEGER | Requests in current window |

### workspace_analytics

Daily analytics rollup for workspace usage.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| workspace_id | TEXT | FK to workspaces.id |
| date | DATE | Analytics date |
| sessions_count | INTEGER | Number of sessions |
| messages_count | INTEGER | Number of messages |
| unique_visitors | INTEGER | Unique visitor count |
| avg_response_time_ms | INTEGER | Average response latency |
| total_tokens_used | INTEGER | Total tokens consumed |

---

## 3. TypeScript Interfaces

### Database Layer Types

```typescript
// src/lib/db/users.ts

export type UserRole = 'admin' | 'superuser' | 'user';

export interface DbUser {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserWithSubscriptions extends DbUser {
  subscriptions: {
    categoryId: number;
    categoryName: string;
    categorySlug: string;
    isActive: boolean;
  }[];
}

export interface UserWithAssignments extends DbUser {
  assignedCategories: {
    categoryId: number;
    categoryName: string;
    categorySlug: string;
  }[];
}

// src/lib/db/categories.ts

export interface DbCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface CategoryWithStats extends DbCategory {
  documentCount: number;
  superUserCount: number;
  subscriberCount: number;
}

// src/lib/db/documents.ts

export interface DbDocument {
  id: number;
  filename: string;
  filepath: string;
  file_size: number;
  is_global: number;
  chunk_count: number;
  status: 'processing' | 'ready' | 'error';
  error_message: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface DocumentWithCategories extends DbDocument {
  categories: {
    categoryId: number;
    categoryName: string;
  }[];
}

// src/lib/db/threads.ts

export interface DbThread {
  id: string;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  sources_json: string | null;
  attachments_json: string | null;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  created_at: string;
}
```

### API Response Types

```typescript
// src/types/index.ts

export interface Source {
  documentName: string;
  pageNumber: number;
  chunkText: string;
  score: number;
  isWeb?: boolean;  // True if from Tavily web search
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  attachments?: string[];
  timestamp: Date;
}

export interface Thread {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  uploadCount: number;
  categoryIds: number[];
}

export interface GlobalDocument {
  id: number;
  filename: string;
  filepath: string;
  size: number;
  chunkCount: number;
  uploadedAt: Date;
  uploadedBy: string;
  status: 'processing' | 'ready' | 'error';
  errorMessage?: string;
  isGlobal: boolean;
  categories: DocumentCategory[];
}

export interface DocumentCategory {
  categoryId: number;
  categoryName: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  documentCount: number;
  superUserCount: number;
  subscriberCount: number;
}

export interface AllowedUser {
  email: string;
  name?: string;
  role: 'admin' | 'superuser' | 'user';
  addedAt: Date;
  addedBy: string;
  subscriptions: { categoryId: number; categoryName: string; isActive: boolean }[];
  assignedCategories: { categoryId: number; categoryName: string }[];
}

// src/types/workspace.ts

export type WorkspaceType = 'embed' | 'standalone';
export type AccessMode = 'category' | 'explicit';

export interface Workspace {
  id: string;
  slug: string;                    // Random 16-char URL path
  name: string;
  type: WorkspaceType;
  is_enabled: boolean;
  access_mode: AccessMode;
  // Branding
  primary_color: string;
  logo_url?: string;
  chat_title?: string;
  greeting_message: string;
  suggested_prompts?: string[];
  footer_text?: string;
  // LLM overrides
  llm_provider?: string;
  llm_model?: string;
  temperature?: number;
  system_prompt?: string;
  // Embed-specific
  allowed_domains: string[];
  daily_limit: number;
  session_limit: number;
  // Features
  voice_enabled: boolean;
  file_upload_enabled: boolean;
  max_file_size_mb: number;
  // Meta
  category_ids: number[];
  user_ids?: string[];             // Explicit user list
  created_by: string;
  created_by_role: 'admin' | 'superuser';
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSession {
  id: string;
  workspace_id: string;
  visitor_id?: string;
  user_id?: string;
  referrer_url?: string;
  ip_hash?: string;
  message_count: number;
  started_at: string;
  last_activity: string;
  expires_at?: string;
}

export interface WorkspaceThread {
  id: string;
  workspace_id: string;
  session_id: string;
  title: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMessage {
  id: string;
  workspace_id: string;
  session_id: string;
  thread_id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources_json?: string;
  latency_ms?: number;
  tokens_used?: number;
  created_at: string;
}

export interface WorkspaceUser {
  workspace_id: string;
  user_id: string;
  user_email: string;              // Denormalized for display
  user_name: string;               // Denormalized for display
  added_by: string;
  added_at: string;
}

export interface WorkspaceAnalytics {
  workspace_id: string;
  date: string;
  sessions_count: number;
  messages_count: number;
  unique_visitors: number;
  avg_response_time_ms?: number;
  total_tokens_used: number;
}
```

---

## 4. ChromaDB Schema

### Category-Based Collections

Each category has its own ChromaDB collection with the naming pattern `policy_{category_slug}`:

```
ChromaDB Collections:
├── policy_hr           ← HR category documents
├── policy_finance      ← Finance category documents
├── policy_it           ← IT category documents
└── policy_legal        ← Legal category documents
```

**Global Documents**: When `is_global=1`, document chunks are indexed into ALL category collections.

### Collection Configuration

```typescript
{
  name: "policy_{slug}",
  metadata: {
    "hnsw:space": "cosine"  // Cosine similarity for text embeddings
  }
}
```

### Chunk Document Schema

```typescript
interface ChromaDocument {
  id: string;           // Format: "{docId}-chunk-{index}"
  embedding: number[];  // 3072 dimensions (text-embedding-3-large)
  document: string;     // The actual chunk text
  metadata: {
    documentId: number;      // Parent document ID (SQLite)
    documentName: string;    // Original filename
    pageNumber: number;      // Page where chunk appears
    chunkIndex: number;      // Position in document
    source: 'global' | 'user';  // Document source type
    threadId?: string;       // Only for user uploads
    userId?: number;         // Only for user uploads
  }
}
```

### Chunking Strategy

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| Chunk Size | 800 characters | Balance between context and specificity |
| Overlap | 150 characters | Ensure continuity across chunks |
| Separators | `['\n\n', '\n', '. ', ' ', '']` | Preserve paragraph/sentence boundaries |

**Note**: Chunk size and overlap are configurable via admin settings (`rag-settings`).

### Query Pattern

```typescript
// Query for relevant chunks from user's subscribed categories
const categoryCollections = getUserCategorySlugs(userId);

for (const slug of categoryCollections) {
  const collection = await chromaClient.getCollection(`policy_${slug}`);
  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: 5,
    include: ["documents", "metadatas", "distances"]
  });
}
```

---

## 5. Redis Schema

### Key Patterns

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `query:{hash}` | Configurable (1h default) | Cached RAG responses |
| `query:tavily:{hash}` | Configurable (1d default) | Cached web search results |
| `session:{token}` | 24 hours | User session data |

### Cache Management Commands

```bash
# 1. Flush complete Redis database (all cache)
docker exec policy-bot-redis redis-cli FLUSHALL

# 2. Flush RAG query cache only (excludes Tavily)
docker exec policy-bot-redis redis-cli --scan --pattern "query:*" --count 1000 | grep -v "tavily" | xargs -r docker exec -i policy-bot-redis redis-cli DEL

# 3. Flush Tavily web search cache only
docker exec policy-bot-redis redis-cli --scan --pattern "query:tavily:*" | xargs -r docker exec -i policy-bot-redis redis-cli DEL

# Verify cache entries
docker exec policy-bot-redis redis-cli KEYS "*"
```

> **Note:** The Admin Documents page "Refresh" button performs a complete Redis flush (`FLUSHALL`) plus reindexes all documents.

### Query Cache Schema

**Key**: `query:{md5(query + categories + settings)}`

```typescript
interface CachedQuery {
  answer: string;
  sources: Source[];
  cachedAt: string;  // ISO 8601 timestamp
}
```

### Tavily Cache Schema

**Key**: `tavily:{md5(searchQuery)}`

```typescript
interface CachedTavilyResult {
  results: TavilySearchResult[];
  cachedAt: string;
}
```

### Session Schema

Managed by NextAuth. Sessions stored in Redis for persistence.

**Key**: `session:{sessionToken}`

```typescript
interface Session {
  user: {
    name: string;
    email: string;
    image?: string;
    role: 'admin' | 'superuser' | 'user';
  };
  expires: string;
}
```

---

## 6. Filesystem Storage

### Directory Structure

```
data/
├── policy-bot.db           ← SQLite database
├── global-docs/            ← Admin-uploaded policy documents
│   ├── Leave_Policy.pdf
│   ├── Travel_Guidelines.pdf
│   └── HR_Handbook.pdf
├── threads/                ← User thread data
│   └── {userId}/
│       └── {threadId}/
│           ├── uploads/    ← User-uploaded PDFs
│           │   └── document.pdf
│           └── outputs/    ← AI-generated files
│               └── chart.png
└── workspace-uploads/      ← Workspace session uploads
    └── {workspaceId}/
        └── {sessionId}/
            ├── document.pdf
            └── image.png
```

### File Storage Notes

- **global-docs/**: Admin uploads stored here, metadata in SQLite `documents` table
- **threads/{userId}/{threadId}/uploads/**: User uploads, metadata in `thread_uploads` table
- **threads/{userId}/{threadId}/outputs/**: AI outputs, metadata in `thread_outputs` table
- **workspace-uploads/{workspaceId}/{sessionId}/**: Workspace session uploads (both embed and standalone modes)
- PDF files are stored with sanitized filenames to prevent path traversal
- Workspace uploads are cleaned up when sessions expire (embed) or are explicitly deleted

---

## 7. Data Flow Diagrams

### User Creation with Subscriptions

```
Admin Creates User
    │
    ▼
┌─────────────────┐
│ Insert into     │
│ users table     │
│ (role, email)   │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ For each        │
│ category ID:    │
│ Insert into     │
│ user_subscriptions
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Return user     │
│ with subs list  │
└─────────────────┘
```

### Document Upload with Categories

Two upload methods are supported: file upload and text content upload.

#### File Upload Flow
```
Admin/Super User File Upload
    │
    ▼
┌─────────────────┐
│ Validate file   │
│ (type, ≤50MB)   │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Save file to    │
│ global-docs/    │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Insert into     │
│ documents       │
│ (status=process)│
└─────────────────┘
    │
    ├── is_global=true ──▶ No document_categories entries
    │                      (indexed in ALL collections)
    │
    └── is_global=false ─▶ Insert document_categories
                           for each selected category
    │
    ▼
┌─────────────────┐
│ Extract text    │
│ (Azure DI or    │
│  Mistral OCR)   │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Chunk + Embed   │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ Store in ChromaDB:              │
│ - Global: ALL policy_* colls   │
│ - Category: specific colls     │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ Update document │
│ status=ready    │
│ chunk_count=N   │
└─────────────────┘
```

#### Text Content Upload Flow
```
Admin/Super User Text Upload
    │
    ▼
┌─────────────────┐
│ Validate input  │
│ (name ≤255 char │
│  content ≥10)   │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Save as .txt    │
│ to global-docs/ │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Insert into     │
│ documents       │
│ (status=process)│
└─────────────────┘
    │
    ├── is_global=true ──▶ No document_categories entries
    │                      (indexed in ALL collections)
    │
    └── is_global=false ─▶ Insert document_categories
                           for each selected category
    │
    ▼
┌─────────────────┐
│ Chunk text      │  ◀── Bypasses OCR extraction
│ directly        │      (text already plain)
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Create          │
│ embeddings      │
└─────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ Store in ChromaDB:              │
│ - Global: ALL policy_* colls   │
│ - Category: specific colls     │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ Update document │
│ status=ready    │
│ chunk_count=N   │
└─────────────────┘
```

### Category-Aware Query Flow

```
User Query
    │
    ▼
┌─────────────────┐
│ Get user's      │
│ subscribed      │
│ category IDs    │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Get thread      │
│ category IDs    │
│ (if selected)   │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Intersect:      │
│ user subs ∩     │
│ thread cats     │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Query each      │
│ policy_{slug}   │
│ collection      │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Merge & rank    │
│ results         │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Generate answer │
│ via LiteLLM     │
└─────────────────┘
```

---

## 8. Indexes and Performance

### SQLite Indexes

| Table | Index | Purpose |
|-------|-------|---------|
| users | idx_users_email | Fast email lookups |
| users | idx_users_role | Filter by role |
| categories | idx_categories_slug | Collection name lookups |
| user_subscriptions | idx_user_subscriptions_user | Get user's subscriptions |
| user_subscriptions | idx_user_subscriptions_category | Get category subscribers |
| documents | idx_documents_status | Filter by processing status |
| documents | idx_documents_is_global | Find global documents |
| document_categories | idx_document_categories_doc | Get document's categories |
| document_categories | idx_document_categories_cat | Get category's documents |
| threads | idx_threads_user | Get user's threads |
| threads | idx_threads_updated | Sort by recent activity |
| messages | idx_messages_thread | Get thread's messages |
| storage_alerts | idx_storage_alerts_pending | Find unacknowledged alerts |

### ChromaDB Index

ChromaDB maintains HNSW (Hierarchical Navigable Small World) index for fast ANN search:

```typescript
{
  "hnsw:space": "cosine",
  "hnsw:construction_ef": 200,
  "hnsw:search_ef": 100
}
```

### Query Optimization Tips

1. Use `getUserWithSubscriptions()` for single query with JOINs
2. Batch embedding creation during ingestion (100 chunks/batch)
3. Enable Redis caching for frequently asked questions
4. Limit ChromaDB query results to top 5-10 per collection

---

## 9. Backup & Recovery

### SQLite Backup

```bash
# Backup database
sqlite3 data/policy-bot.db ".backup data/backup-$(date +%Y%m%d).db"

# Restore database
cp data/backup-20241202.db data/policy-bot.db
```

### ChromaDB Backup

```bash
# Backup ChromaDB volume
docker run --rm -v policy-bot_chroma_data:/data -v $(pwd):/backup \
  alpine tar czvf /backup/chroma-backup.tar.gz -C /data .

# Restore
docker run --rm -v policy-bot_chroma_data:/data -v $(pwd):/backup \
  alpine tar xzvf /backup/chroma-backup.tar.gz -C /data
```

### Redis Backup

```bash
# Backup Redis RDB
docker run --rm -v policy-bot_redis_data:/data -v $(pwd):/backup \
  alpine cp /data/dump.rdb /backup/redis-backup.rdb
```

### Full Backup Script

```bash
#!/bin/bash
BACKUP_DIR="/backups/policy-bot/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

# SQLite
sqlite3 data/policy-bot.db ".backup $BACKUP_DIR/policy-bot.db"

# Global docs
tar -czvf $BACKUP_DIR/global-docs.tar.gz data/global-docs/

# Threads (optional - large)
tar -czvf $BACKUP_DIR/threads.tar.gz data/threads/

# ChromaDB
docker run --rm -v policy-bot_chroma_data:/data -v $BACKUP_DIR:/backup \
  alpine tar czvf /backup/chroma.tar.gz -C /data .
```

---

## 10. Data Lifecycle

### User Data

| Event | Action |
|-------|--------|
| User created | Insert users, optionally user_subscriptions |
| User deleted | CASCADE deletes threads, messages, uploads, subscriptions |
| Role changed | Update users.role, may affect access |

### Document Data

| Event | Action |
|-------|--------|
| Document uploaded | Insert documents, document_categories, ChromaDB chunks |
| Document deleted | Remove from documents, document_categories, ChromaDB |
| Categories changed | Update document_categories, reindex in ChromaDB |
| Re-ingested | Delete old ChromaDB chunks, create new ones |

### Thread Data

| Event | Action |
|-------|--------|
| Thread created | Insert threads, thread_categories |
| Message added | Insert messages, update threads.updated_at (trigger) |
| Thread deleted | CASCADE deletes messages, thread_uploads, thread_outputs |

### Cache Data

| Data Type | TTL | Notes |
|-----------|-----|-------|
| Query cache | Configurable | Invalidated on document changes |
| Tavily cache | Configurable | Separate TTL from RAG cache |
| Sessions | 24 hours | Auto-expire |

---

## 11. Constraints & Validation

### User Constraints

| Constraint | Value |
|------------|-------|
| Email | Unique, required |
| Role | `admin`, `superuser`, or `user` |
| Max admins | Unlimited |

### Category Constraints

| Constraint | Value |
|------------|-------|
| Name | Unique, required |
| Slug | Auto-generated, unique |

### Document Constraints

| Constraint | Admin File Upload | Admin Text Upload | Super User File Upload | Super User Text Upload | User Uploads |
|------------|-------------------|-------------------|------------------------|------------------------|--------------|
| Max file size | 50 MB | 10 MB | 50 MB | 10 MB | 5 MB |
| Allowed types | PDF, DOCX, XLSX, PPTX, images | Text (.txt) | PDF only | Text (.txt) | PDF only |
| Max per thread | N/A | N/A | N/A | N/A | 3 files |
| Min content length | N/A | 10 chars | N/A | 10 chars | N/A |
| Max name length | N/A | 255 chars | N/A | 255 chars | N/A |
| Global option | Yes | Yes | No | No | N/A |

### Thread Constraints

| Constraint | Value |
|------------|-------|
| Max threads per user | Unlimited |
| Max messages per thread | Unlimited |
| Title max length | 100 characters |

---

## 12. Migration from JSON Files

If migrating from the previous JSON-based storage:

```typescript
// Migration steps:
// 1. Run schema.sql to create tables
// 2. Import allowed-users.json → users table
// 3. Import global-docs/registry.json → documents table
// 4. Create default category if none exist
// 5. Map all documents to default category
```

The migration is handled automatically on first run by checking for existing JSON files.
