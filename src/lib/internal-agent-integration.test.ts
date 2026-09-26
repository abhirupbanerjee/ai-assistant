/** Offline tests of actual function bodies with SDK/DB boundaries injected.
 * No application import graph, credentials, runtime settings, or network calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import * as native from './anthropic-native-state';
import * as thinking from './llm-thinking';
import * as responses from './llm/providers/openai-responses';
import { getModelCompatibility } from './model-compatibility';
import { copyToolCompletionState } from './tool-completion-state';
import { guardFallbackAfterOutput, classifyFallbackError } from './llm-fallback-policy';

// Like the existing main-loop tests, compile source declarations rather than
// reimplementing the production logic or importing its DB/native dependency tree.
function loadFunctions(file: string, names: string[], dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const nodes = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
  assert.equal(nodes.length, names.length);
  const compiled = ts.transpileModule(nodes.map(node => node.getText(parsed).replace(/^export /, '')).join('\n')
    .replace("await import('@/lib/streaming/utils')", 'await loadStreaming()'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn { ${names.join(', ')} };`)(...Object.values(dependencies));
}

const noop = () => {};
const base = { ...native, ...thinking, ...responses, getModelCompatibility, copyToolCompletionState,
  guardFallbackAfterOutput,
  console: { log: noop, warn: noop, error: noop } };
const tools = [{ type: 'function', function: { name: 'inspect', parameters: { type: 'object', properties: {} } } }];
const spec = (model: string) => ({ model, provider: model.includes('claude') ? 'anthropic' : 'openai', temperature: 0.4, thinking_enabled: false });

function claudeMessage(turn: number, tool = false): Anthropic.Message {
  return { id: `msg_${turn}`, type: 'message', role: 'assistant', model: 'claude-fable-5-1',
    stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 4 }, content: [
      { type: 'thinking', thinking: `private-${turn}`, signature: `signed-${turn}` },
      { type: 'redacted_thinking', data: `redacted-${turn}` },
      { type: 'text', text: 'first', citations: null },
      ...(tool ? [{ type: 'tool_use', id: `call_${turn}`, name: 'inspect', input: { turn } }] : []),
      { type: 'text', text: 'second', citations: null },
    ] } as Anthropic.Message;
}

function internal(overrides: Record<string, unknown> = {}) {
  return loadFunctions('./llm-client.ts', ['getThinkingCompletionParams', 'isClaudeModelId', 'isGeminiModelId',
    'callAnthropic', 'emitUsage', 'stripThinkTags', 'logEmptyThinkingResponse', 'createInternalCompletion', 'isClaudeModel'], {
    ...base, REASONING_RATIO: 3, ADAPTIVE_RATIO: 2, FLOOR_REASONING: 2048,
    MAX_THINKING_BUDGET_ANTHROPIC_LEGACY: 40960,
    getModelOutputLimit: async () => 128000,
    isFireworksModel: () => false, isMoonshotModel: () => false, isDeepSeekModel: () => false,
    isMistralModel: () => false, isGeminiModel: () => false, isOpenAIModel: () => true,
    getLlmSettings: () => assert.fail('Unexpected config read'),
    ...overrides,
  }) as {
    getThinkingCompletionParams: (model: string, max: number, mode: string) => Promise<{ enabled: boolean; maxTokens: number; requestParams: Record<string, unknown> }>;
    createInternalCompletion: typeof import('./llm-client').createInternalCompletion;
  };
}

test('internal optional none survives disabled profiles; mandatory thinking keeps budget headroom', async () => {
  const api = internal();
  for (const model of ['gpt-6-sol', 'openai/gpt-6-luna']) {
    const params = await api.getThinkingCompletionParams(model, 100, 'disabled');
    assert.deepEqual(params, { enabled: false, maxTokens: 100, requestParams: { reasoning_effort: 'none' } });
  }
  for (const model of ['gpt-6-astra', 'claude-fable-5-1', 'anthropic/claude-opus-5-5']) {
    const params = await api.getThinkingCompletionParams(model, 100, 'disabled');
    assert.equal(params.enabled, true);
    assert.ok(params.maxTokens >= 2148);
    assert.ok((await api.getThinkingCompletionParams(model, 128000, 'disabled')).maxTokens <= 128000);
  }
});

test('internal OpenAI forwards none without removing real assistant history', async () => {
  let captured: unknown[] = [];
  const api = internal({ callOpenAIChat: async (...args: unknown[]) => { captured = args; return { content: 'done' }; } });
  const messages = [{ role: 'user' as const, content: 'old' }, { role: 'assistant' as const, content: 'real answer' },
    { role: 'user' as const, content: 'new' }, { role: 'assistant' as const, content: '{' }];
  assert.equal(await api.createInternalCompletion({ model: 'gpt-6-sol', messages, reasoningMode: 'disabled' }), 'done');
  assert.deepEqual(captured[1], messages.slice(0, -1));
  assert.equal((captured[2] as { reasoningEffort: string }).reasoningEffort, 'none');
  assert.equal(messages.length, 4);
});

for (const [model, effort] of [['claude-fable-5-1', 'high'], ['anthropic/claude-opus-5-5', 'medium']]) {
  test(`internal ${model}: native schema merges effort, no sampling/prefill, all text`, async () => {
    let request: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const api = internal({ getAnthropicClient: async () => ({ messages: { create: async (body: typeof request) => {
      request = body; return claudeMessage(1);
    } } }) });
    const schema = { type: 'object', properties: { value: { type: 'string' } } };
    const messages = [{ role: 'user' as const, content: 'old' }, { role: 'assistant' as const, content: 'historical' },
      { role: 'user' as const, content: 'new' }, { role: 'assistant' as const, content: '{' }];
    for (const structured of [{ responseSchema: schema },
      { responseFormat: { type: 'json_schema' as const, json_schema: { name: 'answer', schema } } }]) {
      const result = await api.createInternalCompletion({ model, messages, temperature: 0.2, maxTokens: 100,
        reasoningMode: 'disabled', ...structured });
      assert.equal(result, 'firstsecond');
      assert.equal(request?.thinking?.type, 'adaptive');
      assert.deepEqual(request?.output_config, { effort, format: { type: 'json_schema', schema } });
      assert.equal(Object.hasOwn(request!, 'temperature'), false);
      assert.deepEqual(request?.messages, messages.slice(0, -1));
      assert.ok(request!.max_tokens > 100);
    }
  });
}

function router(overrides: Record<string, unknown> = {}) {
  return loadFunctions('./agent/llm-router.ts', ['prepareGenerationOptions', 'generateWithModel', 'dispatchGenerateWithModel',
    'generateAnthropic', 'generateOpenAI', 'isRequestParamCompatibilityError', 'extractThinkTags',
    'getModelContextLimit', 'getModelOutputLimit'], {
    ...base, isModelThinkingCapable: async () => false,
    resolveProviderCredentialForRequest: async () => ({ credentialId: 'offline' }), recordTokenUsage: noop,
    stripOpenAIPrefix: (model: string) => model.replace(/^openai\//, ''), requiresMaxCompletionTokens: () => true,
    ...overrides,
  }) as {
    generateWithModel: typeof import('./agent/llm-router').generateWithModel;
    getModelContextLimit: (model: string) => Promise<number>;
    getModelOutputLimit: (model: string) => Promise<number>;
  };
}

test('router Claude enforces mandatory defaults with forcePlain and copies native state', async () => {
  for (const model of ['claude-fable-5-1', 'claude-opus-5-5']) {
    let request: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const api = router({ getAnthropicClient: async () => ({ messages: { create: async (body: typeof request) => {
      request = body; return claudeMessage(1);
    } } }) });
    const result = await api.generateWithModel({ ...spec(model), provider: 'anthropic' }, 'hello', { forcePlain: true });
    assert.equal(result.content, 'firstsecond');
    assert.equal(request?.thinking?.type, 'adaptive');
    assert.equal(request?.output_config?.effort, getModelCompatibility(model)?.defaultEffort);
    assert.equal(Object.hasOwn(request!, 'temperature'), false);
    assert.deepEqual(native.getAnthropicNativeContent(result), claudeMessage(1).content);
    assert.equal(await api.getModelContextLimit(model), 1000000);
  }
});

test('router mandatory models never retry with weakened parameters; refusals remain final', async () => {
  let attempts = 0;
  const api = router({ getAnthropicClient: async () => ({ messages: { create: async () => {
    attempts++; throw new Error('unsupported thinking parameter');
  } } }) });
  await assert.rejects(api.generateWithModel({ ...spec('claude-fable-5-1'), provider: 'anthropic' }, 'hello'));
  assert.equal(attempts, 1);
  const refusal = router({ getAnthropicClient: async () => ({ messages: { create: async () => ({
    ...claudeMessage(1), content: [], stop_reason: 'refusal',
  }) } }) });
  assert.equal((await refusal.generateWithModel({ ...spec('claude-opus-5-5'), provider: 'anthropic' }, 'hello')).content,
    native.ANTHROPIC_REFUSAL_MESSAGE);
});

function openaiMock() {
  const requests: Record<string, unknown>[] = [];
  const client = { responses: { create: async (request: Record<string, unknown>) => {
    requests.push(request);
    return { id: 'r1', status: 'completed', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 }, output: [
      { type: 'reasoning', id: 'rs1', encrypted_content: 'encrypted', summary: [] },
      { type: 'message', id: 'm1', role: 'assistant', status: 'completed', phase: 'final_answer',
        content: [{ type: 'output_text', text: 'done', annotations: [] }] },
    ] };
  } }, chat: { completions: { create: () => assert.fail('Unexpected Chat Completions request') } } };
  return { requests, client };
}

for (const model of ['gpt-6-astra', 'openai/gpt-6-sol', 'gpt-6-luna']) {
  test(`router ${model}: Responses with no tools, no sampling, correct effort and native wrapper`, async () => {
    const mock = openaiMock();
    const api = router({ getOpenAIClient: async () => mock.client });
    const result = await api.generateWithModel({ ...spec(model), provider: 'openai' }, 'hello', { forcePlain: true, temperature: 0.4 });
    assert.equal(result.content, 'done');
    const request = mock.requests[0];
    assert.deepEqual(request.reasoning, { effort: model.includes('astra') ? 'medium' : 'none' });
    for (const key of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty']) assert.equal(Object.hasOwn(request, key), false);
    const replay = responses.toOpenAIResponsesInput([copyToolCompletionState(result, { role: 'assistant', content: result.content })]);
    assert.equal(replay[0].type, 'reasoning');
    assert.equal(await api.getModelOutputLimit(model), 128000);
  });
}

function subagent(overrides: Record<string, unknown> = {}) {
  return loadFunctions('./agent/subagent.ts', ['runSubagentTaskLoop', 'trimMessagesForContext', 'rebuildSubagentHistory',
    'estimateSubagentHistoryTokens', 'truncateToolResult', 'truncateObjectValue'], {
    ...base, estimateTokens: (text: string) => Math.ceil(text.length / 4),
    DEFAULT_MAX_TOKENS: 100000, CONTEXT_SAFETY_MARGIN: 8000, MAX_TOOL_RESULT_CHARS: 4000,
    getModelContextLimit: async () => 1000000, getEnabledToolsForPlan: async () => ['inspect'],
    getToolDefinitionsForSubagent: async () => tools, resolveSkillsForTask: async () => '',
    AVAILABLE_TOOLS: {}, isMcpTool: () => false,
    ...overrides,
  }) as {
    runSubagentTaskLoop: typeof import('./agent/subagent').runSubagentTaskLoop;
    trimMessagesForContext: (messages: OpenAI.Chat.ChatCompletionMessageParam[], max: number) => {
      trimmedMessages: OpenAI.Chat.ChatCompletionMessageParam[]; droppedTurns: number;
    };
  };
}

test('subagent actual two-turn Claude loop replays signed/redacted blocks and final tools-disabled history', async () => {
  let turn = 0;
  const histories: Anthropic.MessageParam[][] = [];
  const model = 'claude-fable-5-1';
  const api = subagent({ resolveExecutorModelForTask: async () => ({ model: spec(model) }),
    generateToolCompletionWithFallback: async (_spec: unknown, messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
      histories.push(native.convertOpenAIMessagesToAnthropic(messages, { model }).anthropicMessages);
      turn++;
      const result = native.anthropicCompletionFromFinalMessage(claudeMessage(turn, turn <= 2), model);
      return copyToolCompletionState(result, { ...result, tokens_used: 7, model_used: model });
    },
  });
  const result = await api.runSubagentTaskLoop({ id: 1, description: 'inspect' } as never, {} as never, {} as never, undefined, 2);
  assert.equal(result.content, 'firstsecond');
  assert.equal(result.hit_iteration_limit, true);
  assert.deepEqual(histories[1].find(message => message.role === 'assistant')?.content, claudeMessage(1, true).content);
  assert.deepEqual(histories[2].filter(message => message.role === 'assistant').map(message => message.content),
    [claudeMessage(1, true).content, claudeMessage(2, true).content]);
});

test('subagent trim invalidates all native tool exchanges, preserves images, never mutates original', () => {
  const first = native.anthropicCompletionFromFinalMessage(claudeMessage(1, true), 'claude-fable-5-1');
  const second = native.anthropicCompletionFromFinalMessage(claudeMessage(2, true), 'claude-fable-5-1');
  const image: OpenAI.Chat.ChatCompletionMessageParam = { role: 'user', content: [
    { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
  ] };
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'system' }, image,
    copyToolCompletionState(first, { role: 'assistant', content: 'first', tool_calls: first.tool_calls }),
    { role: 'tool', tool_call_id: 'call_1', content: 'x'.repeat(10000) },
    { role: 'user', content: 'continue' },
    copyToolCompletionState(second, { role: 'assistant', content: 'second', tool_calls: second.tool_calls }),
    { role: 'tool', tool_call_id: 'call_2', content: 'ok' },
  ];
  const api = subagent();
  assert.equal(api.trimMessagesForContext(messages, 1000000).trimmedMessages, messages);
  const rebuilt = api.trimMessagesForContext(messages, 1000);
  assert.ok(rebuilt.droppedTurns > 0);
  assert.deepEqual(rebuilt.trimmedMessages, [messages[0], image, messages[4]]);
  assert.equal(messages.length, 7);
  assert.ok(native.getAnthropicNativeContent(messages[2]));
  assert.doesNotThrow(() => native.convertOpenAIMessagesToAnthropic(rebuilt.trimmedMessages, { model: 'claude-fable-5-1' }));
});

test('subagent orphan cleanup is a rebuild even under budget', () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: 'system' },
    { role: 'user', content: 'task' }, { role: 'tool', tool_call_id: 'orphan', content: 'ok' }];
  const result = subagent().trimMessagesForContext(messages, 10000);
  assert.equal(result.droppedTurns, 1);
  assert.deepEqual(result.trimmedMessages, messages.slice(0, 2));
});

test('legacy compaction retains the newer complete tool exchange and accepts non-Responses content', () => {
  const call = (id: string) => ({ role: 'assistant' as const, content: null,
    tool_calls: [{ id, type: 'function' as const, function: { name: 'inspect', arguments: '{}' } }] });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'system' }, { role: 'user', content: 'task' },
    call('old'), { role: 'tool', tool_call_id: 'old', content: 'x'.repeat(10000) },
    call('new'), { role: 'tool', tool_call_id: 'new', content: 'keep this result' },
    { role: 'assistant', content: [{ type: 'refusal', refusal: 'Cannot comply.' }] },
  ];
  assert.deepEqual(subagent().trimMessagesForContext(messages, 1000).trimmedMessages,
    [messages[0], messages[1], ...messages.slice(4)]);
});

test('subagent pins an initial fallback model and prohibits fallback on subsequent/final turns', async () => {
  const models: string[] = [];
  const allowed: boolean[] = [];
  const api = subagent({ resolveExecutorModelForTask: async () => ({ model: spec('gpt-6-astra') }),
    generateToolCompletionWithFallback: async (model: { model: string }, _messages: unknown, _tools: unknown,
      _choice: unknown, _temperature: unknown, _max: unknown, _timeout: unknown, allow: boolean) => {
      models.push(model.model); allowed.push(allow);
      return { model_used: 'gpt-6-sol', tokens_used: 1, content: 'progress',
        tool_calls: models.length <= 2 ? [{ id: `call_${models.length}`, type: 'function',
          function: { name: 'inspect', arguments: '{}' } }] : undefined };
    },
  });
  await api.runSubagentTaskLoop({ id: 1, description: 'inspect' } as never, {} as never, {} as never, undefined, 2);
  assert.deepEqual(models, ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-sol']);
  assert.deepEqual(allowed, [true, false, false]);
});

for (const compact of [false, true]) {
  test(`subagent actual Responses loop: ${compact ? 'committed native compaction' : 'two native turns'} and explicit none final`, async () => {
    const model = 'gpt-6-astra';
    let turn = 0;
    const requests: Record<string, unknown>[] = [];
    const choices: unknown[] = [];
    const client = { responses: { create: async (request: Record<string, unknown>) => {
      requests.push(request);
      turn++;
      return { id: `resp_${turn}`, status: 'completed', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
        output: turn <= (compact ? 3 : 2) ? [
          { type: 'reasoning', id: `rs_${turn}`, encrypted_content: compact && turn === 2 ? 'x'.repeat(140000) : `cipher-${turn}`, summary: [] },
          { type: 'function_call', id: `item_${turn}`, call_id: `call_${turn}`, name: 'inspect', arguments: `{ "turn": ${turn} }`, status: 'completed' },
        ] : [{ type: 'message', id: 'final', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: 'done', annotations: [] }] }] };
    } } } as unknown as responses.OpenAIResponsesClient;
    const api = subagent({ resolveExecutorModelForTask: async () => ({ model: spec(model) }),
      getModelContextLimit: async () => compact ? 40000 : 1000000,
      generateToolCompletionWithFallback: async (_spec: unknown, messages: OpenAI.Chat.ChatCompletionMessageParam[],
        suppliedTools: unknown[], toolChoice: unknown) => {
        choices.push(toolChoice);
        assert.equal(responses.shouldUseOpenAIResponses(model, messages, { tools: suppliedTools, toolChoice }), true);
        const result = await responses.callOpenAIResponses(client, model, messages, { tools: suppliedTools, toolChoice });
        return copyToolCompletionState(result, { ...result, tokens_used: result.totalTokens, model_used: model });
      },
    });
    const result = await api.runSubagentTaskLoop({ id: 1, description: 'inspect' } as never, {} as never, {} as never,
      undefined, compact ? 3 : 2);
    assert.equal(result.content, 'done');
    assert.equal(choices.at(-1), 'none');
    const lastInput = requests.at(-1)!.input as Array<Record<string, unknown>>;
    const ids = lastInput.filter(item => item.type === 'reasoning').map(item => item.id);
    assert.deepEqual(ids, compact ? ['rs_3'] : ['rs_1', 'rs_2']);
    const calls = lastInput.filter(item => item.type === 'function_call').map(item => item.call_id);
    assert.deepEqual(calls, compact ? ['call_3'] : ['call_1', 'call_2']);
    if (compact) {
      const rebuilt = requests[2].input as Array<Record<string, unknown>>;
      assert.equal(rebuilt.some(item => item.type === 'reasoning' || item.type === 'function_call_output'), false);
    }
  });
}

test('tools-disabled final after a fully compacted prefix still selects Responses', async () => {
  let called = false;
  const model = 'gpt-6-luna';
  const api = subagent({ resolveExecutorModelForTask: async () => ({ model: spec(model) }),
    generateToolCompletionWithFallback: async (_spec: unknown, messages: OpenAI.Chat.ChatCompletionMessageParam[],
      suppliedTools: unknown[], toolChoice: unknown) => {
      called = true;
      assert.equal(toolChoice, 'none');
      assert.equal(responses.shouldUseOpenAIResponses(model, messages, { tools: suppliedTools, toolChoice }), true);
      return { content: 'done', tokens_used: 1, model_used: model };
    },
  });
  await api.runSubagentTaskLoop({ id: 1, description: 'inspect' } as never, {} as never, {} as never, undefined, 0);
  assert.equal(called, true);
});

test('subagent refusal or incomplete native response never executes tools or bypasses refusal', async () => {
  for (const stopReason of ['refusal', 'max_tokens'] as const) {
    let calls = 0;
    const model = 'claude-fable-5-1';
    const api = subagent({ resolveExecutorModelForTask: async () => ({ model: spec(model) }),
      AVAILABLE_TOOLS: { inspect: { category: 'autonomous', execute: () => assert.fail('Unsafe tool execution') } },
      generateToolCompletionWithFallback: async () => {
        calls++;
        const result = native.anthropicCompletionFromFinalMessage({ ...claudeMessage(1, true), stop_reason: stopReason }, model);
        return copyToolCompletionState(result, { ...result, tokens_used: 7, model_used: model });
      },
    });
    const result = await api.runSubagentTaskLoop({ id: 1, description: 'inspect' } as never, {} as never, {} as never);
    assert.equal(calls, 1);
    assert.deepEqual(result.tools_used, []);
    assert.equal(result.hit_iteration_limit, false);
    assert.equal(result.content.includes('Subagent failed'), stopReason === 'max_tokens');
  }
});

test('legacy internal Claude keeps supported assistant prefixes and optional thinking behavior', async () => {
  let request: Anthropic.MessageCreateParamsNonStreaming | undefined;
  const api = internal({ getAnthropicClient: async () => ({ messages: { create: async (body: typeof request) => {
    request = body; return claudeMessage(1);
  } } }) });
  const messages = [{ role: 'user' as const, content: 'JSON' }, { role: 'assistant' as const, content: '{' }];
  await api.createInternalCompletion({ model: 'claude-haiku-4-5-20251001', messages, reasoningMode: 'disabled' });
  assert.deepEqual(request?.messages, messages);
  assert.notEqual(request?.thinking?.type, 'adaptive');
});

function directOpenAI(replies: Array<object[] | Error>) {
  let calls = 0;
  const api = loadFunctions('./llm/providers/openai.ts', ['streamOpenAICompletion', 'stripOpenAIPrefix',
    'requiresMaxCompletionTokens', 'isNonChatOpenAIModel'], {
    ...base, normalizeModelId: (model: string) => model.replace(/^openai\//, ''), FIRST_CHUNK_TIMEOUT_MS: 1000,
    loadStreaming: async () => ({ getStreamingConfigMs: async () => ({ TOOL_TIMEOUT_MS: 1000 }) }),
    getOpenAIDirectClient: async () => ({ chat: { completions: { create: async () => {
      calls++;
      const reply = replies.shift();
      assert.ok(reply, 'Unexpected retry');
      if (reply instanceof Error) throw reply;
      return (async function* () { for (const chunk of reply) {
        if (chunk instanceof Error) throw chunk;
        yield chunk;
      } })();
    } } } }),
  }) as { streamOpenAICompletion: typeof import('./llm/providers/openai').streamOpenAICompletion };
  return { ...api, calls: () => calls };
}

const chatToolChunk = (args = '{}') => ({ choices: [{ delta: { tool_calls: [
  { index: 0, id: 'call', type: 'function', function: { name: 'inspect', arguments: args } },
] } }] });
const chatFinish = (finish_reason: string) => ({ choices: [{ delta: {}, finish_reason }] });

test('legacy direct OpenAI only exposes complete, valid tool batches', async () => {
  for (const chunks of [[chatToolChunk()], [chatToolChunk(), chatFinish('length')],
    [chatToolChunk(), chatFinish('content_filter')], [chatToolChunk('{'), chatFinish('tool_calls')]]) {
    const api = directOpenAI([chunks]);
    await assert.rejects(api.streamOpenAICompletion('gpt-4o', [], { tools }), error => {
      assert.equal(classifyFallbackError(error), null);
      return true;
    });
    assert.equal(api.calls(), 1);
  }
  const api = directOpenAI([[chatToolChunk(), chatFinish('tool_calls')]]);
  assert.equal((await api.streamOpenAICompletion('gpt-4o', [], { tools })).tool_calls?.[0].id, 'call');
});

test('legacy direct OpenAI refusal and output-started failures never run tools or retry', async () => {
  const api = directOpenAI([[chatToolChunk(), { choices: [{ delta: { refusal: 'Cannot comply.' } }] }, chatFinish('stop')]]);
  const result = await api.streamOpenAICompletion('gpt-4o', [], { tools });
  assert.equal(result.tool_calls, undefined);
  assert.equal(result.content, 'Cannot comply.');
  const failure = Object.assign(new Error('503 reasoning_effort unsupported'), { status: 503 });
  const failed = directOpenAI([[chatToolChunk(), failure]]);
  await assert.rejects(failed.streamOpenAICompletion('gpt-5.4', [], { tools, reasoningEffort: 'high' }), error => {
    assert.equal(classifyFallbackError(error), null);
    return true;
  });
  assert.equal(failed.calls(), 1);
});

test('optional GPT6 off effort is not stripped by a Chat parameter retry', async () => {
  const api = directOpenAI([Object.assign(new Error('400 reasoning_effort unsupported'), { status: 400 })]);
  await assert.rejects(api.streamOpenAICompletion('gpt-6-sol', [], { reasoningEffort: 'none' }));
  assert.equal(api.calls(), 1);
});

test('shared compatible stream never parameter-retries after hidden tool output', async () => {
  let calls = 0;
  const failure = Object.assign(new Error('400 reasoning_effort is unsupported'), { status: 400 });
  const api = loadFunctions('./openai.ts', ['streamOneCompletion', 'streamOneCompletionWithThinkingRetry'], {
    ...base, logger: { warn: noop }, FIRST_CHUNK_TIMEOUT_MS: 1000, FIRST_CHUNK_TIMEOUT_OLLAMA_MS: 1000,
    getStreamingConfigMs: async () => ({ TOOL_TIMEOUT_MS: 1000 }), isThinkTagModel: () => false,
  }) as { streamOneCompletionWithThinkingRetry: (...args: unknown[]) => Promise<unknown> };
  const client = { chat: { completions: { create: async () => {
    calls++;
    return (async function* () { yield chatToolChunk(); throw failure; })();
  } } } };
  await assert.rejects(api.streamOneCompletionWithThinkingRetry(client,
    { model: 'deepseek-chat', messages: [], reasoning_effort: 'high' },
    { requestParams: { reasoning_effort: 'high' } }), error => {
    assert.equal(classifyFallbackError(error), null);
    assert.equal((error as Error).cause, failure);
    return true;
  });
  assert.equal(calls, 1);
});
