import assert from "node:assert/strict";
import { test } from "node:test";

import type { PortalConfig } from "../../lib/config";
import { assertAdmin, AuthorizationError, resolvePrincipal } from "../../lib/auth/principal";

const config = {
  nodeEnv: "test",
  baseUrl: new URL("http://localhost:3100"),
  secureCookies: false,
  databaseUrl: "postgresql://portal:secret@localhost/test_portal",
  databaseSsl: false,
  entraTenantId: "11111111-1111-4111-8111-111111111111",
  entraClientId: "22222222-2222-4222-8222-222222222222",
  entraClientSecret: "test-secret",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  adminEmails: new Set(["admin@example.com"]),
  adminObjectIds: new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]),
} satisfies PortalConfig;

test("resolves exact normalized email and object ID administrators", () => {
  const byEmail = resolvePrincipal({
    objectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    tenantId: config.entraTenantId,
    email: "ADMIN@example.com",
  }, config);
  const byObjectId = resolvePrincipal({
    objectId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    tenantId: config.entraTenantId,
  }, config);
  assert.equal(byEmail.role, "admin");
  assert.equal(byObjectId.role, "admin");
});

test("defaults valid unmapped identities to user and enforces admin mutations", () => {
  const user = resolvePrincipal({
    objectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    tenantId: config.entraTenantId,
    email: "user@example.com",
  }, config);
  assert.equal(user.role, "user");
  assert.throws(() => assertAdmin(user), AuthorizationError);
});

test("rejects identities from another tenant and ambiguous emails", () => {
  assert.throws(() => resolvePrincipal({
    objectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    tenantId: "99999999-9999-4999-8999-999999999999",
  }, config), /unexpected tenant/);
  const identity = resolvePrincipal({
    objectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    tenantId: config.entraTenantId,
    email: "not-an-email",
  }, config);
  assert.equal(identity.email, null);
  assert.equal(identity.role, "user");
});
