import assert from "node:assert/strict";
import { test } from "node:test";

import { extractOutputId } from "../../lib/upstream/output-path";

const expected = {
  sourceOrigin: "https://assistant.example.test",
  slug: "contract-bot",
  jobId: "job_fixture_01",
};

test("extracts an output ID from the exact public route shape", () => {
  assert.equal(
    extractOutputId(
      "/api/agent-bots/contract-bot/jobs/job_fixture_01/outputs/output_fixture_01/download",
      expected,
    ),
    "output_fixture_01",
  );
});

test("accepts a same-origin absolute URL", () => {
  assert.equal(
    extractOutputId(
      "https://assistant.example.test/api/agent-bots/contract-bot/jobs/job_fixture_01/outputs/output_2/download",
      expected,
    ),
    "output_2",
  );
});

test("rejects cross-origin, mismatched ownership, query, and malformed paths", () => {
  const rejected = [
    "https://evil.example/api/agent-bots/contract-bot/jobs/job_fixture_01/outputs/output_1/download",
    "/api/agent-bots/other-bot/jobs/job_fixture_01/outputs/output_1/download",
    "/api/agent-bots/contract-bot/jobs/other-job/outputs/output_1/download",
    "/api/agent-bots/contract-bot/jobs/job_fixture_01/outputs/output_1/download?redirect=evil",
    "/api/agent-bots/contract-bot/jobs/job_fixture_01/outputs/../download",
    "/api/agent-bots/contract-bot/jobs/job_fixture_01/outputs/output%2Fescape/download",
  ];
  for (const url of rejected) assert.equal(extractOutputId(url, expected), null, url);
  assert.equal(extractOutputId("/valid-looking", { ...expected, sourceOrigin: "not a URL" }), null);
});
