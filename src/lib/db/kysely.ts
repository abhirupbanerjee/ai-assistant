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
import { assertFeatureFlagCombinations, readFeatureFlagCombinations } from '../feature-flag-combinations';

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

  // Personal + Shared Category Memory, Phase 1 foundation. This is an authorized
  // clean reset: the legacy per-user/per-category fact table is deliberately not
  // migrated. Statements are idempotent for both upgraded and fresh databases.
  await sql`DROP TABLE IF EXISTS user_memories CASCADE`.execute(database);
  await sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN NOT NULL DEFAULT TRUE`.execute(database);
  await sql`
    CREATE TABLE IF NOT EXISTS personal_preference_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      preferred_language TEXT,
      translation_language TEXT,
      translation_mode TEXT NOT NULL DEFAULT 'never' CHECK (translation_mode IN ('never', 'when_requested', 'always')),
      tone TEXT NOT NULL DEFAULT 'default' CHECK (tone IN ('default', 'friendly', 'formal', 'direct', 'professional')),
      verbosity TEXT NOT NULL DEFAULT 'balanced' CHECK (verbosity IN ('brief', 'balanced', 'detailed')),
      complexity TEXT NOT NULL DEFAULT 'standard' CHECK (complexity IN ('simple', 'standard', 'technical', 'executive')),
      preferred_format TEXT NOT NULL DEFAULT 'auto' CHECK (preferred_format IN ('auto', 'bullets', 'steps', 'prose', 'table')),
      preferred_diagram_format TEXT NOT NULL DEFAULT 'auto' CHECK (preferred_diagram_format IN ('auto', 'mermaid', 'ascii', 'infographic')),
      preferred_document_format TEXT NOT NULL DEFAULT 'auto' CHECK (preferred_document_format IN ('auto', 'markdown', 'docx', 'pdf')),
      include_examples BOOLEAN,
      include_citations BOOLEAN,
      source TEXT NOT NULL DEFAULT 'user_set' CHECK (source IN ('user_set', 'inferred')),
      preferred_language_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_language_source IN ('user_set', 'inferred')),
      translation_language_source TEXT NOT NULL DEFAULT 'inferred' CHECK (translation_language_source IN ('user_set', 'inferred')),
      translation_mode_source TEXT NOT NULL DEFAULT 'inferred' CHECK (translation_mode_source IN ('user_set', 'inferred')),
      tone_source TEXT NOT NULL DEFAULT 'inferred' CHECK (tone_source IN ('user_set', 'inferred')),
      verbosity_source TEXT NOT NULL DEFAULT 'inferred' CHECK (verbosity_source IN ('user_set', 'inferred')),
      complexity_source TEXT NOT NULL DEFAULT 'inferred' CHECK (complexity_source IN ('user_set', 'inferred')),
      preferred_format_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_format_source IN ('user_set', 'inferred')),
      preferred_diagram_format_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_diagram_format_source IN ('user_set', 'inferred')),
      preferred_document_format_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_document_format_source IN ('user_set', 'inferred')),
      include_examples_source TEXT NOT NULL DEFAULT 'inferred' CHECK (include_examples_source IN ('user_set', 'inferred')),
      include_citations_source TEXT NOT NULL DEFAULT 'inferred' CHECK (include_citations_source IN ('user_set', 'inferred')),
      learning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS preferred_language_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_language_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS translation_language_source TEXT NOT NULL DEFAULT 'inferred' CHECK (translation_language_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS translation_mode_source TEXT NOT NULL DEFAULT 'inferred' CHECK (translation_mode_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS tone_source TEXT NOT NULL DEFAULT 'inferred' CHECK (tone_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS verbosity_source TEXT NOT NULL DEFAULT 'inferred' CHECK (verbosity_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS complexity_source TEXT NOT NULL DEFAULT 'inferred' CHECK (complexity_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS preferred_format_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_format_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS preferred_diagram_format TEXT NOT NULL DEFAULT 'auto' CHECK (preferred_diagram_format IN ('auto', 'mermaid', 'ascii', 'infographic'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS preferred_document_format TEXT NOT NULL DEFAULT 'auto' CHECK (preferred_document_format IN ('auto', 'markdown', 'docx', 'pdf'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS preferred_diagram_format_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_diagram_format_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS preferred_document_format_source TEXT NOT NULL DEFAULT 'inferred' CHECK (preferred_document_format_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS include_examples_source TEXT NOT NULL DEFAULT 'inferred' CHECK (include_examples_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`ALTER TABLE personal_preference_profiles ADD COLUMN IF NOT EXISTS include_citations_source TEXT NOT NULL DEFAULT 'inferred' CHECK (include_citations_source IN ('user_set', 'inferred'))`.execute(database);
  await sql`
    CREATE TABLE IF NOT EXISTS personal_interests (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      normalized_topic TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user_set' CHECK (source IN ('user_set', 'inferred')),
      confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_used_at TIMESTAMPTZ,
      hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, normalized_topic)
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_personal_interests_user_active ON personal_interests(user_id, is_active)`.execute(database);
  await sql`
    CREATE TABLE IF NOT EXISTS pending_personal_preference_candidates (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      field TEXT NOT NULL CHECK (field IN ('preferredLanguage', 'translationLanguage', 'translationMode', 'tone', 'verbosity', 'complexity', 'preferredFormat', 'preferredDiagramFormat', 'preferredDocumentFormat', 'includeExamples', 'includeCitations')),
      value JSONB NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.75 CHECK (confidence >= 0.0 AND confidence <= 1.0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, field)
    )
  `.execute(database);
  await sql`ALTER TABLE pending_personal_preference_candidates DROP CONSTRAINT IF EXISTS pending_personal_preference_candidates_field_check`.execute(database);
  await sql`ALTER TABLE pending_personal_preference_candidates ADD CONSTRAINT pending_personal_preference_candidates_field_check CHECK (field IN ('preferredLanguage', 'translationLanguage', 'translationMode', 'tone', 'verbosity', 'complexity', 'preferredFormat', 'preferredDiagramFormat', 'preferredDocumentFormat', 'includeExamples', 'includeCitations'))`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_pending_personal_preferences_user ON pending_personal_preference_candidates(user_id, updated_at DESC)`.execute(database);
  await sql`
    CREATE TABLE IF NOT EXISTS category_memories (
      id BIGSERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      memory_type TEXT NOT NULL CHECK (memory_type IN ('fact', 'terminology', 'decision', 'process', 'faq', 'caveat')),
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'suggested', 'approved', 'archived', 'rejected')),
      source_reference TEXT,
      confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
      valid_from TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      moderation_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (category_id, normalized_title),
      CHECK (expires_at IS NULL OR valid_from IS NULL OR expires_at > valid_from)
    )
  `.execute(database);
  await sql`ALTER TABLE category_memories ADD COLUMN IF NOT EXISTS moderation_flags JSONB NOT NULL DEFAULT '[]'::jsonb`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_category_memories_category_status ON category_memories(category_id, status)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_category_memories_active_window ON category_memories(category_id, valid_from, expires_at)`.execute(database);
  await sql`
    CREATE TABLE IF NOT EXISTS category_memory_events (
      id BIGSERIAL PRIMARY KEY,
      category_memory_id BIGINT NOT NULL REFERENCES category_memories(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      revision_number INTEGER NOT NULL CHECK (revision_number > 0),
      action TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      previous_value JSONB,
      new_value JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (category_memory_id, revision_number)
    )
  `.execute(database);
  await sql`ALTER TABLE category_memory_events DROP CONSTRAINT IF EXISTS category_memory_events_action_check`.execute(database);
  await sql`ALTER TABLE category_memory_events ADD CONSTRAINT category_memory_events_action_check CHECK (action IN ('created', 'suggested', 'edited', 'approved', 'rejected', 'archived', 'restored', 'expiry_changed'))`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_category_memory_events_memory ON category_memory_events(category_memory_id, revision_number DESC)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_category_memory_events_category ON category_memory_events(category_id, created_at DESC)`.execute(database);
  await sql`
    CREATE TABLE IF NOT EXISTS category_memory_extraction_events (
      id BIGSERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      source_message_id TEXT NOT NULL UNIQUE,
      source_surface TEXT NOT NULL DEFAULT 'main-chat' CHECK (source_surface = 'main-chat'),
      outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'no_candidate', 'candidate_created', 'duplicate_skip', 'access_revoked', 'error')),
      category_memory_id BIGINT REFERENCES category_memories(id) ON DELETE SET NULL,
      candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count BETWEEN 0 AND 1),
      duplicate_skips INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_skips BETWEEN 0 AND 1),
      redaction_count INTEGER NOT NULL DEFAULT 0 CHECK (redaction_count >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_category_memory_extraction_metrics ON category_memory_extraction_events(category_id, created_at DESC)`.execute(database);
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('category_memory_suggestion_submitted', 'category_memory_suggestion_approved', 'category_memory_suggestion_rejected')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      resource_type TEXT NOT NULL DEFAULT 'category_memory' CHECK (resource_type = 'category_memory'),
      resource_id BIGINT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC)`.execute(database);

  console.log('[Kysely] Reset legacy memory and ensured Personal/Category Memory tables');

  // The replacement uses separate collections in later phases. Removing the
  // legacy collection is idempotent; QdrantVectorStore also tolerates a missing
  // collection. A Qdrant outage must not prevent the SQL migration or startup.
  try {
    const { qdrantStore } = await import('../vector-store/qdrant');
    if (await qdrantStore.healthCheck()) {
      await qdrantStore.deleteCollection('user_memories');
    }
  } catch (error) {
    console.warn('[Kysely] Could not remove legacy user_memories vector collection:', error);
  }
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

  // Migration: Kimi K3 and DeepSeek V4 Pro are newer reasoning models that DO support
  // tool_choice: 'required' (per official Moonshot and DeepSeek API docs). The blanket
  // think-tag backfill above incorrectly set forced_tool_capable=0 for them, which causes
  // tool_choice:'required' to be downgraded to 'auto' at runtime (see openai.ts
  // isModelForcedToolCapable guard). With 'auto', reasoning models pick text/web_search
  // or hallucinate tool results instead of calling generative tools like site_gen.
  // Re-enable forced tool support for these specific models. See model-discovery.isForcedToolCapable.
  await sql`
    UPDATE enabled_models
    SET forced_tool_capable = 1
    WHERE (
        id IN ('moonshot/kimi-k3', 'kimi-k3', 'deepseek-v4-pro', 'deepseek/deepseek-v4-pro', 'fireworks/deepseek-v4-pro')
        OR id LIKE 'moonshot/kimi-k3%'
        OR id LIKE '%/kimi-k3'
        OR id LIKE 'deepseek-v4-pro'
        OR id LIKE '%/deepseek-v4-pro'
      )
      AND forced_tool_capable = 0
  `.execute(database);
  console.log('[Kysely] Re-enabled forced_tool_capable for Kimi K3 and DeepSeek V4 Pro (reasoning models that support tool_choice: required)');

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

  // Migration: Ensure Kimi K2.7 Code (highspeed, Moonshot native) pricing + caps match
  // the official Moonshot rates — $1.90 in / $8.00 out per 1M tokens, 262K context,
  // 16K max output, vision + tool capable, temperature fixed at 1 (thinking always on).
  await sql`
    UPDATE enabled_models
    SET max_input_tokens = 262144,
        max_output_tokens = 16384,
        vision_capable = 1,
        tool_capable = 1,
        parallel_tool_capable = 1,
        input_cost_per_1m = 1.90,
        output_cost_per_1m = 8.00,
        forced_tool_capable = 1
    WHERE id = 'moonshot/kimi-k2.7-code-highspeed'
  `.execute(database);
  console.log('[Kysely] Updated Kimi K2.7 Code (highspeed) spec — $1.90 in / $8.00 out, 262K ctx, 16K out, vision+tools');

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
    // DeepSeek V4 Pro supports tool_choice: 'required' per official DeepSeek API docs.
    // Without forced_tool_capable=1, tool_choice gets downgraded to 'auto', letting the
    // reasoning model pick text/web_search over generative tools like site_gen.
    { id: 'fireworks/deepseek-v4-pro', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 1.74, output_cost_per_1m: 3.48, forced_tool_capable: 1 },
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
    // DeepSeek V4 Pro supports tool_choice: 'required' per official DeepSeek API docs.
    { id: 'deepseek-v4-pro', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, input_cost_per_1m: 0.435, output_cost_per_1m: 0.87, forced_tool_capable: 1 },
    // Moonshot/Kimi K2 (native API)
    { id: 'moonshot/kimi-k2p5', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, input_cost_per_1m: 0.60, output_cost_per_1m: 3.00, forced_tool_capable: 1 },
    { id: 'moonshot/kimi-k2p6', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, input_cost_per_1m: 0.75, output_cost_per_1m: 3.50, forced_tool_capable: 1 },
    // Moonshot/Kimi K3 (native API) — 1M context, 131K default max output (caps at 1M),
    // always-on reasoning (reasoning_effort: "max" only), $3 in / $15 out per 1M tokens.
    // Temperature/top_p/n are fixed — isTemperatureLockedModel handles via kimi-k3 prefix.
    // Kimi K3 supports tool_choice: 'required' per official Moonshot API docs.
    // Without forced_tool_capable=1, tool_choice gets downgraded to 'auto', letting the
    // reasoning model pick text/web_search over generative tools like site_gen, or worse,
    // hallucinate tool results without actually calling the tool.
    { id: 'moonshot/kimi-k3', max_input_tokens: 1048576, max_output_tokens: 131072, vision_capable: 1, input_cost_per_1m: 3.00, output_cost_per_1m: 15.00, forced_tool_capable: 1 },
    { id: 'kimi-k3', max_input_tokens: 1048576, max_output_tokens: 131072, vision_capable: 1, input_cost_per_1m: 3.00, output_cost_per_1m: 15.00, forced_tool_capable: 1 },
    // Moonshot/Kimi K2 (dot-notation aliases)
    { id: 'moonshot/kimi-k2.5', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 0, input_cost_per_1m: 0.60, output_cost_per_1m: 3.00, forced_tool_capable: 0 },
    { id: 'moonshot/kimi-k2.6', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, input_cost_per_1m: 0.60, output_cost_per_1m: 2.50, forced_tool_capable: 0 },
    // Moonshot/Kimi K2.7 Code (highspeed) — native API. Temperature is fixed at 1
    // (Moonshot rejects any other value); thinking is always on (billed as output).
    // Input $1.90 / Output $8.00 per 1M tokens. Vision + tool calling supported.
    { id: 'moonshot/kimi-k2.7-code-highspeed', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, input_cost_per_1m: 1.90, output_cost_per_1m: 8.00, forced_tool_capable: 1 },
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

  // Per-user connected OAuth accounts (Drive connectors — Phase 2)
  // Stores encrypted access/refresh tokens for providers like Google Drive and Microsoft OneDrive.
  // `user_email` is the identity key (matches session.user.email / RequestContext.userId).
  await sql`
    CREATE TABLE IF NOT EXISTS user_connected_accounts (
      id              TEXT PRIMARY KEY,
      provider        TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'github', 'notion', 'slack', 'gitbook')),
      user_email      TEXT NOT NULL,
      display_name    TEXT,
      access_token    TEXT,
      refresh_token   TEXT,
      scopes          TEXT NOT NULL,
      token_expiry    TIMESTAMPTZ,
      revoked         BOOLEAN DEFAULT FALSE,
      last_error      TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `.execute(database);
  // Drop and recreate the provider CHECK constraint to include new connectors
  // (github, notion, slack). Runs on every connection for existing databases;
  // CREATE TABLE above already has the full list for fresh installs.
  await sql`ALTER TABLE user_connected_accounts DROP CONSTRAINT IF EXISTS user_connected_accounts_provider_check`.execute(database);
  await sql`ALTER TABLE user_connected_accounts ADD CONSTRAINT user_connected_accounts_provider_check CHECK (provider IN ('google', 'microsoft', 'github', 'notion', 'slack', 'gitbook'))`.execute(database);

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_connected_accounts_unique ON user_connected_accounts(user_email, provider)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_user_connected_accounts_user ON user_connected_accounts(user_email)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_user_connected_accounts_provider ON user_connected_accounts(provider)`.execute(database);
  console.log('[Kysely] Ensured user_connected_accounts table exists');

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

  // Migration: MCP server configurations (Strategy A — MCP Tool Integration)
  await sql`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      auth_token TEXT,
      enabled INTEGER DEFAULT 1,
      timeout_ms INTEGER DEFAULT 30000,
      tool_count INTEGER DEFAULT 0,
      last_health_check TIMESTAMPTZ,
      health_status TEXT DEFAULT 'unknown',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled)`.execute(database);
  console.log('[Kysely] Ensured mcp_servers table exists');

  // Migration: tool_type column on tool_configs for MCP tools
  await sql`ALTER TABLE tool_configs ADD COLUMN IF NOT EXISTS tool_type TEXT DEFAULT 'builtin'`
    .execute(database);
  console.log('[Kysely] Ensured tool_configs.tool_type column exists');

  // ===================================================================
  // Agent System — Phase 1 Foundations (see plans/agent_system_architecture___implementation_plan.md)
  // DB-first agent registry, swarm kill switch, force-swarm role allowlist,
  // and model capability tiers. Runtime enforcement lands in Phase 4; these
  // migrations only establish schema + seed data.
  // ===================================================================

  // agent registry — 5 role families, category-scoped, model-bound
  await sql`
    CREATE TABLE IF NOT EXISTS agent (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      role_family     TEXT NOT NULL CHECK (role_family IN ('planner','executor','critic','researcher','presenter')),
      category_id     INTEGER,
      model_id        TEXT,
      system_prompt   TEXT NOT NULL DEFAULT '',
      tool_allowlist  JSONB,
      config          JSONB,
      enabled         BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      FOREIGN KEY (model_id) REFERENCES enabled_models(id) ON DELETE SET NULL
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_category ON agent(category_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_role_family ON agent(role_family)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_enabled ON agent(enabled)`.execute(database);
  console.log('[Kysely] Ensured agent table exists (Phase 1)');

  // Seed global template agents (category_id NULL) — one per role family.
  // Per the plan, agents are category-scoped; but categories are user-created and
  // may not exist at first boot, so we seed category-agnostic templates that admins
  // clone/scope via the registry UI rather than seeding per-category in a migration.
  await sql`
    INSERT INTO agent (id, name, role_family, category_id, model_id, system_prompt, tool_allowlist, config, enabled) VALUES
      ('tpl-planner',    'Planner (template)',    'planner',    NULL, NULL, 'You are a Planner. Decompose the user''s goal into a DAG of subtasks and assign each subtask to the best-suited executor/researcher agent. Output the plan as structured JSON.', '[]', '{"max_subtasks": 12, "allow_parallel": true}'::jsonb, TRUE),
      ('tpl-executor',   'Executor (template)',   'executor',   NULL, NULL, 'You are an Executor. Complete the assigned subtask using the tools in your allowlist. Return an artifact, a confidence score (0-1), and a suggested_next action.', '[]', '{"max_retries": 2}'::jsonb, TRUE),
      ('tpl-critic',     'Critic (template)',     'critic',     NULL, NULL, 'You are a Critic. Review the executor artifact against the subtask criteria. Approve, or loop back with specific failure reasons. Never approve low-confidence artifacts without justification.', '[]', '{"min_confidence": 0.6}'::jsonb, TRUE),
      ('tpl-researcher', 'Researcher (template)', 'researcher', NULL, NULL, 'You are a Researcher. Retrieve information from the knowledge base, web, and uploaded documents for the assigned subtask. Cite sources. Return a structured artifact.', '["web_search","web_extract","kb_summary","kb_search","kb_read"]', '{}'::jsonb, TRUE),
      ('tpl-presenter',  'Presenter (template)',  'presenter',  NULL, NULL, 'You are a Presenter. Assemble the final deliverable from the swarm''s artifacts into a coherent, well-formatted response for the user.', '["diagram_gen"]'::jsonb, '{}'::jsonb, TRUE)
    ON CONFLICT (id) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Seeded 5 global template agents (one per role family) (Phase 1)');

  // Seed 7 domain-specialized executor + critic template agents.
  // All model_id values are NULL — models are user-configured, so binding
  // happens post-seed via the admin UI (Phase 3 validation guides admins).
  await sql`
    INSERT INTO agent (id, name, role_family, category_id, model_id, system_prompt, tool_allowlist, config, enabled) VALUES
      ('tpl-code-executor','Code Executor (template)','executor',NULL,NULL,
       'You are a Code Executor. Analyze repositories using code_analysis (cite SonarCloud metric keys), produce architecture diagrams with diagram_gen. Return findings with severity ratings and confidence. Reject confidence < 0.7.',
       '["code_analysis","diagram_gen"]'::jsonb,'{"max_retries":2,"min_confidence":0.7}'::jsonb,TRUE),
      ('tpl-code-critic','Code Critic (template)','critic',NULL,NULL,
       'You are a Code Critic. Review for missed security hotspots, false-positive severity ratings, missing architecture context. Reject confidence < 0.7 with specific file/function references.',
       '[]'::jsonb,'{"min_confidence":0.7}'::jsonb,TRUE),
      ('tpl-doc-executor','Document Executor (template)','executor',NULL,NULL,
       'You are a Document Executor. Produce formatted .docx via doc_gen; generate data visualizations with chart_gen and reference them. Source all claims. Return artifact with confidence.',
       '["doc_gen","chart_gen"]'::jsonb,'{"max_retries":2}'::jsonb,TRUE),
      ('tpl-doc-critic','Document Critic (template)','critic',NULL,NULL,
       'You are a Document Critic. Review structural completeness (exec summary, methodology, findings, recommendations), unsupported claims, chart-text alignment, branding. Reject if sections missing or claims unsourced.',
       '[]'::jsonb,'{"min_confidence":0.65}'::jsonb,TRUE),
      ('tpl-data-executor','Data Analyst Executor (template)','executor',NULL,NULL,
       'You are a Data Analyst Executor. Build Excel spreadsheets with formulas via xlsx_gen; combine datasets with aggregate_data; visualize with chart_gen. Return spreadsheet artifact with data-quality confidence.',
       '["xlsx_gen","aggregate_data","chart_gen"]'::jsonb,'{"max_retries":2}'::jsonb,TRUE),
      ('tpl-pptx-executor','Presentation Executor (template)','executor',NULL,NULL,
       'You are a Presentation Executor. Generate .pptx via pptx_gen with visuals from image_gen and charts from chart_gen. Return deck artifact with confidence and slide-count summary.',
       '["pptx_gen","image_gen","chart_gen"]'::jsonb,'{"max_retries":2}'::jsonb,TRUE),
      ('tpl-site-executor','Web Builder Executor (template)','executor',NULL,NULL,
       'You are a Web Builder Executor. Generate static sites with site_gen, interactive HTML dashboards with html_gen, audit existing sites with website_analysis. Return site artifact with confidence.',
       '["site_gen","html_gen","website_analysis"]'::jsonb,'{"max_retries":2}'::jsonb,TRUE)
    ON CONFLICT (id) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Seeded 7 domain-specialized executor + critic template agents (Phase 2)');

  // Migration: Append kb_read to the tool_allowlist of any agent that already
  // has kb_summary (researcher templates + any executor with KB access) but is
  // missing kb_read. Idempotent: the @> checks make re-runs a no-op. Covers
  // agents seeded before the kb_read tool existed (tpl-researcher was seeded
  // with '["web_search","web_extract","kb_summary"]').
  await sql`
    UPDATE agent
    SET tool_allowlist = tool_allowlist || '["kb_read"]'::jsonb
    WHERE tool_allowlist IS NOT NULL
      AND tool_allowlist @> '["kb_summary"]'::jsonb
      AND NOT (tool_allowlist @> '["kb_read"]'::jsonb)
  `.execute(database);
  console.log('[Kysely] Ensured kb_read in tool_allowlist for agents with kb_summary');

  // Migration: Append kb_search to the tool_allowlist of any agent that already
  // has kb_read but is missing kb_search. Idempotent. Completes the kb_* ladder
  // (kb_summary → kb_search → kb_read) for the Researcher agent and any
  // executor/researcher with KB access.
  await sql`
    UPDATE agent
    SET tool_allowlist = tool_allowlist || '["kb_search"]'::jsonb
    WHERE tool_allowlist IS NOT NULL
      AND tool_allowlist @> '["kb_read"]'::jsonb
      AND NOT (tool_allowlist @> '["kb_search"]'::jsonb)
  `.execute(database);
  console.log('[Kysely] Ensured kb_search in tool_allowlist for agents with kb_read');

  // Migration: Append website_analysis and load_testing to tpl-researcher.
  // Both tools are subagentSafe: true — safe addition that lets the researcher
  // audit sites during research without needing a separate executor.
  await sql`
    UPDATE agent
    SET tool_allowlist = tool_allowlist || '["website_analysis","load_testing"]'::jsonb
    WHERE id = 'tpl-researcher'
      AND NOT tool_allowlist @> '["website_analysis"]'::jsonb
  `.execute(database);
  console.log('[Kysely] Ensured website_analysis + load_testing in tpl-researcher tool_allowlist');

  // Migration: Add diagram_gen to tpl-presenter (presenter assembles deliverables;
  // diagrams are a common deliverable format).
  await sql`
    UPDATE agent
    SET tool_allowlist = tool_allowlist || '["diagram_gen"]'::jsonb
    WHERE id = 'tpl-presenter'
      AND NOT tool_allowlist @> '["diagram_gen"]'::jsonb
  `.execute(database);
  console.log('[Kysely] Ensured diagram_gen in tpl-presenter tool_allowlist');

  // Migration: Fix tpl-executor empty allowlist (currently '[]').
  // An executor with no tools forces unnecessary agent nesting:
  //   tpl-executor → agent__tpl-site-executor → html_gen
  // instead of calling html_gen/image_gen directly.
  // Idempotent: WHERE tool_allowlist @> '[]' matches only the empty array.
  await sql`
    UPDATE agent
    SET tool_allowlist = '["html_gen","image_gen","chart_gen","diagram_gen","doc_gen","pptx_gen","site_gen"]'::jsonb
    WHERE id = 'tpl-executor'
      AND tool_allowlist @> '[]'::jsonb
      AND jsonb_array_length(tool_allowlist) = 0
  `.execute(database);
  console.log('[Kysely] Fixed tpl-executor empty tool_allowlist → 7 artifact-generation tools');

  // Migration: Add dedicated tpl-html-executor for HTML ebooks/dashboards/single pages.
  // Splits from tpl-site-executor so the LLM can choose the right specialist:
  //   tpl-html-executor → html_gen + diagram_gen + chart_gen (ebooks, dashboards)
  //   tpl-site-executor → site_gen + html_gen + website_analysis + image_gen (full sites)
  // Idempotent via ON CONFLICT (id) DO NOTHING.
  await sql`
    INSERT INTO agent (id, name, role_family, category_id, model_id, system_prompt, tool_allowlist, config, enabled) VALUES
      ('tpl-html-executor','HTML Executor (template)','executor',NULL,NULL,
       'You are an HTML Executor. Generate interactive HTML dashboards and ebooks with html_gen, include diagrams via diagram_gen and charts via chart_gen. Return HTML artifact with confidence.',
       '["html_gen","diagram_gen","chart_gen"]'::jsonb,'{"max_retries":2}'::jsonb,TRUE)
    ON CONFLICT (id) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Seeded tpl-html-executor template agent (idempotent)');

  // Migration: Expand tpl-site-executor to include image_gen for site assets.
  // The allowlist was '["site_gen","html_gen","website_analysis"]' — adding image_gen
  // lets it generate site assets (hero images, icons) directly.
  // Idempotent: only appends if image_gen is not already present.
  await sql`
    UPDATE agent
    SET tool_allowlist = tool_allowlist || '["image_gen"]'::jsonb,
        system_prompt = 'You are a Web Builder Executor. Generate complete static sites with site_gen, interactive HTML pages with html_gen, audit existing sites with website_analysis, and generate images with image_gen for site assets. Return site artifact with confidence.'
    WHERE id = 'tpl-site-executor'
      AND NOT tool_allowlist @> '["image_gen"]'::jsonb
  `.execute(database);
  console.log('[Kysely] Expanded tpl-site-executor allowlist + added image_gen');

  // Seed suggested (not forced) tool-routing rules for common KB-intent keywords.
  // force_mode='suggested' → determineToolChoice returns 'auto', so the model is
  // free to call the tool but is not forced (avoids forced-tool incompatibility
  // across Anthropic/Fireworks/Gemini/thinking models). Idempotent via
  // ON CONFLICT (id) DO NOTHING with deterministic seed ids. Admins can edit or
  // delete these from the Tool Routing admin UI like any other rule.
  await sql`
    INSERT INTO tool_routing_rules (id, tool_name, rule_name, rule_type, patterns, force_mode, priority, category_ids, is_active, created_by, updated_by)
    VALUES
      ('seed-kb-search-rfp',    'kb_search',  'RFP/RFQ/proposal/tender/contract intent', 'keyword', '["rfp","rfq","proposal","tender","contract"]', 'suggested', 90, NULL, 1, 'system', 'system'),
      ('seed-kb-search-review', 'kb_search',  'Review a report/document/file',            'keyword', '["review"]',                                   'suggested', 95, NULL, 1, 'system', 'system'),
      ('seed-kb-summary-policy','kb_summary', 'Policy/manual/handbook/guideline intent',  'keyword', '["policy","manual","handbook","guideline"]',    'suggested', 90, NULL, 1, 'system', 'system'),
      ('seed-kb-summary-summ',  'kb_summary', 'Summarise a report/document/file',         'keyword', '["summarise","summarize"]',                     'suggested', 95, NULL, 1, 'system', 'system')
    ON CONFLICT (id) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Seeded suggested kb_* tool-routing rules (idempotent)');

  // model registry — capability tier column (swarm-eligibility + role assignment)
  // 'unclassified' is the conservative default: swarm-ineligible until an admin assigns a tier.
  await sql`ALTER TABLE enabled_models ADD COLUMN IF NOT EXISTS capability_tier TEXT NOT NULL DEFAULT 'unclassified'`.execute(database);
  console.log('[Kysely] Ensured enabled_models.capability_tier column exists (Phase 1)');

  // Seed capability tiers for known platform models. Tier values:
  //   'swarm_full'   — may fill any swarm role (planner/executor/critic/researcher/presenter)
  //   'swarm_limited'— may fill executor/researcher/presenter only (no planner/critic)
  //   'unclassified' — swarm-ineligible (default)
  // Only well-established tool-capable reasoning models get 'swarm_full'.
  await sql`
    UPDATE enabled_models SET capability_tier = 'swarm_full'
    WHERE id IN (
      'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini',
      'claude-3-5-sonnet-20241022', 'anthropic/claude-3-5-sonnet-20241022',
      'anthropic/claude-sonnet-4', 'anthropic/claude-opus-4',
      'fireworks/deepseek-v4-pro', 'moonshot/kimi-k2.6'
    ) AND capability_tier = 'unclassified'
  `.execute(database);
  await sql`
    UPDATE enabled_models SET capability_tier = 'swarm_limited'
    WHERE id IN (
      'gpt-4o-mini', 'gpt-4.1-mini',
      'fireworks/deepseek-v4-flash', 'mistral-medium'
    ) AND capability_tier = 'unclassified'
  `.execute(database);
  console.log('[Kysely] Seeded capability_tier for known models (Phase 1)');

  // swarm_control — kill switch, category-keyed from day one (NULL = global).
  // v1 runtime reads only the global row; per-category rows reserved for future use.
  await sql`
    CREATE TABLE IF NOT EXISTS swarm_control (
      id              TEXT PRIMARY KEY,
      category_id     INTEGER,
      swarm_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by      TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `.execute(database);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_swarm_control_category ON swarm_control(category_id)`.execute(database);
  // Seed exactly one global row: category_id NULL, swarm_enabled TRUE (ON at launch).
  await sql`
    INSERT INTO swarm_control (id, category_id, swarm_enabled)
    VALUES ('global', NULL, TRUE)
    ON CONFLICT DO NOTHING
  `.execute(database);
  console.log('[Kysely] Ensured swarm_control table + global kill-switch row exists (Phase 1)');

  // force_swarm_role_allowlist — which user roles may use the per-message Force swarm action.
  // All roles allowed by default; admins may revoke per role.
  await sql`
    CREATE TABLE IF NOT EXISTS force_swarm_role_allowlist (
      id          TEXT PRIMARY KEY,
      role        TEXT NOT NULL UNIQUE CHECK (role IN ('super_admin','admin','superuser','user')),
      allowed     BOOLEAN NOT NULL DEFAULT TRUE
    )
  `.execute(database);
  await sql`
    INSERT INTO force_swarm_role_allowlist (id, role, allowed) VALUES
      ('allow-super_admin', 'super_admin', TRUE),
      ('allow-admin',       'admin',       TRUE),
      ('allow-superuser',   'superuser',   TRUE),
      ('allow-user',        'user',        TRUE)
    ON CONFLICT (role) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Ensured force_swarm_role_allowlist table + default rows exist (Phase 1)');

  // Seed max_output_tokens for known models where it is NULL. Admin-edited values
  // are preserved (WHERE max_output_tokens IS NULL). The per-model CASE values
  // mirror the nativeProviderSpecs/fireworksSpecs seed blocks above so the two
  // never disagree. Output limits vary widely WITHIN a provider family
  // (Mistral 3K–16K, Kimi 16K–131K, MiniMax 16K–32K, Claude 8K–128K), so
  // broad provider-prefix caps would silently over- or under-allocate the
  // reasoning budget — per-model matching is required.
  await sql`
    UPDATE enabled_models SET max_output_tokens = CASE
      -- Claude adaptive-thinking (Sonnet 5, Opus 5/4.6+, Fable 5): 128K
      WHEN id LIKE 'claude-sonnet-5%' OR id LIKE 'anthropic/claude-sonnet-5%'
        OR id LIKE 'claude-opus-5%' OR id LIKE 'anthropic/claude-opus-5%'
        OR id LIKE 'claude-fable-5%' OR id LIKE 'anthropic/claude-fable-5%'
        OR id LIKE 'claude-opus-4-6%' OR id LIKE 'anthropic/claude-opus-4-6%' THEN 128000
      -- Claude Sonnet 4.6: 32K
      WHEN id LIKE 'claude-sonnet-4-6%' OR id LIKE 'anthropic/claude-sonnet-4-6%' THEN 32000
      -- Legacy Claude (3.5, 4 base, Haiku): 8K
      WHEN id LIKE 'claude%' OR id LIKE 'anthropic/claude%' THEN 8192
      -- OpenAI GPT-5.x (5, 5.4, 5.5, 5.6 Sol/Terra/Luna): 128K
      WHEN id LIKE 'gpt-5%' OR id LIKE 'openai/gpt-5%' THEN 128000
      -- GPT-4.1: 32K
      WHEN id LIKE 'gpt-4.1%' OR id LIKE 'openai/gpt-4.1%' THEN 32768
      -- GPT-4o: 16K
      WHEN id LIKE 'gpt-4o%' OR id LIKE 'openai/gpt-4o%' THEN 16384
      -- Gemini 2.5 / 3.x: 65K; legacy Gemini: 8K
      WHEN id LIKE 'gemini-3%' OR id LIKE 'gemini-2.5%' THEN 65536
      WHEN id LIKE 'gemini%' THEN 8192
      -- Mistral (output varies by tier: large=16K, medium=8K, small=3K)
      WHEN id LIKE 'mistral-large%' THEN 16000
      WHEN id LIKE 'mistral-medium-3.5%' THEN 16000
      WHEN id LIKE 'mistral-medium%' THEN 8000
      WHEN id LIKE 'mistral-small%' THEN 3000
      WHEN id LIKE 'mistral%' THEN 8000
      -- Kimi K3: 131072 (caps at 1M); K2.x: 16K; K2.7-code: 16384
      WHEN id LIKE 'moonshot/kimi-k3%' OR id LIKE 'kimi-k3%' THEN 131072
      WHEN id LIKE 'moonshot/kimi-k2.7-code%' OR id LIKE 'fireworks/kimi-k2p7-code%' THEN 16384
      WHEN id LIKE 'moonshot/kimi-k2%' OR id LIKE 'fireworks/kimi-k2%'
        OR id LIKE 'kimi-k2%' THEN 16000
      -- MiniMax M3: 32K; M2.x: 16K
      WHEN id LIKE 'fireworks/minimax-m3%' OR id LIKE 'minimax-m3%' THEN 32768
      WHEN id LIKE 'fireworks/minimax-m2%' OR id LIKE 'minimax-m2%' THEN 16384
      -- DeepSeek V4 (flash/pro): 16K
      WHEN id LIKE 'deepseek-v4%' OR id LIKE 'fireworks/deepseek-v4%'
        OR id LIKE 'deepseek/deepseek-v4%' THEN 16384
      WHEN id LIKE 'deepseek%' THEN 8000
      -- Fireworks hosted (glm, qwen3p7, gpt-oss, nemotron): 16K common cap
      WHEN id LIKE 'fireworks/%' THEN 16384
      -- Ollama (local, small models): 8K
      WHEN id LIKE 'ollama%' THEN 8000
      ELSE 16000
    END
    WHERE max_output_tokens IS NULL
  `.execute(database);
  console.log('[Kysely] Seeded max_output_tokens for known models (NULL rows only)');

  // Migration: Comprehensive model spec sync (July 2026) — pricing, capabilities, context windows
  // Covers all 25 currently enabled models. Uses idempotent UPDATEs safe for re-run.
  const comprehensiveModelSpecs: Array<{
    id: string;
    max_input_tokens: number;
    max_output_tokens: number;
    vision_capable: number;
    parallel_tool_capable: number;
    thinking_capable: number;
    forced_tool_capable: number;
    input_cost_per_1m: number;
    output_cost_per_1m: number;
  }> = [
    // === Fireworks AI — Serverless Chat Models ===
    { id: 'fireworks/minimax-m3', max_input_tokens: 512000, max_output_tokens: 32768, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.30, output_cost_per_1m: 1.20 },
    { id: 'fireworks/glm-5p2', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 1.40, output_cost_per_1m: 4.40 },
    { id: 'fireworks/glm-5p1', max_input_tokens: 202752, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 1.40, output_cost_per_1m: 4.40 },
    { id: 'fireworks/kimi-k2p7-code', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.95, output_cost_per_1m: 4.00 },
    { id: 'fireworks/kimi-k2p6', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.95, output_cost_per_1m: 4.00 },
    { id: 'fireworks/kimi-k2p5', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.60, output_cost_per_1m: 3.00 },
    { id: 'fireworks/qwen3p7-plus', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.40, output_cost_per_1m: 1.60 },
    { id: 'fireworks/minimax-m2p7', max_input_tokens: 196608, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 0.30, output_cost_per_1m: 1.20 },
    { id: 'fireworks/minimax-m2p5', max_input_tokens: 196608, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 0.30, output_cost_per_1m: 1.20 },
    { id: 'fireworks/gpt-oss-120b', max_input_tokens: 131072, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 0, input_cost_per_1m: 0.15, output_cost_per_1m: 0.60 },
    { id: 'fireworks/gpt-oss-20b', max_input_tokens: 131072, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 0, input_cost_per_1m: 0.07, output_cost_per_1m: 0.30 },
    { id: 'fireworks/deepseek-v4-flash', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.14, output_cost_per_1m: 0.28 },
    { id: 'fireworks/deepseek-v4-pro', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 1.74, output_cost_per_1m: 3.48 },
    { id: 'fireworks/nemotron-3-ultra-nvfp4', max_input_tokens: 262144, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 0.60, output_cost_per_1m: 2.40 },
    // === DeepSeek Native API ===
    { id: 'deepseek-v4-flash', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.14, output_cost_per_1m: 0.28 },
    { id: 'deepseek-v4-pro', max_input_tokens: 1048576, max_output_tokens: 16384, vision_capable: 0, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.435, output_cost_per_1m: 0.87 },
    // === OpenAI GPT-5.6 Family ===
    { id: 'gpt-5.6-luna', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 1.00, output_cost_per_1m: 6.00 },
    { id: 'gpt-5.6-terra', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 2.50, output_cost_per_1m: 15.00 },
    { id: 'gpt-5.6-sol', max_input_tokens: 1050000, max_output_tokens: 128000, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 5.00, output_cost_per_1m: 30.00 },
    // === Google Gemini ===
    { id: 'gemini-3.6-flash', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 1.50, output_cost_per_1m: 7.50 },
    { id: 'gemini-3.5-flash', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 1.50, output_cost_per_1m: 9.00 },
    { id: 'gemini-3.5-flash-lite', max_input_tokens: 1048576, max_output_tokens: 65536, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 1, forced_tool_capable: 1, input_cost_per_1m: 0.30, output_cost_per_1m: 2.50 },
    // === Mistral AI ===
    { id: 'mistral-medium-3-5', max_input_tokens: 256000, max_output_tokens: 16000, vision_capable: 0, parallel_tool_capable: 0, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 1.50, output_cost_per_1m: 7.50 },
    { id: 'mistral-medium-3.5', max_input_tokens: 256000, max_output_tokens: 16000, vision_capable: 0, parallel_tool_capable: 0, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 1.50, output_cost_per_1m: 7.50 },
    { id: 'mistral-large-2512', max_input_tokens: 262144, max_output_tokens: 16000, vision_capable: 1, parallel_tool_capable: 1, thinking_capable: 0, forced_tool_capable: 1, input_cost_per_1m: 0.50, output_cost_per_1m: 1.50 },
  ];
  for (const m of comprehensiveModelSpecs) {
    await sql`
      UPDATE enabled_models
      SET
        max_input_tokens = ${m.max_input_tokens},
        max_output_tokens = ${m.max_output_tokens},
        vision_capable = ${m.vision_capable},
        tool_capable = 1,
        parallel_tool_capable = ${m.parallel_tool_capable},
        thinking_capable = ${m.thinking_capable},
        forced_tool_capable = ${m.forced_tool_capable},
        input_cost_per_1m = ${m.input_cost_per_1m},
        output_cost_per_1m = ${m.output_cost_per_1m}
      WHERE id = ${m.id}
    `.execute(database);
  }
  console.log('[Kysely] Synced comprehensive model specs for all 25 enabled models (July 2026)');

  // Browser sessions (remote browser sidecar). Records persist the checkpoint
  // state machine; the live Playwright context lives only in the worker.
  await sql`
    CREATE TABLE IF NOT EXISTS browser_sessions (
      id                 TEXT PRIMARY KEY,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      thread_id          TEXT,
      task               TEXT,
      worker_session_id  TEXT,
      state              TEXT NOT NULL DEFAULT 'created',
      current_url        TEXT,
      page_title         TEXT,
      pending_checkpoint TEXT,
      last_aria_json     TEXT,
      allowlist_json     TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at         TIMESTAMPTZ,
      terminated_at      TIMESTAMPTZ
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS browser_sessions_user_id_idx ON browser_sessions (user_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS browser_sessions_thread_id_idx ON browser_sessions (thread_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS browser_sessions_expires_at_idx ON browser_sessions (expires_at)`.execute(database);
  // Backfill for databases where the table pre-existed before the `task` column.
  await sql`ALTER TABLE browser_sessions ADD COLUMN IF NOT EXISTS task TEXT`.execute(database);
  console.log('[Kysely] Ensured browser_sessions table + indexes exist');

  // ===================================================================
  // AI & API Setup Redesign — Phase A: Additive Schema
  // (see plans/AI_API_Setup_Redesign_Implementation_Plan.md §10, §12.3)
  //
  // Additive only: nine empty registry/tenancy tables plus nullable
  // `organization_id` columns on workspaces and token_usage_log. No data is
  // backfilled here and no runtime behavior changes — `org-tenancy-enabled`
  // is seeded off. NOT NULL enforcement is deferred to Phase B.
  // ===================================================================

  // Organizations — tenant model (Decision 1/2/4).
  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'ENTITY' CHECK (type IN ('DEFAULT', 'ENTITY', 'INDIVIDUAL')),
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      credential_mode TEXT NOT NULL DEFAULT 'PLATFORM_MANAGED' CHECK (credential_mode IN ('PLATFORM_MANAGED', 'ORGANIZATION_BYOK')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'suspended')),
      isolation_mode TEXT NOT NULL DEFAULT 'SOFT' CHECK (isolation_mode IN ('SOFT', 'HARD')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(database);
  // Single-Default invariant: at most one organization may be the default.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS organizations_single_default_idx ON organizations (is_default) WHERE is_default = TRUE`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status)`.execute(database);
  // Additive lifecycle state: allow archiving an organization instead of
  // deleting it. The inline CHECK was created without 'archived', so drop and
  // re-create the constraint to include it.
  await sql`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_status_check`.execute(database);
  await sql`ALTER TABLE organizations ADD CONSTRAINT organizations_status_check CHECK (status IN ('active', 'disabled', 'suspended', 'archived'))`.execute(database);
  console.log('[Kysely] Ensured organizations table exists (Phase A)');

  // Organization memberships — user → organization (role: org_admin|member).
  await sql`
    CREATE TABLE IF NOT EXISTS organization_memberships (
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('org_admin', 'member')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, user_id)
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_organization_memberships_user ON organization_memberships(user_id)`.execute(database);
  console.log('[Kysely] Ensured organization_memberships table exists (Phase A)');

  // Server-side provider capability registry (Decision 4) — single source of truth.
  await sql`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled)`.execute(database);
  console.log('[Kysely] Ensured providers table exists (Phase A)');

  await sql`
    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      importance TEXT NOT NULL DEFAULT 'OPTIONAL' CHECK (importance IN ('REQUIRED', 'RECOMMENDED', 'OPTIONAL')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_capabilities_importance ON capabilities(importance)`.execute(database);
  console.log('[Kysely] Ensured capabilities table exists (Phase A)');

  await sql`
    CREATE TABLE IF NOT EXISTS provider_capabilities (
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      is_supported BOOLEAN NOT NULL DEFAULT TRUE,
      model_or_service_ids JSONB,
      selection_mode TEXT NOT NULL DEFAULT 'none' CHECK (selection_mode IN ('none', 'model', 'service')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider_id, capability_id)
    )
  `.execute(database);
  await sql`
    ALTER TABLE provider_capabilities
    ADD COLUMN IF NOT EXISTS selection_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (selection_mode IN ('none', 'model', 'service'))
  `.execute(database);

  await sql`CREATE INDEX IF NOT EXISTS idx_provider_capabilities_capability ON provider_capabilities(capability_id)`.execute(database);
  console.log('[Kysely] Ensured provider_capabilities table exists (Phase A)');

  // Seed the complete compiled registry on every startup. The operation is
  // idempotent and repairs deployments where Phase B inserted provider and
  // capability references but no provider_capabilities mappings.
  const { seedProviderRegistry } = await import('../provider-registry');
  const seededRegistry = await seedProviderRegistry(database);
  console.log(
    `[Kysely] Seeded provider registry (${seededRegistry.providers.length} providers, ` +
      `${seededRegistry.capabilities.length} capabilities, ` +
      `${seededRegistry.providerCapabilities.length} mappings)`
  );

  // Platform-level credentials (env-sourced, read-only from the browser).
  await sql`
    CREATE TABLE IF NOT EXISTS platform_provider_credentials (
      provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
      secret_ref TEXT NOT NULL,
      kek_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      credential_version INTEGER NOT NULL DEFAULT 1,
      last_verified_at TIMESTAMPTZ,
      last_verification_attempt_at TIMESTAMPTZ,
      last_verification_status TEXT,
      last_verification_http_status INTEGER,
      last_verification_error_code TEXT,
      verified_source_fingerprint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(database);
  await sql`ALTER TABLE platform_provider_credentials ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1`.execute(database);
  await sql`ALTER TABLE platform_provider_credentials ADD COLUMN IF NOT EXISTS last_verification_attempt_at TIMESTAMPTZ`.execute(database);
  await sql`ALTER TABLE platform_provider_credentials ADD COLUMN IF NOT EXISTS last_verification_status TEXT`.execute(database);
  await sql`ALTER TABLE platform_provider_credentials ADD COLUMN IF NOT EXISTS last_verification_http_status INTEGER`.execute(database);
  await sql`ALTER TABLE platform_provider_credentials ADD COLUMN IF NOT EXISTS last_verification_error_code TEXT`.execute(database);
  await sql`ALTER TABLE platform_provider_credentials ADD COLUMN IF NOT EXISTS verified_source_fingerprint TEXT`.execute(database);
  console.log('[Kysely] Ensured platform_provider_credentials table exists (Phase A)');

  // Organization-scoped credentials (BYOK). `credential_id` is the stable
  // external identifier; `id` is the row PK. The composite unique constraint
  // allows multiple keys per (organization, provider).
  await sql`
    CREATE TABLE IF NOT EXISTS organization_provider_credentials (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL,
      secret_ciphertext TEXT NOT NULL,
      dek_wrapped TEXT NOT NULL,
      kek_version INTEGER NOT NULL DEFAULT 1,
      aad TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      last_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, provider_id, credential_id)
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_org_provider_creds_org ON organization_provider_credentials(organization_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_org_provider_creds_provider ON organization_provider_credentials(provider_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_org_provider_creds_credential ON organization_provider_credentials(credential_id)`.execute(database);
  console.log('[Kysely] Ensured organization_provider_credentials table exists (Phase A)');

  // Per-organization capability → provider/credential/model configuration.
  await sql`
    CREATE TABLE IF NOT EXISTS organization_capability_config (
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      credential_id TEXT,
      model_or_service_id TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, capability_id)
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_org_capability_config_provider ON organization_capability_config(provider_id)`.execute(database);
  console.log('[Kysely] Ensured organization_capability_config table exists (Phase A)');

  // Credential audit log (Decision 11) — written by the vault service on mutation.
  await sql`
    CREATE TABLE IF NOT EXISTS credential_audit_log (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      credential_id TEXT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'replaced', 'disabled', 'enabled', 'tested', 'rotated')),
      redacted_detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_credential_audit_log_org ON credential_audit_log(organization_id, created_at DESC)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_credential_audit_log_provider ON credential_audit_log(provider_id, created_at DESC)`.execute(database);
  console.log('[Kysely] Ensured credential_audit_log table exists (Phase A)');

  // Reconcile legacy duplicate active keys before enforcing the runtime invariant.
  // The newest explicit default wins; superseded rows remain as disabled history.
  await sql`WITH ranked AS (SELECT id, organization_id, provider_id, credential_id, ROW_NUMBER() OVER (PARTITION BY organization_id, provider_id ORDER BY is_default DESC, updated_at DESC, id DESC) AS rn FROM organization_provider_credentials WHERE status = 'active') INSERT INTO credential_audit_log (organization_id, provider_id, credential_id, actor_user_id, action, redacted_detail) SELECT organization_id, provider_id, credential_id, NULL, 'disabled', 'Automatically disabled during single-active credential reconciliation' FROM ranked WHERE rn > 1`.execute(database);
  await sql`WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id, provider_id ORDER BY is_default DESC, updated_at DESC, id DESC) AS rn FROM organization_provider_credentials WHERE status = 'active') UPDATE organization_provider_credentials AS credential SET status = 'disabled', is_default = FALSE FROM ranked WHERE credential.id = ranked.id AND ranked.rn > 1`.execute(database);
  await sql`UPDATE organization_provider_credentials SET is_default = FALSE WHERE status = 'disabled' AND is_default = TRUE`.execute(database);
  await sql`UPDATE organization_provider_credentials SET is_default = TRUE WHERE status = 'active' AND is_default = FALSE`.execute(database);
  await sql`UPDATE organization_capability_config AS config SET credential_id = active.credential_id FROM organization_provider_credentials AS active WHERE config.organization_id = active.organization_id AND config.provider_id = active.provider_id AND active.status = 'active' AND config.credential_id IS NOT NULL AND config.credential_id <> active.credential_id`.execute(database);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_provider_creds_single_active ON organization_provider_credentials(organization_id, provider_id) WHERE status = 'active'`.execute(database);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_provider_creds_single_default ON organization_provider_credentials(organization_id, provider_id) WHERE is_default = TRUE`.execute(database);
  console.log('[Kysely] Reconciled and enforced one active organization credential per provider');

  // Nullable organization_id on workspaces (Decision 1). NOT NULL is deferred
  // to Phase B after backfill. FK lands in the PostgreSQL schema only; the
  // legacy SQLite workspaces module is frozen.
  await sql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS organization_id INTEGER`.execute(database);
  await sql`ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_organization_id_fkey`.execute(database);
  await sql`ALTER TABLE workspaces ADD CONSTRAINT workspaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_workspaces_organization_id ON workspaces(organization_id)`.execute(database);
  console.log('[Kysely] Ensured workspaces.organization_id column + FK exist (Phase A)');

  // Nullable organization_id on the usage event table. This repository's usage
  // table is `token_usage_log` (see compat/token-usage.ts); the plan refers to
  // it conceptually as `usage_events`. NOT NULL + backfill deferred to Phase B.
  await sql`ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS organization_id INTEGER`.execute(database);
  await sql`ALTER TABLE token_usage_log DROP CONSTRAINT IF EXISTS token_usage_log_organization_id_fkey`.execute(database);
  await sql`ALTER TABLE token_usage_log ADD CONSTRAINT token_usage_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_token_usage_log_organization ON token_usage_log(organization_id)`.execute(database);
  console.log('[Kysely] Ensured token_usage_log.organization_id column + FK exist (Phase A)');

  // Category → organization tagging (admin categories menu). Nullable with FK to
  // organizations; existing categories are backfilled to the DEFAULT org so the
  // legacy category list remains visible after the org-tenancy migration.
  await sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS organization_id INTEGER`.execute(database);
  await sql`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_organization_id_fkey`.execute(database);
  await sql`ALTER TABLE categories ADD CONSTRAINT categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL`.execute(database);
  await sql`UPDATE categories SET organization_id = (SELECT id FROM organizations WHERE is_default = TRUE LIMIT 1) WHERE organization_id IS NULL`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_categories_organization ON categories(organization_id)`.execute(database);
  console.log('[Kysely] Ensured categories.organization_id column + FK exist (org tagging)');

  // Active organization selection (multi-org representation). Nullable FK lets a
  // user (including super_admin) switch which organization they are representing
  // in chats; the runtime resolver validates the selection against membership.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_organization_id INTEGER`.execute(database);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_active_organization_id_fkey`.execute(database);
  await sql`ALTER TABLE users ADD CONSTRAINT users_active_organization_id_fkey FOREIGN KEY (active_organization_id) REFERENCES organizations(id) ON DELETE SET NULL`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_active_organization ON users(active_organization_id)`.execute(database);
  console.log('[Kysely] Ensured users.active_organization_id column + FK exist (active org)');

  // Phase E (AI & API Setup Redesign, plan §9/§12.3): `credential_id` links a
  // usage row to the vault-stored credential that served the request. It is
  // nullable text (the vault credential_id is a string, not the row PK) and is
  // stamped by the token logger alongside organization_id. No FK to
  // organization_provider_credentials because a credential may be replaced or
  // disabled after the row is written and usage rows must be immutable history.
  await sql`ALTER TABLE token_usage_log ADD COLUMN IF NOT EXISTS credential_id TEXT`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_token_usage_log_credential ON token_usage_log(credential_id)`.execute(database);
  console.log('[Kysely] Ensured token_usage_log.credential_id column + index exist (Phase E)');

  // Seed `org-tenancy-enabled` = true (Phase D). ON CONFLICT DO NOTHING
  // preserves any explicit value an operator may have set; the flag defaults on
  // from Phase D onward.
  await sql`
    INSERT INTO settings (key, value, updated_by)
    VALUES ('org-tenancy-enabled', 'true', 'system')
    ON CONFLICT (key) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Ensured org-tenancy-enabled setting exists (default on)');

  // ===================================================================
  // AI & API Setup Redesign — Phase B: Backfill + Vault
  // (see plans/AI_API_Setup_Redesign_Implementation_Plan.md §6, §12.3, §17)
  //
  // Adds the `credential_version` column that Phase A deferred (§7/§10) plus a
  // PostgreSQL trigger that increments it on every key mutation. The trigger is
  // the backstop for ad-hoc SQL and backup restores; the application write path
  // (src/lib/credential-vault.ts) also increments it explicitly, and the trigger
  // only bumps when no explicit bump was made, so the two never double-count.
  // The trigger also refreshes `updated_at` on every row change.
  // ===================================================================

  await sql`ALTER TABLE organization_provider_credentials ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1`.execute(database);
  console.log('[Kysely] Ensured organization_provider_credentials.credential_version column exists (Phase B)');

  await sql`
    CREATE OR REPLACE FUNCTION bump_org_credential_version()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.credential_version = OLD.credential_version THEN
        NEW.credential_version := OLD.credential_version + 1;
      END IF;
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_bump_org_credential_version ON organization_provider_credentials`.execute(database);
  await sql`
    CREATE TRIGGER trg_bump_org_credential_version
    BEFORE UPDATE ON organization_provider_credentials
    FOR EACH ROW EXECUTE FUNCTION bump_org_credential_version()
  `.execute(database);
  console.log('[Kysely] Ensured credential_version bump trigger exists (Phase B)');

  // Platform secrets remain in `llm_providers`; the platform credential table
  // is source metadata. Bump its revision after a key/base mutation so every
  // provider client cache gets a new identity rather than reusing version 0.
  await sql`
    CREATE OR REPLACE FUNCTION bump_platform_credential_version()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO platform_provider_credentials (
        provider_id, secret_ref, kek_version, status, credential_version, updated_at
      ) VALUES (
        NEW.id, 'llm_providers:' || NEW.id, 1, 'active', 1, NOW()
      )
      ON CONFLICT (provider_id) DO UPDATE
      SET credential_version = platform_provider_credentials.credential_version + 1,
          secret_ref = 'llm_providers:' || NEW.id,
          updated_at = NOW(),
          last_verified_at = NULL,
          last_verification_attempt_at = NULL,
          last_verification_status = NULL,
          last_verification_http_status = NULL,
          last_verification_error_code = NULL,
          verified_source_fingerprint = NULL;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_bump_platform_credential_version ON llm_providers`.execute(database);
  await sql`
    CREATE TRIGGER trg_bump_platform_credential_version
    AFTER UPDATE OF api_key, api_base ON llm_providers
    FOR EACH ROW
    WHEN (OLD.api_key IS DISTINCT FROM NEW.api_key OR OLD.api_base IS DISTINCT FROM NEW.api_base)
    EXECUTE FUNCTION bump_platform_credential_version()
  `.execute(database);
  console.log('[Kysely] Ensured platform credential revision trigger exists');

  // Seed `org-credential-resolver-enabled` = true (Phase D). ON CONFLICT DO
  // NOTHING preserves any explicit value; the flag defaults on from Phase D.
  await sql`
    INSERT INTO settings (key, value, updated_by)
    VALUES ('org-credential-resolver-enabled', 'true', 'system')
    ON CONFLICT (key) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Ensured org-credential-resolver-enabled setting exists (default on)');

  // Seed `vector-tenancy-enabled` = true (Phase D). Absent keys already resolve
  // to false in readFeatureFlagCombinations(); seeding it makes the ON default
  // explicit and discoverable in the settings table.
  await sql`
    INSERT INTO settings (key, value, updated_by)
    VALUES ('vector-tenancy-enabled', 'true', 'system')
    ON CONFLICT (key) DO NOTHING
  `.execute(database);
  console.log('[Kysely] Ensured vector-tenancy-enabled setting exists (default on)');

  // ===================================================================
  // AI & API Setup Redesign — Phase D: Resolver Switch (plan §12.3).
  //
  // One-time flip of the three Phase D flags for deployments that already
  // seeded them OFF in Phases A/C. A marker key gates the UPDATE so it runs
  // exactly once — afterwards an operator can set any flag back to 'false' to
  // roll the phase back without the boot path re-flipping it.
  // ===================================================================
  await sql`
    UPDATE settings
    SET value = 'true', updated_by = 'system'
    WHERE key IN ('org-tenancy-enabled', 'org-credential-resolver-enabled', 'vector-tenancy-enabled')
      AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'phase-d-resolver-switch-applied')
  `.execute(database);
  await sql`
    INSERT INTO settings (key, value, updated_by)
    SELECT 'phase-d-resolver-switch-applied', 'true', 'system'
    WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'phase-d-resolver-switch-applied')
  `.execute(database);
  console.log('[Kysely] Applied one-time Phase D resolver-switch flag flip');

  // ===================================================================
  // AI & API Setup Redesign — Phase E: Enable BYOK (plan §12.3).
  //
  // Flip `ai-api-setup-ui-enabled` = true (consolidated AI & API Setup page).
  // The flag has no dependency on the other three (plan §17), but is flipped in
  // a one-time, marker-gated UPDATE so an operator can set it back to 'false'
  // without the boot path re-flipping it. The key is seeded ON for fresh
  // installs; the UPDATE turns ON deployments that seeded it OFF earlier.
  // ===================================================================
  await sql`
    INSERT INTO settings (key, value, updated_by)
    VALUES ('ai-api-setup-ui-enabled', 'true', 'system')
    ON CONFLICT (key) DO NOTHING
  `.execute(database);
  await sql`
    UPDATE settings
    SET value = 'true', updated_by = 'system'
    WHERE key = 'ai-api-setup-ui-enabled'
      AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'phase-e-ai-setup-ui-applied')
  `.execute(database);
  await sql`
    INSERT INTO settings (key, value, updated_by)
    SELECT 'phase-e-ai-setup-ui-applied', 'true', 'system'
    WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'phase-e-ai-setup-ui-applied')
  `.execute(database);
  console.log('[Kysely] Applied one-time Phase E AI & API Setup UI flag flip');

  // Startup assertion: reject invalid feature-flag orderings (plan §17).
  // Phase D turns on org-tenancy + credential resolver + vector tenancy, which
  // is a valid combination; this guards invalid orderings (e.g. vector-tenancy
  // without org-tenancy).
  try {
    const flagCombinations = await readFeatureFlagCombinations(database);
    assertFeatureFlagCombinations(flagCombinations);
  } catch (error) {
    console.error('[Kysely] Feature flag combination assertion failed:', error);
    throw error;
  }

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
