#!/bin/bash
# =============================================================================
# SQLite → PostgreSQL Data Import Script
#
# Imports CSV files exported from SQLite into an existing PostgreSQL database.
# Assumes Postgres schema already exists (via schema/postgres.sql + Kysely migrations).
#
# Usage:
#   ./scripts/postgres-import.sh [CSV_DIR] [DATABASE_URL]
#
# Example:
#   ./scripts/postgres-import.sh ./sqlite_export "postgresql://policybot:pass@localhost:5432/policybot"
#
# Prerequisites:
#   - psql installed
#   - Postgres schema already created (docker-compose up postgres, or run schema/postgres.sql)
#   - CSV files from sqlite-export.sh in CSV_DIR
# =============================================================================

set -uo pipefail
# Note: not using -e because TRUNCATE of tables that may not exist
# should not abort the entire script. Errors are handled per-step.

# --- Configuration ---
CSV_DIR="${1:-./sqlite_export}"
DATABASE_URL="${2:-${DATABASE_URL:-}}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not provided."
  echo "Usage: $0 [CSV_DIR] [DATABASE_URL]"
  echo "   or: DATABASE_URL=... $0 [CSV_DIR]"
  exit 1
fi

if [ ! -d "$CSV_DIR" ]; then
  echo "ERROR: CSV directory not found: $CSV_DIR"
  exit 1
fi

echo "================================================"
echo "  SQLite → PostgreSQL Import"
echo "================================================"
echo "CSV directory: $CSV_DIR"
echo ""

# --- Helper: import a CSV if it exists and has data ---
import_table() {
  local table="$1"
  local csv_file="$CSV_DIR/${2:-$table}.csv"
  local columns="${3:-}"  # optional explicit column list

  if [ ! -f "$csv_file" ]; then
    echo "  SKIP $table (no CSV file)"
    return 0
  fi

  local line_count
  line_count=$(wc -l < "$csv_file")
  if [ "$line_count" -le 1 ]; then
    echo "  SKIP $table (0 rows)"
    return 0
  fi

  local row_count=$((line_count - 1))

  # Auto-detect column list from CSV header to handle column order mismatches
  if [ -z "$columns" ]; then
    columns=$(head -1 "$csv_file" | tr -d '\r')
  fi

  local rc=0
  psql "$DATABASE_URL" -q -c "\copy $table($columns) FROM '$csv_file' CSV HEADER" 2>/tmp/pg_import_err || rc=$?

  if [ $rc -eq 0 ]; then
    echo "  OK   $table ($row_count rows)"
  else
    echo "  FAIL $table — $(cat /tmp/pg_import_err)"
    return 1
  fi
}

# --- Helper: import CSV with deduplication (for tables with unique constraints) ---
import_table_dedup() {
  local table="$1"
  local unique_col="$2"
  local csv_file="$CSV_DIR/$table.csv"

  if [ ! -f "$csv_file" ]; then
    echo "  SKIP $table (no CSV file)"
    return 0
  fi

  local line_count
  line_count=$(wc -l < "$csv_file")
  if [ "$line_count" -le 1 ]; then
    echo "  SKIP $table (0 rows)"
    return 0
  fi

  local columns
  columns=$(head -1 "$csv_file" | tr -d '\r')

  # Import into a temp table, then INSERT ... ON CONFLICT to keep latest row
  local rc=0
  psql "$DATABASE_URL" -q <<EOSQL 2>/tmp/pg_import_err || rc=$?
    CREATE TEMP TABLE _staging (LIKE $table INCLUDING DEFAULTS);
    \copy _staging($columns) FROM '$csv_file' CSV HEADER
    INSERT INTO $table($columns)
    SELECT DISTINCT ON ($unique_col) $columns FROM _staging
    ORDER BY $unique_col, updated_at DESC
    ON CONFLICT ($unique_col) DO NOTHING;
    DROP TABLE _staging;
EOSQL

  if [ $rc -eq 0 ]; then
    local imported
    imported=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM $table")
    echo "  OK   $table ($imported rows, deduped on $unique_col)"
  else
    echo "  FAIL $table — $(cat /tmp/pg_import_err)"
    return 1
  fi
}

