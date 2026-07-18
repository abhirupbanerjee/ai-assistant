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
import { Pool, types as pgTypes } from 'pg';
import type { DB } from './db-types';

// Parse PostgreSQL TIMESTAMP / TIMESTAMPTZ columns as strings instead of Date objects.
// The entire codebase (types, interfaces, compat layer) expects ISO date strings.
// Without this, `kysely-codegen` generates `Date | null` and `next build` fails
// with "Conversion of type 'Date | null' to type 'string'" in ~55+ files.
pgTypes.setTypeParser(1114, (val: string) => val); // timestamp
pgTypes.setTypeParser(1184, (val: string) => val); // timestamptz

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

  // Migration: Update thread_outputs file_type CHECK constraint to include audio and html formats
  // This matches the SQLite migration in index.ts lines 641-729
  await sql`
    ALTER TABLE thread_outputs
    DROP CONSTRAINT IF EXISTS thread_outputs_file_type_check
  `.execute(database);
  await sql`
    UPDATE thread_outputs SET file_type = 'md' WHERE file_type NOT IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav', 'html')
  `.execute(database);
  await sql`
    ALTER TABLE thread_outputs
    ADD CONSTRAINT thread_outputs_file_type_check
    CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav', 'html'))
  `.execute(database);
  console.log('[Kysely] Updated thread_outputs file_type constraint for audio and html formats');

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

  // Migration: Add sources_enabled column to workspaces table
  await sql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sources_enabled INTEGER DEFAULT 1`.execute(database);
  console.log('[Kysely] Ensured workspaces.sources_enabled column exists');

  // Migration: Add encrypted_key column to agent_bot_api_keys table
  // Stores the full API key encrypted with AES-256-GCM (DATA_SOURCE_ENCRYPTION_KEY)
  // so admins can reveal it later via the eye icon in the UI.
  await sql`
    ALTER TABLE agent_bot_api_keys
    ADD COLUMN IF NOT EXISTS encrypted_key TEXT
  `.execute(database);
  console.log('[Kysely] Ensured agent_bot_api_keys.encrypted_key column exists');

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
      'ollama-cloud': { apiKey: 'OLLAMA_API_KEY' },
      'azure-foundry': { apiKey: 'AZURE_FOUNDRY_API_KEY', apiBase: 'AZURE_FOUNDRY_ENDPOINT' },
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

  // Seed Ollama Cloud provider (added after initial setup)
  await database
    .insertInto('llm_providers')
    .values({
      id: 'ollama-cloud',
      name: 'Ollama Cloud',
      api_key: process.env['OLLAMA_API_KEY'] || null,
      api_base: null,
      enabled: 1,
    })
    .onConflict(oc => oc.column('id').doNothing())
    .execute();
  console.log('[Kysely] Ensured Ollama Cloud provider exists');

  // Seed Moonshot provider (added after initial setup)
  await database
    .insertInto('llm_providers')
    .values({
      id: 'moonshot',
      name: 'Moonshot AI',
      api_key: process.env['MOONSHOT_API_KEY'] || null,
      api_base: process.env['MOONSHOT_API_BASE'] || null,
      enabled: 1,
    })
    .onConflict(oc => oc.column('id').doNothing())
    .execute();
  console.log('[Kysely] Ensured Moonshot provider exists');

  // Seed Azure AI Foundry provider (Route 5 aggregator — added after initial setup)
  await database
    .insertInto('llm_providers')
    .values({
      id: 'azure-foundry',
      name: 'Azure AI Foundry',
      api_key: process.env['AZURE_FOUNDRY_API_KEY'] || null,
      api_base: process.env['AZURE_FOUNDRY_ENDPOINT'] || null,
      enabled: 1,
    })
    .onConflict(oc => oc.column('id').doNothing())
    .execute();
  console.log('[Kysely] Ensured Azure AI Foundry provider exists');

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

  // Migration: Seed current Fireworks serverless chat models
  const newFireworksModels = [
    {
      id: 'fireworks/glm-5p2',
      display_name: 'GLM 5.2 (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 1048576,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/glm-5p1',
      display_name: 'GLM 5.1 (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 202752,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/kimi-k2p7-code',
      display_name: 'Kimi K2.7 Code (Fireworks)',
      tool_capable: 1,
      vision_capable: 1,
      max_input_tokens: 262144,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/kimi-k2p6',
      display_name: 'Kimi K2.6 (Fireworks)',
      tool_capable: 1,
      vision_capable: 1,
      max_input_tokens: 262144,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/kimi-k2p5',
      display_name: 'Kimi K2.5 (Fireworks)',
      tool_capable: 1,
      vision_capable: 1,
      max_input_tokens: 262144,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/qwen3p7-plus',
      display_name: 'Qwen3.7 Plus (Fireworks)',
      tool_capable: 1,
      vision_capable: 1,
      max_input_tokens: 262144,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/minimax-m3',
      display_name: 'MiniMax M3 (Fireworks)',
      tool_capable: 1,
      vision_capable: 1,
      max_input_tokens: 512000,
      max_output_tokens: 32768,
    },
    {
      id: 'fireworks/minimax-m2p7',
      display_name: 'MiniMax M2.7 (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 196608,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/minimax-m2p5',
      display_name: 'MiniMax M2.5 (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 196608,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/gpt-oss-120b',
      display_name: 'OpenAI GPT-OSS 120B (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 131072,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/gpt-oss-20b',
      display_name: 'OpenAI GPT-OSS 20B (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 131072,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/nemotron-3-ultra-nvfp4',
      display_name: 'NVIDIA Nemotron 3 Ultra NVFP4 (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 262144,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/deepseek-v4-flash',
      display_name: 'DeepSeek V4 Flash (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 1048576,
      max_output_tokens: 16384,
    },
    {
      id: 'fireworks/deepseek-v4-pro',
      display_name: 'DeepSeek V4 Pro (Fireworks)',
      tool_capable: 1,
      vision_capable: 0,
      max_input_tokens: 1048576,
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
  await sql`DELETE FROM enabled_models WHERE id IN ('fireworks/deepseek-v3p2', 'fireworks/qwen3-coder-480b-a35b-instruct', 'fireworks/qwen3-vl-30b-a3b-thinking', 'fireworks/qwen3p6-plus')`.execute(database);
  console.log('[Kysely] Removed retired Fireworks models (deepseek-v3p2, qwen3-coder-480b, qwen3-vl-30b-a3b-thinking, qwen3p6-plus)');

  // Migration: Remove deprecated DeepSeek legacy models
  await sql`DELETE FROM enabled_models WHERE id IN ('deepseek-chat', 'deepseek-reasoner')`.execute(database);
  console.log('[Kysely] Removed deprecated DeepSeek legacy models (deepseek-chat, deepseek-reasoner)');

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

  // Migration: Add parallel_tool_capable, thinking_capable, and forced_tool_capable columns to enabled_models
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS parallel_tool_capable INTEGER DEFAULT 0`.execute(database);
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS thinking_capable INTEGER DEFAULT 0`.execute(database);
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS forced_tool_capable INTEGER DEFAULT 1`.execute(database);
  console.log('[Kysely] Ensured parallel_tool_capable, thinking_capable, and forced_tool_capable columns exist');

  // Migration: Claude adaptive-thinking models (e.g. claude-fable-5) reject forced
  // tool_choice. The column defaults to 1, so backfill existing rows seeded before
  // this classification was corrected. See model-discovery.isForcedToolCapable.
  await sql`
    UPDATE enabled_models
    SET forced_tool_capable = 0
    WHERE (
        id LIKE 'claude-fable-5%'
        OR id LIKE '%/claude-fable-5%'
        OR id LIKE 'claude-opus-4-7%'
        OR id LIKE '%/claude-opus-4-7%'
        OR id LIKE 'claude-opus-4-8%'
        OR id LIKE '%/claude-opus-4-8%'
        OR id LIKE 'claude-sonnet-4-6%'
        OR id LIKE '%/claude-sonnet-4-6%'
        OR id LIKE 'claude-opus-4-6%'
        OR id LIKE '%/claude-opus-4-6%'
      )
      AND forced_tool_capable = 1
  `.execute(database);
  console.log('[Kysely] Ensured Claude adaptive-thinking models are not marked forced-tool-capable');

  // Migration: Think-tag / reasoning models (Kimi K2, DeepSeek V4 Pro, Qwen3, QwQ,
  // GPT-OSS) do not reliably honor forced tool_choice. These mirror isThinkTagModel
  // in model-discovery. Rows seeded before forced_tool_capable existed inherited the
  // default of 1, so backfill them to 0. See model-discovery.isForcedToolCapable.
  await sql`
    UPDATE enabled_models
    SET forced_tool_capable = 0
    WHERE (
        id LIKE 'kimi-k2%'
        OR id LIKE '%/kimi-k2%'
        OR id LIKE 'kimi-k3%'
        OR id LIKE '%/kimi-k3%'
        OR id LIKE 'deepseek-v4-pro%'
        OR id LIKE '%/deepseek-v4-pro%'
        OR id LIKE 'qwen3%'
        OR id LIKE '%/qwen3%'
        OR id LIKE 'qwq%'
        OR id LIKE '%/qwq%'
        OR id LIKE 'gpt-oss%'
        OR id LIKE '%/gpt-oss%'
      )
      AND forced_tool_capable = 1
  `.execute(database);
  console.log('[Kysely] Ensured think-tag/reasoning models are not marked forced-tool-capable');

  // Migration: Add input_cost_per_1m and output_cost_per_1m columns to enabled_models
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS input_cost_per_1m NUMERIC(12,8)`.execute(database);
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS output_cost_per_1m NUMERIC(12,8)`.execute(database);
  console.log('[Kysely] Ensured input_cost_per_1m and output_cost_per_1m columns exist');

  // Migration: Ensure MiniMax M2.7 and M3 pricing matches Fireworks serverless rates
  await sql`
    UPDATE enabled_models
    SET input_cost_per_1m = 0.30, output_cost_per_1m = 1.20
    WHERE id IN ('fireworks/minimax-m2p7', 'fireworks/minimax-m3')
  `.execute(database);
  console.log('[Kysely] Updated MiniMax M2.7 / M3 pricing to $0.30 in / $1.20 out per 1M tokens');

  // Migration: Ensure Kimi K2.7 Code pricing matches the K2.6 tier
  await sql`
    UPDATE enabled_models
    SET input_cost_per_1m = 0.95, output_cost_per_1m = 4.00
    WHERE id = 'fireworks/kimi-k2p7-code'
  `.execute(database);
  console.log('[Kysely] Updated Kimi K2.7 Code pricing to $0.95 in / $4.00 out per 1M tokens');

  // Migration: Ensure Fireworks DeepSeek V4 Pro / Flash pricing matches Fireworks serverless rates
  await sql`
    UPDATE enabled_models
    SET input_cost_per_1m = 1.74, output_cost_per_1m = 3.48
    WHERE id = 'fireworks/deepseek-v4-pro'
  `.execute(database);
  await sql`
    UPDATE enabled_models
    SET input_cost_per_1m = 0.14, output_cost_per_1m = 0.28
    WHERE id = 'fireworks/deepseek-v4-flash'
  `.execute(database);
  console.log('[Kysely] Updated Fireworks DeepSeek V4 Pro / Flash pricing');

  // Migration: Sync Fireworks serverless chat model specs and pricing from current catalog.
  // Context windows, vision tags and prices verified from the public Fireworks serverless
  // catalog (https://fireworks.ai/models?modelTypes=Serverless) and pricing page
  // (https://docs.fireworks.ai/serverless/pricing).
  const fireworksServerlessSpecs: Array<{
    id: string;
    max_input_tokens: number;
    max_output_tokens: number;
    vision_capable: number;
    input_cost_per_1m: number;
    output_cost_per_1m: number;
    forced_tool_capable: number;
  }> = [
    { id: 'fireworks/glm-5p2', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 1.40, output_cost_per_1m: 4.40, forced_tool_capable: 1 },
    { id: 'fireworks/glm-5p1', max_input_tokens: 202752, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 1.40, output_cost_per_1m: 4.40, forced_tool_capable: 1 },
    { id: 'fireworks/kimi-k2p7-code', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 0.95, output_cost_per_1m: 4.00, forced_tool_capable: 1 },
    { id: 'fireworks/kimi-k2p6', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 0.95, output_cost_per_1m: 4.00, forced_tool_capable: 1 },
    { id: 'fireworks/kimi-k2p5', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 0.60, output_cost_per_1m: 3.00, forced_tool_capable: 1 },
    { id: 'fireworks/qwen3p7-plus', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 0.40, output_cost_per_1m: 1.60, forced_tool_capable: 1 },
    { id: 'fireworks/minimax-m3', max_input_tokens: 512000, max_output_tokens: 32768, vision_capable: 1, input_cost_per_1m: 0.30, output_cost_per_1m: 1.20, forced_tool_capable: 1 },
    { id: 'fireworks/minimax-m2p7', max_input_tokens: 196608, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.30, output_cost_per_1m: 1.20, forced_tool_capable: 1 },
    { id: 'fireworks/minimax-m2p5', max_input_tokens: 196608, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.30, output_cost_per_1m: 1.20, forced_tool_capable: 1 },
    { id: 'fireworks/gpt-oss-120b', max_input_tokens: 131072, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.15, output_cost_per_1m: 0.60, forced_tool_capable: 0 },
    { id: 'fireworks/gpt-oss-20b', max_input_tokens: 131072, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.07, output_cost_per_1m: 0.30, forced_tool_capable: 0 },
    { id: 'fireworks/nemotron-3-ultra-nvfp4', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.60, output_cost_per_1m: 2.40, forced_tool_capable: 1 },
    { id: 'fireworks/deepseek-v4-flash', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.14, output_cost_per_1m: 0.28, forced_tool_capable: 1 },
    { id: 'fireworks/deepseek-v4-pro', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 1.74, output_cost_per_1m: 3.48, forced_tool_capable: 0 },
  ];
  for (const m of fireworksServerlessSpecs) {
    await sql`
      UPDATE enabled_models
      SET
        max_input_tokens = ${m.max_input_tokens},
        max_output_tokens = ${m.max_output_tokens},
        vision_capable = ${m.vision_capable},
        tool_capable = 1,
        input_cost_per_1m = ${m.input_cost_per_1m},
        output_cost_per_1m = ${m.output_cost_per_1m},
        forced_tool_capable = ${m.forced_tool_capable}
      WHERE id = ${m.id}
    `.execute(database);
  }
  console.log('[Kysely] Synced Fireworks serverless model specs and pricing');

  // Migration: Seed pricing and specs for native provider models (not covered by Fireworks sync above)
  const nativeProviderSpecs: Array<{
    id: string;
    max_input_tokens: number;
    max_output_tokens: number;
    vision_capable: number;
    input_cost_per_1m: number;
    output_cost_per_1m: number;
    forced_tool_capable: number;
  }> = [
    // Gemini 2.5
    { id: 'gemini-2.5-pro', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, input_cost_per_1m: 1.25, output_cost_per_1m: 10.00, forced_tool_capable: 1 },
    { id: 'gemini-2.5-flash', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, input_cost_per_1m: 0.30, output_cost_per_1m: 2.50, forced_tool_capable: 1 },
    { id: 'gemini-2.5-flash-lite', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, input_cost_per_1m: 0.10, output_cost_per_1m: 0.40, forced_tool_capable: 1 },
    // Gemini 3.x
    { id: 'gemini-3-flash-preview', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, input_cost_per_1m: 0.50, output_cost_per_1m: 3.00, forced_tool_capable: 1 },
    { id: 'gemini-3.1-pro-preview', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, input_cost_per_1m: 2.00, output_cost_per_1m: 12.00, forced_tool_capable: 1 },
    { id: 'gemini-3.5-flash', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, input_cost_per_1m: 1.50, output_cost_per_1m: 9.00, forced_tool_capable: 1 },
    { id: 'gemini-3.1-flash-lite', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, input_cost_per_1m: 0.25, output_cost_per_1m: 1.50, forced_tool_capable: 1 },
    // OpenAI - GPT-4 series
    { id: 'gpt-4o', max_input_tokens: 128000, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 2.50, output_cost_per_1m: 10.00, forced_tool_capable: 1 },
    { id: 'gpt-4o-mini', max_input_tokens: 128000, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 0.15, output_cost_per_1m: 0.60, forced_tool_capable: 1 },
    { id: 'gpt-4.1', max_input_tokens: 1000000, max_output_tokens: 32768, vision_capable: 1, input_cost_per_1m: 2.00, output_cost_per_1m: 8.00, forced_tool_capable: 1 },
    { id: 'gpt-4.1-mini', max_input_tokens: 1000000, max_output_tokens: 32768, vision_capable: 1, input_cost_per_1m: 0.40, output_cost_per_1m: 1.60, forced_tool_capable: 1 },
    { id: 'gpt-4.1-nano', max_input_tokens: 1000000, max_output_tokens: 32768, vision_capable: 1, input_cost_per_1m: 0.10, output_cost_per_1m: 0.40, forced_tool_capable: 1 },
    // OpenAI - GPT-5 base series
    { id: 'gpt-5', max_input_tokens: 272000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 1.25, output_cost_per_1m: 10.00, forced_tool_capable: 1 },
    { id: 'gpt-5-mini', max_input_tokens: 272000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 0.25, output_cost_per_1m: 2.00, forced_tool_capable: 1 },
    { id: 'gpt-5-nano', max_input_tokens: 272000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 0.05, output_cost_per_1m: 0.40, forced_tool_capable: 1 },
    // OpenAI - GPT-5.5/5.4 series (latest)
    { id: 'gpt-5.5', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 5.00, output_cost_per_1m: 30.00, forced_tool_capable: 1 },
    { id: 'gpt-5.5-pro', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 30.00, output_cost_per_1m: 180.00, forced_tool_capable: 1 },
    { id: 'gpt-5.4', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 2.50, output_cost_per_1m: 15.00, forced_tool_capable: 1 },
    { id: 'gpt-5.4-mini', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 0.75, output_cost_per_1m: 4.50, forced_tool_capable: 1 },
    { id: 'gpt-5.4-nano', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 0.20, output_cost_per_1m: 1.25, forced_tool_capable: 1 },
    { id: 'gpt-5.4-pro', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 30.00, output_cost_per_1m: 180.00, forced_tool_capable: 1 },
    // OpenAI - GPT-5.6 family (Sol, Terra, Luna)
    // gpt-5.6 is the base alias that routes to gpt-5.6-sol (OpenAI convention).
    { id: 'gpt-5.6', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 5.00, output_cost_per_1m: 30.00, forced_tool_capable: 1 },
    { id: 'gpt-5.6-sol', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 5.00, output_cost_per_1m: 30.00, forced_tool_capable: 1 },
    { id: 'gpt-5.6-terra', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 2.50, output_cost_per_1m: 15.00, forced_tool_capable: 1 },
    { id: 'gpt-5.6-luna', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, input_cost_per_1m: 1.00, output_cost_per_1m: 6.00, forced_tool_capable: 1 },
    // OpenAI - o-series
    { id: 'o1', max_input_tokens: 200000, max_output_tokens: 100000, vision_capable: 1, input_cost_per_1m: 15.00, output_cost_per_1m: 60.00, forced_tool_capable: 0 },
    { id: 'o3', max_input_tokens: 200000, max_output_tokens: 100000, vision_capable: 1, input_cost_per_1m: 10.00, output_cost_per_1m: 40.00, forced_tool_capable: 0 },
    { id: 'o3-mini', max_input_tokens: 200000, max_output_tokens: 100000, vision_capable: 0, input_cost_per_1m: 1.10, output_cost_per_1m: 4.40, forced_tool_capable: 0 },
    { id: 'o4-mini', max_input_tokens: 200000, max_output_tokens: 100000, vision_capable: 0, input_cost_per_1m: 1.10, output_cost_per_1m: 4.40, forced_tool_capable: 0 },
    // Mistral
    { id: 'mistral-large-3', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 0, input_cost_per_1m: 0.50, output_cost_per_1m: 1.50, forced_tool_capable: 1 },
    { id: 'mistral-medium-3', max_input_tokens: 131072, max_output_tokens: 8000, vision_capable: 0, input_cost_per_1m: 0.40, output_cost_per_1m: 2.00, forced_tool_capable: 1 },
    { id: 'mistral-medium-3.5', max_input_tokens: 256000, max_output_tokens: 16000, vision_capable: 0, input_cost_per_1m: 1.50, output_cost_per_1m: 7.50, forced_tool_capable: 1 },
    { id: 'mistral-small-3.2', max_input_tokens: 128000, max_output_tokens: 3000, vision_capable: 0, input_cost_per_1m: 0.08, output_cost_per_1m: 0.20, forced_tool_capable: 1 },
    // DeepSeek V4 (native API)
    { id: 'deepseek-v4-flash', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.14, output_cost_per_1m: 0.28, forced_tool_capable: 1 },
    { id: 'deepseek-v4-pro', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.435, output_cost_per_1m: 0.87, forced_tool_capable: 0 },
    // Moonshot/Kimi K2 (native API)
    { id: 'moonshot/kimi-k2p5', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, input_cost_per_1m: 0.60, output_cost_per_1m: 3.00, forced_tool_capable: 1 },
    { id: 'moonshot/kimi-k2p6', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, input_cost_per_1m: 0.75, output_cost_per_1m: 3.50, forced_tool_capable: 1 },
    // Moonshot/Kimi K3 (native API)
    { id: 'moonshot/kimi-k3', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 3.00, output_cost_per_1m: 15.00, forced_tool_capable: 0 },
    { id: 'kimi-k3', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 3.00, output_cost_per_1m: 15.00, forced_tool_capable: 0 },
    // Moonshot/Kimi K2 (dot-notation aliases)
    { id: 'moonshot/kimi-k2.5', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 0, input_cost_per_1m: 0.60, output_cost_per_1m: 3.00, forced_tool_capable: 0 },
    { id: 'moonshot/kimi-k2.6', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, input_cost_per_1m: 0.60, output_cost_per_1m: 2.50, forced_tool_capable: 0 },
    // Mistral legacy aliases
    { id: 'mistral-large-latest', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, input_cost_per_1m: 0.50, output_cost_per_1m: 1.50, forced_tool_capable: 1 },
    { id: 'mistral-medium', max_input_tokens: 256000, max_output_tokens: 8000, vision_capable: 0, input_cost_per_1m: 0.40, output_cost_per_1m: 2.00, forced_tool_capable: 1 },
    // Claude Sonnet 4.6
    { id: 'claude-sonnet-4-6', max_input_tokens: 1000000, max_output_tokens: 32000, vision_capable: 1, input_cost_per_1m: 3.00, output_cost_per_1m: 15.00, forced_tool_capable: 0 },
  ];
  for (const m of nativeProviderSpecs) {
    await sql`
      UPDATE enabled_models
      SET
        max_input_tokens = ${m.max_input_tokens},
        max_output_tokens = ${m.max_output_tokens},
        vision_capable = ${m.vision_capable},
        tool_capable = 1,
        input_cost_per_1m = ${m.input_cost_per_1m},
        output_cost_per_1m = ${m.output_cost_per_1m},
        forced_tool_capable = ${m.forced_tool_capable}
      WHERE id = ${m.id}
        AND (input_cost_per_1m IS NULL OR output_cost_per_1m IS NULL)
    `.execute(database);
  }
  console.log('[Kysely] Synced native provider model specs and pricing (OpenAI, Gemini, Mistral, DeepSeek, Moonshot)');

  // Migration: Add input_tokens and output_tokens to token_usage_log
  await sql`ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0`.execute(database);
  await sql`ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0`.execute(database);
  console.log('[Kysely] Ensured input_tokens and output_tokens columns exist');

  await sql`
    UPDATE enabled_models
    SET thinking_capable = 1
    WHERE (
        id IN ('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', 'fireworks/deepseek-v4-pro', 'fireworks/deepseek-v4-flash', 'fireworks/kimi-k2p6', 'moonshot/kimi-k2p6', 'fireworks/minimax-m3', 'fireworks/kimi-k2p7-code', 'moonshot/kimi-k3', 'kimi-k3')
        OR id LIKE 'gpt-5%'
        OR id LIKE 'openai/gpt-5%'
      )
      AND thinking_capable = 0
  `.execute(database);
  console.log('[Kysely] Ensured default thinking models are marked capable');

  // Migration: Backfill thinking_capable for Claude Sonnet 4.6 and Gemini 3.x
  // These models support thinking but were missed by the original backfill above
  await sql`
    UPDATE enabled_models
    SET thinking_capable = 1
    WHERE (
        id LIKE 'claude-sonnet-4-6%'
        OR id LIKE '%/claude-sonnet-4-6%'
        OR id LIKE 'gemini-3%'
      )
      AND thinking_capable = 0
  `.execute(database);
  console.log('[Kysely] Ensured Claude Sonnet 4.6 and Gemini 3.x thinking models are marked capable');

  // Migration: Backfill parallel_tool_capable for models whose detection patterns
  // indicate support but DB rows may be stale (parallel_tool_capable was not synced
  // by earlier nativeProviderSpecs migration which only syncs tool/vision/forced/pricing)
  await sql`
    UPDATE enabled_models
    SET parallel_tool_capable = 1
    WHERE (
        -- GPT-5.4 family (gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, gpt-5.4-pro)
        id LIKE 'gpt-5.4%'
        -- GPT-5.5 family
        OR id LIKE 'gpt-5.5%'
        -- GPT-5.6 family (Sol, Terra, Luna)
        OR id LIKE 'gpt-5.6%'
        -- Mistral Large
        OR id LIKE 'mistral-large%'
        -- Gemini (all models — full parallel + compositional support)
        OR id LIKE 'gemini-%'
        -- Claude (all models — excellent multi-tool support)
        OR id LIKE 'claude-%'
        -- Moonshot/Kimi K2 (native API — full tool calling with parallel support)
        OR id LIKE 'moonshot/kimi%'
      )
      AND parallel_tool_capable = 0
  `.execute(database);
  console.log('[Kysely] Ensured parallel_tool_capable is set for GPT-5.4/5.5/5.6, Mistral Large, Gemini, and Claude models');

  // Migration: Ensure GPT-5.6 family is marked thinking-capable
  await sql`
    UPDATE enabled_models
    SET thinking_capable = 1
    WHERE id LIKE 'gpt-5.6%'
      AND thinking_capable = 0
  `.execute(database);
  console.log('[Kysely] Ensured GPT-5.6 family is marked thinking-capable');

  // Migration: Fix context windows for Gemini 3.x models (1,000,000 → 1,048,576)
  await sql`
    UPDATE enabled_models
    SET max_input_tokens = 1048576
    WHERE id IN ('gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.1-flash-lite')
      AND max_input_tokens = 1000000
  `.execute(database);
  console.log('[Kysely] Fixed Gemini 3.x context windows to 1,048,576');

  // Migration: Fix context windows for Kimi K2.x and Mistral Medium models
  await sql`
    UPDATE enabled_models SET max_input_tokens = 262144 WHERE id = 'moonshot/kimi-k2.6' AND (max_input_tokens IS NULL OR max_input_tokens != 262144)
  `.execute(database);
  await sql`
    UPDATE enabled_models SET max_input_tokens = 262144 WHERE id = 'moonshot/kimi-k2.5' AND (max_input_tokens IS NULL OR max_input_tokens != 262144)
  `.execute(database);
  await sql`
    UPDATE enabled_models SET max_input_tokens = 256000 WHERE id = 'mistral-medium' AND (max_input_tokens IS NULL OR max_input_tokens != 256000)
  `.execute(database);
  console.log('[Kysely] Fixed context windows for Kimi K2.x and Mistral Medium models');

  // Migration: Fix Gemini max output tokens (64,000 → 65,536 per official API)
  await sql`
    UPDATE enabled_models
    SET max_output_tokens = 65536
    WHERE (id LIKE 'gemini-%')
      AND max_output_tokens = 64000
  `.execute(database);
  console.log('[Kysely] Fixed Gemini max output tokens to 65,536');

  // Migration: Update thread_outputs and workspace_outputs file_type CHECK constraints to include 'html'
  // First, update any rows with file_types that would violate the new constraint to a valid type
  await sql`
    UPDATE thread_outputs SET file_type = 'md' WHERE file_type NOT IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav', 'html')
  `.execute(database);
  await sql`
    UPDATE workspace_outputs SET file_type = 'md' WHERE file_type NOT IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'html')
  `.execute(database);
  // Drop old constraints and add updated ones
  await sql`
    ALTER TABLE thread_outputs DROP CONSTRAINT IF EXISTS thread_outputs_file_type_check
  `.execute(database);
  await sql`
    ALTER TABLE thread_outputs ADD CONSTRAINT thread_outputs_file_type_check
      CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav', 'html'))
  `.execute(database);
  await sql`
    ALTER TABLE workspace_outputs DROP CONSTRAINT IF EXISTS workspace_outputs_file_type_check
  `.execute(database);
  await sql`
    ALTER TABLE workspace_outputs ADD CONSTRAINT workspace_outputs_file_type_check
      CHECK (file_type IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'html'))
  `.execute(database);
  console.log('[Kysely] Updated file_type constraints to include html format');

  // Migration: Add 'zip' file_type to thread_outputs and workspace_outputs for site_gen website packaging
  // Repair any site_gen rows previously mislabeled as 'html' (filename ends in .zip)
  await sql`
    UPDATE thread_outputs SET file_type = 'zip'
    WHERE file_type = 'html' AND filename LIKE '%.zip'
  `.execute(database);
  await sql`
    UPDATE workspace_outputs SET file_type = 'zip'
    WHERE file_type = 'html' AND filename LIKE '%.zip'
  `.execute(database);
  // Safety: normalize any unknown file_type to 'md' before re-adding the CHECK constraint
  await sql`
    UPDATE thread_outputs SET file_type = 'md'
    WHERE file_type NOT IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav', 'html', 'zip')
  `.execute(database);
  await sql`
    UPDATE workspace_outputs SET file_type = 'md'
    WHERE file_type NOT IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'mp3', 'wav', 'html', 'zip')
  `.execute(database);
  await sql`
    ALTER TABLE thread_outputs DROP CONSTRAINT IF EXISTS thread_outputs_file_type_check
  `.execute(database);
  await sql`
    ALTER TABLE thread_outputs
    ADD CONSTRAINT thread_outputs_file_type_check
      CHECK (file_type IN ('image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'mp3', 'wav', 'html', 'zip'))
  `.execute(database);
  await sql`
    ALTER TABLE workspace_outputs DROP CONSTRAINT IF EXISTS workspace_outputs_file_type_check
  `.execute(database);
  await sql`
    ALTER TABLE workspace_outputs
    ADD CONSTRAINT workspace_outputs_file_type_check
      CHECK (file_type IN ('pdf', 'docx', 'image', 'chart', 'md', 'xlsx', 'pptx', 'mp3', 'wav', 'html', 'zip'))
  `.execute(database);
  console.log('[Kysely] Added zip file_type to thread_outputs and workspace_outputs');

  // Migration: Create citation_trajectories table if it doesn't exist
  await sql`
    CREATE TABLE IF NOT EXISTS citation_trajectories (
      id SERIAL PRIMARY KEY,
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      document_name TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      raw_score REAL,
      reranked_score REAL,
      was_selected INTEGER NOT NULL,
      rank_before INTEGER,
      rank_after INTEGER,
      source_type TEXT DEFAULT 'vector' CHECK (source_type IN ('vector', 'user_upload', 'web')),
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_citation_trajectories_message ON citation_trajectories(message_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_citation_trajectories_thread ON citation_trajectories(thread_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_citation_trajectories_source_type ON citation_trajectories(source_type)`.execute(database);
  console.log('[Kysely] Ensured citation_trajectories table exists');

  // Migration: Add include_sources column to agent_bot_versions if missing
  await sql`ALTER TABLE agent_bot_versions ADD COLUMN IF NOT EXISTS include_sources INTEGER DEFAULT 0`.execute(database);
  console.log('[Kysely] Ensured agent_bot_versions.include_sources column exists');

  // Migration: Add sources_json column to agent_bot_jobs if missing
  await sql`ALTER TABLE agent_bot_jobs ADD COLUMN IF NOT EXISTS sources_json TEXT`.execute(database);
  console.log('[Kysely] Ensured agent_bot_jobs.sources_json column exists');

  // Migration: Create slash_command_configs table
  await sql`
    CREATE TABLE IF NOT EXISTS slash_command_configs (
      id TEXT PRIMARY KEY,
      command_key TEXT UNIQUE NOT NULL,
      tool_name TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      aliases TEXT NOT NULL,
      hint TEXT NOT NULL,
      icon TEXT,
      format_hint TEXT,
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT NOT NULL
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_slash_commands_enabled ON slash_command_configs(enabled)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_slash_commands_tool ON slash_command_configs(tool_name)`.execute(database);
  console.log('[Kysely] Ensured slash_command_configs table exists');

  // Seed default slash commands if table is empty
  const { ensureSlashCommandsExist } = await import('./compat/slash-commands');
  await ensureSlashCommandsExist('system');
  console.log('[Kysely] Ensured default slash commands exist');

  // Migration: Create model_latency_log table for Auto model selection
  await sql`
    CREATE TABLE IF NOT EXISTS model_latency_log (
      id BIGSERIAL PRIMARY KEY,
      model_id TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      output_tokens INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      error_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_model_latency_model_time ON model_latency_log(model_id, created_at DESC)`.execute(database);
  console.log('[Kysely] Ensured model_latency_log table exists');

  // Migration: Add capability_scores JSONB column to enabled_models
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS capability_scores JSONB DEFAULT NULL`.execute(database);
  console.log('[Kysely] Ensured enabled_models.capability_scores column exists');

  // Migration: Update CHECK constraints to include 'super_admin' role
  // Users table role CHECK
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`.execute(database);
  await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'superuser', 'user'))`.execute(database);
  console.log('[Kysely] Updated users.role CHECK constraint to include super_admin');

  // Skills table created_by_role CHECK
  await sql`ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_created_by_role_check`.execute(database);
  await sql`ALTER TABLE skills ADD CONSTRAINT skills_created_by_role_check CHECK (created_by_role IN ('super_admin', 'admin', 'superuser'))`.execute(database);
  console.log('[Kysely] Updated skills.created_by_role CHECK constraint to include super_admin');

  // Workspaces table created_by_role CHECK
  await sql`ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_created_by_role_check`.execute(database);
  await sql`ALTER TABLE workspaces ADD CONSTRAINT workspaces_created_by_role_check CHECK (created_by_role IN ('super_admin', 'admin', 'superuser'))`.execute(database);
  console.log('[Kysely] Updated workspaces.created_by_role CHECK constraint to include super_admin');

  // Agent bots table created_by_role CHECK
  await sql`ALTER TABLE agent_bots DROP CONSTRAINT IF EXISTS agent_bots_created_by_role_check`.execute(database);
  await sql`ALTER TABLE agent_bots ADD CONSTRAINT agent_bots_created_by_role_check CHECK (created_by_role IN ('super_admin', 'admin', 'superuser'))`.execute(database);
  console.log('[Kysely] Updated agent_bots.created_by_role CHECK constraint to include super_admin');

  // Migration: Self-Evolving Knowledge Base — Phase 0 (Prerequisites)

  // User feedback on assistant answers
  await sql`
    CREATE TABLE IF NOT EXISTS user_feedback (
      id          TEXT PRIMARY KEY,
      query       TEXT NOT NULL,
      answer      TEXT NOT NULL,
      rating      TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
      correction  TEXT,
      category_slugs JSONB,
      workspace_id TEXT,
      user_id     INTEGER NOT NULL,
      thread_id   TEXT,
      message_id  TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      processed   BOOLEAN DEFAULT FALSE
    )
  `.execute(database);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_feedback_unique ON user_feedback(user_id, message_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_user_feedback_thread ON user_feedback(thread_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_user_feedback_processed ON user_feedback(processed, created_at)`.execute(database);
  await sql`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS model_id TEXT`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_user_feedback_model ON user_feedback(model_id)`.execute(database);
  console.log('[Kysely] Ensured user_feedback table exists');

  // Per-user opt-in/out preferences
  await sql`
    CREATE TABLE IF NOT EXISTS user_evolved_kb_settings (
      user_id         INTEGER PRIMARY KEY,
      allow_learning  BOOLEAN DEFAULT TRUE,
      show_provenance BOOLEAN DEFAULT TRUE,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `.execute(database);
  console.log('[Kysely] Ensured user_evolved_kb_settings table exists');

  // Feature flag at instance level
  await sql`
    CREATE TABLE IF NOT EXISTS evolved_kb_settings (
      id              TEXT PRIMARY KEY DEFAULT 'default',
      enabled         BOOLEAN DEFAULT FALSE,
      shadow_mode     BOOLEAN DEFAULT TRUE,
      shadow_mode_sample_rate REAL DEFAULT 0.1,
      auto_approve_threshold REAL DEFAULT 0.95,
      pending_ttl_days INTEGER DEFAULT 30,
      rejected_ttl_days INTEGER DEFAULT 30,
      superseded_ttl_days INTEGER DEFAULT 90,
      orphaned_ttl_days INTEGER DEFAULT 30,
      verifier_model  TEXT,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `.execute(database);
  await sql`
    INSERT INTO evolved_kb_settings (id, enabled, shadow_mode) VALUES ('default', FALSE, TRUE)
    ON CONFLICT (id) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Ensured evolved_kb_settings table exists');

  // Migration: Document summaries for KB overview queries
  await sql`
    CREATE TABLE IF NOT EXISTS document_summaries (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL UNIQUE,
      summary_text TEXT NOT NULL,
      generated_at TIMESTAMP DEFAULT NOW(),
      model_used TEXT,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `.execute(database);
  console.log('[Kysely] Ensured document_summaries table exists');

  console.log('[Kysely] PostgreSQL migrations completed');

  // Fire-and-forget: fail stale active autonomous plans (crashed/restarted sessions)
  import('../db/compat/task-plans')
    .then(({ failStaleActivePlans }) =>
      failStaleActivePlans(2).then((count: number) => {
        if (count > 0) {
          console.log(`[Kysely] Auto-failed ${count} stale active autonomous plan(s) older than 2 hours`);
        }
      })
    )
    .catch(() => {
      /* ignore — table may not exist on very first boot */
    });

  // Fire-and-forget: initialize automated backup scheduler
  import('../services/backup-scheduler')
    .then(({ initBackupScheduler }) =>
      initBackupScheduler().catch(err => console.warn('[Backup] Scheduler init failed:', err))
    )
    .catch(err => console.warn('[Backup] Module load failed:', err));

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
