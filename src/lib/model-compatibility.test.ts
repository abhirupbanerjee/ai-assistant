import assert from 'node:assert/strict';
import test from 'node:test';
import { getModelCompatibility, normalizeModelId } from './model-compatibility';
import {
  buildThinkingRequestProfile,
  getTemperatureForModel,
  isClaudeAdaptiveThinkingModel,
  isDefaultThinkingEnabledModel,
  isLikelyThinkingCapableModel,
  isTemperatureUnsupportedModel,
} from './llm-thinking';

const MODELS = [
  ['gpt-6-astra', true, 'medium', 'effort'],
  ['gpt-6-sol', false, 'medium', 'effort'],
  ['gpt-6-luna', false, 'medium', 'effort'],
  ['claude-fable-5-1', true, 'high', 'adaptive'],
  ['claude-opus-5-5', true, 'medium', 'adaptive'],
] as const;

for (const [model, mandatory, effort, mode] of MODELS) {
  test(`${model}: explicit compatibility and provider normalization`, () => {
    const compatibility = getModelCompatibility(model);
    assert.ok(compatibility);
    const adaptive = mode === 'adaptive';
    assert.deepEqual(compatibility, {
      omitSampling: true,
      alwaysThinking: mandatory,
      defaultEffort: effort,
      allowedEfforts: model === 'claude-opus-5-5' ? ['low', 'medium', 'high', 'xhigh', 'max']
        : adaptive ? ['low', 'medium', 'high', 'max']
        : mandatory ? ['low', 'medium', 'high', 'xhigh', 'max']
          : ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      reasoningMode: mode,
      toolEndpoint: adaptive ? 'messages' : 'responses',
      supportsPrefill: false,
      supportsForcedToolChoice: !adaptive,
      contextWindow: adaptive ? 1_000_000 : 1_050_000,
      maxOutputTokens: 128_000,
    });
    for (const prefix of ['', 'openai/', 'anthropic/', 'azure-foundry/', 'gateway/provider/', 'ollama-']) {
      const qualified = ` ${prefix}${model.toUpperCase()}:latest `;
      assert.equal(normalizeModelId(qualified), model);
      assert.equal(getModelCompatibility(qualified), compatibility);
      assert.equal(isLikelyThinkingCapableModel(qualified), true);
      assert.equal(isDefaultThinkingEnabledModel(qualified), true);
      assert.equal(isClaudeAdaptiveThinkingModel(qualified), adaptive);
      assert.equal(isTemperatureUnsupportedModel(qualified), true);
      for (const temperature of [undefined, 0, 0.3, 1, 2]) {
        assert.equal(getTemperatureForModel(qualified, temperature), undefined);
      }
    }
    assert.ok(Object.isFrozen(compatibility));
    assert.ok(Object.isFrozen(compatibility.allowedEfforts));
    assert.ok(compatibility.allowedEfforts.includes(compatibility.defaultEffort));
  });

  test(`${model}: profile honors mandatory reasoning, defaults, toggles, and tool turns`, () => {
    for (const thinkingCapable of [undefined, false, true]) {
      for (const thinkingEnabled of [undefined, false, true]) {
        for (const forcePlain of [undefined, false, true]) {
          for (const toolsEnabled of [false, true]) {
            const profile = buildThinkingRequestProfile({
              modelId: `provider/${model}`,
              thinkingCapable,
              thinkingEnabled,
              forcePlain,
              toolsEnabled,
            });
            const enabled = mandatory || ((thinkingEnabled ?? true) && !forcePlain);
            assert.equal(profile.capable, true);
            assert.equal(profile.defaultEnabled, true);
            assert.equal(profile.enabled, enabled);
            if (mode === 'adaptive') {
              assert.deepEqual(profile.requestParams, {
                thinking: { type: 'adaptive', display: 'summarized' },
                output_config: { effort },
              });
              assert.equal(profile.requiresThinkingStatePreservation, true);
              assert.deepEqual(profile.streamFields, ['think_tags', 'thinking']);
            } else {
              assert.deepEqual(profile.requestParams, { reasoning_effort: enabled ? effort : 'none' });
              assert.equal(profile.requiresThinkingStatePreservation, false);
              assert.deepEqual(profile.streamFields, enabled ? ['think_tags', 'reasoning_content'] : ['think_tags']);
            }
          }
        }
      }
    }
  });
}