# --- Helper: reset a SERIAL sequence to max(id) + 1 ---
reset_sequence() {
  local table="$1"
  local column="${2:-id}"
  psql "$DATABASE_URL" -q -c "
    SELECT setval(pg_get_serial_sequence('$table', '$column'),
                  COALESCE((SELECT MAX($column) FROM $table), 0) + 1, false);
  " 2>/dev/null || true
}

# =============================================================================
# PRE-IMPORT: Schema patches (columns missing from postgres.sql but added by
#             SQLite runtime migrations)
# =============================================================================
echo "--- Pre-import schema patches ---"

psql "$DATABASE_URL" -q <<'SQL'
-- generated_podcasts_json: added by SQLite migration, not in postgres.sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS generated_podcasts_json TEXT;

-- Ensure mode/plan_id columns exist on messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'normal';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS plan_id TEXT;

-- folder_sync_files.last_modified stores millisecond timestamps that exceed INT4
ALTER TABLE folder_sync_files ALTER COLUMN last_modified TYPE BIGINT;
SQL
echo "  Schema patches applied."
echo ""

# =============================================================================
# PRE-IMPORT: Disable triggers to preserve original timestamps
# =============================================================================
echo "--- Disabling triggers ---"

psql "$DATABASE_URL" -q <<'SQL'
-- Disable update_timestamp triggers so imported created_at/updated_at are preserved
ALTER TABLE users DISABLE TRIGGER ALL;
ALTER TABLE threads DISABLE TRIGGER ALL;
ALTER TABLE messages DISABLE TRIGGER ALL;
ALTER TABLE llm_providers DISABLE TRIGGER ALL;
ALTER TABLE enabled_models DISABLE TRIGGER ALL;
ALTER TABLE agent_bots DISABLE TRIGGER ALL;
ALTER TABLE agent_bot_versions DISABLE TRIGGER ALL;
SQL
echo "  Triggers disabled."
echo ""

# =============================================================================
# PRE-IMPORT: Clear existing data (import into fresh Postgres)
#             Order: children first, then parents (reverse FK order)
# =============================================================================
echo "--- Clearing existing data (reverse FK order) ---"

psql "$DATABASE_URL" -q <<'SQL'
-- Truncate tables that exist (safe wrapper for tables that may not exist yet)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'folder_sync_files', 'folder_syncs',
      'workspace_rate_limits', 'workspace_messages', 'workspace_sessions',
      'workspace_categories', 'workspace_users', 'workspaces',
      'agent_bot_api_keys', 'agent_bot_versions', 'agent_bots',
      'tool_routing_rules', 'tool_configs', 'function_api_configs',
      'user_memories', 'thread_uploads', 'thread_categories',
      'thread_summaries', 'archived_messages', 'compliance_results',
      'thread_shares', 'share_access_log',
      'document_categories', 'messages', 'threads', 'documents',
      'category_prompts', 'super_user_categories', 'user_subscriptions',
      'enabled_models', 'llm_providers', 'skills', 'categories',
      'settings', 'reindex_jobs', 'users'
    ])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
      EXECUTE format('TRUNCATE TABLE %I CASCADE', t);
    END IF;
  END LOOP;
END $$;
SQL
echo "  All tables cleared."
echo ""

# =============================================================================
# IMPORT: Parents first, then children (FK order)
# =============================================================================
echo "--- Importing data (FK order) ---"

# Level 0: No foreign keys
import_table "users"
import_table "categories"
import_table "settings"
import_table "llm_providers"
import_table "skills"

# Level 1: Depends on users OR categories
import_table "category_prompts"
import_table "super_user_categories"
import_table "user_subscriptions"
import_table "documents"
import_table "threads"
import_table "enabled_models"
import_table_dedup "tool_configs" "tool_name"
import_table "tool_routing_rules"
import_table "function_api_configs"
import_table "folder_syncs"

# Level 2: Depends on Level 1
import_table "document_categories"
import_table "thread_categories"
import_table "messages"
import_table "thread_uploads"
import_table "user_memories"
import_table "folder_sync_files"
import_table "thread_summaries"

