/**
 * Offline front-door contract tests. Compile the actual function declarations
 * from openai.ts into an injected scope, avoiding its DB/native import graph.
 * The function bodies are not reimplemented; only external services are mocked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import * as native from './anthropic-native-state';
import * as thinking from './llm-thinking';
import { getModelCompatibility } from './model-compatibility';
import { copyToolCompletionState } from './tool-completion-state';
import { guardFallbackAfterOutput, classifyFallbackError } from './llm-fallback-policy';
import { streamOpenAIResponses, type OpenAIResponsesClient } from './llm/providers/openai-responses';

const noop = () => {};

test('Claude transport failure after hidden thinking is terminal to outer fallback', async () => {
  const failure = Object.assign(new Error('socket hang up'), { status: 503 });
  const handlers: Record<string, (...args: any[]) => void> = {};
  const api = harness();
  const client = { messages: { stream: (_params: unknown, options: { maxRetries: number }) => {
    assert.equal(options.maxRetries, 0);
    return { on: (name: string, callback: (...args: any[]) => void) => { handlers[name] = callback; },
      finalMessage: async () => {
        handlers.streamEvent({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } });
        throw failure;
      } };
  } } } as unknown as Anthropic;
  await assert.rejects(api.streamAnthropicCompletion(client, {
    model: 'claude-fable-5-1', messages: [{ role: 'user', content: 'q' }], max_tokens: 4096,
  }), error => {
    assert.equal(classifyFallbackError(error), null);
    assert.equal((error as Error).cause, failure);
    return true;
  });
});

test('delegated fallback stops after prior tools or an explicit post-compaction guard', async () => {
  const failure = Object.assign(new Error('service unavailable'), { status: 503 });
  const api = harness({ streamOpenAICompletion: async () => { throw failure; } });
  const spec = { provider: 'openai' as const, model: 'gpt-6-astra', temperature: 0.4 };
  for (const history of [[{ role: 'tool' as const, tool_call_id: 'old', content: 'done' }], []]) {
    await assert.rejects(api.generateToolCompletionWithFallback(spec, history, tools as OpenAI.Chat.ChatCompletionTool[],
      'auto', undefined, undefined, undefined, history.length > 0), error => error === failure);
  }
});
const tools = [{ type: 'function', function: { name: 'inspect', parameters: { type: 'object', properties: {} } } }];
const source = readFileSync(new URL('./openai.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('openai.ts', source, ts.ScriptTarget.Latest, true);
const names = ['streamAnthropicCompletion', 'generateToolCompletion', 'generateToolCompletionWithFallback',
  'generateResponseWithTools', 'convertToolsToAnthropic', 'truncateContextToBudget'];
const declarations = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
assert.equal(declarations.length, names.length);
const compiled = ts.transpileModule(declarations.map(node => node.getText(parsed).replace(/^export /, '')).join('\n')
  .replace("await import('./llm-fallback')", 'await loadFallback()'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

function harness(overrides: Record<string, unknown> = {}) {
  const dependencies = {
    ...native, ...thinking, getModelCompatibility, copyToolCompletionState, guardFallbackAfterOutput,
    console: { log: noop, warn: noop }, logger: { info: noop, warn: noop, debug: noop },
    FIRST_CHUNK_TIMEOUT_MS: 1000, SUBAGENT_INTER_CHUNK_TIMEOUT_MS: 1000,
    OLLAMA_NUM_CTX: 16384, OLLAMA_ALLOWED_TOOLS: new Set(), SKILL_MAPPABLE_TOOLS: new Set(),
    isClaudeModel: (model: string) => model.includes('claude-'),
    getAnthropicModelId: (model: string) => model.replace(/^anthropic\//, ''),
    isOpenAIModel: (model: string) => model.includes('gpt-'),
    isFireworksModel: () => false, isOllamaModel: () => false, isOllamaCloudModel: () => false,
    isMoonshotModel: () => false, isDeepSeekModel: () => false, isAzureFoundryModel: () => false,
    isMistralModel: () => false, isGeminiModel: () => false,
    getOpenAIDirectClient: async () => ({}), requiresMaxCompletionTokens: () => true,
    getLlmSettings: async () => ({ model: 'gpt-6-astra', temperature: 0.4 }),
    getLimitsSettings: async () => ({ maxTotalToolCalls: 10, maxPerToolCalls: 10, conversationHistoryMessages: 20 }),
    getEffectiveMaxTokens: async () => 4096,
    isToolCapableModelFromDb: async () => true,
    isModelThinkingCapable: async () => false,
    isModelForcedToolCapable: async () => true,
    isModelParallelToolCapable: async () => false,
    buildConversationContext: (history: unknown[]) => ({ followUp: { isFollowUp: false },
      history: { all: history }, cache: { key: 'test', isCacheable: false } }),
    getHistoryForAPI: (ctx: { history: { all: unknown[] } }) => ctx.history.all,
    formatUserMessage: (_ctx: unknown, _context: unknown, user: string) => user,
    countTokens: (text: string) => text.length,
    getToolDefinitions: async () => tools,
    resolveSkills: async () => ({}), resolveToolRouting: async () => ({ matches: [] }),
    determineToolChoice: () => 'required',
    executeTool: async () => JSON.stringify({ success: true, data: [] }),
    isAgentTool: () => false, isTerminalTool: async () => false,
    getToolDisplayName: (name: string) => name,
    getStreamingConfigMs: async () => ({ TOOL_TIMEOUT_MS: 1000 }),
    loadFallback: async () => ({ isRecoverableApiError: () => { throw new Error('Unexpected fallback'); }, markModelUnhealthy: noop }),
    streamOneCompletionWithThinkingRetry: () => { throw new Error('Unexpected Chat Completions fallback'); },
    ...overrides,
  };
  // The returned signatures come from production, without importing it at runtime.
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn { ${names.join(', ')} };`)(...Object.values(dependencies)) as {
    generateToolCompletion: typeof import('./openai').generateToolCompletion;
    generateToolCompletionWithFallback: typeof import('./openai').generateToolCompletionWithFallback;
    generateResponseWithTools: typeof import('./openai').generateResponseWithTools;
    streamAnthropicCompletion: (...args: unknown[]) => Promise<ReturnType<typeof native.anthropicCompletionFromFinalMessage>>;
  };
}

function claudeMessage(turn: number, stop: Anthropic.Message['stop_reason'] = 'tool_use'): Anthropic.Message {
  return { id: `msg_${turn}`, model: 'claude-fable-5-1', type: 'message', role: 'assistant',
    stop_reason: stop, stop_sequence: null, container: null,
    content: stop === 'refusal' ? [] : [
      { type: 'thinking', thinking: `thought-${turn}`, signature: `signature-${turn}` },
      { type: 'redacted_thinking', data: `redacted-${turn}` },
      ...(stop === 'tool_use' ? [{ type: 'tool_use' as const, id: `call_${turn}`, name: 'inspect',
        input: { turn }, caller: { type: 'direct' as const } }] : [{ type: 'text' as const, text: 'done', citations: null }]),
    ], usage: { input_tokens: 4, output_tokens: 5 } as Anthropic.Usage };
}

function claudeMock(replies: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsStreaming[] = [];
  const client = { messages: { stream(params: Anthropic.MessageCreateParamsStreaming) {
    requests.push(structuredClone(params));
    const message = replies.shift();
    assert.ok(message, 'unexpected Claude request');
    const handlers = new Map<string, (...args: unknown[]) => void>();
    return {
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      finalMessage: async () => {
        handlers.get('streamEvent')?.({ type: 'content_block_delta', index: 0,
          delta: { type: 'thinking_delta', thinking: 'live' } });
        for (const block of message.content) if (block.type === 'text') handlers.get('text')?.(block.text);
        return message;
      },
    };
  } } };
  return { requests, client };
}

for (const model of ['claude-fable-5-1', 'claude-opus-5-5']) {
  test(`actual main loop: ${model} replays two native turns, image and downgraded routing`, async () => {
    const mock = claudeMock([claudeMessage(1), claudeMessage(2), claudeMessage(3, 'end_turn')]);
    let display = '';
    const api = harness({ getAnthropicClient: async () => mock.client,
      resolveToolRouting: async () => ({ matches: [{ toolName: 'inspect', forceMode: 'required' }] }) });
    const result = await api.generateResponseWithTools('system', [], '', 'inspect', true, [],
      { onThinkingChunk: text => { display += text; } },
      [{ filename: 'image.png', mimeType: 'image/png', base64: 'AAAA' }],
      undefined, undefined, undefined, undefined, undefined, model);
    assert.equal(result.content, 'done');
    assert.equal(result.totalTokens, 27);
    assert.equal(mock.requests.length, 3);
    assert.equal(display, 'livelivelive'); // Not duplicated with final-message thinking.
    for (const request of mock.requests) {
      assert.equal(request.thinking?.type, 'adaptive');
      assert.deepEqual(request.tool_choice, { type: 'auto' });
      assert.deepEqual(request.output_config, { effort: model.includes('fable') ? 'high' : 'medium' });
      assert.ok(!('temperature' in request));
    }
    assert.deepEqual(mock.requests[2].messages[1].content, claudeMessage(1).content);
    assert.deepEqual(mock.requests[2].messages[3].content, claudeMessage(2).content);
    assert.equal((mock.requests[2].messages[0].content as Anthropic.ContentBlockParam[])[1].type, 'image');
    assert.deepEqual(native.getAnthropicNativeContent(result.fullHistory[2]), claudeMessage(1).content);
  });
}

test('actual completion and fallback wrappers retain Claude state; refusal does not invoke fallback', async () => {
  const mock = claudeMock([claudeMessage(1), claudeMessage(2, 'refusal')]);
  const api = harness({ getAnthropicClient: async () => mock.client });
  const spec = { provider: 'anthropic' as const, model: 'claude-fable-5-1', thinking_enabled: false, temperature: 0.3 };
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'user', content: [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ] }];
  const first = await api.generateToolCompletionWithFallback(spec, messages, tools as OpenAI.Chat.ChatCompletionTool[],
    { type: 'function', function: { name: 'inspect' } });
  assert.deepEqual(native.getAnthropicNativeContent(first), claudeMessage(1).content);
  messages.push(copyToolCompletionState(first, { role: 'assistant', content: first.content, tool_calls: first.tool_calls }));
  messages.push({ role: 'tool', tool_call_id: 'call_1', content: 'ok' });
  const second = await api.generateToolCompletionWithFallback(spec, messages, tools as OpenAI.Chat.ChatCompletionTool[], 'required');
  assert.equal(second.content, native.ANTHROPIC_REFUSAL_MESSAGE);
  assert.equal(second.tool_calls, undefined);
  assert.equal(mock.requests.length, 2);
  assert.deepEqual(mock.requests[1].messages[1].content, claudeMessage(1).content);
  assert.deepEqual(mock.requests[0].tool_choice, { type: 'auto' });
});

function responsesMock() {
  const requests: Array<Record<string, unknown>> = [];
  let turn = 0;
  const outputs = [1, 2].map(n => [
    { type: 'reasoning', id: `rs_${n}`, encrypted_content: `cipher-${n}`, summary: [] },
    { type: 'message', id: `msg_${n}`, role: 'assistant', status: 'completed', phase: 'commentary',
      content: [{ type: 'output_text', text: 'checking', annotations: [] }] },
    { type: 'function_call', id: `item_${n}`, call_id: `call_${n}`, name: 'inspect', arguments: '{}', status: 'completed' },
  ]);
  const client = { responses: { create: async (request: Record<string, unknown>) => {
    requests.push(structuredClone(request));
    const n = turn++;
    return (async function* () {
      yield { type: 'response.completed', response: { id: `resp_${n}`, status: 'completed',
        output: outputs[n] ?? [{ type: 'message', id: 'final', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: 'done', annotations: [] }] }],
        usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 } } };
    })();
  } } } as unknown as OpenAIResponsesClient;
  return { requests, outputs, stream: (model: string, messages: Parameters<typeof streamOpenAIResponses>[2],
    options: Parameters<typeof streamOpenAIResponses>[3]) => streamOpenAIResponses(client, model, messages, options) };
}

for (const capped of [false, true]) {
  test(`actual OpenAI main loop: two native tool turns and ${capped ? 'tool-limit' : 'normal'} final turn use Responses`, async () => {
    const mock = responsesMock();
    const api = harness({ streamOpenAICompletion: mock.stream,
      getLimitsSettings: async () => ({ maxTotalToolCalls: capped ? 2 : 10, maxPerToolCalls: 10 }) });
    const result = await api.generateResponseWithTools('system', [], '', 'inspect', true, [], undefined,
      [{ filename: 'image.png', mimeType: 'image/png', base64: 'AAAA' }]);
    assert.equal(result.content, 'done');
    assert.equal(result.totalTokens, 27);
    assert.equal(mock.requests.length, 3);
    const finalInput = mock.requests[2].input as Array<Record<string, unknown>>;
    for (const output of mock.outputs.flat()) assert.deepEqual(finalInput.find(item => item.id === output.id), output);
    assert.deepEqual(finalInput.filter(item => item.type === 'function_call_output').map(item => item.call_id), ['call_1', 'call_2']);
    assert.ok(JSON.stringify(finalInput).includes('input_image'));
    if (capped) assert.equal(mock.requests[2].tool_choice, 'none');
    assert.ok(!JSON.stringify(result.fullHistory).includes('cipher-'));
  });
}

test('actual OpenAI completion/fallback wrappers preserve native Responses state and all tool IDs', async () => {
  const mock = responsesMock();
  const api = harness({ streamOpenAICompletion: mock.stream });
  const spec = { provider: 'openai' as const, model: 'gpt-6-astra', temperature: 0.3 };
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'user', content: 'inspect' }];
  for (const turn of [1, 2]) {
    const result = await api.generateToolCompletionWithFallback(spec, messages, tools as OpenAI.Chat.ChatCompletionTool[], 'required');
    messages.push(copyToolCompletionState(result, { role: 'assistant', content: result.content, tool_calls: result.tool_calls }));
    messages.push({ role: 'tool', tool_call_id: `call_${turn}`, content: 'ok' });
  }
  await api.generateToolCompletion(spec, messages, tools as OpenAI.Chat.ChatCompletionTool[], 'auto');
  const input = mock.requests[2].input as Array<Record<string, unknown>>;
  for (const output of mock.outputs.flat()) assert.deepEqual(input.find(item => item.id === output.id), output);
});

test('legacy Claude main tool turns still disable thinking', async () => {
  const mock = claudeMock([claudeMessage(1, 'end_turn')]);
  const api = harness({ getAnthropicClient: async () => mock.client, isModelThinkingCapable: async () => true });
  await api.generateResponseWithTools('system', [], '', 'q', true, [], undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, 'claude-sonnet-4-20250514',
    undefined, undefined, undefined, true);
  assert.ok(!('thinking' in mock.requests[0]));
});

test('Claude tool-limit final turn retains both native exchanges and mandatory thinking', async () => {
  const mock = claudeMock([claudeMessage(1), claudeMessage(2), claudeMessage(3, 'end_turn')]);
  const api = harness({ getAnthropicClient: async () => mock.client,
    getLimitsSettings: async () => ({ maxTotalToolCalls: 2, maxPerToolCalls: 10 }) });
  await api.generateResponseWithTools('system', [], '', 'q', true, [], undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, 'claude-opus-5-5');
  assert.equal(mock.requests.length, 3);
  const final = mock.requests[2];
  assert.equal(final.thinking?.type, 'adaptive');
  assert.ok(!('tools' in final));
  assert.deepEqual(final.messages[1].content, claudeMessage(1).content);
  assert.deepEqual(final.messages[3].content, claudeMessage(2).content);
});

test('main Claude refusal terminates without executing tools or requesting another model', async () => {
  const refused = claudeMessage(1, 'refusal');
  refused.content = claudeMessage(1).content; // Defensive: refusal wins even if a tool block is present.
  const mock = claudeMock([refused]);
  const api = harness({ getAnthropicClient: async () => mock.client,
    executeTool: () => { throw new Error('Refused tools must not execute'); } });
  const result = await api.generateResponseWithTools('system', [], '', 'q', true, [], undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, 'claude-fable-5-1');
  assert.equal(result.content, native.ANTHROPIC_REFUSAL_MESSAGE);
  assert.equal(mock.requests.length, 1);
});

test('actual streaming thinking/signature events replace first-chunk timeout; partial completion never returns state', async () => {
  let timerId = 0;
  const activeTimers = new Map<number, { callback: () => void; ms: number }>();
  const durations: number[] = [];
  const mock = claudeMock([claudeMessage(1)]);
  const api = harness({
    setTimeout: (callback: () => void, ms: number) => {
      durations.push(ms);
      activeTimers.set(++timerId, { callback, ms });
      return timerId;
    },
    clearTimeout: (id: number) => activeTimers.delete(id),
  });
  await api.streamAnthropicCompletion(mock.client,
    { model: 'claude-fable-5-1', messages: [{ role: 'user', content: 'q' }], max_tokens: 4096 },
    undefined, undefined, 80, 20);
  assert.deepEqual(durations, [20, 80]);
  assert.equal(activeTimers.size, 0);
  const partial = claudeMock([claudeMessage(1, 'max_tokens')]);
  await assert.rejects(api.streamAnthropicCompletion(partial.client,
    { model: 'claude-fable-5-1', messages: [{ role: 'user', content: 'q' }], max_tokens: 4096 }), /Incomplete/);
  assert.equal(activeTimers.size, 0);
});

test('main Responses history rebuild drops persisted tool exchanges before starting a new native loop', async () => {
  const mock = responsesMock();
  const api = harness({ streamOpenAICompletion: mock.stream });
  const history = [
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'old tool', tool_calls: [{ id: 'old', type: 'function', function: { name: 'inspect', arguments: '{}' } }] },
    { role: 'tool', content: 'old result', tool_call_id: 'old' },
  ] as Parameters<typeof api.generateResponseWithTools>[1];
  await api.generateResponseWithTools('system', history, '', 'new question');
  assert.ok(!JSON.stringify(mock.requests[0].input).includes('old tool'));
  assert.ok(!JSON.stringify(mock.requests[0].input).includes('old result'));
  assert.ok(JSON.stringify(mock.requests[0].input).includes('old question'));
});
