/**
 * Tests for the Phase A request budget resolver and token ledger.
 *
 * Pure unit tests — no DB required (resolveRequestBudget falls back to
 * defaults when the model catalog is unavailable).
 *
 * Run: npx tsx --test src/lib/request-budget.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRequestBudget,
  estimateTextTokens,
  estimateMessageTokens,
  estimateToolSchemaTokens,
  estimateMessagesTokens,
  createLedger,
  addLedgerPart,
  compactLedger,
  RequestBudgetExceeded,
} from './request-budget';

describe('resolveRequestBudget', () => {
  test('uses default window when catalog has no metadata for the model', async () => {
    const budget = await resolveRequestBudget('no-such-model-xyz', { requestedMaxTokens: 4096 });
    // Shared-window formula: window − output − margin.
    assert.equal(budget.maxOutputTokens, 4096);
    assert.ok(budget.inputLimit > 0);
    assert.ok(budget.inputLimit < budget.contextWindow);
  });

  test('input limit is NOT simply the output allowance (the original bug)', async () => {
    const budget = await resolveRequestBudget('no-such-model-xyz', { requestedMaxTokens: 8192 });
    // Old code would have made available input ≈ 8192. The new default
    // window is far larger, so the input limit must exceed the output cap.
    assert.ok(budget.inputLimit > 8192, `inputLimit ${budget.inputLimit} should exceed output 8192`);
  });

  test('runtime override (Ollama num_ctx) caps the advertised window', async () => {
    const budget = await resolveRequestBudget('ollama-local', {
      requestedMaxTokens: 4096,
      runtimeContextTokens: 16384,
    });
    assert.ok(budget.inputLimit <= 16384);
  });

  test('runtime window reserves output + safety margin (defect 6)', async () => {
    // The runtime shared window must not be consumed by input alone: input +
    // output + margin must fit within the runtime context window.
    const budget = await resolveRequestBudget('ollama-local', {
      requestedMaxTokens: 8192,
      runtimeContextTokens: 16384,
      safetyMargin: 512,
    });
    assert.ok(
      budget.inputLimit + budget.maxOutputTokens + budget.safetyMargin <= 16384,
      `runtime window over-subscribed: ${budget.inputLimit} + ${budget.maxOutputTokens} + ${budget.safetyMargin} > 16384`
    );
  });

  test('safety margin is honored', async () => {
    const budget = await resolveRequestBudget('no-such-model-xyz', {
      requestedMaxTokens: 4096,
      safetyMargin: 2048,
    });
    assert.equal(budget.safetyMargin, 2048);
    assert.equal(budget.inputLimit, budget.contextWindow - 4096 - 2048);
  });

  test('rejects a runtime window exhausted by output and margin', async () => {
    await assert.rejects(resolveRequestBudget('no-such-model-xyz', {
      requestedMaxTokens: 8192,
      runtimeContextTokens: 8192,
      safetyMargin: 512,
    }), RequestBudgetExceeded);
  });

  test('rejects impossible tiny configs instead of inventing input capacity', async () => {
    await assert.rejects(resolveRequestBudget('no-such-model-xyz', {
      requestedMaxTokens: 500_000,
      runtimeContextTokens: 2048,
    }), RequestBudgetExceeded);
  });

  test('positive sub-1024 input capacity is not raised beyond the runtime window', async () => {
    const budget = await resolveRequestBudget('no-such-model-xyz', {
      requestedMaxTokens: 1024,
      runtimeContextTokens: 2048,
      safetyMargin: 512,
    });
    assert.equal(budget.inputLimit, 512);
    assert.equal(budget.inputLimit + budget.maxOutputTokens + budget.safetyMargin, 2048);
  });
});

describe('token estimation', () => {
  test('estimateTextTokens is conservative (chars/4)', () => {
    assert.equal(estimateTextTokens('abcdefgh'), 2);
    assert.equal(estimateTextTokens(''), 0);
  });

  test('multimodal message parts: text counted as text, images flat-rate', () => {
    const tokens = estimateMessageTokens({
      content: [
        { type: 'text', text: 'abcdefgh' }, // 2 tokens
        { type: 'image_url', image_url: { url: 'data:image/png;base64,XXXX' } },
      ],
    });
    assert.ok(tokens >= 1600 + 2, `expected >= 1602, got ${tokens}`);
  });

  test('tool calls on assistant messages are counted', () => {
    const withCalls = estimateMessageTokens({
      content: 'x',
      tool_calls: [{ id: '1', function: { name: 'kb_read', arguments: '{"filename":"abcdefgh"}' } }],
    });
    const without = estimateMessageTokens({ content: 'x' });
    assert.ok(withCalls > without);
  });

  test('tool schema tokens scale with serialized size', () => {
    const small = estimateToolSchemaTokens([{ function: { name: 'a', parameters: { x: 1 } } }]);
    const big = estimateToolSchemaTokens([
      { function: { name: 'a', parameters: { x: 1 } } },
      { function: { name: 'b', parameters: { big: 'y'.repeat(4000) } } },
    ]);
    assert.ok(big > small + 500);
  });

  test('estimateMessagesTokens sums across roles', () => {
    const total = estimateMessagesTokens([
      { content: 'abcdefgh' },   // 2
      { content: 'ijklmnop' },   // 2
    ]);
    assert.ok(total >= 4);
  });
});

describe('ledger compaction (A4)', () => {
  function makeBudget(inputLimit: number) {
    return {
      model: 'test',
      inputLimit,
      maxOutputTokens: 1024,
      contextWindow: inputLimit + 2048,
      separateInputCeiling: null,
      safetyMargin: 512,
    };
  }

  test('no eviction when under budget', () => {
    const ledger = createLedger(makeBudget(1000));
    addLedgerPart(ledger, { key: 'a', kind: 'tool_result', tokens: 100, reloadable: true });
    addLedgerPart(ledger, { key: 'b', kind: 'system', tokens: 50 });
    const { evicted, fits } = compactLedger(ledger);
    assert.equal(fits, true);
    assert.deepEqual(evicted, []);
  });

  test('evicts oldest reloadable part first, keeping stub info', () => {
    const ledger = createLedger(makeBudget(300));
    addLedgerPart(ledger, { key: 'sys', kind: 'system', tokens: 50 });
    addLedgerPart(ledger, { key: 't1', kind: 'tool_result', tokens: 200, reloadable: true, stub: 'doc1 p1-3' });
    addLedgerPart(ledger, { key: 't2', kind: 'tool_result', tokens: 100, reloadable: true, stub: 'doc1 p4-6' });
    // 350 > 300 → evict oldest (t1)
    const { evicted, fits } = compactLedger(ledger);
    assert.equal(fits, true);
    assert.ok(evicted.includes('t1'));
    assert.ok(!evicted.includes('t2'));
    assert.ok(!evicted.includes('sys'));
  });

  test('throws RequestBudgetExceeded when nothing reloadable remains', () => {
    const ledger = createLedger(makeBudget(100));
    addLedgerPart(ledger, { key: 'sys', kind: 'system', tokens: 500 });
    assert.throws(() => compactLedger(ledger), (err: unknown) => {
      assert.ok(err instanceof RequestBudgetExceeded);
      assert.equal(err.code, 'REQUEST_BUDGET_EXCEEDED');
      assert.equal(err.inputLimit, 100);
      return true;
    });
  });
});
