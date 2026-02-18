#!/usr/bin/env node
/**
 * Database Setup Script
 *
 * Usage: npm run db:setup
 *
 * This script:
 * 1. Detects the DATABASE_PROVIDER from environment
 * 2. Creates the database schema
 * 3. Initializes default settings
 *
 * For PostgreSQL, ensure DATABASE_URL is set.
 * For SQLite, uses SQLITE_DB_PATH or default location.
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import Database from 'better-sqlite3';

// Load environment variables
config();

// Default settings to initialize
const DEFAULT_SETTINGS: Record<string, object> = {
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
    allowedTypes: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'application/json',
    ],
  },
  'acronym-mappings': {},
  'system-prompt': {
    content: `You are a helpful assistant that answers questions based on the provided knowledge base documents.

Guidelines:
- Only answer questions using information from the provided context
- If the information is not in the context, say so clearly
- Always cite your sources with document names and page numbers
- Use markdown formatting for better readability
- Be concise but thorough`,
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

// Agent budget settings
const AGENT_BUDGET_SETTINGS = [
  { key: 'agent_budget_max_llm_calls', value: '500' },
  { key: 'agent_budget_max_tokens', value: '2000000' },
  { key: 'agent_budget_max_web_searches', value: '100' },
  { key: 'agent_confidence_threshold', value: '80' },
  { key: 'agent_budget_max_duration_minutes', value: '30' },
  { key: 'agent_task_timeout_minutes', value: '5' },
];

async function setupPostgres(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL setup');
  }

  console.log('[Setup] Connecting to PostgreSQL...');
  const pool = new Pool({ connectionString });

  try {
    // Read and execute the PostgreSQL schema
    const schemaPath = path.join(__dirname, 'schema', 'postgres.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`PostgreSQL schema not found at ${schemaPath}`);
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');
    console.log('[Setup] Executing PostgreSQL schema...');
    await pool.query(schema);
    console.log('[Setup] Schema created successfully');

    // Initialize default settings
    console.log('[Setup] Initializing default settings...');
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_by)
         VALUES ($1, $2, 'system')
         ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)]
      );
    }

    // Initialize agent budget settings
    for (const setting of AGENT_BUDGET_SETTINGS) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_by)
         VALUES ($1, $2, 'system')
         ON CONFLICT (key) DO NOTHING`,
        [setting.key, setting.value]
      );
    }

    console.log('[Setup] Default settings initialized');

    // Verify tables
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`[Setup] Created ${result.rows.length} tables:`);
    result.rows.forEach((row) => console.log(`  - ${row.table_name}`));
  } finally {
    await pool.end();
  }
}

function setupSqlite(): void {
  const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const DB_PATH =
    process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'policybot.db');

  // Ensure data directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Check if database already exists
  const dbExists = fs.existsSync(DB_PATH);
  if (dbExists) {
    console.log(`[Setup] SQLite database already exists at ${DB_PATH}`);
    console.log('[Setup] The application will run migrations automatically on startup');
    console.log('[Setup] If you want to recreate the database, delete the file first');
    return;
  }

  console.log(`[Setup] Creating SQLite database at ${DB_PATH}...`);
  const db = new Database(DB_PATH);

  try {
    // Enable foreign keys and WAL mode
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    // Read and execute the SQLite schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      // Try alternate location
      const altPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
      if (!fs.existsSync(altPath)) {
        throw new Error(`SQLite schema not found at ${schemaPath} or ${altPath}`);
      }
      const schema = fs.readFileSync(altPath, 'utf-8');
      console.log('[Setup] Executing SQLite schema...');
      db.exec(schema);
    } else {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      console.log('[Setup] Executing SQLite schema...');
      db.exec(schema);
    }

    console.log('[Setup] Schema created successfully');

    // Initialize default settings
    console.log('[Setup] Initializing default settings...');
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, updated_by)
      VALUES (?, ?, 'system')
    `);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertStmt.run(key, JSON.stringify(value));
    }

    // Initialize agent budget settings
    for (const setting of AGENT_BUDGET_SETTINGS) {
      insertStmt.run(setting.key, setting.value);
    }

    console.log('[Setup] Default settings initialized');

    // Verify tables
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    console.log(`[Setup] Created ${tables.length} tables:`);
    tables.forEach((t) => console.log(`  - ${t.name}`));
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';

  console.log('='.repeat(50));
  console.log('Policy Bot Database Setup');
  console.log('='.repeat(50));
  console.log(`Provider: ${provider}`);
  console.log('');

  try {
    if (provider === 'postgres') {
      await setupPostgres();
    } else {
      setupSqlite();
    }

    console.log('');
    console.log('='.repeat(50));
    console.log('Setup completed successfully!');
    console.log('='.repeat(50));
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run `npm run db:types` to generate TypeScript types');
    console.log('  2. Start the application with `npm run dev`');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('='.repeat(50));
    console.error('Setup failed!');
    console.error('='.repeat(50));
    console.error(error);
    process.exit(1);
  }
}

main();
