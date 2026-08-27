#!/usr/bin/env bash
#
# Phase 0 — Write-funnel grep gate (§7.9 gate 3)
#
# Ensures zero direct `enabled_models` writes (INSERT/UPDATE/DELETE via
# Kysely methods or raw SQL) exist outside the allowlisted files:
#   - src/lib/db/compat/enabled-models.ts   (compat layer — the funnel)
#   - src/lib/db/kysely.ts                  (schema + data migrations)
#   - src/lib/db/enabled-models.ts          (legacy non-compat, removed at Exit Gate 2)
#   - src/lib/db/index.ts                   (legacy SQLite migrations)
#
# Any match outside the allowlist causes exit code 1.
#
set -euo pipefail

cd "$(dirname "$0")/.."

ALLOWLIST=(
  'src/lib/db/compat/enabled-models.ts'
  'src/lib/db/kysely.ts'
  'src/lib/db/enabled-models.ts'
  'src/lib/db/index.ts'
)

# Patterns that constitute a "write" to enabled_models
#   - Kysely builder methods: insertInto, updateTable, deleteFrom
#   - Raw SQL: INSERT INTO, UPDATE, DELETE FROM
PATTERNS=(
  "insertInto('enabled_models')"
  'insertInto("enabled_models")'
  "updateTable('enabled_models')"
  'updateTable("enabled_models")'
  "deleteFrom('enabled_models')"
  'deleteFrom("enabled_models")'
  'INSERT INTO enabled_models'
  'INSERT INTO `enabled_models`'
  'UPDATE enabled_models'
  'UPDATE `enabled_models`'
  'DELETE FROM enabled_models'
  'DELETE FROM `enabled_models`'
)

VIOLATIONS=0

echo "=== Phase 0 Write-Funnel Grep Gate ==="
echo "Searching for direct enabled_models writes outside allowlist..."
echo ""

for pattern in "${PATTERNS[@]}"; do
  # grep -rn with line numbers; --include to limit to .ts files
  # Use -I to skip binary files, -F for fixed-string matching
  while IFS= read -r line; do
    # Extract file path (before first colon)
    file="${line%%:*}"

    # Check if file is in allowlist
    allowed=false
    for a in "${ALLOWLIST[@]}"; do
      if [[ "$file" == "$a" ]]; then
        allowed=true
        break
      fi
    done

    if [[ "$allowed" == false ]]; then
      echo "VIOLATION: $line"
      echo "  (pattern: \"$pattern\" in non-allowlisted file: $file)"
      echo ""
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(grep -rnF --include='*.ts' "$pattern" src/ 2>/dev/null || true)
done

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo "FAILED: $VIOLATIONS violation(s) found."
  echo "All enabled_models writes must go through src/lib/db/compat/enabled-models.ts"
  echo "or be part of schema migrations in src/lib/db/kysely.ts."
  exit 1
fi

echo "PASSED: No direct enabled_models writes outside allowlist."
