import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closePool, getPool } from "../../lib/db/pool";

const originalEnv = { ...process.env };

after(async () => {
  await closePool();
  process.env = originalEnv;
});

test("concurrent callers share one PostgreSQL pool", async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORTAL_BASE_URL: "http://localhost:3100",
    DATABASE_URL: "postgresql://portal:secret@localhost/test_portal",
    DATABASE_SSL: "false",
    PORTAL_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
    ENTRA_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
    ENTRA_CLIENT_SECRET: "test-secret",
  });

  const [first, second, third] = await Promise.all([getPool(), getPool(), getPool()]);
  assert.equal(first, second);
  assert.equal(second, third);
});
