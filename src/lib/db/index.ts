/**
 * SQLite Database Connection and Initialization
 *
 * Provides a singleton database connection with:
 * - Automatic initialization from schema.sql
 * - Connection pooling via better-sqlite3
 * - Default settings initialization
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { validateLiteLLMOnStartup } from '../litellm-validator';
import { seedCoreSkills } from '../skills/seed';
import { removeCoreFlag } from './skills';
import { seedDefaultProviders } from './llm-providers';

// Database file path
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'policybot.db');

// Provider guard: Track SQLite access when PostgreSQL is the configured provider
let sqliteAccessWarningShown = false;

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Get or create the database connection
 */
export function getDatabase(): Database.Database {
  if (db) return db;

  // Provider guard: Log warning when SQLite is accessed in PostgreSQL mode
  // During Phase 1 (hybrid mode), SQLite is still used for settings
  // This helps track what still needs migration to compat layer
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';
  if (provider === 'postgres' && !sqliteAccessWarningShown) {
    console.warn('[DB] SQLite accessed in PostgreSQL mode - settings/config only (Phase 1 hybrid mode)');
    sqliteAccessWarningShown = true;
  }

  // Ensure data directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Create database connection
  db = new Database(DB_PATH);

  // Enable foreign keys and WAL mode for better concurrency
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Initialize schema and run migrations
  console.log('[DB] Initializing database schema and migrations...');
  initializeSchema(db);

  // Initialize default settings
  initializeDefaultSettings(db);

  // Seed default LLM providers (idempotent)
  seedDefaultProviders();

  // Seed core skills (idempotent)
  seedCoreSkills();

  // Remove is_core flag from all skills (allows deletion)
  const removedCount = removeCoreFlag();
  if (removedCount > 0) {
    console.log(`[Skills] Removed is_core flag from ${removedCount} skills`);
  }

  // Validate LiteLLM config (fail fast if default model missing)
  validateLiteLLMOnStartup();

  return db;
}

/**
 * Initialize database schema from schema.sql
 */
function initializeSchema(database: Database.Database): void {
  // Try multiple paths for schema.sql (works in both dev and production)
  const possiblePaths = [
    path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql'),
    path.join(process.cwd(), '.next', 'server', 'lib', 'db', 'schema.sql'),
    path.join(__dirname, 'schema.sql'),
  ];

  let schema: string | null = null;
  for (const schemaPath of possiblePaths) {
    if (fs.existsSync(schemaPath)) {
      schema = fs.readFileSync(schemaPath, 'utf-8');
      break;
    }
  }

  if (!schema) {
    // Inline schema as fallback
    schema = getInlineSchema();
  }

  database.exec(schema);

  // Run migrations for new columns on existing tables
  runMigrations(database);
}

/**
 * Run migrations for adding new columns to existing tables
 */
