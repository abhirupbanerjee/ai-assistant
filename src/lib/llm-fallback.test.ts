/** Offline tests of the actual module, with a closed import graph and mocked DB. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { ModelLatencyContext } from './model-latency-logger';

function harness(healthReadFails = false) {
  const root = dirname(fileURLToPath(import.meta.url));
  const logs: unknown[][] = [];
  const latency: ModelLatencyContext[] = [];
  let settingsReads = 0;
  const forbidden = () => assert.fail('Unexpected DB/config/model resolution access');
  const mocks: Record<string, unknown> = {
    [resolve(root, 'db/compat/enabled-models.ts')]: { getEnabledModel: forbidden, getActiveModels: forbidden },
    [resolve(root, 'db/compat/config.ts')]: {
      getRoutesSettings: forbidden,
      getLlmFallbackSettings: async () => {
        settingsReads++;
        if (healthReadFails) throw new Error('mock health cache config failure');
        return { healthCacheDuration: 'hourly' };
      },
    },
    [resolve(root, 'model-latency-logger.ts')]: {
      recordModelLatency: (entry: ModelLatencyContext) => latency.push(entry),
    },
  };
  const allowed = new Set(['llm-fallback.ts', 'llm-fallback-policy.ts', 'model-compatibility.ts',
    'anthropic-native-state.ts', 'llm/providers/openai-responses.ts'].map(file => resolve(root, file)));
  const cache = new Map<string, unknown>();
  function load(file: string): unknown {
    if (Object.hasOwn(mocks, file)) return mocks[file];
    if (cache.has(file)) return cache.get(file);
    assert.ok(allowed.has(file), `Unexpected runtime import: ${file}`);
    // Transpile the ENTIRE production module. CommonJS lowering routes static
    // and dynamic imports through the same closed mock boundary, including the
    // fire-and-forget latency import. No source/function replacements.
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: file,
    }).outputText;
    const module = { exports: {} };
    cache.set(file, module.exports);
    const requireMock = (id: string) => {
      assert.ok(id.startsWith('.'), `Unexpected external dependency: ${id}`);
      return load(resolve(dirname(file), `${id}.ts`));
    };
    const log = (...args: unknown[]) => logs.push(args);
    new Function('require', 'module', 'exports', 'console', compiled)(
      requireMock, module, module.exports, { log, warn: log, error: log },
    );
    return module.exports;
  }
  return {
    api: load(resolve(root, 'llm-fallback.ts')) as typeof import('./llm-fallback'),
    responses: () => load(resolve(root, 'llm/providers/openai-responses.ts')) as typeof import('./llm/providers/openai-responses'),
    native: () => load(resolve(root, 'anthropic-native-state.ts')) as typeof import('./anthropic-native-state'),
    logs, latency, settingsReads: () => settingsReads,
    switches: () => logs.filter(args => String(args[0]).includes('Model switch:')),
    failures: () => logs.filter(args => args[0] === '[LLM-Fallback] Model attempt failed')
      .map(args => args[1] as { attemptedModels: string[]; retryAllowed: boolean }),
  };
}

const sdkError = (status: number, message: string, code?: string) => Object.assign(new Error(message), {
  status, code, request_id: 'req_offline', error: { type: code, message },
});
const opusError = () => sdkError(400,
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"temperature: This parameter is deprecated for claude-opus-5-5. Please remove it from your request."},"request_id":"req_offline"}',
  'invalid_request_error');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('no models: no execution, DB or latency; not an exhaustion error', async () => {
  const h = harness();
  await assert.rejects(h.api.withModelFallback({ modelsToTry: [], execute: async () => assert.fail('execute') }),
    error => error instanceof h.api.LlmFallbackError && error.code === 'NO_MODELS_AVAILABLE' && !error.recoverable);
  assert.equal(h.settingsReads(), 0);
  assert.deepEqual(h.latency, []);
});

test('first model succeeds without fallback or health access', async () => {
  const h = harness();
  const attempted: string[] = [];
  const result = await h.api.withModelFallback({ modelsToTry: ['a', 'b'], execute: async model => {
    attempted.push(model); return { content: 'done' };
  } });
  await flush();
  assert.deepEqual(attempted, ['a']);
  assert.equal(result.usedModel, 'a');
  assert.deepEqual(result.switches, []);
  assert.equal(h.settingsReads(), 0);
  assert.equal(h.latency[0].success, true);
});

test('structured rate limit switches once, deduplicates candidates, then succeeds', async () => {
  const h = harness();
  const attempted: string[] = [];
  const notified: string[] = [];
  const result = await h.api.withModelFallback({ modelsToTry: ['a', 'a', 'b', 'c'], execute: async model => {
    attempted.push(model);
    if (model === 'a') throw sdkError(429, 'capacity reached');
    return 'done';
  }, onSwitch: event => notified.push(event.newModel) });
  await flush();
  assert.deepEqual(attempted, ['a', 'b']);
  assert.deepEqual(notified, ['b']);
  assert.equal(result.switches[0].reason, 'rate_limit');
  assert.equal(h.switches().length, 1);
  assert.equal(h.api.isModelHealthy('a'), false);
  assert.equal(h.api.isModelHealthy('b'), true);
  assert.deepEqual(h.latency.map(entry => entry.success), [false, true]);
});

test('exhaustion contains only actual attempts and preserves structured original error/cause', async () => {
  const h = harness();
  const original = { status: 503, code: 'server_error', message: 'capacity reached', cause: { detail: 'original' } };
  const attempted: string[] = [];
  const candidates = ['a', 'b'];
  await assert.rejects(h.api.withModelFallback({ modelsToTry: candidates, execute: async model => {
    attempted.push(model);
    candidates.push('unattempted'); // Does not modify the snapshotted plan.
    throw original;
  } }), error => {
    assert.ok(error instanceof h.api.LlmFallbackError);
    assert.equal(error.code, 'ALL_MODELS_FAILED');
    assert.equal(error.recoverable, true);
    assert.deepEqual(error.attemptedModels, attempted);
    assert.deepEqual(error.attemptedModels, ['a', 'b']);
    assert.equal(error.originalError, original);
    assert.equal(error.cause, original);
    return true;
  });
  assert.equal(h.switches().length, 1);
  assert.ok(!h.logs.some(args => String(args[0]).includes('→ none')));
});

for (const [label, error] of [
  ['exact Opus deprecated temperature 400', opusError()],
  ['401 with misleading transient text', sdkError(401, 'rate limit timeout')],
  ['403 with misleading transient text', sdkError(403, 'model not found')],
  ['authentication before quota', new Error('Authentication failed: billing quota')],
  ['400 before transient text', sdkError(400, 'unsupported request network timeout')],
  ['generic endpoint 404', sdkError(404, 'resource not found')],
  ['refusal before outage', Object.assign(new Error('overloaded'), { code: 'refusal' })],
  ['content filter before rate limit', Object.assign(new Error('rate limit'), { code: 'content_filter' })],
  ['local programming bug', new TypeError('Cannot read network timeout parameter')],
  ['local syntax bug', new SyntaxError('Unexpected token 500')],
  ['parameter error without status', new Error('temperature is deprecated: 500 tokens')],
  ['native history error', new Error('Claude native state belongs to a different model; rebuild history before switching models')],
  ['abort', Object.assign(new Error('timeout'), { name: 'AbortError' })],
  ['numeric substring', new Error('Invalid model abc-500-429-503')],
  ['plain SDK object', { status: 400, error: { type: 'invalid_request_error', message: 'temperature deprecated' } }],
  ['null thrown', null],
  ['undefined thrown', undefined],
  ['string thrown', '400 invalid request: timeout'],
] as const) {
  test(`${label}: stop, preserve identity, no switch, no health/latency penalty`, async () => {
    const h = harness();
    const attempted: string[] = [];
    await assert.rejects(h.api.withModelFallback({ modelsToTry: ['claude-opus-5-5', 'unattempted'], execute: async model => {
      attempted.push(model); throw error;
    }, onSwitch: () => assert.fail('Unexpected switch') }), actual => {
      assert.equal(actual, error);
      return true;
    });
    await flush();
    assert.deepEqual(attempted, ['claude-opus-5-5']);
    assert.equal(h.settingsReads(), 0);
    assert.equal(h.api.isModelHealthy('claude-opus-5-5'), true);
    assert.deepEqual(h.latency, []);
    assert.deepEqual(h.switches(), []);
    assert.deepEqual(h.failures()[0].attemptedModels, attempted);
  });
}

test('a transient failure followed by a parameter bug stops without claiming exhaustion', async () => {
  const h = harness();
  const terminal = opusError();
  await assert.rejects(h.api.withModelFallback({ modelsToTry: ['a', 'b', 'c'], execute: async model => {
    if (model === 'a') throw sdkError(503, 'capacity');
    if (model === 'b') throw terminal;
    assert.fail('c must not execute');
  } }), error => error === terminal);
  assert.deepEqual(h.failures().map(failure => failure.attemptedModels), [['a'], ['a', 'b']]);
  assert.equal(h.switches().length, 1);
  assert.equal(h.api.isModelHealthy('a'), false);
  assert.equal(h.api.isModelHealthy('b'), true);
});

test('real Responses errors: pre-output timeout/interruption/server error can switch; terminal state cannot', async () => {
  const h = harness();
  const { OpenAIResponsesError } = h.responses();
  for (const [code, outputStarted, retry] of [
    ['timeout', false, true], ['interrupted', false, true], ['server_error', false, true],
    ['timeout', true, false], ['server_error', true, false], ['interrupted', true, false],
    ['aborted', false, false], ['invalid_tool_call', false, false], ['max_output_tokens', false, false],
    ['unsupported_output', false, false], ['incomplete_output', false, false], ['content_filter', false, false],
  ] as const) {
    const error = new OpenAIResponsesError('provider failure', code, outputStarted);
    const attempted: string[] = [];
    const run = h.api.withModelFallback({ modelsToTry: ['a', 'b'], execute: async model => {
      attempted.push(model);
      if (model === 'a') throw error;
      return 'done';
    } });
    if (retry) assert.equal((await run).usedModel, 'b');
    else await assert.rejects(run, actual => actual === error);
    assert.deepEqual(attempted, retry ? ['a', 'b'] : ['a'], `${code}/${outputStarted}`);
  }
});

test('real Claude request/native-state guards remain terminal', async () => {
  const h = harness();
  const native = h.native();
  const completion = native.anthropicCompletionFromFinalMessage({
    id: 'msg_offline', type: 'message', role: 'assistant', model: 'claude-fable-5-1',
    stop_reason: 'end_turn', stop_sequence: null, content: [], container: null,
    usage: { input_tokens: 1, output_tokens: 0, cache_creation: null,
      cache_creation_input_tokens: null, cache_read_input_tokens: null,
      inference_geo: null, server_tool_use: null, service_tier: null },
  }, 'claude-fable-5-1');
  for (const execute of [
    async () => native.applyAnthropicRequestPolicy({ model: 'claude-opus-5-5', messages: [{ role: 'assistant', content: 'prefill' }] }),
    async () => native.getAnthropicNativeContent(completion, 'claude-opus-5-5'),
  ]) {
    await assert.rejects(h.api.withModelFallback<unknown>({ modelsToTry: ['a', 'b'], execute,
      onSwitch: () => assert.fail('Native history must not switch') }), /prefill|different model/);
  }
  assert.equal(h.settingsReads(), 0);
});

test('output/tool flags in cause/error block fallback, including cyclic errors', async () => {
  for (const state of [{ outputStarted: true }, { outputEmitted: true }, { toolsExecuted: true }, { toolsExecuted: 1 }, { toolExecuted: true }]) {
    const h = harness();
    const cause = Object.assign(sdkError(503, 'overloaded'), state);
    const error = new Error('network timeout', { cause });
    Object.assign(cause, { cause: error });
    await assert.rejects(h.api.withModelFallback({ modelsToTry: ['a', 'b'], execute: async () => { throw error; },
      onSwitch: () => assert.fail('Unsafe replay') }), actual => actual === error);
    assert.equal(h.settingsReads(), 0);
  }
});

for (const progress of ['text emitted', 'thinking emitted', 'tool started']) {
  test(`${progress}: caller guard blocks unannotated errors after side effects`, async () => {
    const h = harness();
    let safe = true;
    let executions = 0;
    const error = sdkError(503, 'overloaded');
    await assert.rejects(h.api.withModelFallback({ modelsToTry: ['a', 'b'], canFallback: () => safe,
      execute: async () => { executions++; safe = false; throw error; },
      onSwitch: () => assert.fail('Unsafe replay'),
    }), actual => actual === error);
    assert.equal(executions, 1);
    assert.equal(h.settingsReads(), 0);
    assert.deepEqual(h.switches(), []);
  });
}

test('health bookkeeping failure cannot mask the provider cause', async () => {
  const h = harness(true);
  const original = sdkError(503, 'overloaded');
  await assert.rejects(h.api.withModelFallback({ modelsToTry: ['a'], execute: async () => { throw original; } }), error => {
    assert.ok(error instanceof h.api.LlmFallbackError);
    assert.equal(error.cause, original);
    return true;
  });
  assert.deepEqual(h.switches(), []);
});

test('actual Responses stream timeout after text emission never executes a fallback', async () => {
  const h = harness();
  const responses = h.responses();
  let requests = 0;
  let output = '';
  const client = { responses: { create: async () => {
    requests++;
    return (async function* () {
      yield { type: 'response.output_text.delta', delta: 'visible' };
      yield { type: 'error', code: 'timeout', message: 'provider timeout' };
    })();
  } } } as unknown as Parameters<typeof responses.streamOpenAIResponses>[0];
  await assert.rejects(h.api.withModelFallback({ modelsToTry: ['gpt-6-astra', 'unattempted'],
    execute: model => responses.streamOpenAIResponses(client, model, [{ role: 'user', content: 'hello' }], {
      onChunk: chunk => { output += chunk; },
    }),
  }), error => error instanceof responses.OpenAIResponsesError && error.outputStarted && error.code === 'timeout');
  assert.equal(output, 'visible');
  assert.equal(requests, 1);
  assert.equal(h.settingsReads(), 0);
  assert.deepEqual(h.switches(), []);
});

test('Claude policy already removes Opus sampling; refusal is a successful terminal result', async () => {
  const h = harness();
  const native = h.native();
  const request = native.applyAnthropicRequestPolicy({ model: 'anthropic/claude-opus-5-5',
    messages: [{ role: 'user', content: 'hello' }], temperature: 0.4, top_p: 0.8, top_k: 10 });
  for (const key of ['temperature', 'top_p', 'top_k']) assert.equal(Object.hasOwn(request, key), false);
  const refusal = { content: native.ANTHROPIC_REFUSAL_MESSAGE, stopReason: 'refusal' };
  const result = await h.api.withModelFallback({ modelsToTry: ['a', 'b'], execute: async () => refusal,
    onSwitch: () => assert.fail('Refusal must not switch models') });
  assert.equal(result.result, refusal);
  assert.deepEqual(h.switches(), []);
});

test('structured classifier handles cause, model 404, quota precedence and legacy statuses', () => {
  const { api } = harness();
  for (const [error, reason] of [
    [new Error('wrapped', { cause: sdkError(503, 'capacity') }), 'api_error'],
    [sdkError(404, 'missing', 'model_not_found'), 'model_unavailable'],
    [sdkError(429, 'billing limit', 'insufficient_quota'), 'quota_exceeded'],
    [new TypeError('fetch failed'), 'api_error'],
    [new Error('503 capacity'), 'api_error'],
    [new Error('HTTP 429 capacity'), 'rate_limit'],
    [new Error('status: 400 timeout'), null],
    [new Error('Unknown model foo-503-429'), null],
  ] as const) assert.equal(api.isRecoverableApiError(error), reason);
});
