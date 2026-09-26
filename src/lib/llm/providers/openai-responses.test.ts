import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { classifyFallbackError } from '../../llm-fallback-policy';
import type { ResponseInput, ResponseOutputItem } from 'openai/resources/responses/responses';
import {
  buildOpenAIResponsesRequest, callOpenAIResponses, copyOpenAIResponsesState,
  OpenAIResponsesError, shouldUseOpenAIResponses, streamOpenAIResponses,
  toOpenAIResponsesInput, type OpenAIResponsesMessage,
} from './openai-responses';

const tools = [{ type: 'function', function: {
  name: 'inspect', description: 'Inspect an image', parameters: { type: 'object', properties: {} },
} }];

test('refusal wins over an otherwise complete tool batch, including replay state', async () => {
  const output: ResponseOutputItem[] = [...nativeOutput, { type: 'message', id: 'refused', role: 'assistant', status: 'completed',
    content: [{ type: 'refusal', refusal: 'Cannot comply.' }] }];
  for (const run of [callOpenAIResponses, streamOpenAIResponses]) {
    const mock = mockClient([run === callOpenAIResponses ? Response.json(response(output)) : sse([completed(output)])]);
    const result = await run(mock.client, 'gpt-6-astra', [], { tools });
    assert.equal(result.tool_calls, undefined);
    assert.equal(result.refusal, 'Cannot comply.');
    assert.ok(!toOpenAIResponsesInput([copyOpenAIResponsesState(result, { role: 'assistant' })]).some(item => item.type === 'function_call'));
  }
});

test('a malformed later function prevents the entire completed batch from executing', async () => {
  const output: ResponseOutputItem[] = [...nativeOutput, { type: 'function_call', id: 'bad', call_id: 'bad',
    name: 'inspect', arguments: '{', status: 'completed' }];
  const mock = mockClient([sse([completed(output)])]);
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], { tools }), error => {
    assert.equal(classifyFallbackError(error), null);
    return /Invalid function call arguments/.test(String(error));
  });
});

test('raw iterator failure after hidden tool output is terminal to outer fallback', async () => {
  const failure = Object.assign(new Error('socket hang up'), { status: 503 });
  const client = { responses: { create: async () => (async function* () {
    yield { type: 'response.function_call_arguments.delta', delta: '{' };
    throw failure;
  })() } } as unknown as import('./openai-responses').OpenAIResponsesClient;
  await assert.rejects(streamOpenAIResponses(client, 'gpt-6-astra', [], { tools }), error => {
    assert.equal(classifyFallbackError(error), null);
    assert.equal((error as Error).cause, failure);
    return true;
  });
});
const nativeOutput: ResponseOutputItem[] = [
  { type: 'reasoning', id: 'rs_native', encrypted_content: 'opaque-ciphertext', summary: [{ type: 'summary_text', text: 'Checking.' }] },
  { type: 'message', id: 'msg_commentary', role: 'assistant', phase: 'commentary', status: 'completed',
    content: [{ type: 'output_text', text: 'Looking.', annotations: [] }] },
  { type: 'function_call', id: 'fc_item_not_call_id', call_id: 'call_native', name: 'inspect', arguments: '{"image":1}', status: 'completed' },
  { type: 'function_call', id: 'fc_second', call_id: 'call_second', name: 'inspect', arguments: '{"image":2}', status: 'completed' },
];
const finalOutput: ResponseOutputItem[] = [{ type: 'message', id: 'msg_final', role: 'assistant', phase: 'final_answer', status: 'completed',
  content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }];
const usage = { input_tokens: 11, input_tokens_details: { cached_tokens: 2 }, output_tokens: 7,
  output_tokens_details: { reasoning_tokens: 4 }, total_tokens: 18 };
