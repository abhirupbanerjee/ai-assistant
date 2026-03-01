/**
 * Kysely Database Instance Factory
 *
 * Provides a single Kysely instance that works with both SQLite and PostgreSQL.
 * The dialect is determined by DATABASE_PROVIDER environment variable.
 *
 * Usage:
 *   import { getDb } from '@/lib/db/kysely';
 *   const db = await getDb();
 *   const users = await db.selectFrom('users').selectAll().execute();
 */

import { Kysely, SqliteDialect, PostgresDialect, sql } from 'kysely';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import type { DB } from './db-types';

// Database provider type
export type DatabaseProvider = 'sqlite' | 'postgres';

// Singleton instance
let db: Kysely<DB> | null = null;
let currentProvider: DatabaseProvider | null = null;

/**
 * Get the current database provider from environment
 */
export function getDatabaseProvider(): DatabaseProvider {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';
  if (provider !== 'sqlite' && provider !== 'postgres') {
    console.warn(`[Kysely] Unknown DATABASE_PROVIDER "${provider}", defaulting to sqlite`);
    return 'sqlite';
  }
  return provider;
}

/**
 * Run SQLite migrations for the Kysely path
 * Mirrors critical migrations from index.ts for threads table
 */
function runSqliteMigrations(database: Database.Database): void {
  // Safety check: ensure threads table exists before migrating
  const tableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='threads'"
  ).get();
  if (!tableExists) {
    // Schema not initialized yet - skip migrations
    return;
  }

  const threadsColumns = database.pragma('table_info(threads)') as { name: string }[];
  const columnNames = threadsColumns.map((c) => c.name);

  if (!columnNames.includes('is_summarized')) {
    database.exec('ALTER TABLE threads ADD COLUMN is_summarized INTEGER DEFAULT 0');
  }
  if (!columnNames.includes('total_tokens')) {
    database.exec('ALTER TABLE threads ADD COLUMN total_tokens INTEGER DEFAULT 0');
  }
  if (!columnNames.includes('is_pinned')) {
    database.exec('ALTER TABLE threads ADD COLUMN is_pinned INTEGER DEFAULT 0');
    database.exec('CREATE INDEX IF NOT EXISTS idx_threads_pinned ON threads(is_pinned, updated_at DESC)');
  }
  if (!columnNames.includes('selected_model')) {
    database.exec('ALTER TABLE threads ADD COLUMN selected_model TEXT');
    database.exec('CREATE INDEX IF NOT EXISTS idx_threads_selected_model ON threads(selected_model)');
  }
  console.log('[Kysely SQLite] Thread migrations completed');
}

/**
 * Get or create the Kysely database instance
 */
export async function getDb(): Promise<Kysely<DB>> {
  if (db) return db;

  const provider = getDatabaseProvider();
  currentProvider = provider;

  if (provider === 'postgres') {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        '[Kysely] DATABASE_URL is required when DATABASE_PROVIDER=postgres'
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
  } else {
    // SQLite
    const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const DB_PATH =
      process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'policybot.db');

    // Ensure data directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.log('[Kysely] Initializing SQLite connection...');
    const sqliteDb = new Database(DB_PATH);

    // Enable foreign keys and WAL mode
    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');

    // Run SQLite migrations for thread columns
    runSqliteMigrations(sqliteDb);

    db = new Kysely<DB>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });
  }

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

  console.log('[Kysely] PostgreSQL migrations completed');
}

/**
 * Get the current provider (after initialization)
 */
export function getCurrentProvider(): DatabaseProvider | null {
  return currentProvider;
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
    currentProvider = null;
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