function runMigrations(database: Database.Database): void {
  console.log('[DB Migration] Starting migrations...');

  // Check and add is_summarized column to threads
  const threadsColumns = database.pragma('table_info(threads)') as { name: string }[];
  const threadColumnNames = threadsColumns.map((c) => c.name);

  if (!threadColumnNames.includes('is_summarized')) {
    database.exec('ALTER TABLE threads ADD COLUMN is_summarized INTEGER DEFAULT 0');
    console.log('[DB Migration] Added is_summarized column to threads');
  }

  if (!threadColumnNames.includes('total_tokens')) {
    database.exec('ALTER TABLE threads ADD COLUMN total_tokens INTEGER DEFAULT 0');
    console.log('[DB Migration] Added total_tokens column to threads');
  }

  if (!threadColumnNames.includes('is_pinned')) {
    database.exec('ALTER TABLE threads ADD COLUMN is_pinned INTEGER DEFAULT 0');
    database.exec('CREATE INDEX IF NOT EXISTS idx_threads_pinned ON threads(is_pinned, updated_at DESC)');
    console.log('[DB Migration] Added is_pinned column to threads');
  }

  // Add selected_model column for per-thread model override
  if (!threadColumnNames.includes('selected_model')) {
    database.exec('ALTER TABLE threads ADD COLUMN selected_model TEXT');
    database.exec('CREATE INDEX IF NOT EXISTS idx_threads_selected_model ON threads(selected_model)');
    console.log('[DB Migration] Added selected_model column to threads');
  }

  // Check and add token_count column to messages
  const messagesColumns = database.pragma('table_info(messages)') as { name: string }[];
  const messageColumnNames = messagesColumns.map((c) => c.name);

  if (!messageColumnNames.includes('token_count')) {
    database.exec('ALTER TABLE messages ADD COLUMN token_count INTEGER');
  }

  // Check and add generated_documents_json column to messages (for autonomous doc_gen tool)
  if (!messageColumnNames.includes('generated_documents_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN generated_documents_json TEXT');
  }

  // Check and add visualizations_json column to messages (for data_source tool charts)
  if (!messageColumnNames.includes('visualizations_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN visualizations_json TEXT');
  }

  // Check and add generated_images_json column to messages (for autonomous image_gen tool)
  if (!messageColumnNames.includes('generated_images_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN generated_images_json TEXT');
  }

  // Check and add generated_podcasts_json column to messages (for autonomous podcast_gen tool)
  if (!messageColumnNames.includes('generated_podcasts_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN generated_podcasts_json TEXT');
  }

  // Check if skills table exists, create if not (for existing databases)
  const skillsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='skills'"
  ).get();

  // Check and add starter_prompts column to category_prompts
  const categoryPromptsColumns = database.pragma('table_info(category_prompts)') as { name: string }[];
  const categoryPromptsColumnNames = categoryPromptsColumns.map((c) => c.name);

  if (!categoryPromptsColumnNames.includes('starter_prompts')) {
    database.exec('ALTER TABLE category_prompts ADD COLUMN starter_prompts TEXT DEFAULT NULL');
  }

  if (!categoryPromptsColumnNames.includes('welcome_title')) {
    database.exec('ALTER TABLE category_prompts ADD COLUMN welcome_title TEXT DEFAULT NULL');
  }

  if (!categoryPromptsColumnNames.includes('welcome_message')) {
    database.exec('ALTER TABLE category_prompts ADD COLUMN welcome_message TEXT DEFAULT NULL');
  }

  if (!skillsTableExists) {
    database.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_skills_trigger ON skills(trigger_type, is_active);
      CREATE INDEX IF NOT EXISTS idx_skills_priority ON skills(priority);
      CREATE INDEX IF NOT EXISTS idx_skills_core ON skills(is_core);

      CREATE TABLE IF NOT EXISTS category_skills (
        category_id INTEGER NOT NULL,
        skill_id INTEGER NOT NULL,
        PRIMARY KEY (category_id, skill_id),
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_category_skills_category ON category_skills(category_id);
      CREATE INDEX IF NOT EXISTS idx_category_skills_skill ON category_skills(skill_id);
    `);
  }

  // Check and create tool_configs table for Tools system
  const toolConfigsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tool_configs'"
  ).get();

  if (!toolConfigsTableExists) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS tool_configs (
        id TEXT PRIMARY KEY,
        tool_name TEXT UNIQUE NOT NULL,
        is_enabled INTEGER DEFAULT 0,
        config_json TEXT NOT NULL,
        description_override TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_config_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
        old_config TEXT,
        new_config TEXT,
        changed_by TEXT NOT NULL,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_tool_config_audit_name ON tool_config_audit(tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_config_audit_time ON tool_config_audit(changed_at DESC);
    `);
  }

  // Check and create category_tool_configs table for per-category tool settings
  const categoryToolConfigsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='category_tool_configs'"
  ).get();

  if (!categoryToolConfigsTableExists) {
    database.exec(`
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
    `);
  }

  // Check and add document generation columns to thread_outputs
  const threadOutputsColumns = database.pragma('table_info(thread_outputs)') as { name: string }[];
  const threadOutputsColumnNames = threadOutputsColumns.map((c) => c.name);

  if (!threadOutputsColumnNames.includes('generation_config')) {
    database.exec('ALTER TABLE thread_outputs ADD COLUMN generation_config TEXT');
  }

  if (!threadOutputsColumnNames.includes('expires_at')) {
    database.exec('ALTER TABLE thread_outputs ADD COLUMN expires_at DATETIME');
  }

  if (!threadOutputsColumnNames.includes('download_count')) {
    database.exec('ALTER TABLE thread_outputs ADD COLUMN download_count INTEGER DEFAULT 0');
  }

  // Check and create data_api_configs table for Data Sources feature
  const dataApiConfigsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='data_api_configs'"
  ).get();

  if (!dataApiConfigsTableExists) {
    database.exec(`
      -- Data API configurations
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_tested DATETIME,
        last_error TEXT
      );

      -- API-Category mapping (orphan APIs not accessible)
      CREATE TABLE IF NOT EXISTS data_api_categories (
        api_id TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (api_id) REFERENCES data_api_configs(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (api_id, category_id)
      );

      -- CSV data sources
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- CSV-Category mapping (orphan CSVs not accessible)
      CREATE TABLE IF NOT EXISTS data_csv_categories (
        csv_id TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (csv_id) REFERENCES data_csv_configs(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (csv_id, category_id)
      );

      -- Audit log for data source changes
      CREATE TABLE IF NOT EXISTS data_source_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL CHECK(source_type IN ('api', 'csv')),
        source_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'tested', 'deleted')),
        changed_by TEXT NOT NULL,
        details TEXT,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes for data sources
      CREATE INDEX IF NOT EXISTS idx_data_api_status ON data_api_configs(status);
      CREATE INDEX IF NOT EXISTS idx_data_api_name ON data_api_configs(name);
      CREATE INDEX IF NOT EXISTS idx_data_api_categories_api ON data_api_categories(api_id);
      CREATE INDEX IF NOT EXISTS idx_data_api_categories_cat ON data_api_categories(category_id);
      CREATE INDEX IF NOT EXISTS idx_data_csv_name ON data_csv_configs(name);
      CREATE INDEX IF NOT EXISTS idx_data_csv_categories_csv ON data_csv_categories(csv_id);
      CREATE INDEX IF NOT EXISTS idx_data_csv_categories_cat ON data_csv_categories(category_id);
      CREATE INDEX IF NOT EXISTS idx_data_source_audit_source ON data_source_audit(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_data_source_audit_time ON data_source_audit(changed_at DESC);
    `);
  }

  // Check and create function_api_configs table for Function Calling APIs
  const functionApiConfigsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='function_api_configs'"
  ).get();

  if (!functionApiConfigsTableExists) {
    database.exec(`
      -- Function API configurations (OpenAI-format function calling)
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_tested DATETIME,
        last_error TEXT
      );

      -- Function API-Category mapping
      CREATE TABLE IF NOT EXISTS function_api_categories (
        api_id TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (api_id) REFERENCES function_api_configs(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (api_id, category_id)
      );

      -- Indexes for function APIs
      CREATE INDEX IF NOT EXISTS idx_function_api_status ON function_api_configs(status);
      CREATE INDEX IF NOT EXISTS idx_function_api_name ON function_api_configs(name);
      CREATE INDEX IF NOT EXISTS idx_function_api_enabled ON function_api_configs(is_enabled);
      CREATE INDEX IF NOT EXISTS idx_function_api_categories_api ON function_api_categories(api_id);
      CREATE INDEX IF NOT EXISTS idx_function_api_categories_cat ON function_api_categories(category_id);
    `);
  }

  // Check and add config_json column to category_tool_configs
  const ctcColumns = database.pragma('table_info(category_tool_configs)') as { name: string }[];
  const ctcColumnNames = ctcColumns.map((c) => c.name);

  if (!ctcColumnNames.includes('config_json')) {
    database.exec('ALTER TABLE category_tool_configs ADD COLUMN config_json TEXT');
  }

  // Check and add description_override column to tool_configs (for admin-editable tool descriptions)
  const toolConfigsColumns = database.pragma('table_info(tool_configs)') as { name: string }[];
  const toolConfigsColumnNames = toolConfigsColumns.map((c) => c.name);

  if (!toolConfigsColumnNames.includes('description_override')) {
    database.exec('ALTER TABLE tool_configs ADD COLUMN description_override TEXT');
  }

  // Check and create tool_routing_rules table for keyword-based tool routing
  const toolRoutingRulesTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tool_routing_rules'"
  ).get();

  if (!toolRoutingRulesTableExists) {
    database.exec(`
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_tool ON tool_routing_rules(tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_active ON tool_routing_rules(is_active);
      CREATE INDEX IF NOT EXISTS idx_tool_routing_rules_priority ON tool_routing_rules(priority);
    `);
  }

  // Check and create task_plans table for Task Planner tool
  const taskPlansTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='task_plans'"
  ).get();

  if (!taskPlansTableExists) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS task_plans (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        category_slug TEXT,
        title TEXT,
        tasks_json TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
        total_tasks INTEGER DEFAULT 0,
        completed_tasks INTEGER DEFAULT 0,
        failed_tasks INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_plans_thread ON task_plans(thread_id);
      CREATE INDEX IF NOT EXISTS idx_task_plans_status ON task_plans(status);
      CREATE INDEX IF NOT EXISTS idx_task_plans_user ON task_plans(user_id);
    `);
  }

  // Migrate task_plans table for autonomous mode (add columns if missing)
  const taskPlansColumns = database.prepare("PRAGMA table_info(task_plans)").all() as Array<{ name: string }>;
  const taskPlansColumnNames = taskPlansColumns.map(col => col.name);

  if (!taskPlansColumnNames.includes('mode')) {
    database.exec(`
      ALTER TABLE task_plans ADD COLUMN mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'autonomous'));
      ALTER TABLE task_plans ADD COLUMN budget_json TEXT DEFAULT '{"max_llm_calls": 100, "max_tokens": 500000}';
      ALTER TABLE task_plans ADD COLUMN budget_used_json TEXT DEFAULT '{"llm_calls": 0, "tokens_used": 0, "web_searches": 0}';
      ALTER TABLE task_plans ADD COLUMN model_config_json TEXT DEFAULT '{}';
    `);
  }

  // Migrate messages table for autonomous mode (add columns if missing)
  const messagesColumnsForMode = database.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  const messagesColumnNames = messagesColumnsForMode.map(col => col.name);

  if (!messagesColumnNames.includes('mode')) {
    database.exec(`
      ALTER TABLE messages ADD COLUMN mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'autonomous'));
      ALTER TABLE messages ADD COLUMN plan_id TEXT REFERENCES task_plans(id);
    `);
  }

  // Ensure global budget settings exist
  const budgetSettings = database.prepare("SELECT key FROM settings WHERE key LIKE 'agent_%'").all();
  if (budgetSettings.length === 0) {
    database.exec(`
      INSERT OR IGNORE INTO settings (key, value, updated_by) VALUES
        ('agent_budget_max_llm_calls', '500', 'system'),
        ('agent_budget_max_tokens', '2000000', 'system'),
        ('agent_budget_max_web_searches', '100', 'system'),
        ('agent_confidence_threshold', '80', 'system'),
        ('agent_budget_max_duration_minutes', '30', 'system'),
        ('agent_task_timeout_minutes', '5', 'system');
    `);
  }

  // Migration: Add execution control columns to task_plans for pause/resume/stop
  const taskPlansControlColumns = database.pragma('table_info(task_plans)') as { name: string }[];
  const taskPlansCtrlColumnNames = taskPlansControlColumns.map((c) => c.name);

  if (!taskPlansCtrlColumnNames.includes('paused_at')) {
    database.exec(`
      ALTER TABLE task_plans ADD COLUMN paused_at DATETIME;
      ALTER TABLE task_plans ADD COLUMN pause_reason TEXT;
      ALTER TABLE task_plans ADD COLUMN resumed_at DATETIME;
      ALTER TABLE task_plans ADD COLUMN stopped_at DATETIME;
      ALTER TABLE task_plans ADD COLUMN stop_reason TEXT;
    `);
  }

  // Check and create RAG testing tables for RAG Tuning Dashboard
  const ragTestQueriesTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='rag_test_queries'"
  ).get();

  if (!ragTestQueriesTableExists) {
    database.exec(`
      -- RAG test queries (saved test queries)
      CREATE TABLE IF NOT EXISTS rag_test_queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        category_ids TEXT,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- RAG test results (test execution history)
      CREATE TABLE IF NOT EXISTS rag_test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id INTEGER,
        test_query TEXT NOT NULL,
        settings_snapshot TEXT NOT NULL,
        chunks_retrieved INTEGER NOT NULL,
        avg_similarity REAL NOT NULL,
        latency_ms INTEGER NOT NULL,
        top_chunks TEXT,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (query_id) REFERENCES rag_test_queries(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rag_test_queries_created ON rag_test_queries(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rag_test_results_created ON rag_test_results(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rag_test_results_query ON rag_test_results(query_id);
    `);
  }

  // Migration: Ensure thread_outputs table exists and clean up any interrupted migrations
  const threadOutputsExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='thread_outputs'"
  ).get();
  const threadOutputsNewExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='thread_outputs_new'"
  ).get();

  if (!threadOutputsExists && threadOutputsNewExists) {
    // Previous migration was interrupted - rename the new table to recover data
    database.exec('ALTER TABLE thread_outputs_new RENAME TO thread_outputs');
    database.exec('CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_thread_outputs_expires ON thread_outputs(expires_at)');
    console.log('[DB Migration] Recovered thread_outputs table from interrupted migration');
  } else if (threadOutputsNewExists) {
    // thread_outputs exists and thread_outputs_new is leftover - clean it up
    database.exec('DROP TABLE IF EXISTS thread_outputs_new');
    console.log('[DB Migration] Cleaned up leftover thread_outputs_new table');
  }

  // Re-check if thread_outputs exists after potential recovery
  const threadOutputsReady = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='thread_outputs'"
  ).get();

  // Only run thread_outputs migrations if table exists
  if (threadOutputsReady) {
    // Migration: Update file_type CHECK constraint to include 'md' format
    // SQLite doesn't allow modifying CHECK constraints, so we recreate the table
    try {
      // Test if 'md' is allowed by the current constraint
    database.exec(`
      INSERT INTO thread_outputs (thread_id, filename, filepath, file_type, file_size)
      VALUES ('__migration_test__', '__test__', '__test__', 'md', 0)
    `);
    // If successful, delete the test row
    database.exec(`DELETE FROM thread_outputs WHERE thread_id = '__migration_test__'`);
  } catch {
    // 'md' is not allowed, need to recreate the table with updated constraint
    // Use transaction to prevent race conditions during concurrent builds
    database.exec(`
      BEGIN IMMEDIATE;
      -- Drop any leftover temp table from interrupted migration
      DROP TABLE IF EXISTS thread_outputs_new;
      -- Create new table with updated constraint
      CREATE TABLE thread_outputs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        message_id TEXT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md')),
        file_size INTEGER NOT NULL,
        generation_config TEXT,
        expires_at DATETIME,
        download_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
      );

      -- Copy existing data
      INSERT INTO thread_outputs_new (id, thread_id, message_id, filename, filepath, file_type, file_size, generation_config, expires_at, download_count, created_at)
      SELECT id, thread_id, message_id, filename, filepath, file_type, file_size, generation_config, expires_at, download_count, created_at
      FROM thread_outputs;

      -- Drop old table and rename new one
      DROP TABLE thread_outputs;
      ALTER TABLE thread_outputs_new RENAME TO thread_outputs;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id);
      CREATE INDEX IF NOT EXISTS idx_thread_outputs_expires ON thread_outputs(expires_at);
      COMMIT;
    `);
  }

  // Migration: Update file_type CHECK constraint to include 'mp3' format for podcast generation
  try {
    // Test if 'mp3' is allowed by the current constraint
    database.exec(`
      INSERT INTO thread_outputs (thread_id, filename, filepath, file_type, file_size)
      VALUES ('__migration_test_mp3__', '__test__', '__test__', 'mp3', 0)
    `);
    // If successful, delete the test row
    database.exec(`DELETE FROM thread_outputs WHERE thread_id = '__migration_test_mp3__'`);
  } catch {
    // 'mp3' is not allowed, need to recreate the table with updated constraint
    // Use transaction to prevent race conditions during concurrent builds
    database.exec(`
      BEGIN IMMEDIATE;
      -- Drop any leftover temp table from interrupted migration
      DROP TABLE IF EXISTS thread_outputs_new;
      -- Create new table with updated constraint (includes mp3 for podcast generation)
      CREATE TABLE thread_outputs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        message_id TEXT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3')),
        file_size INTEGER NOT NULL,
        generation_config TEXT,
        expires_at DATETIME,
        download_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
      );

      -- Copy existing data
      INSERT INTO thread_outputs_new (id, thread_id, message_id, filename, filepath, file_type, file_size, generation_config, expires_at, download_count, created_at)
      SELECT id, thread_id, message_id, filename, filepath, file_type, file_size, generation_config, expires_at, download_count, created_at
      FROM thread_outputs;

      -- Drop old table and rename new one
      DROP TABLE thread_outputs;
      ALTER TABLE thread_outputs_new RENAME TO thread_outputs;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id);
      CREATE INDEX IF NOT EXISTS idx_thread_outputs_expires ON thread_outputs(expires_at);
      COMMIT;
    `);
    console.log('[DB Migration] Added mp3 file type to thread_outputs');
  }

  // Migration: Update file_type CHECK constraint to include 'wav' format for Gemini TTS podcast generation
  try {
    // Test if 'wav' is allowed by the current constraint
    database.exec(`
      INSERT INTO thread_outputs (thread_id, filename, filepath, file_type, file_size)
      VALUES ('__migration_test_wav__', '__test__', '__test__', 'wav', 0)
    `);
    // If successful, delete the test row
    database.exec(`DELETE FROM thread_outputs WHERE thread_id = '__migration_test_wav__'`);
  } catch {
    // 'wav' is not allowed, need to recreate the table with updated constraint
    // Use transaction to prevent race conditions during concurrent builds
    database.exec(`
      BEGIN IMMEDIATE;
      -- Drop any leftover temp table from interrupted migration
      DROP TABLE IF EXISTS thread_outputs_new;
      -- Create new table with updated constraint (includes wav for Gemini TTS)
      CREATE TABLE thread_outputs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        message_id TEXT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav')),
        file_size INTEGER NOT NULL,
        generation_config TEXT,
        expires_at DATETIME,
        download_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
      );

      -- Copy existing data
      INSERT INTO thread_outputs_new (id, thread_id, message_id, filename, filepath, file_type, file_size, generation_config, expires_at, download_count, created_at)
      SELECT id, thread_id, message_id, filename, filepath, file_type, file_size, generation_config, expires_at, download_count, created_at
      FROM thread_outputs;

      -- Drop old table and rename new one
      DROP TABLE thread_outputs;
      ALTER TABLE thread_outputs_new RENAME TO thread_outputs;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id);
      CREATE INDEX IF NOT EXISTS idx_thread_outputs_expires ON thread_outputs(expires_at);
      COMMIT;
    `);
    console.log('[DB Migration] Added wav file type to thread_outputs');
  }
  } // End of threadOutputsReady check

  // Migration: Create thread_shares table for thread sharing feature
  const threadSharesTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='thread_shares'"
  ).get();

  if (!threadSharesTableExists) {
    database.exec(`
      -- Thread shares for sharing threads with other users
      CREATE TABLE IF NOT EXISTS thread_shares (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        share_token TEXT UNIQUE NOT NULL,
        created_by INTEGER NOT NULL,
        allow_download INTEGER DEFAULT 1,
        expires_at DATETIME,
        view_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_viewed_at DATETIME,
        revoked_at DATETIME,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_shares_token ON thread_shares(share_token);
      CREATE INDEX IF NOT EXISTS idx_thread_shares_thread ON thread_shares(thread_id);
      CREATE INDEX IF NOT EXISTS idx_thread_shares_creator ON thread_shares(created_by);

      -- Share access log for audit
      CREATE TABLE IF NOT EXISTS share_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_id TEXT NOT NULL,
        accessed_by INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('view', 'download')),
        resource_type TEXT,
        resource_id TEXT,
        accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (share_id) REFERENCES thread_shares(id) ON DELETE CASCADE,
        FOREIGN KEY (accessed_by) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_share_access_log_share ON share_access_log(share_id);
      CREATE INDEX IF NOT EXISTS idx_share_access_log_accessed ON share_access_log(accessed_at DESC);
    `);
  }

  // Migration: Create workspaces tables for embed and standalone chat modes
  const workspacesTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'"
  ).get();

  if (!workspacesTableExists) {
    database.exec(`
      -- Workspaces table (both embed and standalone)
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('embed', 'standalone')),
        is_enabled INTEGER DEFAULT 1,

        -- Access Control (standalone only)
        access_mode TEXT DEFAULT 'category' CHECK (access_mode IN ('category', 'explicit')),

        -- Branding
        primary_color TEXT DEFAULT '#2563eb',
        logo_url TEXT,
        chat_title TEXT,
        greeting_message TEXT DEFAULT 'How can I help you today?',
        suggested_prompts TEXT,
        footer_text TEXT,

        -- LLM Configuration (overrides global settings)
        llm_provider TEXT,
        llm_model TEXT,
        temperature REAL,
        system_prompt TEXT,

        -- Embed-specific settings
        allowed_domains TEXT DEFAULT '[]',
        daily_limit INTEGER DEFAULT 1000,
        session_limit INTEGER DEFAULT 50,

        -- Feature toggles
        voice_enabled INTEGER DEFAULT 0,
        file_upload_enabled INTEGER DEFAULT 0,
        max_file_size_mb INTEGER DEFAULT 5,

        -- Ownership & Timestamps
        created_by TEXT NOT NULL,
        created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'superuser')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Many-to-many: Workspace to Categories
      CREATE TABLE IF NOT EXISTS workspace_categories (
        workspace_id TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, category_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      );

      -- Many-to-many: Workspace to Users (for explicit access mode, standalone only)
      CREATE TABLE IF NOT EXISTS workspace_users (
        workspace_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        added_by TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Workspace sessions (for both types, embed = ephemeral, standalone = persistent)
      CREATE TABLE IF NOT EXISTS workspace_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        visitor_id TEXT,
        user_id INTEGER,
        referrer_url TEXT,
        ip_hash TEXT,
        message_count INTEGER DEFAULT 0,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

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

      -- Workspace messages (stored for analytics + standalone history)
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE CASCADE
      );

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

      -- Workspace AI-generated outputs (images, documents, podcasts for workspace chats)
      CREATE TABLE IF NOT EXISTS workspace_outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        thread_id TEXT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'mp3', 'wav')),
        file_size INTEGER NOT NULL,
        generation_config TEXT,
        expires_at DATETIME,
        download_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE SET NULL
      );

      -- Indexes for workspaces
      CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
      CREATE INDEX IF NOT EXISTS idx_workspaces_type ON workspaces(type);
      CREATE INDEX IF NOT EXISTS idx_workspaces_enabled ON workspaces(is_enabled);
      CREATE INDEX IF NOT EXISTS idx_workspace_categories_workspace ON workspace_categories(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_categories_category ON workspace_categories(category_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_users_workspace ON workspace_users(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_users_user ON workspace_users(user_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_sessions_workspace ON workspace_sessions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_sessions_expires ON workspace_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_workspace_sessions_user ON workspace_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_threads_session ON workspace_threads(session_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_threads_workspace ON workspace_threads(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_messages_thread ON workspace_messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_messages_session ON workspace_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_messages_workspace ON workspace_messages(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_analytics_date ON workspace_analytics(workspace_id, date);
      CREATE INDEX IF NOT EXISTS idx_workspace_outputs_workspace ON workspace_outputs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_outputs_session ON workspace_outputs(session_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_outputs_thread ON workspace_outputs(thread_id);
    `);
  }

  // Migration: Create workspace_outputs table if workspaces exists but workspace_outputs doesn't
  // This handles the case where workspaces was created before workspace_outputs was added
  const workspaceOutputsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_outputs'"
  ).get();

  if (!workspaceOutputsTableExists) {
    // Check if workspaces table exists (workspace_outputs depends on it)
    const wsTableExists = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'"
    ).get();

    if (wsTableExists) {
      database.exec(`
        -- Workspace AI-generated outputs (images, documents, podcasts for workspace chats)
        CREATE TABLE IF NOT EXISTS workspace_outputs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          thread_id TEXT,
          filename TEXT NOT NULL,
          filepath TEXT NOT NULL,
          file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'mp3', 'wav')),
          file_size INTEGER NOT NULL,
          generation_config TEXT,
          expires_at DATETIME,
          download_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_workspace ON workspace_outputs(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_session ON workspace_outputs(session_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_thread ON workspace_outputs(thread_id);
      `);
    }
  }

  // Migration: Add auth_required column to workspaces table (for embed auth toggle)
  const workspacesColumns = database.pragma('table_info(workspaces)') as { name: string }[];
  const workspacesColumnNames = workspacesColumns.map((c) => c.name);

  if (workspacesColumnNames.length > 0 && !workspacesColumnNames.includes('auth_required')) {
    database.exec('ALTER TABLE workspaces ADD COLUMN auth_required INTEGER DEFAULT 0');
  }

  // Migration: Add web_search_enabled column to workspaces table
  if (workspacesColumnNames.length > 0 && !workspacesColumnNames.includes('web_search_enabled')) {
    database.exec('ALTER TABLE workspaces ADD COLUMN web_search_enabled INTEGER DEFAULT 1');
  }

  // Migration: Add tool routing columns to skills table for unified keyword actions
  // This merges tool routing functionality into the skills system
  const skillsColumns = database.pragma('table_info(skills)') as { name: string }[];
  const skillsColumnNames = skillsColumns.map((c) => c.name);

  if (!skillsColumnNames.includes('match_type')) {
    database.exec(`
      -- Pattern matching type (keyword = word boundary, regex = full regex)
      ALTER TABLE skills ADD COLUMN match_type TEXT DEFAULT 'keyword'
        CHECK (match_type IN ('keyword', 'regex'));

      -- Tool routing fields
      ALTER TABLE skills ADD COLUMN tool_name TEXT;
      ALTER TABLE skills ADD COLUMN force_mode TEXT
        CHECK (force_mode IN ('required', 'preferred', 'suggested'));

      -- Tool configuration override (JSON)
      ALTER TABLE skills ADD COLUMN tool_config_override TEXT;

      -- Data source filtering (JSON: {type: 'include'|'exclude', source_ids: number[]})
      ALTER TABLE skills ADD COLUMN data_source_filter TEXT;
    `);
  }

  // Migration: Create folder_syncs tables for folder upload with re-sync capability
  const folderSyncsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='folder_syncs'"
  ).get();

  if (!folderSyncsTableExists) {
    database.exec(`
      -- Folder sync sessions (track uploaded folders)
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
        last_synced_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_folder_syncs_user ON folder_syncs(uploaded_by);
      CREATE INDEX IF NOT EXISTS idx_folder_syncs_status ON folder_syncs(status);

      -- Individual files within a folder sync
      CREATE TABLE IF NOT EXISTS folder_sync_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_sync_id TEXT NOT NULL,
        document_id INTEGER,
        relative_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_hash TEXT,
        file_size INTEGER NOT NULL,
        last_modified INTEGER,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'skipped', 'error')),
        error_message TEXT,
        synced_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (folder_sync_id) REFERENCES folder_syncs(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_folder_sync_files_sync ON folder_sync_files(folder_sync_id);
      CREATE INDEX IF NOT EXISTS idx_folder_sync_files_doc ON folder_sync_files(document_id);
      CREATE INDEX IF NOT EXISTS idx_folder_sync_files_hash ON folder_sync_files(file_hash);
    `);
  }

  // Migration: Add folder sync columns to documents table
  const documentsColumns = database.pragma('table_info(documents)') as { name: string }[];
  const documentsColumnNames = documentsColumns.map((c) => c.name);

  if (!documentsColumnNames.includes('folder_sync_id')) {
    database.exec(`
      ALTER TABLE documents ADD COLUMN folder_sync_id TEXT REFERENCES folder_syncs(id) ON DELETE SET NULL;
      ALTER TABLE documents ADD COLUMN original_relative_path TEXT;
      CREATE INDEX IF NOT EXISTS idx_documents_folder_sync ON documents(folder_sync_id);
    `);
  }

  // Migration: Add compliance_config column to skills table
  const skillsColumnsForCompliance = database.pragma('table_info(skills)') as { name: string }[];
  const skillsComplianceColumnNames = skillsColumnsForCompliance.map((c) => c.name);

  if (!skillsComplianceColumnNames.includes('compliance_config')) {
    database.exec(`
      ALTER TABLE skills ADD COLUMN compliance_config TEXT;
    `);
  }

  // Migration: Create compliance_results table for compliance checker audit trail
  const complianceResultsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='compliance_results'"
  ).get();

  if (!complianceResultsTableExists) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS compliance_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

        validated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (conversation_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_compliance_conversation ON compliance_results(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_compliance_decision ON compliance_results(decision, validated_at);
      CREATE INDEX IF NOT EXISTS idx_compliance_hitl ON compliance_results(hitl_triggered, validated_at);
      CREATE INDEX IF NOT EXISTS idx_compliance_message ON compliance_results(message_id);
    `);
  }

  // Migration: Add max_output_tokens column to enabled_models table
  const enabledModelsColumns = database.pragma('table_info(enabled_models)') as { name: string }[];
  const enabledModelsColumnNames = enabledModelsColumns.map((c) => c.name);

  if (!enabledModelsColumnNames.includes('max_output_tokens')) {
    database.exec('ALTER TABLE enabled_models ADD COLUMN max_output_tokens INTEGER');
    // Set provider-based defaults for existing models
    database.exec(`
      UPDATE enabled_models SET max_output_tokens = 8000 WHERE provider_id = 'deepseek';
      UPDATE enabled_models SET max_output_tokens = 2000 WHERE provider_id = 'ollama';
      UPDATE enabled_models SET max_output_tokens = 16000 WHERE provider_id NOT IN ('deepseek', 'ollama');
    `);
    console.log('[DB Migration] Added max_output_tokens column to enabled_models');
  }

  // Migration: Add xlsx and pptx to workspace_outputs file_type CHECK constraint
  // SQLite requires table recreation to modify CHECK constraints
  const workspaceOutputsExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_outputs'"
  ).get();

  if (workspaceOutputsExists) {
    // Check if migration is needed by looking at table definition
    const tableInfo = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='workspace_outputs'"
    ).get() as { sql: string } | undefined;

    if (tableInfo && !tableInfo.sql.includes('xlsx')) {
      console.log('[DB Migration] Adding xlsx/pptx support to workspace_outputs...');

      database.exec(`
        -- Create new table with updated CHECK constraint
        CREATE TABLE workspace_outputs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          thread_id TEXT,
          filename TEXT NOT NULL,
          filepath TEXT NOT NULL,
          file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx')),
          file_size INTEGER NOT NULL,
          generation_config TEXT,
          expires_at DATETIME,
          download_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE SET NULL
        );

        -- Copy existing data
        INSERT INTO workspace_outputs_new
        SELECT * FROM workspace_outputs;

        -- Drop old table
        DROP TABLE workspace_outputs;

        -- Rename new table
        ALTER TABLE workspace_outputs_new RENAME TO workspace_outputs;

        -- Recreate indexes
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_workspace ON workspace_outputs(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_session ON workspace_outputs(session_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_thread ON workspace_outputs(thread_id);
      `);

      console.log('[DB Migration] Added xlsx/pptx support to workspace_outputs');
    }

    // Check if mp3/wav migration is needed
    const tableInfoAfterXlsx = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='workspace_outputs'"
    ).get() as { sql: string } | undefined;

    if (tableInfoAfterXlsx && !tableInfoAfterXlsx.sql.includes('wav')) {
      console.log('[DB Migration] Adding mp3/wav support to workspace_outputs...');

      database.exec(`
        -- Create new table with updated CHECK constraint (includes mp3/wav for podcasts)
        CREATE TABLE workspace_outputs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          thread_id TEXT,
          filename TEXT NOT NULL,
          filepath TEXT NOT NULL,
          file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'mp3', 'wav')),
          file_size INTEGER NOT NULL,
          generation_config TEXT,
          expires_at DATETIME,
          download_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES workspace_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE SET NULL
        );

        -- Copy existing data
        INSERT INTO workspace_outputs_new
        SELECT * FROM workspace_outputs;

        -- Drop old table
        DROP TABLE workspace_outputs;

        -- Rename new table
        ALTER TABLE workspace_outputs_new RENAME TO workspace_outputs;

        -- Recreate indexes
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_workspace ON workspace_outputs(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_session ON workspace_outputs(session_id);
        CREATE INDEX IF NOT EXISTS idx_workspace_outputs_thread ON workspace_outputs(thread_id);
      `);

      console.log('[DB Migration] Added mp3/wav support to workspace_outputs');
    }
  }

  // Create reindex_jobs table if it doesn't exist (for embedding model change reindexing)
  const reindexJobsTableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='reindex_jobs'"
  ).get();

  if (!reindexJobsTableExists) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS reindex_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        target_model TEXT NOT NULL,
        target_dimensions INTEGER NOT NULL,
        previous_model TEXT NOT NULL,
        previous_dimensions INTEGER NOT NULL,
        total_documents INTEGER DEFAULT 0,
        processed_documents INTEGER DEFAULT 0,
        failed_documents INTEGER DEFAULT 0,
        errors TEXT DEFAULT '[]',
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL
      )
    `);
    console.log('[DB Migration] Created reindex_jobs table');
  }

  // Migration: Add credentials authentication columns to users table
  const usersColumns = database.pragma('table_info(users)') as { name: string }[];
  const usersColumnNames = usersColumns.map((c) => c.name);

  if (!usersColumnNames.includes('password_hash')) {
    database.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
    console.log('[DB Migration] Added password_hash column to users');
  }

  if (!usersColumnNames.includes('credentials_enabled')) {
    database.exec('ALTER TABLE users ADD COLUMN credentials_enabled INTEGER DEFAULT 1');
    console.log('[DB Migration] Added credentials_enabled column to users');
  }

  console.log('[DB Migration] Migrations completed successfully');
}

/**
 * Inline schema as fallback when file is not accessible
 */
function getInlineSchema(): string {
  return `
