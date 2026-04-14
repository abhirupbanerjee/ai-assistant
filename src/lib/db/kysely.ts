/**
 * Kysely Database Instance Factory
 *
 * Provides a single Kysely instance for PostgreSQL.
 *
 * Usage:
 *   import { getDb } from '@/lib/db/kysely';
 *   const db = await getDb();
 *   const users = await db.selectFrom('users').selectAll().execute();
 */

import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './db-types';

// Singleton instance
let db: Kysely<DB> | null = null;

/**
 * Get or create the Kysely database instance
 */
export async function getDb(): Promise<Kysely<DB>> {
  if (db) return db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[Kysely] DATABASE_URL is required'
    );
  }

  const poolMax = parseInt(process.env.DATABASE_POOL_MAX || '20', 10);
  const poolIdleTimeout = parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT || '30000', 10);
  const poolConnectionTimeout = parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT || '10000', 10);

  console.log(`[Kysely] Initializing PostgreSQL connection (pool: max=${poolMax}, idleTimeout=${poolIdleTimeout}ms)...`);
  db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: poolMax,
        idleTimeoutMillis: poolIdleTimeout,
        connectionTimeoutMillis: poolConnectionTimeout,
      }),
    }),
  });

  // Run idempotent PostgreSQL migrations for existing databases
  await runPostgresMigrations(db);

  return db;
}

/**
 * Run idempotent PostgreSQL schema migrations for existing databases.
 * The docker-entrypoint init script only runs on first init, so schema
 * changes for existing deployments must be applied here.
 */
