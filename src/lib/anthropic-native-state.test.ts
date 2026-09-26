import test from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ANTHROPIC_REFUSAL_MESSAGE, anthropicCompletionFromFinalMessage,
  applyAnthropicRequestPolicy, convertOpenAIMessagesToAnthropic,
  convertToolChoiceToAnthropic, copyAnthropicNativeState,
  getAnthropicNativeContent, handleAnthropicStreamEvent,
  type AnthropicConvertibleMessage,
} from './anthropic-native-state';
import { copyToolCompletionState } from './tool-completion-state';
import { buildThinkingRequestProfile } from './llm-thinking';

const model = 'claude-fable-5-1';
function finalMessage(turn: number, overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: `msg_${turn}`, type: 'message', role: 'assistant', model, container: null,
    stop_reason: 'tool_use', stop_sequence: null,
    content: [
      { type: 'thinking', thinking: `thinking-${turn}`, signature: `unaltered-signature-${turn}` },
      { type: 'redacted_thinking', data: `opaque-${turn}` },
      { type: 'text', text: `checking-${turn}`, citations: null },
      { type: 'tool_use', id: `call_${turn}`, name: 'inspect', input: { turn }, caller: { type: 'direct' } },
    ],
    usage: { input_tokens: 4, output_tokens: 5 } as Anthropic.Usage,
    ...overrides,
  };
}

test('two tool turns preserve full native blocks, ordering, signatures and images through wrappers', () => {
  const history: AnthropicConvertibleMessage[] = [{ role: 'user', content: [
    { type: 'text', text: 'Inspect these' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
  ] }];
  for (const turn of [1, 2]) {
    const native = finalMessage(turn);
    const result = anthropicCompletionFromFinalMessage(native, model);
    const wrapper = copyToolCompletionState(result, { content: result.content, tool_calls: result.tool_calls });
    const fallbackWrapper = copyToolCompletionState(wrapper, { ...wrapper, model_used: model });
    history.push(copyToolCompletionState(fallbackWrapper, { role: 'assistant', ...wrapper }));
    history.push({ role: 'tool', tool_call_id: `call_${turn}`, content: 'ok' });
    const request = convertOpenAIMessagesToAnthropic(history, { model });
    assert.deepEqual(request.anthropicMessages[turn * 2 - 1].content, native.content);
    assert.deepEqual(request.anthropicMessages[1].content, finalMessage(1).content);
    assert.ok(!JSON.stringify(history).includes('unaltered-signature'));
    assert.ok(!JSON.stringify(history).includes('opaque-'));
    assert.equal(result.totalTokens, 9);
  }
  const first = convertOpenAIMessagesToAnthropic(history, { model }).anthropicMessages[0];
  assert.deepEqual(first.content, [
    { type: 'text', text: 'Inspect these' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'image', source: { type: 'url', url: 'https://example.com/image.png' } },
  ]);
});

test('native snapshots cannot be corrupted by input or replay mutations', () => {
  const native = finalMessage(1);
  const expected = structuredClone(native.content);
  const result = anthropicCompletionFromFinalMessage(native, model);
  native.content.length = 0;
  const copied = copyAnthropicNativeState(result, {});
  getAnthropicNativeContent(copied)!.length = 0;
  assert.deepEqual(getAnthropicNativeContent(copied), expected);
  assert.throws(() => getAnthropicNativeContent(copied, 'claude-opus-5-5'), /different model/);
});

for (const [id, effort] of [['claude-fable-5-1', 'high'], ['anthropic/claude-opus-5-5', 'medium']]) {
  test(`${id}: mandatory adaptive policy overrides disabled/manual thinking and forced tools`, () => {
    for (const thinking of [{ type: 'disabled' }, { type: 'enabled', budget_tokens: 1000 }] as const) {
      for (const choice of ['required', { type: 'function', function: { name: 'inspect' } }] as const) {
        const params = applyAnthropicRequestPolicy({
          model: id, messages: [{ role: 'user', content: 'question' }],
          temperature: 0.2, top_p: 0.9, top_k: 20, thinking,
          tool_choice: convertToolChoiceToAnthropic(choice),
        });
        assert.deepEqual(params.thinking, { type: 'adaptive' });
        assert.deepEqual((params as { output_config?: unknown }).output_config, { effort });
        assert.deepEqual(params.tool_choice, { type: 'auto' });
        for (const key of ['temperature', 'top_p', 'top_k']) assert.ok(!(key in params));
      }
    }
    const profile = buildThinkingRequestProfile({ modelId: id, thinkingCapable: false,
      thinkingEnabled: false, forcePlain: true, toolsEnabled: true, maxTokens: 4096 });
    assert.equal(profile.enabled, true);
    assert.equal((profile.requestParams.thinking as { type: string }).type, 'adaptive');
    assert.deepEqual(profile.requestParams.output_config, { effort });
  });
}

test('auto/none and valid effort survive; invalid effort defaults; legacy policy is unchanged', () => {
  for (const type of ['auto', 'none'] as const) {
    const params = applyAnthropicRequestPolicy({ model, messages: [{ role: 'user', content: 'q' }],
      tool_choice: { type }, output_config: { effort: 'low' } });
    assert.deepEqual(params.tool_choice, { type });
    assert.deepEqual(params.output_config, { effort: 'low' });
  }
  assert.deepEqual(applyAnthropicRequestPolicy({ model, messages: [],
    output_config: { effort: 'none' } as unknown as Anthropic.OutputConfig }).output_config, { effort: 'high' });
  const legacy = { model: 'claude-sonnet-4-20250514', messages: [], temperature: 0.3,
    thinking: { type: 'disabled' } as const, tool_choice: { type: 'any' } as const };
  assert.equal(applyAnthropicRequestPolicy(legacy), legacy);
});

test('affected models reject prefills, not completed tool-result turns', () => {
  assert.throws(() => applyAnthropicRequestPolicy({ model,
    messages: [{ role: 'assistant', content: 'Here is' }] }), /prefills/);
  assert.doesNotThrow(() => applyAnthropicRequestPolicy({ model,
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] }] }));
});