test('compatibility only overrides exact IDs, not unknown families, suffixes, or object keys', () => {
  for (const model of [
    '', 'gpt-6', 'gpt-6-astra-mini', 'gpt-6-astra-2026-09-01', 'gpt-6-sol-pro',
    'gpt-6-luna-preview', 'claude-fable-5', 'claude-fable-5-10', 'claude-opus-5',
    'claude-opus-5-50', 'claude-opus-5-5-latest', 'gpt-5.6', 'toString', '__proto__', 'constructor',
  ]) {
    assert.equal(getModelCompatibility(model), undefined, model);
    assert.equal(getModelCompatibility(`provider/${model}`), undefined, model);
  }
  assert.equal(isLikelyThinkingCapableModel('gpt-6-astra-mini'), false);
  assert.equal(isClaudeAdaptiveThinkingModel('claude-opus-5-50'), false);
});

test('legacy temperatures retain existing omission, locking, and default behavior', () => {
  for (const model of ['o3', 'claude-opus-4-7', 'claude-fable-5', 'moonshot/kimi-k2.6']) {
    assert.equal(getTemperatureForModel(model, 0.7), undefined, model);
  }
  for (const model of ['gpt-5.4', 'gpt-5.6-sol', 'deepseek-reasoner', 'deepseek-v4-pro']) {
    assert.equal(getTemperatureForModel(model, 0.7), 1, model);
  }
  assert.equal(getTemperatureForModel('gpt-4o', undefined), 0.3);
  assert.equal(getTemperatureForModel('gpt-4o', 0), 0);
});

test('legacy GPT-5 tool restrictions and effort defaults remain unchanged', () => {
  for (const model of ['gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-luna']) {
    for (const toolsEnabled of [false, true]) {
      for (const thinkingEnabled of [false, true]) {
        const profile = buildThinkingRequestProfile({
          modelId: model, thinkingCapable: true, thinkingEnabled, toolsEnabled,
        });
        const gpt56 = model.startsWith('gpt-5.6');
        const expected = toolsEnabled ? (gpt56 ? 'none' : undefined)
          : !thinkingEnabled ? 'none'
            : ['gpt-5.6', 'gpt-5.6-sol'].includes(model) ? 'max' : 'high';
        assert.equal(profile.enabled, thinkingEnabled);
        assert.equal(profile.requestParams.reasoning_effort, expected);
      }
    }
  }
});

test('legacy capability gating, UI defaults, forcePlain, and Claude budgets are preserved', () => {
  for (const model of ['gpt-5.6', 'claude-fable-5', 'claude-sonnet-5', 'deepseek-v4-pro']) {
    assert.equal(buildThinkingRequestProfile({ modelId: model, thinkingEnabled: true }).capable, false);
    const disabled = buildThinkingRequestProfile({ modelId: model, thinkingCapable: true });
    assert.equal(disabled.enabled, false);
    const plain = buildThinkingRequestProfile({
      modelId: model, thinkingCapable: true, thinkingEnabled: true, forcePlain: true,
    });
    assert.equal(plain.enabled, false);
  }
  assert.equal(buildThinkingRequestProfile({ modelId: 'o3', thinkingCapable: true, thinkingEnabled: true }).capable, false);
  const adaptive = buildThinkingRequestProfile({ modelId: 'claude-fable-5', thinkingCapable: true, thinkingEnabled: true });
  assert.deepEqual(adaptive.requestParams, {
    thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' },
  });
  const legacy = buildThinkingRequestProfile({
    modelId: 'claude-sonnet-4-5', thinkingCapable: true, thinkingEnabled: true, maxTokens: 2048,
  });
  assert.deepEqual(legacy.requestParams, { thinking: { type: 'enabled', budget_tokens: 1024 } });
  assert.equal(legacy.requiresThinkingStatePreservation, true);
});
