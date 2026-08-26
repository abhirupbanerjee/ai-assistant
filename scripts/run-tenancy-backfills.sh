#!/usr/bin/env bash
#
# Organization and vector-tenancy migration runner.
#
# Safely runs the required backfills in dependency order:
#   1. PostgreSQL organization ownership / Default-org backfill
#   2. Qdrant organization_id payload backfill
#
# Both underlying scripts are idempotent. Re-running this script only fills rows
# or Qdrant points that have not already been assigned an organization.
#
# Run from the repository root:
#   bash scripts/run-tenancy-backfills.sh
#
# `--skip-readiness` is reserved for emergency recovery when the operator has
# already completed and recorded the readiness checks for this exact deployment.

set -Eeuo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SKIP_READINESS_ARG="${1:-}"

if [[ $# -gt 1 || ( -n "$SKIP_READINESS_ARG" && "$SKIP_READINESS_ARG" != "--skip-readiness" ) ]]; then
  echo "Usage: bash scripts/run-tenancy-backfills.sh [--skip-readiness]" >&2
  exit 64
fi

cd "$ROOT_DIR"

if [[ -z "${DATABASE_URL:-}" && ! -f .env && ! -f .env.local ]]; then
  echo "[Tenancy Backfill] DATABASE_URL is not set and neither .env nor .env.local exists." >&2
  echo "[Tenancy Backfill] Run from the deployed application directory or provide the container environment." >&2
  exit 1
fi

if [[ "$SKIP_READINESS_ARG" != "--skip-readiness" ]]; then
  echo "[Tenancy Backfill] 1/3 Running pre-migration readiness checks..."
  npx tsx scripts/pre-migration-readiness.ts
else
  echo "[Tenancy Backfill] Skipping readiness checks by explicit operator request."
fi

echo "[Tenancy Backfill] 2/3 Backfilling PostgreSQL organization tenancy..."
npx tsx scripts/backfill-org-tenancy.ts

echo "[Tenancy Backfill] 3/3 Backfilling Qdrant organization payloads..."
npx tsx scripts/backfill-vector-tenancy.ts

echo "[Tenancy Backfill] Completed successfully. Re-test kb_search and kb_read in the owning organization."