function response(output: ResponseOutputItem[] = finalOutput, extra: Record<string, unknown> = {}) {
  return { id: 'resp_test', object: 'response', status: 'completed', output, usage, error: null, incomplete_details: null, ...extra };
}
function completed(output = finalOutput) {
  return { type: 'response.completed', sequence_number: 10, response: response(output) };
}
function sse(events: readonly object[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
function mockClient(replies: Array<Response | (() => Promise<Response>)>) {
  const requests: Record<string, unknown>[] = [];
  const signals: Array<AbortSignal | null | undefined> = [];
  const client = new OpenAI({ apiKey: 'not-a-real-key', maxRetries: 2,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      signals.push(init?.signal);
      const reply = replies.shift();
      assert.ok(reply, 'Unexpected network call or retry');
      return typeof reply === 'function' ? reply() : reply;
    },
  });
  return { client, requests, signals };
}

for (const streaming of [false, true]) {
  test(`${streaming ? 'streaming' : 'non-streaming'}: two SDK calls replay encrypted native state, images, phase and exact call IDs`, async () => {
    const mock = mockClient(streaming
      ? [sse([
        { type: 'response.output_item.added', output_index: 0, item: nativeOutput[0] },
        { type: 'response.reasoning_summary_text.delta', delta: 'Checking.' },
        { type: 'response.output_text.delta', delta: 'Look' },
        { type: 'response.output_text.delta', delta: 'ing.' },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_item_not_call_id', output_index: 2, delta: '{"image":' },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_item_not_call_id', output_index: 2, delta: '1}' },
        { type: 'response.output_item.done', output_index: 2, item: nativeOutput[2] },
        completed(nativeOutput),
      ]), sse([completed()])]
      : [Response.json(response(nativeOutput)), Response.json(response())]);
    const messages: OpenAIResponsesMessage[] = [
      { role: 'system', content: 'Old system' }, { role: 'developer', content: 'Be accurate' },
      { role: 'user', content: [{ type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' } },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] },
    ];
    const run = streaming ? streamOpenAIResponses : callOpenAIResponses;
    let visible = ''; let thinking = '';
    const first = await run(mock.client, 'openai/gpt-6-astra', messages, {
      tools, systemPrompt: 'New system', reasoningEffort: 'none', temperature: 0.3,
      toolChoice: { type: 'function', function: { name: 'inspect' } },
      onChunk: chunk => { visible += chunk; }, onThinkingChunk: chunk => { thinking += chunk; },
    });
    assert.equal(first.content, 'Looking.');
    assert.equal(first.thinkingContent, 'Checking.');
    assert.deepEqual(first.tool_calls?.map(call => call.id), ['call_native', 'call_second']);
    assert.equal(first.tool_calls?.[0].function.arguments, '{"image":1}');
    assert.deepEqual(first.usage, usage);
    assert.equal(first.totalTokens, 18);
    if (streaming) { assert.equal(visible, 'Looking.'); assert.equal(thinking, 'Checking.'); }
    assert.ok(!JSON.stringify(first).includes('opaque-ciphertext'));
    // Intermediate wrappers must copy state, just as the parent loops do.
    const wrapper = copyOpenAIResponsesState(first, { content: first.content, tool_calls: first.tool_calls });
    messages.push(copyOpenAIResponsesState(wrapper, { role: 'assistant', ...wrapper }));
    messages.push({ role: 'tool', tool_call_id: 'call_native', content: 'Image one' },
      { role: 'tool', tool_call_id: 'call_second', content: 'Image two' });
    assert.ok(shouldUseOpenAIResponses('gpt-6-astra', messages));
    const second = await run(mock.client, 'openai/gpt-6-astra', messages, { systemPrompt: 'New system' });
    assert.equal(second.content, 'Done.');
    assert.equal(mock.requests.length, 2);
    for (const request of mock.requests) {
      assert.equal(request.model, 'gpt-6-astra');
      assert.equal(request.store, false);
      assert.deepEqual(request.include, ['reasoning.encrypted_content']);
      assert.equal((request.reasoning as { effort: string }).effort, 'medium');
      assert.ok(!('temperature' in request));
      assert.ok(!('previous_response_id' in request));
    }
    assert.deepEqual(mock.requests[0].tools, [{ type: 'function', name: 'inspect', description: 'Inspect an image',
      parameters: { type: 'object', properties: {} }, strict: false }]);
    assert.deepEqual(mock.requests[0].tool_choice, { type: 'function', name: 'inspect' });
    const input = mock.requests[1].input as ResponseInput;
    assert.deepEqual(input.slice(3, 7), nativeOutput);
    assert.deepEqual(input.slice(7), [
      { type: 'function_call_output', call_id: 'call_native', output: 'Image one' },
      { type: 'function_call_output', call_id: 'call_second', output: 'Image two' },
    ]);
    assert.deepEqual(input[0], { role: 'system', content: 'New system' });
    assert.deepEqual(input[2], { role: 'user', content: [
      { type: 'input_text', text: 'What is this?' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'high' },
      { type: 'input_image', image_url: 'https://example.com/image.png', detail: 'auto' },
    ] });
  });
}

test('legacy assistant/tool translation and invalid inputs fail rather than silently lose content', () => {
  assert.deepEqual(toOpenAIResponsesInput([
    { role: 'assistant', content: 'I will check', tool_calls: [{ id: 'call_old', type: 'function', function: { name: 'inspect', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_old', content: [{ type: 'text', text: 'Result' }] },
  ]), [
    { role: 'assistant', content: 'I will check' },
    { type: 'function_call', call_id: 'call_old', name: 'inspect', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_old', output: [{ type: 'input_text', text: 'Result' }] },
  ]);
  assert.throws(() => toOpenAIResponsesInput([{ role: 'tool', content: 'Missing ID' }]), /requires tool_call_id/);
  assert.throws(() => toOpenAIResponsesInput([{ role: 'user', content: [{ type: 'input_audio' }] }]), /Unsupported/);
});

test('exact routing, sampling omission, explicit effort, and structured format translation', () => {
  for (const model of ['gpt-6-astra', 'openai/gpt-6-sol', 'gpt-6-luna']) {
    assert.ok(shouldUseOpenAIResponses(model, [], { tools }));
    assert.ok(shouldUseOpenAIResponses(model, [], { toolChoice: 'none' }));
    assert.ok(shouldUseOpenAIResponses(model, [{ role: 'assistant', tool_calls: [] }]));
    assert.equal(shouldUseOpenAIResponses(model, [{ role: 'user', content: 'Hello' }]), false);
    const params = buildOpenAIResponsesRequest(model, [], { temperature: 0.1, topP: 0.8, reasoningEffort: 'max' });
    assert.ok(!('temperature' in params)); assert.ok(!('top_p' in params));
    assert.equal(params.reasoning?.effort, 'max');
  }
  assert.equal(shouldUseOpenAIResponses('gpt-6-astra-preview', [], { tools }), false);
  assert.equal(shouldUseOpenAIResponses('gpt-5.4', [], { tools }), false);
  assert.equal(buildOpenAIResponsesRequest('gpt-6-sol', [], { reasoningEffort: 'none' }).reasoning?.effort, 'none');
  assert.equal(buildOpenAIResponsesRequest('gpt-6-astra', [], { reasoningEffort: 'invalid' }).reasoning?.effort, 'medium');
  const params = buildOpenAIResponsesRequest('gpt-6-astra', [], { responseSchema: { ignored: true },
    responseFormat: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' }, strict: true } } });
  assert.deepEqual(params.text?.format, { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: true });
});

test('streamed refusal is visible, returned, and preserved natively without duplication', async () => {
  const output: ResponseOutputItem[] = [{ type: 'message', id: 'msg_refusal', role: 'assistant', status: 'completed',
    content: [{ type: 'refusal', refusal: 'Cannot comply.' }] }];
  const mock = mockClient([sse([{ type: 'response.refusal.delta', delta: 'Cannot comply.' }, completed(output)])]);
  let visible = '';
  const result = await streamOpenAIResponses(mock.client, 'gpt-6-astra', [], { onChunk: chunk => { visible += chunk; } });
  assert.equal(visible, 'Cannot comply.'); assert.equal(result.refusal, visible); assert.equal(result.content, visible);
  assert.deepEqual(toOpenAIResponsesInput([copyOpenAIResponsesState(result, { role: 'assistant' })]), output);
});

for (const terminal of ['response.incomplete', 'response.failed', 'error', 'eof']) {
  test(`${terminal} after output throws with no retry or executable partial tools`, async () => {
    const event = terminal === 'error' ? { type: 'error', code: 'bad_request', message: 'reasoning_effort not supported' }
      : { type: terminal, response: response(nativeOutput, terminal === 'response.incomplete'
        ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }
        : { status: 'failed', error: { code: 'server_error', message: 'Failed' } }) };
    const mock = mockClient([sse([{ type: 'response.output_text.delta', delta: 'Partial' },
      { type: 'response.function_call_arguments.delta', delta: '{' }, ...(terminal === 'eof' ? [] : [event])])]);
    await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], { tools }), error => {
      assert.ok(error instanceof OpenAIResponsesError); assert.ok(error.outputStarted);
      if (terminal === 'response.incomplete') { assert.equal(error.code, 'max_output_tokens'); assert.deepEqual(error.usage, usage); }
      return true;
    });
    assert.equal(mock.requests.length, 1);
  });
}

test('non-streaming incomplete is not reported as successful', async () => {
  const mock = mockClient([Response.json(response(nativeOutput, { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }))]);
  await assert.rejects(callOpenAIResponses(mock.client, 'gpt-6-astra', [], { tools }), /content_filter/);
});

test('HTTP rejection preserves mandatory reasoning and disables SDK retries', async () => {
  const mock = mockClient([Response.json({ error: { message: 'reasoning_effort unsupported', type: 'server_error' } }, { status: 500 })]);
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], { tools }), /reasoning_effort unsupported/);
  assert.equal(mock.requests.length, 1);
  assert.equal((mock.requests[0].reasoning as { effort: string }).effort, 'medium');
});

test('already-aborted request never starts SDK work', async () => {
  const mock = mockClient([]); const controller = new AbortController(); controller.abort();
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(mock.requests.length, 0);
});

test('first-response timeout interrupts blocked fetch and aborts the HTTP signal', async () => {
  // Deliberately ignore abort until later; eventually settle so the SDK clears
  // its own ten-minute HTTP timeout rather than keeping the test process alive.
  const mock = mockClient([() => new Promise<Response>(resolve => {
    setTimeout(() => resolve(Response.json(response())), 50);
  })]);
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], { firstChunkTimeoutMsOverride: 20 }), /timeout/);
  assert.ok(mock.signals[0]?.aborted); assert.equal(mock.requests.length, 1);
});

test('inter-chunk timeout interrupts a blocked stream and does not retry partial output', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'));
  } });
  const mock = mockClient([new Response(body, { headers: { 'content-type': 'text/event-stream' } })]);
  let visible = '';
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], {
    interChunkTimeoutMsOverride: 20, onChunk: chunk => { visible += chunk; },
  }), /timeout/);
  assert.equal(visible, 'Partial'); assert.ok(mock.signals[0]?.aborted); assert.equal(mock.requests.length, 1);
});

