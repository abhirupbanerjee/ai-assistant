import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThinkingRequestProfile, getTemperatureForModel } from './llm-thinking';

test('Kimi K2.6 enables retained thinking and reasoning-content preservation', () => {
  const profile = buildThinkingRequestProfile({
    modelId: 'moonshot/kimi-k2.6',
    thinkingCapable: true,
    thinkingEnabled: true,
  });

  assert.equal(profile.enabled, true);
  assert.deepEqual(profile.requestParams.thinking, { type: 'enabled', keep: 'all' });
  assert.equal(profile.requiresThinkingStatePreservation, true);
  assert.ok(profile.streamFields.includes('reasoning_content'));
});

test('Kimi K2.6 can explicitly disable thinking for short tasks', () => {
  const profile = buildThinkingRequestProfile({
    modelId: 'moonshot/kimi-k2.6',
    thinkingCapable: true,
    thinkingEnabled: false,
  });

  assert.equal(profile.enabled, false);
  assert.deepEqual(profile.requestParams.thinking, { type: 'disabled' });
});

test('Kimi requests omit temperature rather than forcing a value', () => {
  assert.equal(getTemperatureForModel('moonshot/kimi-k2.6', 0.3), undefined);
  assert.equal(getTemperatureForModel('moonshot/kimi-k2.7-code', 1), undefined);
});

test('Kimi K3 uses reasoning effort without K2.6 thinking controls', () => {
  const profile = buildThinkingRequestProfile({
    modelId: 'moonshot/kimi-k3',
    thinkingCapable: true,
    thinkingEnabled: true,
  });

  assert.equal(profile.requestParams.reasoning_effort, 'high');
  assert.equal(profile.requestParams.thinking, undefined);
});