async function runPostgresMigrations(database: Kysely<DB>): Promise<void> {
  console.log('[Kysely] Running PostgreSQL migrations...');
  // Drop FK from thread_outputs.thread_id so outputs can be saved for threads
  // that exist only in SQLite (SQLite→PostgreSQL migration scenario).
  await sql`ALTER TABLE thread_outputs DROP CONSTRAINT IF EXISTS thread_outputs_thread_id_fkey`.execute(database);

  // Drop FK from thread_categories.thread_id so category mappings can be saved
  // for threads that exist only in SQLite (hybrid mode).
  await sql`ALTER TABLE thread_categories DROP CONSTRAINT IF EXISTS thread_categories_thread_id_fkey`.execute(database);

  // Migration: Update thread_outputs file_type CHECK constraint to include audio formats (mp3, wav)
  // This matches the SQLite migration in index.ts lines 641-729
  await sql`
    ALTER TABLE thread_outputs
    DROP CONSTRAINT IF EXISTS thread_outputs_file_type_check
  `.execute(database);
  await sql`
    ALTER TABLE thread_outputs
    ADD CONSTRAINT thread_outputs_file_type_check
    CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav'))
  `.execute(database);
  console.log('[Kysely] Updated thread_outputs file_type constraint for audio formats');

  // Migration: Add credentials authentication columns to users table
  // password_hash stores bcrypt-hashed passwords
  // credentials_enabled controls whether user can login with email/password (default: 1 = enabled)
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT
  `.execute(database);
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS credentials_enabled INTEGER DEFAULT 1
  `.execute(database);
  console.log('[Kysely] Added credentials authentication columns to users table');

  // Migration: Add thread columns if missing (mirrors index.ts migrations)
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS is_summarized INTEGER DEFAULT 0`.execute(database);
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0`.execute(database);
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS is_pinned INTEGER DEFAULT 0`.execute(database);
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS selected_model TEXT`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_threads_pinned ON threads(is_pinned, updated_at DESC)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_threads_selected_model ON threads(selected_model)`.execute(database);
  console.log('[Kysely] Ensured thread columns exist');

  // Seed default LLM providers if table is empty (first-time Postgres setup)
  const existingProviders = await database
    .selectFrom('llm_providers')
    .select('id')
    .limit(1)
    .execute();

  if (existingProviders.length === 0) {
    console.log('[Kysely] Seeding default LLM providers...');
    const { DEFAULT_PROVIDERS } = await import('./llm-providers');
    const providerEnvKeys: Record<string, { apiKey?: string; apiBase?: string }> = {
      openai: { apiKey: 'OPENAI_API_KEY' },
      gemini: { apiKey: 'GEMINI_API_KEY' },
      mistral: { apiKey: 'MISTRAL_API_KEY' },
      ollama: { apiBase: 'OLLAMA_API_BASE' },
      anthropic: { apiKey: 'ANTHROPIC_API_KEY' },
      deepseek: { apiKey: 'DEEPSEEK_API_KEY' },
      fireworks: { apiKey: 'FIREWORKS_AI_API_KEY' },
    };

    for (const provider of DEFAULT_PROVIDERS) {
      const envConfig = providerEnvKeys[provider.id];
      const apiKey = envConfig?.apiKey ? (process.env[envConfig.apiKey] || null) : null;
      const apiBase = envConfig?.apiBase ? (process.env[envConfig.apiBase] || null) : null;

      await database
        .insertInto('llm_providers')
        .values({
          id: provider.id,
          name: provider.name,
          api_key: apiKey,
          api_base: apiBase,
          enabled: provider.enabled ? 1 : 0,
        })
        .execute();
    }
    console.log(`[Kysely] Seeded ${DEFAULT_PROVIDERS.length} default LLM providers`);
  }

  // Seed providers added after initial setup — safe to run every startup (ON CONFLICT DO NOTHING)
  await database
    .insertInto('llm_providers')
    .values({
      id: 'fireworks',
      name: 'Fireworks AI',
      api_key: process.env['FIREWORKS_AI_API_KEY'] || null,
      api_base: null,
      enabled: 1,
    })
    .onConflict(oc => oc.column('id').doNothing())
    .execute();
  console.log('[Kysely] Ensured Fireworks AI provider exists');

  // Migration: Create reindex_jobs table if it doesn't exist
  await sql`
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
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL
    )
  `.execute(database);
  console.log('[Kysely] Ensured reindex_jobs table exists');

  // Migration: Create load_test_results table if it doesn't exist
  await sql`
    CREATE TABLE IF NOT EXISTS load_test_results (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      test_run_id TEXT,
      output_url TEXT,
      users INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      metrics_json TEXT NOT NULL,
      passed BOOLEAN DEFAULT FALSE,
      run_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_load_test_results_url ON load_test_results(url)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_load_test_results_created ON load_test_results(created_at DESC)`.execute(database);
  console.log('[Kysely] Ensured load_test_results table exists');

  // Migration: Add generated_diagrams_json column to messages table
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS generated_diagrams_json TEXT`.execute(database);
  console.log('[Kysely] Ensured messages.generated_diagrams_json column exists');

  // Migration: Rename Ollama model IDs to match actual Ollama API model names
  // Old IDs used a display-friendly prefix (ollama-*); new IDs are the actual model names
  // LiteLLM model_name entries in litellm_config.yaml updated to match
  const ollamaRenames: Array<{ oldId: string; newId: string }> = [
    { oldId: 'ollama-llama3.2',   newId: 'llama3.2:3b' },
    { oldId: 'ollama-qwen3',      newId: 'qwen3:4b' },
    { oldId: 'ollama-qwen3-1.7b', newId: 'qwen3:1.7b' },
    { oldId: 'ollama-gpt-oss',    newId: 'gpt-oss:20b' },
    { oldId: 'ollama-mxbai-embed', newId: 'mxbai-embed-large' },
  ];
  for (const { oldId, newId } of ollamaRenames) {
    await sql`UPDATE enabled_models SET id = ${newId} WHERE id = ${oldId}`.execute(database);
    await sql`UPDATE threads SET selected_model = ${newId} WHERE selected_model = ${oldId}`.execute(database);
  }
  console.log('[Kysely] Renamed Ollama model IDs to actual model names');

  // Migration: Seed new Fireworks models added to litellm_config.yaml
  const newFireworksModels = [
    {
      id: 'fireworks/qwen3p6-plus',
      display_name: 'Qwen3 P6 Plus (Fireworks)',
      tool_capable: 1,
      vision_capable: 1,
      max_input_tokens: 131072,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/qwen3-vl-30b-a3b-thinking',
      display_name: 'Qwen3 VL 30B Thinking (Fireworks)',
      tool_capable: 1,
      vision_capable: 1,
      max_input_tokens: 131072,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/minimax-m2p7',
      display_name: 'MiniMax M2.7 (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 131072,
      max_output_tokens: 16384,
    },
  ];
  for (const model of newFireworksModels) {
    await database
      .insertInto('enabled_models')
      .values({
        id: model.id,
        provider_id: 'fireworks',
        display_name: model.display_name,
        tool_capable: model.tool_capable,
        vision_capable: model.vision_capable,
        max_input_tokens: model.max_input_tokens,
        max_output_tokens: model.max_output_tokens,
        is_default: 0,
        enabled: 0,
        sort_order: 9900,
      })
      .onConflict(oc => oc.column('id').doNothing())
      .execute();
  }
  console.log('[Kysely] Seeded new Fireworks models');

  // Migration: Remove retired Fireworks models
  await sql`DELETE FROM enabled_models WHERE id IN ('fireworks/deepseek-v3p2', 'fireworks/qwen3-coder-480b-a35b-instruct')`.execute(database);
  console.log('[Kysely] Removed retired Fireworks models (deepseek-v3p2, qwen3-coder-480b)');

  // Migration: Remove gpt-4o-mini-transcribe (transcription model, not a chat LLM)
  await sql`DELETE FROM enabled_models WHERE id = 'gpt-4o-mini-transcribe'`.execute(database);
  console.log('[Kysely] Removed gpt-4o-mini-transcribe from enabled_models');

  // Migration: Add original_request column to task_plans for keyword skill resolution
  await sql`ALTER TABLE task_plans ADD COLUMN IF NOT EXISTS original_request TEXT`.execute(database);

  // Migration: Update task_plans status check constraint to include 'stopped' and 'paused'
  await sql`
    DO $$ BEGIN
      ALTER TABLE task_plans DROP CONSTRAINT IF EXISTS task_plans_status_check;
      ALTER TABLE task_plans ADD CONSTRAINT task_plans_status_check
        CHECK (status IN ('active', 'completed', 'cancelled', 'failed', 'stopped', 'paused'));
    EXCEPTION WHEN others THEN NULL;
    END $$
  `.execute(database);
  console.log('[Kysely] Updated task_plans status constraint for stopped/paused states');

  // Migration: Create token_usage_log table for unified token tracking
  await sql`
    CREATE TABLE IF NOT EXISTS token_usage_log (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      model TEXT NOT NULL,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_token_usage_log_created ON token_usage_log(created_at DESC)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_token_usage_log_category ON token_usage_log(category, created_at DESC)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_token_usage_log_user ON token_usage_log(user_id, created_at DESC)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_token_usage_log_model ON token_usage_log(model, created_at DESC)`.execute(database);
  console.log('[Kysely] Ensured token_usage_log table exists');

  // Add metadata_json column to messages table
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata_json TEXT`.execute(database);
  // Add model column to workspace_messages table
  await sql`ALTER TABLE workspace_messages ADD COLUMN IF NOT EXISTS model TEXT`.execute(database);
  console.log('[Kysely] Ensured metadata columns exist');

  // Safety net: ensure critical indexes exist (these are in postgres.sql but may be
  // missing if database was set up without the Docker init script)
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_workspace_categories_workspace ON workspace_categories(workspace_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_workspace_sessions_workspace ON workspace_sessions(workspace_id)`.execute(database);
  console.log('[Kysely] Ensured safety net indexes exist');

  // Migration: Add parallel_tool_capable and thinking_capable columns to enabled_models
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS parallel_tool_capable INTEGER DEFAULT 0`.execute(database);
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS thinking_capable INTEGER DEFAULT 0`.execute(database);
  console.log('[Kysely] Ensured parallel_tool_capable and thinking_capable columns exist');

  console.log('[Kysely] PostgreSQL migrations completed');

  // Fire-and-forget: sync enabled models to LiteLLM proxy
  import('../services/litellm-sync').then(({ syncAllModelsToLiteLLM }) =>
    syncAllModelsToLiteLLM()
      .then(r => {
        if (r.synced > 0 || r.failed > 0) {
          console.log(`[LiteLLM Sync] Startup: synced ${r.synced} models (${r.failed} failed)`);
        }
      })
      .catch(err => console.warn('[LiteLLM Sync] Startup sync failed:', err))
  );

  // Fire-and-forget: initialize automated backup scheduler
  import('../services/backup-scheduler').then(({ initBackupScheduler }) =>
    initBackupScheduler().catch(err => console.warn('[Backup] Scheduler init failed:', err))
  );
}

/**
 * Check if the database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return db !== null;
}

/**
 * Close the database connection
 */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    console.log('[Kysely] Database connection closed');
  }
}

/**
 * Get current timestamp expression for the current provider
 * Use this in INSERT/UPDATE statements for timestamp fields
 */
export function currentTimestamp() {
  return sql`CURRENT_TIMESTAMP`;
}

/**
 * Run a raw SQL query (use sparingly, prefer Kysely query builder)
 * Note: For parameterized queries, use the Kysely query builder instead
 */
export async function rawQuery<T>(
  query: string
): Promise<T[]> {
  const database = await getDb();
  const result = await sql.raw<T>(query).execute(database);
  return result.rows as T[];
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  fn: (trx: Kysely<DB>) => Promise<T>
): Promise<T> {
  const database = await getDb();
  return database.transaction().execute(fn);
}