# Level 3: Workspaces (if exported)
import_table "workspaces"
import_table "workspace_sessions"     # depends on workspaces
# workspace_threads not exported (0 rows in export)
import_table "workspace_messages"     # depends on workspaces + workspace_sessions

# Level 4: Agent bots (if exported)
import_table "agent_bots"
import_table "agent_bot_versions"     # depends on agent_bots
import_table "agent_bot_api_keys"     # depends on agent_bots

echo ""

# =============================================================================
# POST-IMPORT: Reset SERIAL sequences
# =============================================================================
echo "--- Resetting sequences ---"

reset_sequence "users"
reset_sequence "categories"
reset_sequence "documents"
reset_sequence "skills"
reset_sequence "thread_uploads"
reset_sequence "user_memories"
reset_sequence "folder_sync_files"

echo "  Sequences reset."
echo ""

# =============================================================================
# POST-IMPORT: Re-enable triggers
# =============================================================================
echo "--- Re-enabling triggers ---"

psql "$DATABASE_URL" -q <<'SQL'
ALTER TABLE users ENABLE TRIGGER ALL;
ALTER TABLE threads ENABLE TRIGGER ALL;
ALTER TABLE messages ENABLE TRIGGER ALL;
ALTER TABLE llm_providers ENABLE TRIGGER ALL;
ALTER TABLE enabled_models ENABLE TRIGGER ALL;
ALTER TABLE agent_bots ENABLE TRIGGER ALL;
ALTER TABLE agent_bot_versions ENABLE TRIGGER ALL;
SQL
echo "  Triggers re-enabled."
echo ""

# =============================================================================
# VERIFICATION: Row counts
# =============================================================================
echo "--- Verification: Row counts ---"
echo ""
printf "  %-30s %s\n" "TABLE" "ROWS"
printf "  %-30s %s\n" "-----" "----"

COUNTS=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'category_prompts', COUNT(*) FROM category_prompts
UNION ALL SELECT 'super_user_categories', COUNT(*) FROM super_user_categories
UNION ALL SELECT 'user_subscriptions', COUNT(*) FROM user_subscriptions
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'document_categories', COUNT(*) FROM document_categories
UNION ALL SELECT 'threads', COUNT(*) FROM threads
UNION ALL SELECT 'thread_categories', COUNT(*) FROM thread_categories
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'thread_uploads', COUNT(*) FROM thread_uploads
UNION ALL SELECT 'user_memories', COUNT(*) FROM user_memories
UNION ALL SELECT 'settings', COUNT(*) FROM settings
UNION ALL SELECT 'llm_providers', COUNT(*) FROM llm_providers
UNION ALL SELECT 'enabled_models', COUNT(*) FROM enabled_models
UNION ALL SELECT 'skills', COUNT(*) FROM skills
UNION ALL SELECT 'tool_configs', COUNT(*) FROM tool_configs
UNION ALL SELECT 'tool_routing_rules', COUNT(*) FROM tool_routing_rules
UNION ALL SELECT 'function_api_configs', COUNT(*) FROM function_api_configs
UNION ALL SELECT 'folder_syncs', COUNT(*) FROM folder_syncs
UNION ALL SELECT 'folder_sync_files', COUNT(*) FROM folder_sync_files
UNION ALL SELECT 'workspaces', COUNT(*) FROM workspaces
UNION ALL SELECT 'workspace_sessions', COUNT(*) FROM workspace_sessions
UNION ALL SELECT 'workspace_messages', COUNT(*) FROM workspace_messages
UNION ALL SELECT 'agent_bots', COUNT(*) FROM agent_bots
UNION ALL SELECT 'agent_bot_versions', COUNT(*) FROM agent_bot_versions
UNION ALL SELECT 'agent_bot_api_keys', COUNT(*) FROM agent_bot_api_keys
UNION ALL SELECT 'thread_summaries', COUNT(*) FROM thread_summaries
ORDER BY 1;
SQL
)

echo "$COUNTS" | while IFS='|' read -r table count; do
  printf "  %-30s %s\n" "$table" "$count"
done

echo ""
echo "================================================"
echo "  Import complete!"
echo ""
echo "  Compare counts above with your SQLite export."
echo "  If counts match, the migration is successful."
echo "================================================"
