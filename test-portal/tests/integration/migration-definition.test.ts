import assert from "node:assert/strict";
import { test } from "node:test";

import { initialMigration } from "../../db/migrations/001_initial";

test("initial migration owns audit and migration-safe registration metadata", () => {
  assert.equal(initialMigration.id, "001_initial");
  assert.match(initialMigration.sql, /registration_audit_events/);
  assert.match(initialMigration.sql, /metadata_json jsonb/);
  assert.doesNotMatch(initialMigration.sql, /api_key|client_secret|session_secret/i);
});