test('caller abort after content stops the stream, including when the mock ignores abort', async () => {
  const mock = mockClient([sse([{ type: 'response.output_text.delta', delta: 'Partial' }, completed()])]);
  const controller = new AbortController();
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], {
    signal: controller.signal, onChunk: () => controller.abort(),
  }), { name: 'AbortError' });
  assert.ok(mock.signals[0]?.aborted); assert.equal(mock.requests.length, 1);
});

test('transport failure after visible output propagates without retry', async () => {
  let breakStream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    breakStream = controller;
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'));
  } });
  const mock = mockClient([new Response(body, { headers: { 'content-type': 'text/event-stream' } })]);
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], {
    onChunk: () => breakStream?.error(new Error('connection lost')),
  }), /connection lost/);
  assert.equal(mock.requests.length, 1); assert.ok(mock.signals[0]?.aborted);
});

test('callback failure aborts HTTP and is not retried', async () => {
  const mock = mockClient([sse([{ type: 'response.output_text.delta', delta: 'Partial' }, completed()])]);
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], {
    onChunk: () => { throw new Error('consumer failed'); },
  }), /consumer failed/);
  assert.equal(mock.requests.length, 1); assert.ok(mock.signals[0]?.aborted);
});

test('completed terminal response cannot expose an incomplete function item', async () => {
  const mock = mockClient([sse([completed([{ type: 'function_call', id: 'fc_partial', call_id: 'call_partial',
    name: 'inspect', arguments: '{', status: 'incomplete' }])])]);
  await assert.rejects(streamOpenAIResponses(mock.client, 'gpt-6-astra', [], { tools }), /incomplete output item/);
  assert.equal(mock.requests.length, 1);
});
