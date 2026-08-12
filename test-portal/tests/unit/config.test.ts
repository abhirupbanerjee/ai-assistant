import assert from "node:assert/strict";
import { test } from "node:test";

import { parseConfig } from "../../lib/config";

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PORTAL_BASE_URL: "http://localhost:3100",
  DATABASE_URL: "postgresql://portal:secret@localhost/test_portal",
  DATABASE_SSL: "false",
  PORTAL_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  ENTRA_CLIENT_SECRET: "test-secret",
  PORTAL_ADMIN_EMAILS: " Admin@Example.COM ",
  PORTAL_ADMIN_OBJECT_IDS: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
};

test("parses and normalizes portal configuration", () => {
  const config = parseConfig(validEnv);
  assert.equal(config.baseUrl.origin, "http://localhost:3100");
  assert.equal(config.secureCookies, false);
  assert.equal(config.databaseSsl, false);
  assert.equal(config.adminEmails.has("admin@example.com"), true);
  assert.equal(config.adminObjectIds.has("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), true);
});

test("fails closed for weak session secrets and insecure production origins", () => {
  assert.throws(() => parseConfig({ ...validEnv, PORTAL_SESSION_SECRET: "short" }), /32 bytes/);
  assert.throws(() => parseConfig({ ...validEnv, NODE_ENV: "production" }), /HTTPS/);
});

test("requires an explicit production administrator mapping", () => {
  assert.throws(
    () => parseConfig({
      ...validEnv,
      NODE_ENV: "production",
      PORTAL_BASE_URL: "https://portal.example.test",
      PORTAL_ADMIN_EMAILS: "",
      PORTAL_ADMIN_OBJECT_IDS: "",
    }),
    /administrator/,
  );
});
