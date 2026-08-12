import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  parseAgentBotJob,
  parseAgentBotSpec,
  parseAgentBotUploadResponse,
  parseAsyncInvokeResponse,
} from "../../contracts/agent-bot";
import { parseWorkspaceInitResponse } from "../../contracts/workspace";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

test("validates sanitized discovery while tolerating unknown fields", async () => {
  const parsed = parseAgentBotSpec(await fixture("agent-spec.json"));
  assert.equal(parsed.slug, "contract-bot");
  assert.deepEqual(parsed.inputSchema.parameters.map(({ name }) => name), ["prompt", "includeDetails"]);
  assert.equal("futureField" in parsed, false);
});

test("validates upload, asynchronous invocation, polling, and workspace fixtures", async () => {
  assert.equal(parseAgentBotUploadResponse(await fixture("agent-upload.json")).fileId, "file_fixture_01");
  assert.equal(parseAsyncInvokeResponse(await fixture("agent-invoke-async.json")).status, "pending");
  assert.equal(parseAgentBotJob(await fixture("agent-job-completed.json")).outputs?.length, 2);
  assert.equal(parseWorkspaceInitResponse(await fixture("workspace-init.json")).type, "public");
});

test("rejects missing public contract fields", () => {
  assert.throws(() => parseAsyncInvokeResponse({ status: "pending" }), /jobId/);
  assert.throws(() => parseWorkspaceInitResponse({ workspaceId: "id", type: "public" }), /config/);
});