test('refusals preserve provider text or use generic fallback, never tools or bypass advice', () => {
  for (const id of [model, 'claude-opus-5-5', 'claude-sonnet-4-20250514']) {
    const withText = anthropicCompletionFromFinalMessage(finalMessage(1, { stop_reason: 'refusal' }), id);
    assert.equal(withText.content, 'checking-1');
    assert.equal(withText.tool_calls, undefined);
    assert.ok(!getAnthropicNativeContent(withText)?.some(block => block.type === 'tool_use'));
    const empty = anthropicCompletionFromFinalMessage(finalMessage(1, { stop_reason: 'refusal', content: [] }), id);
    assert.equal(empty.content, ANTHROPIC_REFUSAL_MESSAGE);
    assert.doesNotMatch(empty.content!, /guardrail|classifier|rephrase|different model/i);
  }
});

test('partial/unsigned reasoning is rejected, never reconstructed or given a fabricated signature', () => {
  for (const stop_reason of [null, 'max_tokens', 'pause_turn'] as const) {
    assert.throws(() => anthropicCompletionFromFinalMessage(finalMessage(1, { stop_reason }), model), /Incomplete/);
  }
  assert.throws(() => anthropicCompletionFromFinalMessage(finalMessage(1, {
    content: [{ type: 'thinking', thinking: 'partial', signature: '' }],
  }), model), /signature/);
});

test('serialized/trimmed tool history fails closed; explicit rebuild removes whole old exchanges', () => {
  const result = anthropicCompletionFromFinalMessage(finalMessage(1), model);
  const history = [
    { role: 'user', content: 'first' },
    copyToolCompletionState(result, { role: 'assistant', content: result.content, tool_calls: result.tool_calls }),
    { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    { role: 'user', content: 'next' },
  ];
  const serialized = JSON.parse(JSON.stringify(history));
  assert.throws(() => convertOpenAIMessagesToAnthropic(serialized, { model }), /Missing Claude native state/);
  assert.throws(() => convertOpenAIMessagesToAnthropic(history.slice(2), { model }), /Orphaned/);
  assert.throws(() => convertOpenAIMessagesToAnthropic(history.slice(0, 2), { model }), /missing tool results/);
  assert.deepEqual(convertOpenAIMessagesToAnthropic(serialized, { model, boundary: 'rebuild' }).anthropicMessages,
    [{ role: 'user', content: [{ type: 'text', text: 'first' }] }, { role: 'user', content: [{ type: 'text', text: 'next' }] }]);
});

test('thinking and signature events reset activity timer without inventing replay state', () => {
  let resets = 0;
  let display = '';
  for (const delta of [
    { type: 'thinking_delta', thinking: 'live thinking' },
    { type: 'signature_delta', signature: 'not-display-text' },
  ] as const) {
    handleAnthropicStreamEvent({ type: 'content_block_delta', index: 0, delta },
      () => resets++, text => { display += text; });
  }
  assert.equal(resets, 2);
  assert.equal(display, 'live thinking');
});

test('consecutive results are batched and unsupported images are not silently stringified', () => {
  const result = anthropicCompletionFromFinalMessage(finalMessage(1, { content: [
    ...finalMessage(1).content, { type: 'tool_use', id: 'second', name: 'inspect', input: {}, caller: { type: 'direct' } },
  ] }), model);
  const converted = convertOpenAIMessagesToAnthropic([
    copyToolCompletionState(result, { role: 'assistant' }),
    { role: 'tool', tool_call_id: 'call_1', content: 'one' },
    { role: 'tool', tool_call_id: 'second', content: 'two' },
  ], { model });
  assert.equal(converted.anthropicMessages.length, 2);
  assert.equal(converted.anthropicMessages[1].content.length, 2);
  assert.throws(() => convertOpenAIMessagesToAnthropic([{ role: 'user', content: [
    { type: 'image_url', image_url: { url: 'data:image/svg+xml;base64,AAAA' } },
  ] }]), /Unsupported Claude image/);
});
