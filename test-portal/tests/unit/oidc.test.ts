import assert from "node:assert/strict";
import { test } from "node:test";

import { createOidcTransaction, safeReturnTo } from "../../lib/auth/entra";

test("accepts only same-origin relative return paths", () => {
  assert.equal(safeReturnTo("/agents/test?id=1"), "/agents/test?id=1");
  assert.equal(safeReturnTo("//evil.example"), "/");
  assert.equal(safeReturnTo("/\\evil.example/path"), "/");
  assert.equal(safeReturnTo("/agents\\evil"), "/");
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo(null), "/");
});

test("creates independent high-entropy OIDC transaction values", () => {
  const first = createOidcTransaction("/");
  const second = createOidcTransaction("/");
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.nonce, second.nonce);
  assert.ok(first.verifier.length >= 43);
});