-- Users & Roles
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'superuser', 'user')),
  added_by TEXT,
  password_hash TEXT,
  credentials_enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- Super user category assignments
CREATE TABLE IF NOT EXISTS super_user_categories (
  user_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT NOT NULL,
  PRIMARY KEY (user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- User category subscriptions
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

-- Documents
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

-- Document to category mapping
CREATE TABLE IF NOT EXISTS document_categories (
  document_id INTEGER NOT NULL,
  category_id INTEGER,
  PRIMARY KEY (document_id, category_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_document_categories_doc ON document_categories(document_id);
CREATE INDEX IF NOT EXISTS idx_document_categories_cat ON document_categories(category_id);

-- Threads
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  selected_model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_pinned INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);

-- Thread category selection
CREATE TABLE IF NOT EXISTS thread_categories (
  thread_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (thread_id, category_id),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_thread_categories_thread ON thread_categories(thread_id);

-- Messages
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

-- Thread file uploads
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
  generation_config TEXT,
  expires_at DATETIME,
  download_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_outputs_thread ON thread_outputs(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_outputs_expires ON thread_outputs(expires_at);

-- User memory storage (facts per user+category)
CREATE TABLE IF NOT EXISTS user_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category_id INTEGER,
  facts_json TEXT NOT NULL,
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
  messages_summarized INTEGER NOT NULL,
  tokens_before INTEGER,
  tokens_after INTEGER,
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

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

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

-- Tool configurations (Tools system)
CREATE TABLE IF NOT EXISTS tool_configs (
  id TEXT PRIMARY KEY,
  tool_name TEXT UNIQUE NOT NULL,
  is_enabled INTEGER DEFAULT 0,
  config_json TEXT NOT NULL,
  description_override TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_tool_config_audit_name ON tool_config_audit(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_config_audit_time ON tool_config_audit(changed_at DESC);

-- Category-level tool configurations (superuser overrides)
CREATE TABLE IF NOT EXISTS category_tool_configs (
  id TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  is_enabled INTEGER,
  branding_json TEXT,
  config_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,
  UNIQUE(category_id, tool_name),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_category_tool_configs_category ON category_tool_configs(category_id);
CREATE INDEX IF NOT EXISTS idx_category_tool_configs_tool ON category_tool_configs(tool_name);

-- Task plans for Task Planner tool
CREATE TABLE IF NOT EXISTS task_plans (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  category_slug TEXT,
  title TEXT,
  tasks_json TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_plans_thread ON task_plans(thread_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_status ON task_plans(status);
CREATE INDEX IF NOT EXISTS idx_task_plans_user ON task_plans(user_id);

-- Data API configurations
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_tested DATETIME,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_data_api_status ON data_api_configs(status);
CREATE INDEX IF NOT EXISTS idx_data_api_name ON data_api_configs(name);

-- API-Category mapping
CREATE TABLE IF NOT EXISTS data_api_categories (
  api_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (api_id) REFERENCES data_api_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (api_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_data_api_categories_api ON data_api_categories(api_id);
CREATE INDEX IF NOT EXISTS idx_data_api_categories_cat ON data_api_categories(category_id);

-- CSV data sources
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_data_csv_name ON data_csv_configs(name);

-- CSV-Category mapping
CREATE TABLE IF NOT EXISTS data_csv_categories (
  csv_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (csv_id) REFERENCES data_csv_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (csv_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_data_csv_categories_csv ON data_csv_categories(csv_id);
CREATE INDEX IF NOT EXISTS idx_data_csv_categories_cat ON data_csv_categories(category_id);

-- Data source audit log
CREATE TABLE IF NOT EXISTS data_source_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK(source_type IN ('api', 'csv')),
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'tested', 'deleted')),
  changed_by TEXT NOT NULL,
  details TEXT,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_data_source_audit_source ON data_source_audit(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_data_source_audit_time ON data_source_audit(changed_at DESC);

-- Function API configurations (OpenAI-format function calling)
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_tested DATETIME,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_function_api_status ON function_api_configs(status);
CREATE INDEX IF NOT EXISTS idx_function_api_name ON function_api_configs(name);
CREATE INDEX IF NOT EXISTS idx_function_api_enabled ON function_api_configs(is_enabled);

-- Function API-Category mapping
CREATE TABLE IF NOT EXISTS function_api_categories (
  api_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (api_id) REFERENCES function_api_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (api_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_function_api_categories_api ON function_api_categories(api_id);
CREATE INDEX IF NOT EXISTS idx_function_api_categories_cat ON function_api_categories(category_id);

-- Folder sync sessions (track uploaded folders)
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
  last_synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_folder_syncs_user ON folder_syncs(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_folder_syncs_status ON folder_syncs(status);

-- Individual files within a folder sync
CREATE TABLE IF NOT EXISTS folder_sync_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_sync_id TEXT NOT NULL,
  document_id INTEGER,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_hash TEXT,
  file_size INTEGER NOT NULL,
  last_modified INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'skipped', 'error')),
  error_message TEXT,
  synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (folder_sync_id) REFERENCES folder_syncs(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_folder_sync_files_sync ON folder_sync_files(folder_sync_id);
CREATE INDEX IF NOT EXISTS idx_folder_sync_files_doc ON folder_sync_files(document_id);
CREATE INDEX IF NOT EXISTS idx_folder_sync_files_hash ON folder_sync_files(file_hash);
  `;
}

/**
 * Initialize default settings if not present
 */
function initializeDefaultSettings(database: Database.Database): void {
  const defaults: Record<string, object> = {
    'rag-settings': {
      topKChunks: 20,
      maxContextChunks: 15,
      similarityThreshold: 0.5,
      chunkSize: 800,
      chunkOverlap: 150,
      queryExpansionEnabled: true,
      cacheEnabled: true,
      cacheTTLSeconds: 3600,
    },
    'llm-settings': {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 2000,
    },
    'tavily-settings': {
      enabled: false,
      defaultTopic: 'general',
      defaultSearchDepth: 'basic',
      maxResults: 5,
      includeDomains: [],
      excludeDomains: [],
      cacheTTLSeconds: 3600,
    },
    'upload-limits': {
      maxFilesPerInput: 5,
      maxFilesPerThread: 10,
      maxFileSizeMB: 10,
      allowedTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/json'],
    },
    'acronym-mappings': {},
    'system-prompt': {
      content: getDefaultSystemPrompt(),
    },
    'retention-settings': {
      threadRetentionDays: 90,
      storageAlertThreshold: 70,
    },
    'memory-settings': {
      enabled: false,
      extractionThreshold: 5,
      maxFactsPerCategory: 20,
      autoExtractOnThreadEnd: true,
    },
    'summarization-settings': {
      enabled: false,
      tokenThreshold: 100000,
      keepRecentMessages: 10,
      summaryMaxTokens: 2000,
      archiveOriginalMessages: true,
    },
    'skills-settings': {
      enabled: false,
      maxTotalTokens: 3000,
      debugMode: false,
    },
  };

  const insertStmt = database.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_by)
    VALUES (?, ?, 'system')
  `);

  for (const [key, value] of Object.entries(defaults)) {
    insertStmt.run(key, JSON.stringify(value));
  }
}

/**
 * Default system prompt
 */
function getDefaultSystemPrompt(): string {
  return `You are a helpful assistant that answers questions based on the provided knowledge base documents.

Guidelines:
- Only answer questions using information from the provided context
- If the information is not in the context, say so clearly
- Always cite your sources with document names and page numbers
- Use markdown formatting for better readability
- Be concise but thorough`;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a query and return all results
 */
export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const database = getDatabase();
  return database.prepare(sql).all(...params) as T[];
}

/**
 * Run a query and return the first result
 */
export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const database = getDatabase();
  return database.prepare(sql).get(...params) as T | undefined;
}

/**
 * Run an insert/update/delete and return the result
 */
export function execute(sql: string, params: unknown[] = []): Database.RunResult {
  const database = getDatabase();
  return database.prepare(sql).run(...params);
}

/**
 * Run multiple statements in a transaction
 */
export function transaction<T>(fn: () => T): T {
  const database = getDatabase();
  return database.transaction(fn)();
}

/**
 * Export database instance type for use in other modules
 */
export type { Database };
